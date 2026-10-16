import type { Locator, Page } from 'playwright';
import { fieldContains, fillTextField, findAttached, findVisible, pollUntil, requireAttached, requireVisible, setFiles } from '../automation/helpers';
import { observeOnly, safeClick } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { YT } from './selectors/youtube';
import type { PlatformModule, PrepareContext } from './types';
import type { YouTubeChannel } from '../../shared/types';

async function progressText(page: Page): Promise<string> {
  const label = await findVisible(page, YT.progressLabel, 0);
  return label ? (await label.innerText()).replace(/\s+/g, ' ').trim() : '';
}

async function dialogError(page: Page): Promise<string | null> {
  const el = await findVisible(page, YT.dialogErrors, 0);
  const text = el ? (await el.innerText()).trim() : '';
  return text || null;
}

async function isChecked(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true')
    .catch(() => false);
}

async function waitForUploadTransfer(ctx: PrepareContext, sizeBytes: number): Promise<boolean> {
  const { page } = ctx;
  const timeout = 10 * 60_000 + Math.ceil(sizeBytes / (256 * 1024)) * 1000;
  const done = await pollUntil(async () => {
    const text = await progressText(page);
    if (YT.uploadFailed.test(text)) throw new Error(`YouTube reported: ${text}`);
    if (text) ctx.setStatus('uploading', `YouTube: ${text}`, 70);
    return !!text && !YT.stillUploading.test(text);
  }, timeout, 2000);
  return !!done;
}

/**
 * Channel post (Posts tab): expand the composer, fill the text, attach images, stop before
 * "Publish". Runs on youtube.com, not Studio.
 */
