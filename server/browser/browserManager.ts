import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserMode, BrowserState } from '../../shared/jobs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { readSettings, writeSettings } from '../utils/settings';
import { cdpRelay } from '../bridge/cdpRelay';

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');

const MODES: BrowserMode[] = ['bundled', 'chrome', 'extension'];

function loadMode(): BrowserMode {
  const env = process.env.SPA_BROWSER_MODE as BrowserMode | undefined;
  if (env && MODES.includes(env)) return env;
  const saved = readSettings().browserMode as BrowserMode | undefined;
  return saved && MODES.includes(saved) ? saved : 'bundled';
}

/** Locations of an installed Google Chrome. SPA_CHROME_PATH wins. */
export function findChrome(): string | null {
  const candidates = [
    process.env.SPA_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

async function debugEndpointUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${config.chromeDebugPort}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function pageTargetCount(): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${config.chromeDebugPort}/json/list`, { signal: AbortSignal.timeout(3000) });
  const targets = (await res.json()) as { type: string }[];
  return targets.filter((t) => t.type === 'page').length;
}

/** Make sure the debuggable Chrome has at least one window, using its own DevTools endpoint. */
async function ensureChromeWindow(): Promise<void> {
  if ((await pageTargetCount()) > 0) return;
  logger.info('browser', 'Chrome has no open window; opening one');
  const version = (await (await fetch(`http://127.0.0.1:${config.chromeDebugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach Chrome to open a window.'));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome did not open a window.')), 10_000);
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        if (msg.error) reject(new Error(`Chrome could not open a window: ${msg.error.message}`));
        else resolve();
      };
      ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true } }));
    });
  } finally {
    ws.close();
  }
  const deadline = Date.now() + 10_000;
  while ((await pageTargetCount()) === 0) {
    if (Date.now() > deadline) throw new Error('Chrome has no open window. Quit the assistant Chrome (Cmd+Q) and click Connect Chrome again.');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Owns the browser the automation drives. Two modes:
 *  - 'bundled': Playwright's Chromium with a persistent profile, launched and closed by the app.
 *  - 'chrome':  your installed Google Chrome, started with its own profile and a local-only
 *               debugging port, then attached to. It stays open as a normal Chrome window you can
 *               use (including for this dashboard); "Close" only detaches the automation.
 * Logins are always done manually on the official sites; nothing here handles passwords.
 */
class BrowserManager extends EventEmitter {
  private context: BrowserContext | null = null;
  private browser: Browser | null = null;
  private launching: Promise<BrowserContext> | null = null;
  private mode: BrowserMode = loadMode();
  private bridgeLock: Promise<unknown> = Promise.resolve();
  private bridgeTabs = new WeakMap<Page, number>();

  /** Chrome tab id of a page opened through the extension bridge. */
  bridgeTabId(page: Page): number | null {
    return this.bridgeTabs.get(page) ?? null;
  }

  get currentMode(): BrowserMode {
    return this.mode;
  }

  /** Extension mode: take control of a tab opened (and released) earlier, instead of a new one. */
  async adoptBridgeTab(tabId: number): Promise<Page> {
    const ctx = await this.getContext();
    const run = this.bridgeLock.then(async () => {
      const appeared = ctx.waitForEvent('page', { timeout: 20_000 });
      appeared.catch(() => undefined);
      await cdpRelay.adoptTab(tabId);
      const p = await appeared;
      this.bridgeTabs.set(p, tabId);
      return p;
    });
    this.bridgeLock = run.catch(() => undefined);
    return run;
  }

  /** Extension mode: stop automating the tab, leaving it open (removes Chrome's debugging bar). */
  async releasePage(page: Page) {
    const tabId = this.bridgeTabs.get(page);
    if (tabId != null) await cdpRelay.release(tabId);
  }

  /**
   * Make this tab the visible one in its window (Chrome pauses video work in hidden tabs) and
   * return a function that puts back the tab the user was on.
   */
  async showTab(page: Page): Promise<() => Promise<void>> {
    const tabId = this.bridgeTabs.get(page);
    if (this.mode === 'extension' && tabId != null) {
      const previous = await cdpRelay.activeTab().catch(() => null);
      await cdpRelay.activate(tabId, { focusWindow: false });
      return async () => {
        if (previous != null && previous !== tabId) await cdpRelay.activate(previous, { focusWindow: false }).catch(() => undefined);
      };
    }
    await page.bringToFront();
    return async () => undefined;
  }

  async focusBridgeTab(tabId: number) {
    await cdpRelay.activate(tabId);
  }

  state(): BrowserState {
    return {
      open: !!this.context,
      mode: this.mode,
      profileDir: this.mode === 'chrome' ? config.chromeProfileDir : this.mode === 'extension' ? 'your own Chrome profile' : config.profileDir,
      channel: this.mode === 'chrome' ? 'Google Chrome' : this.mode === 'extension' ? 'your Chrome (extension bridge)' : config.browserChannel || 'chromium (bundled)',
      chromeAvailable: !!findChrome(),
      bridge: { ...cdpRelay.status(), pairingCode: cdpRelay.pairingCode, extensionDir: EXTENSION_DIR, port: config.port },
    };
  }

  async setMode(mode: BrowserMode) {
    if (mode === this.mode) return;
    if (mode === 'chrome' && !findChrome()) throw new Error('Google Chrome was not found. Install it or set SPA_CHROME_PATH.');
    await this.close();
    this.mode = mode;
    writeSettings({ browserMode: mode });
    logger.info('browser', `Browser mode set to ${mode}`);
    this.emit('change', this.state());
  }

  async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    const start = this.mode === 'chrome' ? this.attachChrome() : this.mode === 'extension' ? this.attachExtension() : this.launchBundled();
    this.launching = start.finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private onGone() {
    this.context = null;
    this.browser = null;
    this.emit('change', this.state());
  }

  private async launchBundled(): Promise<BrowserContext> {
    await fsp.mkdir(config.profileDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(config.profileDir, 0o700);
    logger.info('browser', `Launching visible browser (${this.state().channel}) with profile ${config.profileDir}`);
    const context = await chromium.launchPersistentContext(config.profileDir, {
      headless: false,
      channel: config.browserChannel || undefined,
      viewport: null,
      acceptDownloads: false,
      args: ['--start-maximized'],
    });
    context.on('close', () => {
      logger.info('browser', 'Browser closed');
      this.onGone();
    });
    this.context = context;
    this.emit('change', this.state());
    return context;
  }

  private async attachChrome(): Promise<BrowserContext> {
    if (!(await debugEndpointUp())) {
      const bin = findChrome();
      if (!bin) throw new Error('Google Chrome was not found. Install it or set SPA_CHROME_PATH.');
      await fsp.mkdir(config.chromeProfileDir, { recursive: true, mode: 0o700 });
      await fsp.chmod(config.chromeProfileDir, 0o700);
      logger.info('browser', `Starting Google Chrome with profile ${config.chromeProfileDir}`);
      const child = spawn(
        bin,
        [
          `--remote-debugging-port=${config.chromeDebugPort}`,
          '--remote-debugging-address=127.0.0.1',
          `--user-data-dir=${config.chromeProfileDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          // Keep automation running in background tabs (you stay on your current tab).
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        ],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
      const deadline = Date.now() + 30_000;
      while (!(await debugEndpointUp())) {
        if (Date.now() > deadline) throw new Error('Chrome did not start its local automation port. Close any Chrome window using the assistant profile and try again.');
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      logger.info('browser', `Attaching to the Chrome already listening on 127.0.0.1:${config.chromeDebugPort}`);
    }
    // On macOS, closing Chrome's last window leaves it running with no windows; it then refuses
    // automation ("Browser context management is not supported"). Open a window first.
    await ensureChromeWindow();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.chromeDebugPort}`, { isLocal: true });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    browser.on('disconnected', () => {
      logger.info('browser', 'Detached from Google Chrome');
      this.onGone();
    });
    this.browser = browser;
    this.context = context;
    this.emit('change', this.state());
    return context;
  }

  private async attachExtension(): Promise<BrowserContext> {
    if (!cdpRelay.status().extensionConnected) {
      throw new Error('The Chrome extension is not connected. Install "Post Prep Assistant Bridge" in your Chrome and paste the pairing code (see the dashboard).');
    }
    logger.info('browser', 'Connecting to your Chrome through the extension bridge');
    // isLocal: the browser runs on this same computer, so uploads are handed over by file path
    // (any size) instead of being copied through the connection (Playwright caps that at 50 MB).
    const browser = await chromium.connectOverCDP(cdpRelay.cdpUrl(), { isLocal: true });
    const context = browser.contexts()[0];
    if (!context) throw new Error('The extension bridge did not provide a browser context.');
    browser.on('disconnected', () => {
      logger.info('browser', 'Extension bridge disconnected');
      this.onGone();
    });
    this.browser = browser;
    this.context = context;
    this.emit('change', this.state());
    return context;
  }

  /**
   * Opens a new tab. With `background`, the tab opens without taking focus (Chrome mode), so you
   * stay on the tab you're using; otherwise an untouched blank tab is reused if there is one.
   */
  async newPage(opts: { background?: boolean } = {}): Promise<Page> {
    const ctx = await this.getContext();
    type Claimable = Page & { __claimed?: boolean };
    let page: Page | undefined;
    if (this.mode === 'extension') {
      // The bridge always opens tabs in the background. Serialized so the relay's
      // "last created tab" belongs to this page.
      const run = this.bridgeLock.then(async () => {
        const p = await ctx.newPage();
        if (cdpRelay.lastCreated) this.bridgeTabs.set(p, cdpRelay.lastCreated.tabId);
        return p;
      });
      this.bridgeLock = run.catch(() => undefined);
      page = await run;
    } else if (opts.background && this.browser) {
      const cdp = await this.browser.newBrowserCDPSession();
      try {
        const created = ctx.waitForEvent('page', { timeout: 15_000 });
        await cdp.send('Target.createTarget', { url: 'about:blank', background: true });
        page = await created;
      } finally {
        await cdp.detach().catch(() => undefined);
      }
    } else {
      page = ctx.pages().find((p) => /^(about:blank|chrome:\/\/newtab\/?)$/.test(p.url()) && !(p as Claimable).__claimed);
      page ??= await ctx.newPage();
    }
    (page as Claimable).__claimed = true;
    return page;
  }

  /** Bundled mode: closes the browser. Chrome mode: detaches and leaves Chrome open for you. */
  async close() {
    const ctx = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
    else if (ctx) await ctx.close().catch(() => undefined);
    this.emit('change', this.state());
  }
}

export const browserManager = new BrowserManager();
