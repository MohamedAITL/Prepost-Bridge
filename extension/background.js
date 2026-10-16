// Prepost Bridge
//
// Connects ONLY to the local app at ws://127.0.0.1:<port>/bridge/extension with your pairing code.
// It controls (via chrome.debugger) only the tabs the app asks it to open; it never attaches to
// your other tabs. Closing a tab or pressing "Cancel" on Chrome's debugging bar stops control.

let ws = null;
let connecting = false;
const controlled = new Set(); // tabIds attached by this extension

async function settings() {
  const { token = '', port = 5174 } = await chrome.storage.local.get(['token', 'port']);
  return { token, port };
}

async function setStatus(status, detail = '') {
  await chrome.storage.session.set({ status, detail });
  chrome.action.setBadgeText({ text: status === 'connected' ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#1f7a43' });
}

async function connect() {
  if (ws || connecting) return;
  const { token, port } = await settings();
  if (!token) return setStatus('unpaired', 'Paste the pairing code from the dashboard.');
  connecting = true;
  let socket;
  try {
    socket = new WebSocket(`ws://127.0.0.1:${port}/bridge/extension?token=${encodeURIComponent(token)}`);
  } catch (e) {
    connecting = false;
    return setStatus('disconnected', String(e));
  }
  socket.onopen = () => {
    connecting = false;
    ws = socket;
    send({ type: 'hello', version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent });
    setStatus('connected');
  };
  socket.onmessage = (event) => handle(JSON.parse(event.data));
  socket.onclose = () => {
    connecting = false;
    if (ws === socket) ws = null;
    for (const tabId of [...controlled]) detach(tabId);
    setStatus('disconnected', 'App not reachable. Is it running?');
  };
  socket.onerror = () => undefined;
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function detach(tabId) {
  controlled.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already detached */
  }
}

// Attach only after the new tab has committed its first document, so the automation sees a
// fully initialized page (an attach during the initial empty document never "navigates").
async function waitForTabLoaded(tabId) {
  for (let i = 0; i < 100; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function handle(msg) {
  const reply = (result) => send({ id: msg.id, result: result ?? {} });
  const fail = (e) => send({ id: msg.id, error: (e && e.message) || String(e) });
  try {
    switch (msg.type) {
      case 'createTab': {
        const tab = await chrome.tabs.create({ url: msg.url || 'about:blank', active: !!msg.active });
        await waitForTabLoaded(tab.id);
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        controlled.add(tab.id);
        // The automation identifies a page by Chrome's target id (= its main frame id).
        const targets = await chrome.debugger.getTargets();
        const target = targets.find((t) => t.tabId === tab.id);
        return reply({ tabId: tab.id, targetId: target ? target.id : undefined });
      }
      case 'attachTab': {
        // Re-use a tab the assistant opened before (it was released when its job finished).
        const tab = await chrome.tabs.get(msg.tabId);
        if (!controlled.has(tab.id)) {
          await waitForTabLoaded(tab.id);
          await chrome.debugger.attach({ tabId: tab.id }, '1.3');
          controlled.add(tab.id);
        }
        const targets = await chrome.debugger.getTargets();
        const target = targets.find((t) => t.tabId === tab.id);
        return reply({ tabId: tab.id, targetId: target ? target.id : undefined });
      }
      case 'command': {
        if (!controlled.has(msg.tabId)) throw new Error('Tab is not controlled by the assistant.');
        const target = msg.sessionId ? { tabId: msg.tabId, sessionId: msg.sessionId } : { tabId: msg.tabId };
        const result = await chrome.debugger.sendCommand(target, msg.method, msg.params || {});
        return reply(result);
      }
      case 'activateTab': {
        const tab = await chrome.tabs.update(msg.tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return reply();
      }
      case 'closeTab':
        await detach(msg.tabId);
        await chrome.tabs.remove(msg.tabId).catch(() => undefined);
        return reply();
      case 'detachTab':
        await detach(msg.tabId);
        return reply();
      default:
        throw new Error(`Unknown request ${msg.type}`);
    }
  } catch (e) {
    fail(e);
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!controlled.has(source.tabId)) return;
  send({ type: 'event', tabId: source.tabId, sessionId: source.sessionId, method, params });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (!controlled.has(source.tabId)) return;
  controlled.delete(source.tabId);
  send({ type: 'detached', tabId: source.tabId, reason });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!controlled.has(tabId)) return;
  controlled.delete(tabId);
  send({ type: 'tabClosed', tabId });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'reconnect') {
    if (ws) ws.close();
    ws = null;
    connect().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Reconnect when the app starts later, and keep the service worker alive while connected.
chrome.alarms.create('bridge-retry', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  if (ws) send({ type: 'ping' });
  else connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
