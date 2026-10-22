import { fieldContains, findVisible, pollUntil, readFieldText, requireAttached, requireVisible, setFiles, visibleText, fillTextField, openUrl } from '../automation/helpers';
import { observeOnly } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { X } from './selectors/x';
import type { PlatformModule } from './types';

export const xModule: PlatformModule = {
  id: 'x',
  label: 'X',
  entryUrl: X.homeUrl,

  detectSession: (page) => detectSessionWith(page, X.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    await ctx.step('Open X and check sign-in', () => openWithSession(ctx, xModule, X.composeUrl));

    ctx.setStatus('preparing', 'Opening the post composer…', 20);
    // After a login redirect X may land on /home; the compose URL opens the composer dialog.
    let box = await findVisible(page, X.textbox, 15_000);
    if (!box) {
      await openUrl(page, X.composeUrl);
      box = await ctx.step('Locate post text box', () => requireVisible(page, X.textbox, 30_000, 'post text box'));
    }

    if (content.text) {
      ctx.setStatus('filling', 'Filling the post text…', 35);
      await ctx.step('Fill post text', () => fillTextField(page, box!, content.text));
    }

    if (content.media.length) {
      ctx.setStatus('uploading', `Uploading ${content.media.length} file(s)…`, 50);
      const input = await ctx.step('Locate media input', () => requireAttached(page, X.fileInput, 15_000, 'media upload input'));
      await ctx.step('Attach media files', () => setFiles(input, content.media.map((m) => m.path)));

      const totalBytes = content.media.reduce((s, m) => s + m.item.size, 0);
      const timeout = 120_000 + Math.ceil(totalBytes / (256 * 1024)) * 1000; // ≥256 KB/s
      const expected = content.media.length;
      const done = await ctx.step('Wait for media upload', () =>
        pollUntil(async () => {
          const err = await visibleText(page, X.mediaErrors);
          if (err) throw new Error(`X rejected the media: ${err}`);
          const shown = await page.locator(X.attachmentMedia).count();
          const busy = await findVisible(page, X.uploadProgress, 0);
          ctx.setStatus('uploading', `Media attached: ${Math.min(shown, expected)}/${expected}${busy ? ' (processing…)' : ''}`, 60);
          return shown >= expected && !busy;
        }, timeout, 1000),
      );
      const err = await visibleText(page, X.mediaErrors);
      if (err) throw new Error(`X rejected the media: ${err}`);
      const shown = await page.locator(X.attachmentMedia).count();
      ctx.check(`Media attached (${expected})`, done ? 'pass' : shown > 0 ? 'unverified' : 'fail', done ? undefined : `Composer shows ${shown} preview(s); upload may still be processing.`);
    }

    ctx.setStatus('verifying', 'Verifying the composer…', 90);
    if (content.text) {
      const ok = await fieldContains(box, content.text);
      ctx.check('Post text matches', ok ? 'pass' : 'fail', ok ? undefined : 'The composer text differs from your text.');
    }
    const post = await observeOnly(page.locator(X.postButton));
    ctx.check('Composer open with Post button', post.visible ? 'pass' : 'unverified', post.visible && !post.enabled ? 'Post button is disabled; X may consider the post invalid (e.g. too long).' : undefined);
  },

  async publish(ctx) {
    const { page } = ctx;
    const inDialog = page.url().includes('/compose/');
    const box = await findVisible(page, X.textbox, 5000);
    await ctx.publishClick(page.locator(X.postButton).filter({ visible: true }), 'Post');
    // The compose dialog leaves /compose/post once sent; the inline composer on Home empties instead.
    const sent = await pollUntil(async () => {
      const emptied = !!box && !(await readFieldText(box).catch(() => 'x')).trim() && (await page.locator(X.attachmentMedia).count()) === 0;
      if (inDialog ? !page.url().includes('/compose/') : emptied) return true;
      const err = await visibleText(page, [...X.mediaErrors, ...X.postErrors]);
      if (err) throw new Error(`X reported: ${err}`);
      return false;
    }, 60_000, 1000);
    if (!sent) throw new Error('X did not confirm the post: the composer is still open.');
    ctx.check('Posted on X', 'pass');
  },
};
