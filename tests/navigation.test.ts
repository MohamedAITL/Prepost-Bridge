import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { openUrl } from '../server/automation/helpers';

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

test('a load cut short (net::ERR_ABORTED) does not fail; real errors still do', async () => {
  const page = await browser.newPage();
  await page.route('https://redirecting.example/**', (route) => route.fulfill({ status: 204 })); // Chrome reports ERR_ABORTED
  await page.route('https://broken.example/**', (route) => route.abort('connectionrefused'));
  await assert.rejects(() => page.goto('https://redirecting.example/upload'), /ERR_ABORTED/);
  await openUrl(page, 'https://redirecting.example/upload');
  await assert.rejects(() => openUrl(page, 'https://broken.example/'), /ERR_CONNECTION_REFUSED/);
  await page.close();
});
