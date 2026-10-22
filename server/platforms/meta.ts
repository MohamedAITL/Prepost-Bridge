import type { Locator, Page } from 'playwright';
import { fieldContains, fillTextField, findAttached, findVisible, pollUntil, requireVisible, setFiles, visibleText, openUrl } from '../automation/helpers';
import { observeOnly, safeClick } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { DESTINATION_LABELS, type MetaPage } from '../../shared/types';
import { META } from './selectors/meta';
import { readSettings, writeSettings } from '../utils/settings';
import type { PlatformModule, PrepareContext } from './types';

/** The enabled "Add …" media button that fits the media ("Add Video" for a Reel), or any enabled one. */
async function findAddMediaButton(page: Page, video: boolean): Promise<Locator | null> {
  const buttons = page.getByRole('button', { name: META.addMediaButton }).filter({ visible: true });
  const fits = video ? /video|vidéo|vídeo|فيديو/i : /photo|foto|صور/i;
  return pollUntil(async () => {
    let fallback: Locator | null = null;
    for (let i = 0; i < (await buttons.count()); i++) {
      const b = buttons.nth(i);
      if (!(await observeOnly(b)).enabled) continue;
      const name = `${await b.innerText().catch(() => '')} ${(await b.getAttribute('aria-label').catch(() => '')) ?? ''}`;
      if (fits.test(name)) return b;
      fallback ??= b;
    }
    return fallback;
  }, 15_000, 500);
}

async function attachViaPicker(ctx: PrepareContext, page: Page, paths: string[], video: boolean) {
  const opener = await ctx.step('Find Add photo/video button', () => findAddMediaButton(page, video));
  if (!opener) {
    // Label in another language or a new layout: hand the files to the composer's own file input.
    const input = await findAttached(page, video ? ['input[type="file"][accept*="video"]'] : META.fileInput, 3000);
    if (!input) throw new Error('Could not find Meta\'s "Add photo/video" button or a file input. Add the media in the tab, then press Retry.');
    await setFiles(input, paths);
    ctx.log('Files attached through the composer\'s file input');
    return;
  }
  const chooser = page.waitForEvent('filechooser', { timeout: 20_000 });
  chooser.catch(() => undefined); // if the clicks below fail, this must not become an unhandled rejection
  const label = (await opener.innerText().catch(() => '')).trim() || 'Add photo/video';
  await ctx.step(`Click "${label}"`, () => safeClick(opener, label, { forbiddenSelectors: META.forbidden, timeout: 5000 }));
  // Some layouts open a small menu first ("Upload from computer"); give it a moment to appear.
  const menuItem = page.getByRole('menuitem', { name: META.uploadFromComputer }).or(page.getByRole('button', { name: META.uploadFromComputer })).filter({ visible: true });
  if (await menuItem.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
    await ctx.step('Click "Upload from computer"', () => safeClick(menuItem, 'Upload from computer', { forbiddenSelectors: META.forbidden }));
  }
  const fc = await ctx.step('Wait for the file picker', () => chooser);
  if (paths.length > 1 && !fc.isMultiple()) throw new Error('The Meta media picker only accepts one file at a time here.');
  await fc.setFiles(paths);
  ctx.log('Files attached through the media picker');
}

/** Reel "Thumbnail" section: "Upload image" opens a file picker; confirm an editor if one appears. */
async function setReelThumbnail(ctx: PrepareContext, page: Page, coverPath: string) {
  const upload = page.getByRole('button', { name: META.reelThumbnailUpload }).filter({ visible: true }).first();
  if (!(await upload.isVisible().catch(() => false))) {
    ctx.check('Reel thumbnail', 'unverified', 'No "Upload image" option for the thumbnail; set it yourself.');
    return;
  }
  // "Upload image" is a toggle (seen 2026-10); it reveals an "Upload image" link that opens the picker.
  if ((await upload.getAttribute('aria-pressed').catch(() => null)) !== 'true') {
    await safeClick(upload, 'Thumbnail: Upload image option', { forbiddenSelectors: META.forbidden });
  }
  const link = page.getByRole('link', { name: META.reelThumbnailUpload }).filter({ visible: true }).first();
  await link.waitFor({ state: 'visible', timeout: 10_000 });
  const before = await countMediaPreviews(page);
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  chooser.catch(() => undefined);
  await safeClick(link, 'Upload thumbnail image', { forbiddenSelectors: META.forbidden });
  await (await chooser).setFiles(coverPath);
  // Some versions open a crop/preview dialog with its own Save.
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: META.editorSave }) }).filter({ visible: true }).first();
  if (await dialog.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
    await safeClick(dialog.getByRole('button', { name: META.editorSave }), 'Save thumbnail', { forbiddenSelectors: META.forbidden, allowLabels: META.editorSave });
    await pollUntil(async () => !(await dialog.isVisible().catch(() => false)), 15_000);
  }
  // Uploaded: the link turns into "Change image" (and a new preview usually appears).
  const changeLink = page.getByRole('link', { name: META.reelThumbnailChange }).filter({ visible: true });
  const chosen = await pollUntil(async () => (await changeLink.count()) > 0 || (await countMediaPreviews(page)) > before, 20_000, 500);
  ctx.check('Reel thumbnail uploaded', chosen ? 'pass' : 'unverified', chosen ? undefined : 'Check the thumbnail in the tab.');
  if (!chosen) await ctx.snapshot('meta-reel-thumbnail');
}

