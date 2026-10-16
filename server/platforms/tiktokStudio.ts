import { fieldContains, fillTextField, findAttached, findVisible, pollUntil, readFieldText, requireAttached, requireVisible, setFiles, visibleText } from '../automation/helpers';
import { observeOnly, safeClick } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { TT } from './selectors/tiktok';
import type { PlatformModule, PrepareContext } from './types';

/** "Modifier la couverture" → upload the image → "Enregistrer" (only inside the cover editor). */
async function setCover(ctx: PrepareContext, coverPath: string) {
  const { page } = ctx;
  const container = page.locator(TT.cover.container).filter({ visible: true }).first();
  if (!(await container.isVisible().catch(() => false))) {
    ctx.check('Cover', 'unverified', 'TikTok did not show the cover editor; set the cover yourself.');
    return;
  }
  const edit = container.getByText(TT.cover.edit).first();
  await safeClick((await edit.isVisible().catch(() => false)) ? edit : container, 'Edit cover', { forbiddenSelectors: TT.forbidden });
  const dialog = page.locator(TT.cover.dialog).filter({ visible: true }).first();
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await setFiles(dialog.locator(TT.cover.input).first(), [coverPath]);
  const save = dialog.getByRole('button', { name: TT.cover.save });
  const ready = await pollUntil(async () => (await observeOnly(save)).enabled, 20_000, 500);
  if (!ready) {
    ctx.check('Cover', 'unverified', 'The cover editor did not accept the image; finish it in the tab.');
    await ctx.snapshot('tiktok-cover');
    return;
  }
  await safeClick(save, 'Save cover', { forbiddenSelectors: TT.forbidden, allowLabels: TT.cover.save });
  const closed = await pollUntil(async () => !(await dialog.isVisible().catch(() => false)), 20_000, 500);
  ctx.check('Cover uploaded', closed ? 'pass' : 'unverified', closed ? undefined : 'The cover editor is still open; check it in the tab.');
  if (!closed) await ctx.snapshot('tiktok-cover');
}

export const tiktokStudioModule: PlatformModule = {
  id: 'tiktok',
  label: 'TikTok Studio',
  entryUrl: TT.homeUrl,

  detectSession: (page) => detectSessionWith(page, TT.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    const isPhotoPost = content.media.every((m) => m.item.kind === 'image');

    await ctx.step('Open TikTok Studio and check sign-in', () => openWithSession(ctx, tiktokStudioModule, TT.uploadUrl));

    ctx.setStatus('preparing', 'Opening the upload page…', 20);
    await requireAttached(page, TT.fileInput, 45_000, 'upload input').catch(() => undefined);

    // TikTok may offer to resume an earlier unsaved video. It doesn't block a new upload, so the
    // prompt is left untouched (neither discarded nor resumed) and the new files are selected.
    if (await visibleText(page, TT.unsavedDraftPrompt)) ctx.log('TikTok offers to resume an earlier unsaved video; leaving it and starting a new upload');

    let input;
    if (isPhotoPost) {
      const tab = page.getByRole('tab', { name: TT.photosTab });
      if (await tab.first().isVisible().catch(() => false)) {
        await ctx.step('Switch to the Photos tab', () => safeClick(tab, 'Photos tab', { forbiddenSelectors: TT.forbidden }));
      }
      input = await findAttached(page, TT.imageInput, 15_000);
      if (!input) {
        throw new Error('This TikTok Studio page does not offer photo posts for your account. Use the TikTok app, or deselect the images for TikTok.');
      }
    } else {
      input = await ctx.step('Locate upload input', () => requireAttached(page, TT.fileInput, 45_000, 'upload input'));
    }

    ctx.setStatus('uploading', `Uploading ${content.media.length} file(s)…`, 30);
    await ctx.step('Select files', () => setFiles(input, content.media.map((m) => m.path)));

    const caption = await ctx.step('Wait for the post editor', () => requireVisible(page, TT.caption, 120_000, 'caption editor'));
    // TikTok pre-fills the caption with the file name; let that happen before replacing it.
    await pollUntil(async () => (await readFieldText(caption)).trim().length > 0, 5000, 250);

    ctx.setStatus('filling', 'Filling the caption…', 45);
    await ctx.step('Fill caption', () => fillTextField(page, caption, content.text));

    const totalBytes = content.media.reduce((s, m) => s + m.item.size, 0);
    const timeout = 5 * 60_000 + Math.ceil(totalBytes / (256 * 1024)) * 1000;
    let modalHandled = false;
    const uploaded = await ctx.step('Wait for upload to finish', () =>
      pollUntil(async () => {
        const failed = await visibleText(page, TT.uploadFailed);
        if (failed) throw new Error(`TikTok reported: ${failed}`);
        if (!modalHandled && (await findVisible(page, TT.modal, 0))) {
          modalHandled = true;
          ctx.setStatus('needs_attention', 'TikTok opened a dialog that needs your decision.', 55);
          await ctx.waitForUser('TikTok is showing a dialog (e.g. content checks or a tip). Handle it in the browser, then press Continue. The automation will not choose for you.', {
            until: async () => !(await findVisible(page, TT.modal, 0)),
          });
          ctx.setStatus('uploading', 'Waiting for the upload to finish…', 60);
        }
        if (await visibleText(page, TT.uploadedText)) return true;
        const post = await observeOnly(page.locator(TT.postButton));
        return post.enabled;
      }, timeout, 1500),
    );
    ctx.check('Media uploaded', uploaded ? 'pass' : 'unverified', uploaded ? undefined : 'Upload completion was not confirmed; check the progress in the browser.');

    if (content.thumbnail && !isPhotoPost) {
      ctx.setStatus('filling', 'Setting the cover…', 85);
      await ctx.step('Set cover', () => setCover(ctx, content.thumbnail!.path));
    }

    ctx.setStatus('verifying', 'Verifying caption and media…', 90);
    // Caption can be reset while TikTok processes the upload; refill once if needed.
    if (content.text && !(await fieldContains(caption, content.text))) {
      ctx.log('Caption changed during upload; filling it again', 'warn');
      await ctx.step('Refill caption', () => fillTextField(page, caption, content.text));
    }
    if (content.text) ctx.check('Caption matches', (await fieldContains(caption, content.text)) ? 'pass' : 'fail');
    ctx.check('Media preview visible', (await findVisible(page, TT.preview, 5000)) ? 'pass' : 'unverified');
    const post = await observeOnly(page.locator(TT.postButton));
    ctx.check('Post button present (not clicked)', post.visible ? 'pass' : 'unverified');
  },
};
