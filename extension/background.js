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
    deliverWhatsApp();
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

// A normal browser window to open tabs in. Without one, Chrome/Edge reject tabs.create with
// "No current window" (e.g. all windows closed while the browser keeps running, or a popup or
// app window is focused). Opens a window, without focusing it, if there's none.
async function targetWindowId() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && win.id !== undefined && win.type === 'normal') return win.id;
  } catch {
    /* no focused window */
  }
  const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (all.length) return all[0].id;
  const created = await chrome.windows.create({ focused: false, url: 'about:blank' });
  return created.id;
}

async function handle(msg) {
  if (msg.type === 'whatsappAck') {
    const done = whatsappAcks.get(msg.ref);
    whatsappAcks.delete(msg.ref);
    if (done) done(msg);
    return;
  }
  const reply = (result) => send({ id: msg.id, result: result ?? {} });
  const fail = (e) => send({ id: msg.id, error: (e && e.message) || String(e) });
  try {
    switch (msg.type) {
      case 'createTab': {
        const windowId = await targetWindowId();
        const tab = await chrome.tabs.create({ windowId, url: msg.url || 'about:blank', active: !!msg.active });
        await waitForTabLoaded(tab.id);
        await chrome.debugger.attach({ tabId: tab.id }, '1.3');
        controlled.add(tab.id);
        await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
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
          await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
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
        // focusWindow: false shows the tab inside its window without pulling Chrome to the front.
        if (msg.focusWindow !== false) await chrome.windows.update(tab.windowId, { focused: true });
        return reply();
      }
      case 'getActiveTab': {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return reply({ tabId: tab ? tab.id : null });
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

// Keep automated tabs awake. Chrome freezes CPU-heavy background tabs (video upload pages,
// especially with Energy Saver on); a frozen tab stops uploading and stops answering until you
// look at it. Marking the tab "active" every few seconds un-freezes it.
setInterval(() => {
  for (const tabId of controlled) {
    chrome.debugger.sendCommand({ tabId }, 'Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
  }
}, 4000);

// Reconnect when the app starts later, and keep the service worker alive while connected.
chrome.alarms.create('bridge-retry', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'bridge-retry') return;
  if (ws) send({ type: 'ping' });
  else connect();
  deliverWhatsApp();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

// ---------- WhatsApp → Prepost ----------
// whatsapp.js (on web.whatsapp.com) captures image+caption messages sent after a "." in the chats
// you chose, and hands them here (RELAY_DRAFT). They're kept in a local queue until the Prepost
// engine confirms it has them; it turns each one into a new Post in the dashboard.

const WA_QUEUE = 'pendingWhatsAppDrafts';
const WA_FINGERPRINTS = 'waContentFingerprintsV21';
const whatsappAcks = new Map(); // ref → resolve(ack)
let whatsappDelivering = false;

const waStatus = (message) => chrome.storage.local.set({ bridgeStatus: { message, time: new Date().toLocaleTimeString() } });

// Same chat + same caption (spacing ignored) + same image = the same news item.
async function waFingerprint(draft) {
  const bytes = new TextEncoder().encode((draft.chat || '') + '␟' + draft.title.trim().replace(/\s+/g, ' ') + '␟' + draft.imageHash);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// Read-modify-write of the queue, one at a time (several WhatsApp tabs can capture at once).
let waQueueWrites = Promise.resolve();
function waSerialized(task) {
  const run = waQueueWrites.then(task, task);
  waQueueWrites = run.catch(() => {});
  return run;
}

async function waEnqueue(draft) {
  if (!draft?.id || !draft?.title || !draft?.image?.startsWith('data:image/')) throw new Error('invalid image/title');
  return waSerialized(async () => {
    const fp = await waFingerprint(draft);
    const st = await chrome.storage.local.get({ [WA_QUEUE]: [], [WA_FINGERPRINTS]: {} });
    const queue = st[WA_QUEUE] || [];
    const ledger = st[WA_FINGERPRINTS] || {};
    if (ledger[fp] || queue.some((x) => x.id === draft.id || x.fingerprint === fp)) {
      await waStatus('تجاهلنا نسخة مكررة من الخبر: ' + draft.title.slice(0, 65));
      return queue.length;
    }
    if (queue.length >= 100) throw new Error('طابور الإرسال عامر (100)؛ شغّل Prepost');
    queue.push({ ...draft, fingerprint: fp });
    ledger[fp] = { firstSeen: Date.now(), title: draft.title };
    const recent = Object.entries(ledger).sort((a, b) => a[1].firstSeen - b[1].firstSeen).slice(-1500);
    await chrome.storage.local.set({ [WA_QUEUE]: queue, [WA_FINGERPRINTS]: Object.fromEntries(recent) });
    await waStatus('تحفظ الخبر محلياً؛ ' + queue.length + ' فالانتظار');
    return queue.length;
  });
}

function waSendToEngine(draft) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Prepost ما خدامش أو الإضافة ما مربوطاش'));
    const ref = crypto.randomUUID();
    const timer = setTimeout(() => {
      whatsappAcks.delete(ref);
      reject(new Error('Prepost ما جاوبش'));
    }, 30000);
    whatsappAcks.set(ref, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
    send({ type: 'whatsappDraft', ref, draft: { title: draft.title, image: draft.image, chat: draft.chat } });
  });
}

/** Send waiting items to the engine, oldest first; stop at the first one it can't receive. */
async function deliverWhatsApp() {
  if (whatsappDelivering || !ws || ws.readyState !== WebSocket.OPEN) return;
  whatsappDelivering = true;
  try {
    for (let i = 0; i < 100; i++) {
      const next = (await chrome.storage.local.get({ [WA_QUEUE]: [] }))[WA_QUEUE][0];
      if (!next) return;
      let ack;
      try {
        ack = await waSendToEngine(next);
      } catch (e) {
        await waStatus('الخبر باقي فالانتظار: ' + e.message);
        return;
      }
      // A refused item (e.g. not a real image) would be refused again: drop it instead of blocking the queue.
      if (!ack.ok) await waStatus('Prepost رفض الخبر: ' + (ack.error || '') + ' — ' + next.title.slice(0, 50));
      else await waStatus((ack.duplicate ? 'كان موجود من قبل فـ Prepost: ' : 'وصل الخبر لـ Prepost: ') + next.title.slice(0, 70));
      await waSerialized(async () => {
        const current = (await chrome.storage.local.get({ [WA_QUEUE]: [] }))[WA_QUEUE] || [];
        await chrome.storage.local.set({ [WA_QUEUE]: current.filter((d) => d.id !== next.id) });
      });
    }
  } catch (e) {
    await waStatus('خطأ: ' + e.message);
  } finally {
    whatsappDelivering = false;
  }
}

// Watch-all mode: a separate WhatsApp tab moves through the chosen chats (WhatsApp's own search),
// one chat per cycle. Your own WhatsApp tab is never navigated.
let waRotationBusy = false;
const waScannerLog = (message) => chrome.storage.local.set({ multiScanStatus: { message, time: new Date().toLocaleTimeString() } });

async function waScannerTab() {
  const { scannerTabId } = await chrome.storage.local.get({ scannerTabId: null });
  if (scannerTabId) {
    try {
      const t = await chrome.tabs.get(scannerTabId);
      if (t?.url?.startsWith('https://web.whatsapp.com/')) return t;
    } catch {
      /* closed */
    }
  }
  const t = await chrome.tabs.create({ url: 'https://web.whatsapp.com/', active: false });
  await chrome.storage.local.set({ scannerTabId: t.id });
  return t;
}

async function waMessageTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['whatsapp.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function waRotate() {
  if (waRotationBusy) return;
  waRotationBusy = true;
  try {
    const st = await chrome.storage.local.get({ enabled: true, multiEnabled: false, chats: [], rotationIndex: 0 });
    if (!st.enabled || !st.multiEnabled || !st.chats.length) return;
    const tab = await waScannerTab();
    if (tab.status !== 'complete') return waScannerLog('تبويب WhatsApp ديال المراقبة كيتحمّل');
    const index = st.rotationIndex % st.chats.length;
    const chat = st.chats[index];
    await waScannerLog('كنفحص المحادثة ' + (index + 1) + '/' + st.chats.length + ': ' + chat);
    const nav = await waMessageTab(tab.id, { type: 'ROTATE_TO_CHAT', chat });
    if (!nav?.ok) throw new Error(nav?.error || 'فشل فتح المحادثة ' + chat);
    await new Promise((r) => setTimeout(r, 1200));
    const result = await waMessageTab(tab.id, { type: 'SCAN' });
    await chrome.storage.local.set({ rotationIndex: (index + 1) % st.chats.length });
    await waScannerLog(chat + ': ' + (result?.count || 0) + ' خبر جديد؛ ' + (result?.error || 'الفحص ناجح'));
  } catch (e) {
    await waScannerLog('خطأ فالمراقبة: ' + e.message);
  } finally {
    waRotationBusy = false;
  }
}

chrome.alarms.create('multiChatRotation', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'multiChatRotation') waRotate();
});

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  switch (msg?.type) {
    case 'RELAY_DRAFT':
      waEnqueue(msg.draft)
        .then((count) => {
          respond({ ok: true, queued: true, count });
          deliverWhatsApp();
        })
        .catch((e) => respond({ ok: false, error: e.message }));
      return true;
    case 'RUN_MULTI_SCAN':
    case 'START_MULTI_SCAN':
      waRotate().then(() => respond({ ok: true }));
      return true;
    case 'GET_MULTI_STATUS':
      chrome.storage.local.get({ multiScanStatus: null }).then(respond);
      return true;
    default:
      return false;
  }
});
