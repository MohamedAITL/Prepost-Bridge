// Runs the real X and YouTube Studio modules against LOCAL MOCK pages that imitate the DOM the
// selectors expect. This verifies the module logic (fill, upload, verify, never publish), not
// compatibility with the live sites, which can only be checked with a signed-in account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { metaModule, publishedDialogShown } from '../server/platforms/meta';
import { wordpressModule } from '../server/platforms/wordpress';
import { xModule } from '../server/platforms/x';
import { youtubeStudioModule } from '../server/platforms/youtubeStudio';
import { testContext } from './harness';

let browser: Browser;
let tmp: string;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  browser = await chromium.launch();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-test-'));
  fs.writeFileSync(path.join(tmp, 'a.png'), PNG);
  fs.writeFileSync(path.join(tmp, 'b.png'), PNG);
  fs.writeFileSync(path.join(tmp, 'clip.mp4'), Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'));
});

after(async () => {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const X_FIXTURE = `<!doctype html><meta charset="utf-8">
<a data-testid="SideNav_AccountSwitcher_Button">me</a>
<div role="dialog">
  <div data-testid="tweetTextarea_0" role="textbox" contenteditable="true" style="min-height:40px;border:1px solid"></div>
  <input type="file" data-testid="fileInput" multiple style="display:none">
  <div data-testid="attachments"></div>
  <button data-testid="tweetButton">Post</button>
</div>
<script>
  window.published = false;
  const box = document.querySelector('[data-testid=tweetTextarea_0]');
  // Behaves like a rich editor: handles paste itself.
  box.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  document.querySelector('[data-testid=fileInput]').addEventListener('change', (e) => {
    const att = document.querySelector('[data-testid=attachments]');
    for (const f of e.target.files) { const i = document.createElement('img'); i.src = URL.createObjectURL(f); att.append(i); }
  });
  document.querySelector('[data-testid=tweetButton]').addEventListener('click', () => { window.published = true; });
</script>`;

test('X module fills text (Arabic + emoji + newlines), attaches images, never clicks Post', async () => {
  const context = await browser.newContext();
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: X_FIXTURE }));
  const page = await context.newPage();
  const text = 'خبر عاجل 🚨\nSecond line — français: été\n#news https://example.com/a';
  const { ctx, checks } = testContext(page, {
    targets: ['x'],
    text,
    media: [
      { item: { id: '1', name: 'a.png', mime: 'image/png', size: PNG.length, kind: 'image', source: 'upload' }, path: path.join(tmp, 'a.png') },
      { item: { id: '2', name: 'b.png', mime: 'image/png', size: PNG.length, kind: 'image', source: 'upload' }, path: path.join(tmp, 'b.png') },
    ],
  });
  await xModule.prepare(ctx);
  const value = await page.locator('[data-testid=tweetTextarea_0]').innerText();
  assert.ok(value.includes('خبر عاجل 🚨'), value);
  assert.ok(value.includes('Second line'), value);
  assert.equal(await page.locator('[data-testid=attachments] img').count(), 2);
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false);
  assert.deepEqual(
    checks.filter((c) => c.state !== 'pass'),
    [],
    JSON.stringify(checks),
  );
  await context.close();
});

test('auto-publish: refused when off; when on, X presses Post and confirms it left the composer', async () => {
  const context = await browser.newContext();
  // Pressing Post on the mock sends you Home, like X does.
  const fixture = X_FIXTURE.replace('window.published = true;', "window.published = true; location.href = 'https://x.com/home';");
  await context.route('https://x.com/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  const page = await context.newPage();
  const content = { targets: ['x' as const], text: 'Hello', media: [] };

  const off = testContext(page, content, false);
  await xModule.prepare(off.ctx);
  await assert.rejects(xModule.publish(off.ctx), /auto-publish is off/);
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false);
  assert.ok(page.url().includes('/compose/'));

  const on = testContext(page, content, true);
  await xModule.prepare(on.ctx);
  await xModule.publish(on.ctx);
  assert.ok(page.url().endsWith('/home'), page.url());
  assert.ok(on.checks.some((c) => c.label === 'Posted on X' && c.state === 'pass'));
  await context.close();
});