/**
 * Reel composer: click "Next" through Create → Edit → Share, stopping when the final Share/Publish
 * button is showing. Never clicks that button.
 */
async function advanceReel(ctx: PrepareContext, page: Page) {
  // The thumbnail carousel has its own "Next": the step button is the last one (page footer).
  const next = page.getByRole('button', { name: META.nextButton }).filter({ visible: true }).last();
  const finalButton = page.getByRole('button', { name: META.publishButton });
  for (let i = 0; i < 4; i++) {
    if ((await observeOnly(finalButton)).visible) break;
    const state = await observeOnly(next);
    if (!state.visible) break;
    if (!state.enabled) {
      // A step may need a moment (e.g. video processing) before Next unlocks.
      const unlocked = await pollUntil(async () => (await observeOnly(next)).enabled, 60_000, 1000);
      if (!unlocked) {
        ctx.check('Reel steps', 'unverified', '"Next" stayed disabled; finish this step in the tab, then Share yourself.');
        await ctx.snapshot('meta-reel-step');
        return;
      }
    }
    ctx.setStatus('preparing', `Reel: moving to the next step (${i + 1})…`, 92);
    const heading = await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '');
    await ctx.step(`Click Next (${i + 1})`, () => safeClick(next, 'Next', { forbiddenSelectors: META.forbidden }));
    // Wait for the step to change: the final button appears, or the page moves on.
    await pollUntil(
      async () => (await observeOnly(finalButton)).visible || (await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')) !== heading || !(await observeOnly(next)).enabled,
      15_000,
      500,
    );
  }
  const reached = (await observeOnly(finalButton)).visible;
  ctx.check('Reel at the Share step', reached ? 'pass' : 'unverified', reached ? undefined : 'Check the remaining Reel steps in the tab.');
  if (!reached) await ctx.snapshot('meta-reel-step');
}

/** Visible images/videos big enough to be media previews (icons are excluded by size). */
async function countMediaPreviews(page: Page): Promise<number> {
  return page.locator('img, video').evaluateAll((els) =>
    els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 48 && r.height >= 48 && getComputedStyle(el).visibility !== 'hidden';
    }).length,
  );
}

/**
 * A determinate upload progress bar below 100%. Ignores indeterminate spinners and the seek bar of
 * the video preview player (it's also a progressbar, and stays below 100% while paused).
 */
