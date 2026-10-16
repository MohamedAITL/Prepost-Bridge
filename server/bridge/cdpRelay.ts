import crypto from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config';
import { logger } from '../utils/logger';
import { readSettings, writeSettings } from '../utils/settings';

/**
 * Extension bridge: lets Playwright drive tabs in YOUR everyday Chrome profile.
 *
 *   Playwright ──CDP──▶ this relay ──JSON──▶ extension (chrome.debugger) ──▶ tabs it opened
 *
 * The relay pretends to be a browser-level CDP endpoint for Playwright's connectOverCDP. Each tab
 * the automation creates becomes one Playwright page; commands for it are forwarded to the
 * extension, which runs them with chrome.debugger.sendCommand. The extension never attaches to
 * tabs it did not open, and new tabs open in the background so you stay where you are.
 *
 * Security: the extension endpoint requires a chrome-extension:// origin and the pairing code;
 * the CDP endpoint path contains a per-process random secret known only to this server.
 */

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface TabEntry {
  tabId: number;
  sessionId: string;
  targetId: string;
}

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: unknown };

class CdpRelay extends EventEmitter {
  private readonly cdpSecret = crypto.randomBytes(24).toString('hex');
  private extWs: WebSocket | null = null;
  private extInfo: { version?: string; userAgent?: string } = {};
  private cdpClient: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private tabs = new Map<string, TabEntry>(); // by our sessionId
  private childSessions = new Map<string, number>(); // iframe/worker sessionId -> tabId
  /** The most recently created tab (read right after Playwright's newPage, which is serialized). */
  lastCreated: TabEntry | null = null;
  private detachReasons = new Map<number, string>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });

  /** Pairing code the user pastes into the extension once. Stored with app settings. */
  get pairingCode(): string {
    const settings = readSettings();
    if (typeof settings.bridgeToken === 'string' && settings.bridgeToken.length >= 32) return settings.bridgeToken;
    const token = crypto.randomBytes(16).toString('hex');
    writeSettings({ bridgeToken: token });
    return token;
  }

  status() {
    return { extensionConnected: !!this.extWs, extensionVersion: this.extInfo.version ?? null, controlledTabs: this.tabs.size };
  }

  private server: Server | null = null;

  cdpUrl() {
    const addr = this.server?.address();
    const port = addr && typeof addr === 'object' ? addr.port : config.port;
    return `ws://127.0.0.1:${port}/bridge/cdp/${this.cdpSecret}`;
  }

  attach(server: Server) {
    this.server = server;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      const reject = (code: number) => {
        socket.write(`HTTP/1.1 ${code} Forbidden\r\n\r\n`);
        socket.destroy();
      };
      if (!['127.0.0.1', 'localhost'].includes(host)) return reject(403);

      if (url.pathname === '/bridge/extension') {
        const origin = String(req.headers.origin ?? '');
        const token = url.searchParams.get('token') ?? '';
        const expected = this.pairingCode;
        const ok = origin.startsWith('chrome-extension://') && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
        if (!ok) {
          logger.warn('bridge', `Rejected extension connection (${origin ? 'bad pairing code' : 'not an extension'})`);
          return reject(403);
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this.onExtension(ws));
        return;
      }
      if (url.pathname === `/bridge/cdp/${this.cdpSecret}` && !req.headers.origin) {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.onCdpClient(ws));
        return;
      }
      reject(404);
    });
  }

  // ---------- extension side ----------

  private onExtension(ws: WebSocket) {
    if (this.extWs) this.extWs.close(4000, 'replaced');
    this.extWs = ws;
    logger.info('bridge', 'Chrome extension connected');
    this.emit('change');
    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.onExtensionMessage(msg);
    });
    ws.on('close', () => {
      if (this.extWs !== ws) return;
      this.extWs = null;
      logger.info('bridge', 'Chrome extension disconnected');
      for (const [id, p] of this.pending) {
        p.reject(new Error('The Chrome extension disconnected.'));
        this.pending.delete(id);
      }
      for (const entry of [...this.tabs.values()]) this.dropTab(entry);
      this.cdpClient?.close();
      this.emit('change');
    });
  }

  private onExtensionMessage(msg: Record<string, unknown>) {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    switch (msg.type) {
      case 'hello':
        this.extInfo = { version: String(msg.version ?? ''), userAgent: String(msg.userAgent ?? '') };
        this.emit('change');
        break;
      case 'event': {
        if (process.env.SPA_BRIDGE_DEBUG) logger.info('bridge', `event ${String(msg.method)}${msg.sessionId ? ' (child)' : ''}`);
        const entry = this.entryForTab(Number(msg.tabId));
        if (!entry) return;
        const method = String(msg.method);
        const params = (msg.params ?? {}) as Record<string, unknown>;
        if (method === 'Target.attachedToTarget' && typeof params.sessionId === 'string') this.childSessions.set(params.sessionId, entry.tabId);
        if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') this.childSessions.delete(params.sessionId);
        const sessionId = typeof msg.sessionId === 'string' && msg.sessionId ? msg.sessionId : entry.sessionId;
        this.sendToClient({ method, params, sessionId });
        break;
      }
      case 'detached':
      case 'tabClosed': {
        const entry = this.entryForTab(Number(msg.tabId));
        if (entry) {
          this.detachReasons.set(entry.tabId, msg.type === 'tabClosed' ? 'tab_closed' : String(msg.reason ?? ''));
          logger.info('bridge', `Tab ${entry.tabId} ${msg.type === 'tabClosed' ? 'closed' : `detached (${String(msg.reason ?? '')})`}`);
          this.dropTab(entry);
        }
        break;
      }
    }
  }

  private callExtension<T>(payload: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    const ws = this.extWs;
    if (!ws) return Promise.reject(new Error('The Chrome extension is not connected.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome extension did not answer (${String(payload.method ?? payload.type)}).`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  private entryForTab(tabId: number) {
    return [...this.tabs.values()].find((t) => t.tabId === tabId);
  }

  private dropTab(entry: TabEntry) {
    if (!this.tabs.delete(entry.sessionId)) return;
    for (const [sid, tabId] of this.childSessions) if (tabId === entry.tabId) this.childSessions.delete(sid);
    this.sendToClient({ method: 'Target.detachedFromTarget', params: { sessionId: entry.sessionId, targetId: entry.targetId } });
    this.emit('change');
  }

  /** Why Chrome stopped automation of a tab ('canceled_by_user' = the debugging bar was cancelled). */
  detachReason(tabId: number): string | null {
    return this.detachReasons.get(tabId) ?? null;
  }

  /**
   * Stop automating a tab but leave it open for the user. Chrome's "started debugging" bar goes
   * away once no tab is under automation.
   */
  async release(tabId: number) {
    const entry = this.entryForTab(tabId);
    if (!entry) return;
    await this.callExtension({ type: 'detachTab', tabId }).catch(() => undefined);
    this.dropTab(entry);
  }

  /** Take control of an existing tab again (one the assistant opened and released earlier). */
  async adoptTab(tabId: number): Promise<void> {
    if (this.entryForTab(tabId)) throw new Error('This tab is already under automation.');
    const r = await this.callExtension<{ tabId: number; targetId?: string }>({ type: 'attachTab', tabId });
    if (!r.targetId) throw new Error('The extension could not identify the tab.');
    const entry: TabEntry = { tabId: r.tabId, sessionId: `bridge-tab-${r.tabId}-${Date.now()}`, targetId: r.targetId };
    this.tabs.set(entry.sessionId, entry);
    this.lastCreated = entry;
    this.emit('change');
    this.sendToClient({
      method: 'Target.attachedToTarget',
      params: {
        sessionId: entry.sessionId,
        targetInfo: { targetId: entry.targetId, type: 'page', title: '', url: '', attached: true, canAccessOpener: false, browserContextId: 'bridge-default' },
        waitingForDebugger: false,
      },
    });
  }

  /** Bring a tab (controlled or released) to the front. */
  async activate(tabId: number, opts: { focusWindow?: boolean } = {}) {
    await this.callExtension({ type: 'activateTab', tabId, focusWindow: opts.focusWindow ?? true });
  }

  /** The tab the user is looking at (in the last focused Chrome window). */
  async activeTab(): Promise<number | null> {
    const r = await this.callExtension<{ tabId: number | null }>({ type: 'getActiveTab' }, 5000);
    return r.tabId ?? null;
  }

  // ---------- Playwright side ----------

  private onCdpClient(ws: WebSocket) {
    if (this.cdpClient) this.cdpClient.close();
    this.cdpClient = ws;
    ws.on('message', (raw) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handleCdp(msg).then(
        (result) => {
          if (process.env.SPA_BRIDGE_DEBUG) logger.info('bridge', `← ok ${msg.method}`);
          this.sendToClient({ id: msg.id, sessionId: msg.sessionId, result: result ?? {} });
        },
        (e: Error) => {
          if (process.env.SPA_BRIDGE_DEBUG) logger.warn('bridge', `← error ${msg.method}: ${e.message}`);
          this.sendToClient({ id: msg.id, sessionId: msg.sessionId, error: { code: -32000, message: e.message } });
        },
      );
    });
    ws.on('close', () => {
      if (this.cdpClient !== ws) return;
      this.cdpClient = null;
      // Playwright disconnected: release the tabs (they stay open for you to review).
      for (const entry of [...this.tabs.values()]) {
        this.tabs.delete(entry.sessionId);
        void this.callExtension({ type: 'detachTab', tabId: entry.tabId }).catch(() => undefined);
      }
      this.childSessions.clear();
      this.emit('change');
    });
  }

  private sendToClient(msg: CdpMessage) {
    if (this.cdpClient?.readyState === WebSocket.OPEN) this.cdpClient.send(JSON.stringify(msg));
  }

  private async handleCdp(msg: CdpMessage): Promise<unknown> {
    const method = msg.method ?? '';
    const params = msg.params ?? {};
    if (process.env.SPA_BRIDGE_DEBUG) logger.info('bridge', `→ ${msg.sessionId ? 'tab ' : ''}${method}`);

    if (!msg.sessionId) {
      switch (method) {
        case 'Browser.getVersion':
          return { protocolVersion: '1.3', product: 'Chrome/ExtensionBridge', revision: '', userAgent: this.extInfo.userAgent ?? '', jsVersion: '' };
        case 'Browser.setDownloadBehavior':
        case 'Target.setAutoAttach':
        case 'Target.setDiscoverTargets':
          return {};
        case 'Target.getTargetInfo':
          return { targetInfo: { targetId: 'bridge-browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } };
        case 'Target.getBrowserContexts':
          return { browserContextIds: [] };
        case 'Target.createTarget': {
          const created = await this.callExtension<{ tabId: number; targetId?: string }>({ type: 'createTab', url: 'about:blank', active: false });
          if (!created.targetId) throw new Error('The extension could not identify the new tab.');
          const entry: TabEntry = { tabId: created.tabId, sessionId: `bridge-tab-${created.tabId}`, targetId: created.targetId };
          this.tabs.set(entry.sessionId, entry);
          this.lastCreated = entry;
          this.emit('change');
          this.sendToClient({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: entry.sessionId,
              targetInfo: { targetId: entry.targetId, type: 'page', title: '', url: 'about:blank', attached: true, canAccessOpener: false, browserContextId: 'bridge-default' },
              waitingForDebugger: false,
            },
          });
          return { targetId: entry.targetId };
        }
        case 'Target.closeTarget': {
          const entry = [...this.tabs.values()].find((t) => t.targetId === params.targetId);
          if (entry) {
            await this.callExtension({ type: 'closeTab', tabId: entry.tabId });
            this.dropTab(entry); // Playwright waits for detachedFromTarget after closing
          }
          return { success: true };
        }
        case 'Target.activateTarget': {
          const entry = [...this.tabs.values()].find((t) => t.targetId === params.targetId);
          if (entry) await this.callExtension({ type: 'activateTab', tabId: entry.tabId });
          return {};
        }
        case 'Browser.close':
          return {};
        default:
          throw new Error(`${method} is not available through the extension bridge.`);
      }
    }

    const entry = this.tabs.get(msg.sessionId);
    if (entry) {
      if (method === 'Runtime.runIfWaitingForDebugger') return {};
      if (method === 'Page.bringToFront') return this.callExtension({ type: 'activateTab', tabId: entry.tabId });
      if (method === 'Target.setAutoAttach') {
        return this.callExtension({ type: 'command', tabId: entry.tabId, method, params }).catch(() => ({}));
      }
      return this.callExtension({ type: 'command', tabId: entry.tabId, method, params }, 10 * 60_000);
    }
    const childTab = this.childSessions.get(msg.sessionId);
    if (childTab !== undefined) {
      if (method === 'Runtime.runIfWaitingForDebugger') {
        return this.callExtension({ type: 'command', tabId: childTab, sessionId: msg.sessionId, method, params }).catch(() => ({}));
      }
      return this.callExtension({ type: 'command', tabId: childTab, sessionId: msg.sessionId, method, params }, 10 * 60_000);
    }
    throw new Error('Session closed.');
  }
}

export const cdpRelay = new CdpRelay();
