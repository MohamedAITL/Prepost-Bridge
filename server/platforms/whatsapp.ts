import type { Locator, Page } from 'playwright';
import { fieldContains, fillTextField, openUrl, pollUntil, readFieldText } from '../automation/helpers';
import { safeClick } from '../automation/safeActions';
import { detectSessionWith, openWithSession } from '../automation/session';
import { WA } from './selectors/whatsapp';
import type { PlatformModule } from './types';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openChannelsList(page: Page) {
  await safeClick(page.getByRole('button', { name: WA.channelsButton }), 'Channels');
}

/** Your channels and the ones you follow. Suggestions sit in a navigation without a name. */
function channelRows(page: Page, name?: string) {
  const row = new RegExp(`^${WA.channelRowPrefix}\\s+${name ? `${escapeRegex(name)}$` : ''}`, 'i');
  return page.getByRole('navigation', { name: /\S/ }).getByRole('button', { name: row });
}

const composer = (page: Page) => page.locator(WA.footer).getByRole('textbox');

/** Send: in the footer for text, "Envoyer 1 élément sélectionné" over the media tray. Never clicked here. */
const sendButton = (page: Page) => page.getByRole('button', { name: WA.sendButton }).filter({ visible: true });

/** Media waiting to be sent. All channels share one tab, so opening another channel would discard it. */
const mediaTrayOpen = async (page: Page) => (await page.getByRole('button', { name: WA.mediaTraySend }).filter({ visible: true }).count()) > 0;

/** Open the channel and return its composer. Exact name match, confirmed in the channel's header. */
async function openChannel(page: Page, name: string): Promise<Locator> {
  await openChannelsList(page);
  const row = channelRows(page, name).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
    throw new Error(`The channel "${name}" isn't in your WhatsApp channel list.`);
  });
  await safeClick(row, `Channel "${name}"`);
  const open = page.locator(WA.header).getByRole('button', { name: new RegExp(`^${escapeRegex(name)}(\\s|$)`) });
  if (!(await pollUntil(async () => (await open.count()) > 0, 15_000))) throw new Error(`WhatsApp didn't open the channel "${name}".`);
  const box = composer(page);
  if (!(await box.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false))) throw new Error(`You can't post in "${name}": only its admins have a message box.`);
  return box;
}

async function goToWhatsApp(page: Page) {
  // Your WhatsApp tab is reused: reloading it would be slow and restart the WhatsApp capture.
  if (!page.url().startsWith(WA.homeUrl)) await openUrl(page, WA.homeUrl);
}

/** The channels you can post in: those that open with a message box. */
export async function readWhatsAppChannels(page: Page): Promise<string[]> {
  await goToWhatsApp(page);
  const state = await pollUntil(async () => {
    const s = await whatsappModule.detectSession(page);
    return s === 'unknown' ? null : s;
  }, 45_000);
  if (state !== 'logged_in') throw new Error('Sign in to WhatsApp Web in this browser first.');
  if (await mediaTrayOpen(page)) throw new Error('An update is waiting to be sent in WhatsApp. Send it or close it first.');
  await openChannelsList(page);
  await channelRows(page).first().waitFor({ state: 'visible', timeout: 15_000 });
  const labels = await channelRows(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''));
  const names = labels.map((l) => l.replace(new RegExp(`^${WA.channelRowPrefix}\\s+`, 'i'), '').trim()).filter(Boolean);
  const mine: string[] = [];
  for (const name of names.slice(0, 30)) {
    if (await openChannel(page, name).then(() => true, () => false)) mine.push(name);
  }
  if (!mine.length) throw new Error('No channel you can post in was found. Add them by hand instead.');
  return mine;
}

export const whatsappModule: PlatformModule = {
  id: 'whatsapp',
  label: 'WhatsApp Channels',
  entryUrl: WA.homeUrl,
  detectSession: (page) => detectSessionWith(page, WA.session),

  async prepare(ctx) {
    const { page, content } = ctx;
    const channel = content.whatsapp!.channel;
    await ctx.step('Open WhatsApp and check sign-in', async () => {
      await goToWhatsApp(page);
      if ((await whatsappModule.detectSession(page)) !== 'logged_in') await openWithSession(ctx, whatsappModule, WA.homeUrl);
    });
    if (await mediaTrayOpen(page)) {
      ctx.setStatus('needs_attention', 'An earlier update is waiting in WhatsApp', 20);
      await ctx.waitForUser('An update with media is still waiting to be sent in WhatsApp. Press Show tab, send it or close it there, and this one carries on.', { until: async () => !(await mediaTrayOpen(page)) });
    }
    ctx.setStatus('preparing', `Opening the channel "${channel}"…`, 25);
    const box = await ctx.step('Open the channel', () => openChannel(page, channel));
    ctx.check(`Channel "${channel}"`, 'pass');

    const boxLabel = (await box.getAttribute('aria-label')) ?? '';
    const caption = page.locator(`[contenteditable="true"]:not([aria-label=${JSON.stringify(boxLabel)}])`).filter({ visible: true }).first();

    if (content.media.length) {
      ctx.setStatus('uploading', 'Attaching the media…', 45);
      await ctx.step('Open the attach menu', () => safeClick(page.locator(WA.attachButton).first(), 'Attach'));
      // The item's own picker: the menu also holds the sticker maker's file input, which squares the image.
      const item = page.getByRole('menuitem', { name: WA.photosAndVideos });
      await ctx.step('Attach the file', async () => {
        const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
        chooser.catch(() => undefined); // if the click fails, this must not become an unhandled rejection
        await safeClick(item, 'Photos and videos');
        await (await chooser).setFiles(content.media.map((m) => m.path));
      });
      // The message box stays underneath the tray: only the tray's own box makes a caption.
      const shown = await caption.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
      ctx.check(`Media attached (${content.media.length})`, shown ? 'pass' : 'fail', shown ? undefined : "WhatsApp's media tray did not open; check the tab.");
    }

    if (content.text) {
      ctx.setStatus('filling', 'Filling the text…', 60);
      const field = content.media.length ? caption : box;
      await ctx.step('Fill the text', () => fillTextField(page, field, content.text));
      ctx.check('Text matches', (await fieldContains(field, content.text)) ? 'pass' : 'fail');
    }

    ctx.setStatus('verifying', 'Verifying…', 90);
    const ready = await pollUntil(async () => (await sendButton(page).count()) > 0, 10_000);
    ctx.check('Send button present', ready ? 'pass' : 'unverified');
  },

  async publish(ctx) {
    const { page } = ctx;
    const send = sendButton(page);
    await ctx.publishClick(send, 'Send');
    // The media tray closes and the box empties once WhatsApp has taken the update.
    const sent = await pollUntil(async () => (await send.count()) === 0 && !(await readFieldText(composer(page)).catch(() => 'x')).trim(), 120_000, 1000);
    if (!sent) throw new Error('WhatsApp did not confirm: the update is still in the box.');
    ctx.check('Sent to the channel', 'pass');
  },
};