test('Meta auto-publish: confirmed by the real "Your post is published" dialog, never by caption text', async () => {
  const context = await browser.newContext();
  // Seen 2026-10: Publish → "Publishing your post", then a dialog "Your post is published" (still on /composer).
  const body = `<!doctype html><meta charset="utf-8">
    <div role="combobox" contenteditable="true">تم نشر — Your post is published (caption text)</div>
    <button>Publish</button>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        window.published = true;
        document.body.insertAdjacentHTML('beforeend', '<h4>Publishing your post</h4>');
        setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h1>Your post is published</h1><button>Close</button></div>'), 800);
      });
    </script>`;
  await context.route('https://business.facebook.com/**', (route) => route.fulfill({ contentType: 'text/html', body }));
  const page = await context.newPage();
  await page.goto('https://business.facebook.com/latest/composer');
  assert.equal(await publishedDialogShown(page), false, 'caption words alone must not count as published');

  const { ctx, checks } = testContext(page, { targets: ['facebook' as const], text: 'x', media: [] }, true);
  const started = Date.now();
  await metaModule.publish(ctx);
  assert.ok(Date.now() - started < 10_000, 'confirmed within seconds, not after the 2-minute limit');
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), true);
  assert.ok(checks.some((c) => c.label === 'Published on Meta' && c.state === 'pass'));
  await context.close();
});

test('Meta Reel: the "Reel processing … will be published" dialog counts as accepted', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<div role="dialog"><h3>Reel processing</h3><p>Once your reel finishes processing, it will be published and you will be notified.</p></div>');
  assert.equal(await publishedDialogShown(page), true);
  await context.close();
});

const WP_ADMIN = 'https://0561102b93f7daa97.chouftv.ma/cms/wp-admin/';
const WP_NEW_POST = `<!doctype html><meta charset="utf-8">
<div id="wpadminbar">admin</div>
<form id="post" onsubmit="return false">
  <input type="hidden" id="post_ID" value="123">
  <input type="hidden" id="original_post_status" value="auto-draft">
  <input type="text" id="title">
  <textarea id="content"></textarea>
  <div class="postbox"><h2 class="hndle">عنوان الفيسبوك</h2><div class="inside"><input type="text" id="fb"></div></div>
  <div id="tagsdiv-post_tag"><input class="newtag" type="text"><input type="button" class="tagadd" value="Add"><ul class="tagchecklist"></ul></div>
  <div id="options">${['يظهر في الصفحة الرئيسية', 'شريط الأخبار'].map((n) => `<label><input type="checkbox"> ${n}</label>`).join('')}</div>
  <ul id="categorychecklist">${['سياسة', 'مجتمع', 'حوادث وحقوق', 'أخبار', 'دولي', 'فن وثقافة', 'اقتصاد'].map((n) => `<li><label class="selectit"><input type="checkbox" ${n === 'أخبار' ? 'checked' : ''}> ${n}</label></li>`).join('')}</ul>
  <ul id="categorychecklist-pop" style="display:none"><li><label class="selectit"><input type="checkbox" id="pop-politics"> سياسة</label></li></ul>
  <input type="hidden" id="_thumbnail_id" value="-1">
  <input type="submit" id="publish" value="Publish">
</form>
<script>
  window.published = false;
  window._wpPluploadSettings = { defaults: { multipart_params: { _wpnonce: 'nonce' } } };
  window.wp = { media: { featuredImage: { set: (id) => setTimeout(() => { document.querySelector('#_thumbnail_id').value = id; }, 100) } } };
  document.querySelector('.tagadd').addEventListener('click', () => {
    const input = document.querySelector('.newtag');
    for (const t of input.value.split(',')) if (t.trim()) document.querySelector('.tagchecklist').insertAdjacentHTML('beforeend', '<li>' + t + '</li>');
    input.value = '';
  });
  document.querySelector('#publish').addEventListener('click', () => { window.published = true; location.href = '${WP_ADMIN}post.php?post=123&action=edit'; });
</script>`;
const WP_PUBLISHED = `<!doctype html><meta charset="utf-8"><div id="wpadminbar">admin</div>
<input type="hidden" id="post_ID" value="123"><input type="hidden" id="original_post_status" value="publish"><input type="submit" id="publish" value="Update">
<div id="message"><a href="${WP_ADMIN}edit.php?post_type=press">All posts</a></div>
<span id="sample-permalink"><a href="https://0561102b93f7daa97.chouftv.ma/press/123.html">permalink</a></span>`;