const foldName = (t: string) =>
  t
    .normalize('NFC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Name of the channel YouTube is currently acting as (heading of the channel page). */
async function activeChannelName(page: Page): Promise<string | null> {
  await page.goto(YT.post.profileUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!(await pollUntil(async () => YT.post.channelUrl.test(page.url()), 20_000))) return null;
  const heading = page.getByRole('heading', { level: 1 }).filter({ visible: true }).first();
  return pollUntil(async () => ((await heading.innerText().catch(() => '')).trim() || null), 15_000);
}

async function switcherItems(page: Page) {
  await page.goto(YT.channels.switcherUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await pollUntil(async () => (await page.locator(YT.channels.item).count()) > 0, 20_000);
  const items = page.locator(YT.channels.item);
  const out: { channel: YouTubeChannel; item: Locator }[] = [];
  for (let i = 0; i < (await items.count()); i++) {
    const lines = (await items.nth(i).innerText().catch(() => '')).split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    out.push({ channel: { name: lines[0], handle: lines.find((l) => l.startsWith('@')) ?? '' }, item: items.nth(i) });
  }
  return out;
}

/** The channels this Google account can switch to (from YouTube's channel switcher). */
export async function readYouTubeChannels(page: Page): Promise<YouTubeChannel[]> {
  const state = await pollUntil(async () => {
    await page.goto(YT.channels.switcherUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const s = await youtubeStudioModule.detectSession(page);
    return s === 'unknown' ? null : s;
  }, 30_000, 2000);
  if (state && state !== 'logged_in') throw new Error('Sign in to YouTube in this Chrome first.');
  const channels = (await switcherItems(page)).map((c) => c.channel);
  if (!channels.length) throw new Error('No channels found on YouTube\'s channel switcher. Add them by hand instead.');
  return channels;
}

/** Make YouTube act as this channel (switching is browser-wide), then confirm it. */
async function ensureChannel(ctx: PrepareContext, name: string) {
  const { page } = ctx;
  const current = await activeChannelName(page);
  if (current && foldName(current) === foldName(name)) {
    ctx.check(`Channel "${name}"`, 'pass');
    return;
  }
  ctx.setStatus('preparing', `Switching YouTube to "${name}"…`, 12);
  const entry = (await switcherItems(page)).find((c) => foldName(c.channel.name) === foldName(name));
  if (entry) {
    const before = page.url();
    await safeClick(entry.item, `Channel "${name}"`, { forbiddenSelectors: YT.forbidden });
    await pollUntil(async () => page.url() !== before, 20_000, 500);
  } else {
    ctx.log(`"${name}" is not on the channel switcher`, 'warn');
  }
  const now = await activeChannelName(page);
  if (now && foldName(now) === foldName(name)) {
    ctx.check(`Channel "${name}"`, 'pass', current ? `Switched from "${current}"` : undefined);
    return;
  }
  await ctx.snapshot('youtube-channel');
  ctx.setStatus('needs_attention', `Please switch YouTube to "${name}"`, 12);
  await ctx.waitForUser(`Could not switch YouTube to "${name}" automatically (it's on "${now ?? 'unknown'}"). Press Show tab, use your avatar menu → Switch account → "${name}", then press Continue.`, {
    until: async () => foldName((await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')) || '') === foldName(name),
  });
  const confirmed = await activeChannelName(page);
  ctx.check(`Channel "${name}"`, confirmed && foldName(confirmed) === foldName(name) ? 'pass' : 'fail', confirmed ? `Active channel: ${confirmed}` : undefined);
}

/** Loaded, visible images (not icons or empty placeholders). */
async function countVisibleImages(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((els) =>
    els.filter((el) => {
      const img = el as HTMLImageElement;
      const r = img.getBoundingClientRect();
      return r.width >= 24 && r.height >= 24 && img.complete && img.naturalWidth > 0;
    }).length,
  );
}

async function preparePost(ctx: PrepareContext) {
  const { page, content } = ctx;
  const P = YT.post;
  const images = content.media.filter((m) => m.item.kind === 'image');

  await ctx.step('Open YouTube and check sign-in', () => openWithSession(ctx, youtubeStudioModule, P.profileUrl));
  if (content.youtube?.channel) {
    await ctx.step('Switch to the selected channel', () => ensureChannel(ctx, content.youtube!.channel));
    await page.goto(P.profileUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  ctx.setStatus('preparing', 'Opening your channel\'s Posts tab…', 20);
  const channel = await pollUntil(async () => P.channelUrl.exec(page.url())?.[0] ?? null, 20_000);
  if (!channel) throw new Error('Could not find your YouTube channel. Make sure this Google account has a channel.');
  await page.goto(`https://www.${channel}/posts`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const placeholder = await ctx.step('Locate the post composer', () => requireVisible(page, P.placeholder, 30_000, 'post composer'));
  await ctx.step('Open the post composer', () => safeClick(placeholder, 'Post composer', { forbiddenSelectors: YT.forbidden }));
  const box = await ctx.step('Locate post text box', () => requireVisible(page, P.textbox, 15_000, 'post text box'));

  if (content.text) {
    ctx.setStatus('filling', 'Filling the post text…', 40);
    await ctx.step('Fill post text', () => fillTextField(page, box, content.text));
  }

  if (images.length) {
    ctx.setStatus('uploading', `Adding ${images.length} image(s)…`, 55);
    // Always open the picker through "Add image": its inputs exist in the page before that, but
    // files set on the inactive picker are ignored.
    const picker = page.locator(`${P.dialog} ytd-backstage-multi-image-select-renderer`).first();
    if (!(await picker.isVisible().catch(() => false))) {
      const button = page.locator(P.dialog).getByRole('button', { name: P.addImageButton });
      await ctx.step('Open image picker', () => safeClick(button, 'Add image', { forbiddenSelectors: YT.forbidden }));
      await ctx.step('Wait for image picker', () => picker.waitFor({ state: 'visible', timeout: 15_000 }));
    }
    const before = await countVisibleImages(page, P.thumbnails);
    const input = await ctx.step('Locate image input', () => requireAttached(page, P.imageInput, 15_000, 'image upload input'));
    await ctx.step('Attach images', () => setFiles(input, images.map((m) => m.path)));
    const timeout = 60_000 + Math.ceil(images.reduce((n, m) => n + m.item.size, 0) / (256 * 1024)) * 1000;
    const shown = await ctx.step('Wait for image previews', () =>
      pollUntil(async () => {
        const n = (await countVisibleImages(page, P.thumbnails)) - before;
        ctx.setStatus('uploading', `Images added: ${Math.max(0, Math.min(n, images.length))}/${images.length}`, 65);
        return n >= images.length ? n : null;
      }, timeout, 1000),
    );
    if (shown) ctx.check(`Images added (${images.length})`, 'pass');
    else {
      ctx.check(`Images added (${images.length})`, 'unverified', 'Could not count the image previews; check them in the composer.');
      await ctx.snapshot('youtube-post-images');
    }
  }

  ctx.setStatus('verifying', 'Verifying the post…', 90);
  if (content.text) ctx.check('Post text matches', (await fieldContains(box, content.text)) ? 'pass' : 'fail');
  const publish = await observeOnly(page.locator(P.submitButton));
  ctx.check('Post composer open; Publish left for you (not clicked)', publish.visible ? 'pass' : 'unverified');
}

export const youtubeStudioModule: PlatformModule = {
  id: 'youtube',
  label: 'YouTube Studio',
  entryUrl: YT.studioUrl,

  detectSession: (page) => detectSessionWith(page, YT.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    const yt = content.youtube!;
    if (yt.postType === 'post') return preparePost(ctx);
    const video = content.media.find((m) => m.item.kind === 'video');
    if (!video) throw new Error('No video file selected for YouTube.');

    await ctx.step('Open YouTube Studio and check sign-in', () => openWithSession(ctx, youtubeStudioModule, YT.uploadUrl));
    if (yt.channel) {
      await ctx.step('Switch to the selected channel', () => ensureChannel(ctx, yt.channel));
      await page.goto(YT.uploadUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    ctx.setStatus('preparing', 'Opening the upload dialog…', 15);
    const dialog = await findVisible(page, YT.uploadsDialog, 30_000);
    if (!dialog) {
      // e.g. "Create a channel" prompt, or Studio opened without the dialog.
      await ctx.waitForUser('YouTube Studio did not show the upload dialog. If it asks you to create a channel or accept terms, do that, then open Create → Upload videos and press Continue.', {
        until: async () => !!(await findVisible(page, YT.uploadsDialog, 0)),
      });
    }

    ctx.setStatus('uploading', `Uploading ${video.item.name}…`, 25);
    const input = await ctx.step('Locate video file input', () => requireAttached(page, YT.fileInput, 20_000, 'video file input'));
    await ctx.step('Select video file', () => setFiles(input, [video.path]));

    const title = await ctx.step('Wait for the Details form', () => requireVisible(page, YT.title, 120_000, 'title field'));
    const err = await dialogError(page);
    if (err) throw new Error(`YouTube reported: ${err}`);

    ctx.setStatus('filling', 'Filling title and description…', 40);
    await ctx.step('Fill title', () => fillTextField(page, title, content.title ?? ''));
    if (content.text) {
      const desc = await ctx.step('Locate description field', () => requireVisible(page, YT.description, 15_000, 'description field'));
      await ctx.step('Fill description', () => fillTextField(page, desc, content.text));
    }

    if (content.thumbnail) {
      const thumbInput = await findAttached(page, YT.thumbnailInput, 10_000);
      if (!thumbInput) {
        ctx.check('Custom thumbnail', 'unverified', 'No thumbnail upload control found. Custom thumbnails need a verified channel.');
      } else {
        await ctx.step('Upload thumbnail', () => setFiles(thumbInput, [content.thumbnail!.path]));
        const shown = await findVisible(page, YT.thumbnailPreview, 20_000);
        ctx.check('Custom thumbnail', shown ? 'pass' : 'unverified', shown ? undefined : 'Could not confirm the thumbnail preview; check it in the dialog.');
      }
    }

    if (yt.audience !== 'unset') {
      const sel = YT.audience[yt.audience];
      await ctx.step('Set audience', () => safeClick(page.locator(sel), yt.audience === 'kids' ? 'Made for kids' : 'Not made for kids', { forbiddenSelectors: YT.forbidden }));
      ctx.check('Audience set', (await isChecked(page, sel)) ? 'pass' : 'unverified');
    } else {
      ctx.check('Audience ("made for kids")', 'unverified', 'Not configured: choose it yourself on the Details step.');
    }

    ctx.setStatus('verifying', 'Verifying details…', 60);
    const titleOk = await fieldContains(title, content.title ?? '');
    ctx.check('Title matches', titleOk ? 'pass' : 'fail');
    if (content.text) {
      const desc = await findVisible(page, YT.description, 5000);
      const ok = desc ? await fieldContains(desc, content.text) : false;
      ctx.check('Description matches', ok ? 'pass' : 'fail');
    }

    if (yt.advanceToVisibilityStep && yt.audience !== 'unset') {
      ctx.setStatus('preparing', 'Moving to the Visibility step (Next only)…', 70);
      for (let i = 0; i < 3; i++) {
        if (await findVisible(page, YT.visibilityStep, 0)) break;
        await ctx.step(`Click Next (${i + 1}/3)`, () => safeClick(page.locator(YT.nextButton), 'Next', { forbiddenSelectors: YT.forbidden }));
        const e = await dialogError(page);
        if (e) throw new Error(`YouTube blocked the next step: ${e}`);
      }
      const atVisibility = await findVisible(page, YT.visibilityStep, 20_000);
      ctx.check('Reached Visibility step', atVisibility ? 'pass' : 'unverified');
      if (atVisibility && yt.visibility !== 'unset') {
        const sel = YT.visibility[yt.visibility];
        await ctx.step('Choose visibility', () => safeClick(page.locator(sel), `Visibility: ${yt.visibility}`, { forbiddenSelectors: YT.forbidden }));
        ctx.check(`Visibility "${yt.visibility}" selected (not saved)`, (await isChecked(page, sel)) ? 'pass' : 'unverified');
      }
    }

    const transferred = await ctx.step('Wait for video upload', () => waitForUploadTransfer(ctx, video.item.size));
    const status = await progressText(page);
    ctx.check('Video file uploaded', transferred ? 'pass' : 'unverified', status || undefined);

    ctx.setStatus('verifying', 'Final check…', 95);
    const done = await observeOnly(page.locator(YT.doneButton));
    ctx.check('Upload dialog open; Save/Publish left for you (not clicked)', done.visible ? 'pass' : 'unverified');
  },
};
