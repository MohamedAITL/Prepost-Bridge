import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { SafetyError, safeClick } from '../server/automation/safeActions';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(`
    <script>window.clicked = [];</script>
    <button id="next" onclick="clicked.push('next')">Next</button>
    <button id="post" onclick="clicked.push('post')">Post</button>
    <button id="publier" onclick="clicked.push('publier')">Publier</button>
    <button id="ar" onclick="clicked.push('ar')">نشر</button>
    <div role="button" id="share" aria-label="Share now" onclick="clicked.push('share')">↗</div>
    <button id="sched" onclick="clicked.push('sched')">Schedule for later</button>
    <button data-testid="tweetButton" id="tw" onclick="clicked.push('tw')">Send it</button>
    <form onsubmit="event.preventDefault(); clicked.push('submit')"><button id="sub" type="submit">Continue</button></form>
    <span id="inner-wrap"><button onclick="clicked.push('done')"><span id="inner">Done</span></button></span>
    <button id="create" onclick="clicked.push('create')">Create post</button>
  `);
});

after(async () => {
  await browser.close();
});

const blocked = ['#post', '#publier', '#ar', '#share', '#sched', '#tw', '#sub', '#inner'];

for (const sel of blocked) {
  test(`refuses to click ${sel}`, async () => {
    await assert.rejects(() => safeClick(page.locator(sel), sel), SafetyError);
  });
}

test('allows ordinary navigation buttons', async () => {
  await safeClick(page.locator('#next'), 'Next');
  await safeClick(page.locator('#create'), 'Create post');
  const clicked = await page.evaluate(() => (window as unknown as { clicked: string[] }).clicked);
  assert.deepEqual(clicked, ['next', 'create']);
});

test('platform modules never click, press or submit directly', () => {
  // Every interaction in platform modules must go through the vetted helpers.
  const dir = path.resolve(import.meta.dirname, '../server/platforms');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const pattern of [/\.click\(/, /\.press\(/, /\.tap\(/, /\.dispatchEvent\(/, /\.submit\(/, /keyboard\./, /\.check\(\s*\{/, /requestSubmit/]) {
      assert.doesNotMatch(src, pattern, `${f} uses ${pattern} directly`);
    }
  }
});