test('WordPress module fills a Chouf article (title, body, Facebook title, tags, sections, featured image) and publishes only with auto-publish on', async () => {
  const context = await browser.newContext();
  let uploads = 0;
  await context.route('https://0561102b93f7daa97.chouftv.ma/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/admin-ajax.php')) {
      uploads++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 77 } }) });
    }
    return route.fulfill({ contentType: 'text/html', body: url.includes('/post.php') ? WP_PUBLISHED : WP_NEW_POST });
  });
  const page = await context.newPage();
  const content = {
    targets: ['wordpress' as const],
    title: 'عنوان الخبر',
    text: 'الفقرة الأولى <b>\nالفقرة الثانية',
    media: [{ item: { id: '1', name: 'a.png', mime: 'image/png', size: PNG.length, kind: 'image' as const, source: 'upload' as const }, path: path.join(tmp, 'a.png') }],
    wordpress: { postType: 'press' as const, tags: ['المغرب', 'شوف تيفي'], categories: ['سياسة'], options: ['يظهر في الصفحة الرئيسية', 'شريط الأخبار'], videoUrl: '' },
  };

  const off = testContext(page, content, false);
  await wordpressModule.prepare(off.ctx);
  assert.equal(await page.inputValue('#title'), 'عنوان الخبر');
  assert.equal(await page.inputValue('#content'), '<p>الفقرة الأولى &lt;b&gt;</p>\n<p>الفقرة الثانية</p>', 'paragraphs, HTML escaped');
  assert.equal(await page.inputValue('#fb'), 'عنوان الخبر');
  assert.equal(await page.locator('.tagchecklist li').count(), 2);
  assert.equal(await page.getByLabel('سياسة', { exact: true }).first().isChecked(), true);
  assert.equal(await page.isChecked('#pop-politics'), false, 'the hidden "Most used" copy is left alone');
  assert.equal(await page.getByLabel('أخبار', { exact: true }).isChecked(), false, 'an unwanted pre-ticked section is unticked');
  assert.equal(await page.getByLabel('شريط الأخبار', { exact: true }).isChecked(), true);
  assert.equal(await page.inputValue('#_thumbnail_id'), '77');
  assert.equal(uploads, 1);
  assert.deepEqual(off.checks.filter((c) => c.state !== 'pass'), [], JSON.stringify(off.checks));
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false, 'prepare never publishes');
  assert.deepEqual(off.articles, [{ title: 'عنوان الخبر', url: 'https://chouftv.ma/press/123.html', published: false }], 'the link is known before publishing');

  await assert.rejects(wordpressModule.publish(off.ctx), /auto-publish is off/);
  const on = testContext(page, content, true);
  await wordpressModule.publish(on.ctx);
  assert.ok(page.url().includes('/post.php'));
  assert.deepEqual(on.checks.find((c) => c.label === 'Published on WordPress'), { label: 'Published on WordPress', state: 'pass', detail: 'https://chouftv.ma/press/123.html' });
  assert.deepEqual(on.articles, [{ title: 'عنوان الخبر', url: 'https://chouftv.ma/press/123.html', published: true }], 'read from the permalink, on the public host');
  await context.close();
});

