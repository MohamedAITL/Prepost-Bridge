import fsp from 'node:fs/promises';
import type { Locator, Page } from 'playwright';
import { fillTextField, normalizeForCompare, pollUntil, readFieldText, requireVisible, setFieldValue } from '../automation/helpers';
import { observeOnly, safeClick } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { WORDPRESS_CHOICES } from '../../shared/types';
import { WP } from './selectors/wordpress';
import type { PlatformModule, PrepareContext } from './types';

// Page scripts are strings: the TS loader would otherwise inject a `__name` helper that doesn't
// exist inside the page (same reason as DESCRIBE_SCRIPT in safeActions.ts).

/**
 * After #content holds the HTML: copy it into TinyMCE when the visual editor is showing. Returns
 * the plain text now in the editor.
 */
const TINYMCE_SCRIPT = `(html) => {
  const ed = window.tinymce && window.tinymce.get('content');
  if (ed && !ed.isHidden()) {
    ed.setContent(html); ed.fire('change'); ed.save();
    return ed.getBody().innerText;
  }
  const box = document.createElement('div');
  box.innerHTML = document.querySelector('#content').value;
  return box.textContent;
}`;

/** The Chouf News Desk's uploadFeaturedImage: WordPress's own upload with the page's nonce, then set as featured image. */
const UPLOAD_SCRIPT = `async (image) => {
  try {
    const media = window.wp && window.wp.media;
    const defaults = (window._wpPluploadSettings && window._wpPluploadSettings.defaults) || (window.wp && window.wp.Uploader && window.wp.Uploader.defaults);
    const nonce = defaults && defaults.multipart_params && defaults.multipart_params._wpnonce;
    const postId = document.querySelector('#post_ID') && document.querySelector('#post_ID').value;
    if (!nonce || !postId || !media || !media.featuredImage || !media.featuredImage.set) throw new Error('This editor does not offer image upload settings.');
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    let blob = new Blob([bytes], { type: image.type });
    let name = image.name;
    // Chouf's WordPress refuses WebP ("not permitted for security reasons"): send anything that
    // isn't JPEG/PNG as a JPEG, converted here in the browser.
    if (image.type !== 'image/jpeg' && image.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bitmap, 0, 0);
      blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image to JPEG.'))), 'image/jpeg', 0.92));
      name = name.replace(/\.[^.]+$/, '') + '.jpg';
    }
    const form = new FormData();
    form.append('action', 'upload-attachment');
    form.append('_wpnonce', nonce);
    form.append('post_id', postId);
    form.append('async-upload', blob, name);
    const response = await fetch(new URL('admin-ajax.php', location.href), { method: 'POST', credentials: 'same-origin', body: form, signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data || !result.data.id) throw new Error((result.data && result.data.message) || 'WordPress refused the image.');
    media.featuredImage.set(result.data.id);
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const field = document.querySelector('#_thumbnail_id');
      if (field && String(field.value) === String(result.data.id)) return { ok: true, id: result.data.id };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { ok: false, error: 'The image was uploaded but setting it as featured image was not confirmed.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}`;

