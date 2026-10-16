// End-to-end test of the extension bridge: a Chromium with the unpacked extension loaded connects
// to the relay, and the real X / YouTube modules run through it against local mock pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type BrowserContext } from 'playwright';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-bridge-'));
process.env.SPA_DATA_DIR = dataDir;
const { cdpRelay } = await import('../server/bridge/cdpRelay');
const { xModule } = await import('../server/platforms/x');
const { testContext } = await import('./harness');
const { safeClick, SafetyError } = await import('../server/automation/safeActions');

// Runs inside the extension's service worker.
declare const chrome: any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const X_PAGE = `<!doctype html><meta charset="utf-8"><title>X mock</title>
<a data-testid="SideNav_AccountSwitcher_Button">me</a>
<div role="dialog">
  <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" style="min-height:40px"></div>
  <input type="file" data-testid="fileInput" multiple style="display:none">
  <div data-testid="attachments"></div>
  <button data-testid="tweetButton" onclick="window.published=true">Post</button>
</div>
<script>
  const box = document.querySelector('[data-testid=tweetTextarea_0]');
  box.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  document.querySelector('[data-testid=fileInput]').addEventListener('change', (e) => {
    for (const f of e.target.files) { const i = document.createElement('img'); i.src = URL.createObjectURL(f); document.querySelector('[data-testid=attachments]').append(i); }
  });
</script>`;

let server: http.Server;
let userChrome: BrowserContext; // stands in for "your Chrome" with the extension installed
let bridged: Browser; // Playwright connected through the relay
let pagesBase: string;
const imgPath = path.join(dataDir, 'a.png');

before(async () => {
  fs.writeFileSync(imgPath, PNG);
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(req.url?.startsWith('/x') ? X_PAGE : '<title>home</title>home');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cdpRelay.attach(server);
  const port = (server.address() as { port: number }).port;
  pagesBase = `http://localhost:${port}`;

  const ext = path.resolve(import.meta.dirname, '../extension');
  userChrome = await chromium.launchPersistentContext(path.join(dataDir, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const sw = userChrome.serviceWorkers()[0] ?? (await userChrome.waitForEvent('serviceworker'));
  await sw.evaluate(async ([token, p]) => {
    await chrome.storage.local.set({ token, port: p });
    await (globalThis as unknown as { connect: () => Promise<void> }).connect();
  }, [cdpRelay.pairingCode, port] as const);
  for (let i = 0; i < 50 && !cdpRelay.status().extensionConnected; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(cdpRelay.status().extensionConnected, 'extension should connect with the pairing code');
  bridged = await chromium.connectOverCDP(cdpRelay.cdpUrl());
});

after(async () => {
  await bridged?.close().catch(() => undefined);
  await userChrome?.close();
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('rejects an extension connection with a wrong pairing code', async () => {
  const port = (server.address() as { port: number }).port;
  const code = await new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge/extension?token=${'0'.repeat(32)}`);
    ws.onerror = () => resolve(-1);
    ws.onopen = () => resolve(1);
  });
  assert.equal(code, -1);
});

test('opens a background tab in the user browser and runs the X module through the bridge', async () => {
  const before = userChrome.pages().length;
  const sw = userChrome.serviceWorkers()[0];
  const activeTabId = () => sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  const activeBefore = await activeTabId();
  const page = await bridged.contexts()[0].newPage();
  assert.equal(userChrome.pages().length, before + 1, 'a real tab was created in the user browser');
  assert.equal(await activeTabId(), activeBefore, 'the new tab opened in the background; the user stays on their tab');
  await page.goto(`${pagesBase}/x`);
  // The module navigates to x.com; point it at the mock instead by running its steps on this page.
  const { ctx, checks } = testContext(page, {
    targets: ['x'],
    text: 'خبر 🚨\nLigne deux',
    media: [{ item: { id: '1', name: 'a.png', mime: 'image/png', size: PNG.length, kind: 'image', source: 'upload' }, path: imgPath }],
  });
  const original = page.goto.bind(page);
  page.goto = ((url: string, opts?: Parameters<typeof page.goto>[1]) => original(url.includes('x.com') ? `${pagesBase}/x` : url, opts)) as typeof page.goto;
  await xModule.prepare(ctx);
  assert.match(await page.locator('[data-testid=tweetTextarea_0]').innerText(), /خبر 🚨\s*\n\s*Ligne deux/);
  assert.equal(await page.locator('[data-testid=attachments] img').count(), 1, 'file upload works through chrome.debugger');
  assert.equal(await page.evaluate(() => (window as unknown as { published?: boolean }).published ?? false), false);
  assert.deepEqual(checks.filter((c) => c.state !== 'pass'), [], JSON.stringify(checks));
  // A released tab can be taken over again (tab reuse) instead of opening a new one.
  const entry = cdpRelay.lastCreated!;
  await cdpRelay.release(entry.tabId);
  const tabsAfterRelease = userChrome.pages().length;
  const appeared = bridged.contexts()[0].waitForEvent('page');
  await cdpRelay.adoptTab(entry.tabId);
  const again = await appeared;
  assert.equal(userChrome.pages().length, tabsAfterRelease, 'no new tab was opened');
  assert.equal(await again.locator('[data-testid=attachments] img').count(), 1, 'it is the same tab, with its content');
  await assert.rejects(() => safeClick(again.locator('[data-testid=tweetButton]'), 'Post'), SafetyError);
  await again.close();
  return;
  // The no-publish guard works through the bridge too.
  await assert.rejects(() => safeClick(page.locator('[data-testid=tweetButton]'), 'Post'), SafetyError);
  await page.close();
});

test('a frozen background tab is woken up by the extension (Chrome freezes CPU-heavy tabs)', async () => {
  const page = await bridged.contexts()[0].newPage();
  await page.goto(`${pagesBase}/x`);
  // Freeze the tab the way Chrome does, from the user's side.
  const userPage = userChrome.pages().find((p) => p.url().endsWith('/x'))!;
  const cdp = await userChrome.newCDPSession(userPage);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  const started = Date.now();
  // The keepalive runs every 4 s; the page must answer again shortly after.
  const title = await page.evaluate(() => document.title);
  assert.equal(title, 'X mock');
  assert.ok(Date.now() - started < 12_000, `took ${Date.now() - started} ms`);
  await page.close();
});