const YT_FIXTURE = `<!doctype html><meta charset="utf-8">
<ytcp-app></ytcp-app>
<ytcp-uploads-dialog>
  <ytcp-uploads-file-picker><input type="file" name="Filedata"></ytcp-uploads-file-picker>
  <div id="details" hidden>
    <div id="title-textarea"><div id="textbox" contenteditable="true" aria-label="Add a title"></div></div>
    <div id="description-textarea"><div id="textbox" contenteditable="true"></div></div>
    <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_MFK" role="radio">Yes, it's made for kids</tp-yt-paper-radio-button>
    <tp-yt-paper-radio-button name="VIDEO_MADE_FOR_KIDS_NOT_MFK" role="radio">No, it's not made for kids</tp-yt-paper-radio-button>
  </div>
  <ytcp-uploads-review hidden>
    <tp-yt-paper-radio-button name="PRIVATE" role="radio">Private</tp-yt-paper-radio-button>
    <tp-yt-paper-radio-button name="UNLISTED" role="radio">Unlisted</tp-yt-paper-radio-button>
    <tp-yt-paper-radio-button name="PUBLIC" role="radio">Public</tp-yt-paper-radio-button>
  </ytcp-uploads-review>
  <ytcp-video-upload-progress><span class="progress-label"></span></ytcp-video-upload-progress>
  <button id="next-button">Next</button>
  <button id="done-button">Save</button>
</ytcp-uploads-dialog>
<script>
  window.published = false; window.step = 0;
  const label = document.querySelector('.progress-label');
  document.querySelector('input[name=Filedata]').addEventListener('change', (e) => {
    document.getElementById('details').hidden = false;
    document.querySelector('#title-textarea #textbox').textContent = e.target.files[0].name.replace(/\\.\\w+$/, '');
    label.textContent = 'Uploading 10% … 2 minutes left';
    setTimeout(() => { label.textContent = 'Uploading 60% … 1 minute left'; }, 600);
    setTimeout(() => { label.textContent = 'Upload complete … Processing will begin shortly'; }, 1500);
  });
  for (const r of document.querySelectorAll('tp-yt-paper-radio-button')) r.addEventListener('click', () => {
    const group = r.getAttribute('name').startsWith('VIDEO_') ? 'VIDEO_' : '';
    for (const o of document.querySelectorAll('tp-yt-paper-radio-button')) if (o.getAttribute('name').startsWith('VIDEO_') === !!group) o.removeAttribute('checked');
    r.setAttribute('checked', '');
  });
  document.getElementById('next-button').addEventListener('click', () => {
    window.step++;
    if (window.step >= 3) { document.getElementById('details').hidden = true; document.querySelector('ytcp-uploads-review').hidden = false; }
  });
  document.getElementById('done-button').addEventListener('click', () => { window.published = true; });
</script>`;

test('YouTube module uploads, fills title/description, sets audience, reaches Visibility, never clicks Save', async () => {
  const context = await browser.newContext();
  await context.route('https://www.youtube.com/**', (route) => route.fulfill({ contentType: 'text/html', body: YT_FIXTURE }));
  const page = await context.newPage();
  const { ctx, checks } = testContext(page, {
    targets: ['youtube'],
    text: 'Description line 1\nالسطر الثاني ✨',
    title: 'Mon titre — عنوان',
    media: [{ item: { id: 'v', name: 'clip.mp4', mime: 'video/mp4', size: 24, kind: 'video', source: 'upload' }, path: path.join(tmp, 'clip.mp4') }],
    thumbnail: null,
    youtube: { postType: 'video', channel: '', title: 'Mon titre — عنوان', audience: 'not_kids', visibility: 'unlisted', advanceToVisibilityStep: true },
  });
  await youtubeStudioModule.prepare(ctx);
  assert.equal(await page.locator('#title-textarea #textbox').innerText(), 'Mon titre — عنوان');
  // innerHTML: the Details panel is hidden by now, and hidden elements lose line breaks in innerText.
  assert.match(await page.locator('#description-textarea #textbox').innerHTML(), /Description line 1(<br>|<div>)السطر الثاني ✨/);
  assert.equal(await page.evaluate(() => (window as unknown as { step: number }).step), 3);
  assert.equal(await page.locator('[name=UNLISTED]').getAttribute('checked'), '');
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false);
  assert.deepEqual(
    checks.filter((c) => c.state !== 'pass'),
    [],
    JSON.stringify(checks),
  );
  await context.close();
});