const pageFn = <A, R>(source: string) => new Function(`return ${source}`)() as (arg: A) => R;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each non-empty line becomes a paragraph, as the News Desk did. */
export function articleHtml(body: string): string {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${escapeHtml(l)}</p>`)
    .join('\n');
}

/**
 * The article's public address from WordPress's permalink links, as the News Desk read it: on the
 * public site (not the admin), and for news exactly /press/<id>.html.
 */
export function publicLink(hrefs: (string | null)[], postType: 'press' | 'program', id: string): string | null {
  for (const href of hrefs) {
    try {
      const u = new URL(href ?? '', WP.adminUrl);
      if (!WP.publicHosts.includes(u.hostname) || u.pathname.startsWith('/cms/') || u.pathname === '/') continue;
      if (postType === 'press' && u.pathname !== `/press/${id}.html`) continue;
      return `https://chouftv.ma${u.pathname}`;
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/** A custom field found by its visible label (label, table row, meta box or ACF field). */
async function fieldByLabel(page: Page, label: string): Promise<Locator | null> {
  const input = 'input[type=text], input[type=url], input:not([type]), textarea';
  const exact = new RegExp(`^\\s*${escapeRe(label)}\\s*$`);
  const candidates = [
    page.getByLabel(label, { exact: true }),
    page.locator('tr').filter({ has: page.locator('th, td, label', { hasText: exact }) }).locator(input),
    page.locator('.acf-field').filter({ has: page.locator('.acf-label label', { hasText: exact }) }).locator(input),
    page.locator('.postbox').filter({ has: page.locator('.hndle, h2', { hasText: exact }) }).locator(input),
  ];
  for (const c of candidates) if ((await c.count().catch(() => 0)) > 0) return c.first();
  return null;
}

async function fillLabelled(ctx: PrepareContext, label: string, value: string, what: string) {
  const field = await fieldByLabel(ctx.page, label);
  if (!field) return ctx.check(what, 'unverified', `No "${label}" field found; fill it yourself.`);
  await setFieldValue(field, value);
  const now = await field.inputValue().catch(() => '');
  ctx.check(what, now === value ? 'pass' : 'unverified', now === value ? undefined : `Check "${label}" in the tab.`);
}

/** Tick exactly the wanted options and sections (WordPress checkboxes found by their label). */
async function setChoices(ctx: PrepareContext, names: string[], wanted: string[]) {
  const { page } = ctx;
  for (const name of names) {
    const want = wanted.includes(name);
    // The category box also lists "Most used" copies in a hidden tab: use the visible one.
    const box = page.getByLabel(name, { exact: true }).filter({ visible: true }).first();
    if (!(await box.count())) {
      if (want) ctx.check(`"${name}"`, 'unverified', 'Not found on the page; tick it yourself.');
      continue;
    }
    if ((await box.isChecked().catch(() => !want)) !== want) await safeClick(box, `"${name}"`, { forbiddenSelectors: WP.forbidden });
    const ok = (await box.isChecked().catch(() => !want)) === want;
    if (!ok || want) ctx.check(`"${name}"${want ? ' ticked' : ' unticked'}`, ok ? 'pass' : 'unverified');
  }
}

async function addTags(ctx: PrepareContext, tags: string[]) {
  const { page } = ctx;
  const input = page.locator(WP.tagInput).first();
  if (!tags.length) return;
  if (!(await input.count())) return ctx.check('Tags', 'unverified', 'No tag box found; add the tags yourself.');
  const before = await page.locator(WP.tagChips).count();
  await setFieldValue(input, tags.join(','));
  await safeClick(page.locator(WP.tagAdd).first(), 'Add tags', { forbiddenSelectors: WP.forbidden });
  const added = await pollUntil(async () => (await page.locator(WP.tagChips).count()) - before >= tags.length, 5000, 250);
  ctx.check(`Tags (${tags.length})`, added ? 'pass' : 'unverified', added ? undefined : 'Check the tags in the tab.');
}

async function setFeaturedImage(ctx: PrepareContext, path: string, mime: string, name: string) {
  const data = (await fsp.readFile(path)).toString('base64');
  const result = await ctx.page.evaluate(pageFn<{ data: string; type: string; name: string }, Promise<{ ok: boolean; error?: string }>>(UPLOAD_SCRIPT), { data, type: mime, name });
  ctx.check('Featured image', result.ok ? 'pass' : 'unverified', result.ok ? undefined : `${result.error ?? 'Not confirmed'} Set it yourself in "Featured image".`);
}

export const wordpressModule: PlatformModule = {
  id: 'wordpress',
  label: 'WordPress (Chouf)',
  entryUrl: WP.adminUrl,

  detectSession: (page) => detectSessionWith(page, WP.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    const wp = content.wordpress!;
    const kind = wp.postType === 'program' ? 'video' : 'news article';
    await ctx.step('Open WordPress and check sign-in', () => openWithSession(ctx, wordpressModule, WP.newPostUrl(wp.postType)));

    ctx.setStatus('preparing', `Opening a new ${kind}…`, 20);
    const title = await ctx.step('Locate the editor', () => requireVisible(page, [WP.title], 30_000, 'WordPress title field (classic editor)'));
    if (!(await page.locator(WP.content).count())) throw new Error('The WordPress classic editor is not showing. Switch this account to the classic editor, then Retry.');

    ctx.setStatus('filling', 'Filling the title and the article…', 40);
    await ctx.step('Fill title', () => fillTextField(page, title, content.title ?? ''));
    const html = articleHtml(content.text);
    const shown = await ctx.step('Fill article body', async () => {
      await setFieldValue(page.locator(WP.content), html);
      return page.evaluate(pageFn<string, string>(TINYMCE_SCRIPT), html);
    });
    ctx.check('Article body matches', normalizeForCompare(shown ?? '').includes(normalizeForCompare(content.text)) ? 'pass' : 'fail');

    ctx.setStatus('filling', 'Filling the article settings…', 60);
    await ctx.step('Fill Facebook title', () => fillLabelled(ctx, WP.facebookTitleLabel, content.title ?? '', 'Facebook title'));
    await ctx.step('Add tags', () => addTags(ctx, wp.tags));
    if (wp.postType === 'program') await ctx.step('Fill Video URL', () => fillLabelled(ctx, WP.videoUrlLabel, wp.videoUrl, 'Video URL'));
    const choices = WORDPRESS_CHOICES[wp.postType];
    await ctx.step('Choose options and sections', () => setChoices(ctx, [...choices.options, ...choices.categories], [...wp.options, ...wp.categories]));

    const image = content.media.find((m) => m.item.kind === 'image');
    if (image) {
      ctx.setStatus('uploading', 'Uploading the featured image…', 75);
      await ctx.step('Upload featured image', () => setFeaturedImage(ctx, image.path, image.item.mime, image.item.name));
    }

    ctx.setStatus('verifying', 'Verifying the article…', 90);
    const titleNow = normalizeForCompare(await readFieldText(title).catch(() => ''));
    ctx.check('Title matches', titleNow === normalizeForCompare(content.title ?? '') ? 'pass' : 'fail');
    const publish = await observeOnly(page.locator(WP.publishButton));
    ctx.check('Article ready', publish.visible ? 'pass' : 'unverified', publish.visible ? undefined : 'The Publish button is not showing; check the article in the tab.');
    // WordPress gives the article its id when the editor opens, so a news article's address is
    // already known; it goes live when the article is published.
    const id = await page.locator(WP.postId).inputValue().catch(() => '');
    if (wp.postType === 'press' && /^\d+$/.test(id)) ctx.setArticle({ title: content.title ?? '', url: WP.pressLink(id), published: false });
  },

  async publish(ctx) {
    const { page, content } = ctx;
    await ctx.publishClick(page.locator(WP.publishButton), 'Publish');
    // WordPress reloads on post.php with the post's status set to "publish".
    const done = await pollUntil(async () => /\/post\.php/.test(page.url()) && (await page.locator(WP.publishedStatus).inputValue().catch(() => '')) === 'publish', 90_000, 1000);
    if (!done) throw new Error('WordPress did not confirm the article is published.');
    const postType = content.wordpress!.postType;
    const id = await page.locator(WP.postId).inputValue().catch(() => '');
    const hrefs = await page.locator(WP.permalinkLinks).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    const url = publicLink(hrefs, postType, id) ?? (postType === 'press' && /^\d+$/.test(id) ? WP.pressLink(id) : null);
    if (url) ctx.setArticle({ title: content.title ?? '', url, published: true });
    ctx.check('Published on WordPress', 'pass', url ?? 'Find the article\'s link in WordPress.');
  },
};