async function uploadInProgress(page: Page): Promise<boolean> {
  return page.locator('[role="progressbar"][aria-valuenow]').evaluateAll((els) =>
    els.some((el) => {
      const r = el.getBoundingClientRect();
      const now = Number(el.getAttribute('aria-valuenow'));
      const max = Number(el.getAttribute('aria-valuemax') || 100);
      const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('aria-valuetext') ?? ''}`;
      let n: Element | null = el;
      let inPlayer = false;
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) if (n.querySelector('video')) inPlayer = true;
      if (inPlayer || /play|seek|volume|time|lecture|durée/i.test(label)) return false;
      return r.width > 0 && r.height > 0 && now < max;
    }),
  );
}

function postToCombobox(page: Page) {
  // Business Suite can keep hidden copies of the composer around: only the visible one counts.
  return page.getByRole('combobox', { name: META.postTo }).filter({ visible: true }).first();
}

// Business Suite wraps names in zero-width spaces ("\u200b\nChouf TV Live\n\u200b"): drop them.
const fold = (t: string) =>
  t
    .normalize('NFC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Does "Post to" show exactly this Page? Its text is "Page" or "Page and ig_handle", so a prefix
 * match alone would confuse "Chouf TV" with "Chouf TV Live".
 */
export function postToShowsPage(label: string, pageName: string): boolean {
  const text = fold(label).replace(/^(post to|publier sur|النشر على|نشر على)\s*/, '');
  const name = fold(pageName);
  if (text === name) return true;
  return [' and ', ' et ', ' و', ', '].some((sep) => text.startsWith(name + sep));
}

/**
 * Is the composer on this Page? "Post to" fills in a moment after the composer appears, so give
 * it time. When the composer was opened with the Page's asset id, staying on that id also counts.
 */
async function waitForPostTo(page: Page, pageName: string, timeoutMs = 20_000, assetId: string | null = null): Promise<boolean> {
  return !!(await pollUntil(async () => (await postToIncludes(page, pageName)) || (!!assetId && (await assetIdNow(page)) === assetId), timeoutMs, 500));
}

async function postToIncludes(page: Page, pageName: string): Promise<boolean> {
  const combo = postToCombobox(page);
  if (!(await combo.isVisible().catch(() => false))) return false;
  const labels = [(await combo.getAttribute('aria-label')) ?? '', await combo.innerText().catch(() => '')];
  return labels.some((l) => postToShowsPage(l, pageName));
}

async function postToDestinations(page: Page): Promise<{ facebook: boolean; instagram: boolean; label: string } | null> {
  const combo = postToCombobox(page);
  if (!(await combo.isVisible().catch(() => false))) return null;
  return {
    facebook: (await combo.getByRole('img', { name: 'Facebook' }).count()) > 0,
    instagram: (await combo.getByRole('img', { name: 'Instagram' }).count()) > 0,
    label: (await combo.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
  };
}

async function currentAssetId(page: Page): Promise<string | null> {
  const href = await page.locator('a[href*="asset_id="]').first().getAttribute('href').catch(() => null);
  return href ? new URL(href, 'https://business.facebook.com').searchParams.get('asset_id') : null;
}

/** The menu is open once its Page rows (a radio each) or its "N business assets" title show. */
async function assetMenuOpen(page: Page, timeoutMs: number): Promise<boolean> {
  return !!(await pollUntil(
    async () => (await assetRows(page).first().isVisible().catch(() => false)) || (await page.getByText(META.assetMenu).first().isVisible().catch(() => false)),
    timeoutMs,
  ));
}

async function openAssetMenu(page: Page): Promise<boolean> {
  if (await assetMenuOpen(page, 0)) return true;
  // Wait for Business Suite's left column, where the switcher lives (slow on first load).
  const fbIcon = page.getByRole('img', { name: META.facebookIcon });
  await pollUntil(async () => fbIcon.first().isVisible().catch(() => false), 20_000);
  const notPostTo = { hasNot: page.getByText(META.postTo) };
  const candidates = [
    page.getByRole('combobox', { name: META.assetSwitcherCombobox }).filter(notPostTo),
    page.getByRole('button', { name: META.assetSwitcherName }),
    // Language/layout independent: any button or combobox showing the Facebook icon (brand icons keep their name).
    page.getByRole('button').filter({ has: fbIcon }).filter(notPostTo),
    page.getByRole('combobox').filter({ has: fbIcon }).filter(notPostTo),
  ];
  const tried = new Set<string>();
  for (const c of candidates) {
    const n = Math.min(await c.count().catch(() => 0), 3);
    for (let i = 0; i < n; i++) {
      const opener = c.nth(i);
      if (!(await opener.isVisible().catch(() => false))) continue;
      const key = (await opener.evaluate((el) => el.outerHTML.slice(0, 300)).catch(() => '')) || `${i}`;
      if (tried.has(key)) continue;
      tried.add(key);
      await safeClick(opener, 'Business asset menu', { forbiddenSelectors: META.forbidden }).catch(() => undefined);
      if (await assetMenuOpen(page, 6000)) return true;
    }
  }
  return false;
}

async function assetIdNow(page: Page): Promise<string | null> {
  return new URL(page.url()).searchParams.get('asset_id') ?? (await currentAssetId(page));
}

/**
 * In the asset menu (already open), select the Page's row and return its asset id once Business
 * Suite has switched to it. Returns null if the Page isn't listed or the switch can't be confirmed.
 */
async function selectAssetRow(page: Page, pageName: string): Promise<string | null> {
  await pollUntil(async () => (await assetRows(page).count()) > 0, 10_000);
  const row = (await readAssetRows(page)).find((r) => fold(r.page.name) === fold(pageName));
  if (!row) return null;
  const before = await assetIdNow(page);
  if (await row.radio.isChecked().catch(() => false)) return before;
  await safeClick(row.radio, `Page "${pageName}"`, { forbiddenSelectors: META.forbidden });
  return pollUntil(async () => {
    const id = await assetIdNow(page);
    return id && id !== before ? id : null;
  }, 20_000);
}

// Business Suite keeps one "current Page" per browser: only one job switches at a time.
let switchLock: Promise<unknown> = Promise.resolve();

/** Fallback when the Page's id isn't known yet: switch from Home, then open its composer. */
async function switchAsset(ctx: PrepareContext, page: Page, pageName: string, composerBase: string): Promise<boolean> {
  const run = switchLock.then(async () => {
    await openUrl(page, META.homeUrl);
    if (!(await openAssetMenu(page))) {
      ctx.log('Could not open the business asset menu', 'warn');
      return false;
    }
    const id = await selectAssetRow(page, pageName);
    if (!id) {
      ctx.log(`"${pageName}" could not be selected in the business asset menu`, 'warn');
      return false;
    }
    rememberMetaAsset(pageName, id);
    await openUrl(page, `${composerBase}?asset_id=${id}`);
    await findVisible(page, META.textbox, 30_000);
    return waitForPostTo(page, pageName);
  });
  switchLock = run.catch(() => undefined);
  const ok = await run;
  if (!ok) await ctx.snapshot('meta-switch');
  return ok;
}

function metaAssetId(name: string): string | null {
  const map = (readSettings().metaAssets ?? {}) as Record<string, string>;
  const id = map[fold(name)];
  return id && /^\d+$/.test(id) ? id : null;
}

function rememberMetaAsset(name: string, assetId: string) {
  if (!/^\d+$/.test(assetId)) return;
  const map = (readSettings().metaAssets ?? {}) as Record<string, string>;
  if (map[fold(name)] === assetId) return;
  writeSettings({ metaAssets: { ...map, [fold(name)]: assetId } });
}

/** Asset menu rows: one per Page, with a radio, a heading ("Name" or "Name, ig_handle") and FB/IG icons. */
function assetRows(page: Page) {
  return page.getByRole('row').filter({ has: page.getByRole('radio') });
}

/** "Chouf TV, chouftv_official" → "Chouf TV" when an Instagram account is linked. */
export function pageNameFromHeading(heading: string, instagram: boolean): string {
  const text = heading.replace(/\s+/g, ' ').trim();
  return instagram && text.includes(', ') ? text.slice(0, text.lastIndexOf(', ')) : text;
}

async function readAssetRows(page: Page): Promise<{ page: MetaPage; radio: Locator }[]> {
  const rows = assetRows(page);
  const out: { page: MetaPage; radio: Locator }[] = [];
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const heading = await row.getByRole('heading').first().innerText().catch(() => '');
    if (!heading.trim()) continue;
    const instagram = (await row.getByRole('img', { name: META.instagramIcon }).count()) > 0;
    const name = pageNameFromHeading(heading, instagram);
    if (!out.some((r) => r.page.name === name)) out.push({ page: { name, instagram }, radio: row.getByRole('radio').first() });
  }
  return out;
}

/** Read the user's Pages from Business Suite's asset menu (opened in its own tab). */
export async function readMetaPages(page: Page): Promise<MetaPage[]> {
  await openUrl(page, META.homeUrl);
  const state = await pollUntil(async () => {
    const s = await metaModule.detectSession(page);
    return s === 'unknown' ? null : s;
  }, 30_000);
  if (state !== 'logged_in') throw new Error('Sign in to Meta Business Suite in this Chrome first.');
  if (!(await openAssetMenu(page))) throw new Error('Could not open the business asset menu. Add your Pages by hand instead.');
  await pollUntil(async () => (await assetRows(page).count()) > 0, 10_000);
  const pages = (await readAssetRows(page)).map((r) => r.page);
  if (!pages.length) throw new Error('No Pages found in the business asset menu. Add your Pages by hand instead.');

  // Record each Page's asset id so posts can open that Page's composer directly
  // (composer?asset_id=…) without switching Pages in the menu.
  for (const p of pages) {
    if (!(await assetRows(page).first().isVisible().catch(() => false)) && !(await openAssetMenu(page))) break;
    const id = await selectAssetRow(page, p.name).catch(() => null);
    if (id) rememberMetaAsset(p.name, id);
  }
  return pages;
}

export const metaModule: PlatformModule = {
  id: 'meta',
  label: 'Meta Business Suite',
  entryUrl: META.homeUrl,

  detectSession: (page) => detectSessionWith(page, META.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    const opts = content.meta!;
    const targets = content.targets.map((t) => DESTINATION_LABELS[t]).join(' + ');

    const pageName = opts.page.trim();
    const knownAsset = pageName ? metaAssetId(pageName) : null;
    // A single video goes out as a Reel through Business Suite's "Create reel" composer.
    const reel = opts.videoAs === 'reel' && content.media.length === 1 && content.media[0].item.kind === 'video';
    const composerBase = reel ? META.reelComposerUrl : META.composerUrl;
    const composerUrl = knownAsset ? `${composerBase}?asset_id=${knownAsset}` : composerBase;
    if (reel) ctx.log('Preparing as a Reel');
    await ctx.step('Open Meta Business Suite and check sign-in', () => openWithSession(ctx, metaModule, composerUrl));

    ctx.setStatus('preparing', 'Opening the post composer…', 20);
    let box = await findVisible(page, META.textbox, 30_000);
    if (!box) {
      await openUrl(page, composerUrl);
      box = await ctx.step('Locate composer', () => requireVisible(page, META.textbox, 45_000, 'post composer text box'));
    }

    // Choose the Page: switch business asset when the composer is on a different one.
    if (pageName && !(await waitForPostTo(page, pageName, 20_000, knownAsset))) {
      ctx.setStatus('preparing', `Switching to the Page "${pageName}"…`, 25);
      const switched = await ctx.step('Switch to the selected Page', () => switchAsset(ctx, page, pageName, composerBase));
      if (!switched) {
        ctx.setStatus('needs_attention', `Please switch to "${pageName}"`, 25);
        await ctx.waitForUser(`Could not switch to "${pageName}" automatically. Press Show tab, pick "${pageName}" in Business Suite's asset menu (top left), open Create post, then press Continue.`, {
          until: () => postToIncludes(page, pageName),
        });
      }
      box = await ctx.step('Locate composer', () => requireVisible(page, META.textbox, 45_000, 'post composer text box'));
    }
    if (pageName) {
      const ok = (await postToIncludes(page, pageName)) || (!!knownAsset && (await assetIdNow(page)) === knownAsset);
      ctx.check(`Page "${pageName}" selected in "Post to"`, ok ? 'pass' : 'fail');
      const assetId = new URL(page.url()).searchParams.get('asset_id') ?? (await currentAssetId(page));
      if (ok && assetId) rememberMetaAsset(pageName, assetId);
    }

    // "Post to" already combines the Page and its linked Instagram account; just record it.
    const dest = await postToDestinations(page);
    if (dest) {
      const where = [dest.facebook && 'Facebook', dest.instagram && 'Instagram'].filter(Boolean).join(' + ');
      ctx.check(`Posting to ${where || '?'}`, dest.facebook ? 'pass' : 'unverified', dest.label);
    } else {
      ctx.check('Destination', 'unverified', 'Could not read "Post to"; check it before publishing.');
    }

    if (opts.confirmDestinations) {
      ctx.setStatus('needs_attention', `Confirm the destination: ${targets}`, 32);
      await ctx.waitForUser(`Press Show tab and check "Post to" (${targets}${pageName ? `, ${pageName}` : ''}). Then press Continue and the text and media will be filled in.`);
    }
    box = await requireVisible(page, META.textbox, 15_000, 'post composer text box');

    if (content.text) {
      ctx.setStatus('filling', 'Filling the post text…', 40);
      await ctx.step('Fill post text', () => fillTextField(page, box!, content.text));
    }

    const withVideo = content.media.some((m) => m.item.kind === 'video');
    if (withVideo) await ctx.showTab('the video uploads');
    if (content.media.length) {
      ctx.setStatus('uploading', `Uploading ${content.media.length} file(s)…`, 55);
      const before = await countMediaPreviews(page);
      // Reels: always through "Add Video" (the thumbnail section has its own image input).
      // Posts with a video: only an input that accepts video.
      const hasVideo = content.media.some((m) => m.item.kind === 'video');
      const input = reel ? null : await findAttached(page, hasVideo ? ['input[type="file"][accept*="video"]'] : META.fileInput, 3000);
      if (input) await ctx.step('Attach media files', () => setFiles(input, content.media.map((m) => m.path)));
      else await ctx.step('Attach media via picker', () => attachViaPicker(ctx, page, content.media.map((m) => m.path), hasVideo));

      const totalBytes = content.media.reduce((s, m) => s + m.item.size, 0);
      const timeout = 60_000 + Math.ceil(totalBytes / (256 * 1024)) * 1000;
      const expected = content.media.length;
      // Posts enable Publish once uploads finish; the Reel composer enables Next.
      const publish = reel ? page.getByRole('button', { name: META.nextButton }).filter({ visible: true }).last() : page.getByRole('button', { name: META.publishButton });
      let enabledSince = 0;
      const result = await ctx.step('Wait for media processing', () =>
        pollUntil(async () => {
          const err = await visibleText(page, META.mediaErrors);
          if (err) throw new Error(`Meta reported: ${err}`);
          const shown = (await countMediaPreviews(page)) - before;
          const busy = await uploadInProgress(page);
          const { enabled } = await observeOnly(publish);
          // Reels: Next stays disabled until the upload is done, so it alone is enough. Posts: Publish
          // can be enabled by the text alone, so also require no (real) upload bar.
          enabledSince = enabled && (reel || !busy) ? enabledSince || Date.now() : 0;
          ctx.setStatus('uploading', `Media previews: ${Math.max(0, Math.min(shown, expected))}/${expected}${busy ? ' (uploading…)' : ''}`, 65);
          if (shown >= expected && !busy) return 'counted';
          // Meta enables Publish once uploads are done; a few steady seconds is a reliable signal.
          if (enabledSince && Date.now() - enabledSince > 4000) return 'publish-enabled';
          return null;
        }, timeout, 1000),
      );
      if (result === 'counted') ctx.check(`Media added (${expected})`, 'pass');
      else if (result === 'publish-enabled') ctx.check(`Media added (${expected})`, 'pass', `Upload finished (${reel ? 'Next' : 'Publish'} became available)`);
      else {
        ctx.check(`Media added (${expected})`, 'unverified', 'Could not confirm the upload finished; check the media in the composer.');
        await ctx.snapshot('meta-media');
      }
    }

    ctx.setStatus('verifying', 'Verifying the composer…', 90);
    if (content.text) {
      const current = (await findVisible(page, META.textbox, 5000)) ?? box!;
      ctx.check('Post text matches', (await fieldContains(current, content.text)) ? 'pass' : 'fail');
    }

    if (reel && content.thumbnail) await ctx.step('Set Reel thumbnail', () => setReelThumbnail(ctx, page, content.thumbnail!.path));
    if (reel) await advanceReel(ctx, page);
    await ctx.hideTab();

    const publish = await observeOnly(page.getByRole('button', { name: META.publishButton }));
    ctx.check(`${reel ? 'Reel' : 'Composer'} ready`, publish.visible ? 'pass' : 'unverified');
  },

  async publish(ctx) {
    const { page } = ctx;
    // Publish (posts) or Share (Reels), never Schedule. The footer button is the last match.
    const button = page.getByRole('button', { name: META.finalButton }).filter({ visible: true }).last();
    const start = page.url();
    await ctx.publishClick(button, 'Publish');
    // Business Suite leaves the composer once it accepted the post.
    const done = await pollUntil(async () => {
      const err = await visibleText(page, META.mediaErrors);
      if (err) throw new Error(`Meta reported: ${err}`);
      return (page.url() !== start && !/composer/.test(page.url())) || !!(await visibleText(page, META.publishedText));
    }, 180_000, 1500);
    if (!done) throw new Error('Meta did not confirm: the composer is still open.');
    ctx.check('Published on Meta', 'pass');
  },
};