// Mirrors the YouTube channel Posts composer structure recorded on 2026-10-16.
const YT_POST_FIXTURE = `<!doctype html><meta charset="utf-8">
<button id="avatar-btn">me</button>
<ytd-backstage-post-dialog-renderer>
  <div id="placeholder-area"><yt-formatted-string id="commentbox-placeholder" role="button" aria-label="Exprimez-vous !">Exprimez-vous !</yt-formatted-string></div>
  <div id="composer" hidden>
    <div id="contenteditable-root" contenteditable="true" aria-label="Rédigez un message…" style="min-height:30px"></div>
    <button id="img-btn" aria-label="Ajouter une image">Image</button>
    <ytd-backstage-multi-image-select-renderer hidden>
      <div id="dropzone"><input type="file" accept="image/*" multiple></div>
      <div id="thumbnail-images-container"></div>
    </ytd-backstage-multi-image-select-renderer>
    <div id="buttons"><ytd-button-renderer id="submit-button"><button aria-label="Publier">Publier</button></ytd-button-renderer></div>
  </div>
</ytd-backstage-post-dialog-renderer>
<script>
  window.published = false;
  document.getElementById('commentbox-placeholder').addEventListener('click', () => { document.getElementById('composer').hidden = false; });
  document.getElementById('img-btn').addEventListener('click', () => { document.querySelector('ytd-backstage-multi-image-select-renderer').hidden = false; });
  document.querySelector('#dropzone input').addEventListener('change', (e) => {
    for (const f of e.target.files) { const i = document.createElement('img'); i.width = 80; i.height = 80; i.src = URL.createObjectURL(f); document.getElementById('thumbnail-images-container').append(i); }
  });
  document.querySelector('#submit-button button').addEventListener('click', () => { window.published = true; });
</script>`;

test('YouTube post mode: opens Posts tab, fills text, attaches images, never clicks Publier', async () => {
  const context = await browser.newContext();
  await context.route('https://www.youtube.com/**', (route) =>
    route.request().url().endsWith('/profile')
      ? route.fulfill({ contentType: 'text/html', body: '<script>location.replace("/channel/UCtest")</script>' })
      : route.fulfill({ contentType: 'text/html', body: YT_POST_FIXTURE }),
  );
  const page = await context.newPage();
  const png = (id: string, file: string) => ({ item: { id, name: file, mime: 'image/png', size: PNG.length, kind: 'image' as const, source: 'upload' as const }, path: path.join(tmp, file) });
  const { ctx, checks } = testContext(page, {
    targets: ['youtube'],
    text: 'Annonce 📣\nالسطر الثاني',
    media: [png('1', 'a.png'), png('2', 'b.png')],
    thumbnail: null,
    youtube: { postType: 'post', channel: '', title: '', audience: 'unset', visibility: 'unset', advanceToVisibilityStep: false },
  });
  await youtubeStudioModule.prepare(ctx);
  assert.match(page.url(), /\/channel\/UCtest\/posts$/);
  assert.match(await page.locator('#contenteditable-root').innerText(), /Annonce 📣\s*\n\s*السطر الثاني/);
  assert.equal(await page.locator('#thumbnail-images-container img').count(), 2);
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false);
  assert.deepEqual(checks.filter((c) => c.state !== 'pass'), [], JSON.stringify(checks));
  await context.close();
});

// Mirrors Business Suite's "Create reel" composer recorded on 2026-10-16 (Create → Edit → Share).
const META_REEL_FIXTURE = `<!doctype html><meta charset="utf-8">
<a href="/latest/home?asset_id=1">Home</a>
<h1 id="h">Create reel</h1>
<div role="combobox" aria-labelledby="pt pv"><img alt="Facebook" width="16" height="16"><span id="pt">Post to</span><span id="pv">​ Chouf TV Live ​</span></div>
<button id="add">Add Video</button><input id="file" type="file" accept="video/*" style="display:none">
<div id="preview"></div>
<div role="textbox" contenteditable="true" aria-label="Write into the dialogue box to include text with your post." style="min-height:30px"></div>
<h3>Thumbnail</h3>
<button id="thumb-up" aria-pressed="false">Upload image</button>
<div id="thumb-area" hidden><a href="#" id="thumb-link">Upload image</a><input id="thumb-file" type="file" accept="image/*" style="display:none"><div id="thumb-preview"></div></div>
<div><button id="carousel-next" onclick="window.carousel=(window.carousel||0)+1">Next</button></div>
<button id="next" disabled>Next</button>
<button id="share" hidden>Share</button>
<script>
  window.published = false; let step = 0;
  document.getElementById('add').onclick = () => document.getElementById('file').click();
  document.getElementById('file').onchange = () => {
    const v = document.createElement('video'); v.style.width = '120px'; v.style.height = '120px'; document.getElementById('preview').append(v);
    setTimeout(() => (document.getElementById('next').disabled = false), 300);
  };
  document.getElementById('next').onclick = () => {
    step++;
    document.getElementById('h').textContent = step === 1 ? 'Edit reel' : 'Share reel';
    if (step >= 2) { document.getElementById('next').hidden = true; document.getElementById('share').hidden = false; }
  };
  document.getElementById('share').onclick = () => { window.published = true; };
  document.getElementById('thumb-up').onclick = () => { document.getElementById('thumb-up').setAttribute('aria-pressed', 'true'); document.getElementById('thumb-area').hidden = false; };
  document.getElementById('thumb-link').onclick = (e) => { e.preventDefault(); document.getElementById('thumb-file').click(); };
  document.getElementById('thumb-file').onchange = () => { const i = document.createElement('img'); i.width = 90; i.height = 160; i.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; document.getElementById('thumb-preview').append(i); };
</script>`;

test('Meta Reel: fills text, adds the video, clicks Next to the Share step, never clicks Share', async () => {
  const { metaModule } = await import('../server/platforms/meta');
  const context = await browser.newContext();
  await context.route('https://business.facebook.com/**', (route) => route.fulfill({ contentType: 'text/html', body: META_REEL_FIXTURE }));
  const page = await context.newPage();
  const { ctx, checks } = testContext(page, {
    targets: ['facebook'],
    text: 'Reel du jour 🎬\nالسطر الثاني',
    media: [{ item: { id: 'v', name: 'clip.mp4', mime: 'video/mp4', size: 24, kind: 'video', source: 'upload' }, path: path.join(tmp, 'clip.mp4') }],
    thumbnail: { item: { id: 'c', name: 'a.png', mime: 'image/png', size: PNG.length, kind: 'image', source: 'upload' }, path: path.join(tmp, 'a.png') },
    meta: { page: 'Chouf TV Live', confirmDestinations: false, videoAs: 'reel' },
  });
  await metaModule.prepare(ctx);
  assert.match(page.url(), /reels_composer/);
  assert.equal(await page.locator('#h').innerText(), 'Share reel', JSON.stringify(checks));
  assert.equal(await page.locator('#thumb-preview img').count(), 1, 'thumbnail uploaded');
  assert.equal(await page.evaluate(() => (window as unknown as { carousel?: number }).carousel ?? 0), 0, 'the thumbnail carousel Next was not used');
  assert.equal(await page.evaluate(() => (window as unknown as { published: boolean }).published), false);
  assert.deepEqual(checks.filter((c) => c.state !== 'pass'), [], JSON.stringify(checks));
  await context.close();
});
