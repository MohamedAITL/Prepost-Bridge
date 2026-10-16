import type { Page } from 'playwright';
import type { PlatformModule, PrepareContext, SessionState } from '../platforms/types';
import { anyVisible, type Candidates } from './helpers';

export interface SessionSpec {
  loggedIn: Candidates;
  loggedOut: Candidates;
  loggedOutUrl: RegExp;
  challenge: Candidates;
  challengeUrl: RegExp;
  /**
   * Pages that are only reachable when signed in (the site redirects to login otherwise).
   * Being on one, with no login form or security check, counts as signed in.
   */
  loggedInUrl?: RegExp;
}

/** Generic security-check markers shared by every platform. */
export const COMMON_CHALLENGE: Candidates = [
  'iframe[src*="captcha" i]',
  'iframe[title*="captcha" i]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="arkoselabs"]',
  '[id*="captcha" i]:visible',
];

export async function detectSessionWith(page: Page, spec: SessionSpec): Promise<SessionState> {
  const url = page.url();
  if (spec.challengeUrl.test(url) || (await anyVisible(page, [...spec.challenge, ...COMMON_CHALLENGE]))) return 'challenge';
  if (spec.loggedOutUrl.test(url) || (await anyVisible(page, spec.loggedOut))) return 'logged_out';
  if (await anyVisible(page, spec.loggedIn)) return 'logged_in';
  if (spec.loggedInUrl?.test(url) && (await page.locator('button, a').count()) > 5) return 'logged_in';
  return 'unknown';
}

async function settle(page: Page, mod: PlatformModule, timeoutMs: number): Promise<SessionState> {
  const deadline = Date.now() + timeoutMs;
  let state: SessionState = 'unknown';
  while (Date.now() < deadline) {
    state = await mod.detectSession(page).catch(() => 'unknown' as const);
    if (state !== 'unknown') return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return state;
}

/**
 * Navigate to `targetUrl` and make sure the user is signed in. If not, pause and let them sign in
 * (or pass a security check) manually in the visible browser, then navigate back to the target.
 */
export async function openWithSession(ctx: PrepareContext, mod: PlatformModule, targetUrl: string): Promise<void> {
  const { page } = ctx;
  for (let attempt = 0; attempt < 4; attempt++) {
    ctx.throwIfCancelled();
    ctx.setStatus('opening', `Opening ${mod.label}…`, 5);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const state = await settle(page, mod, 30_000);
    ctx.log(`Session state on ${mod.label}: ${state}`);
    if (state === 'logged_in') return;

    // Don't switch tabs on the user; the status card offers "Show tab".
    const until = async () => (await mod.detectSession(page)) === 'logged_in';
    if (state === 'logged_out') {
      ctx.setStatus('login_required', `Please sign in to ${mod.label} in the browser window. Your password is entered only on the official site.`, 10);
      await ctx.waitForUser(`Sign in to ${mod.label} in its tab (press Show tab; complete any 2-step verification). The job continues automatically once you're signed in, or press Continue.`, { until, timeoutMs: 20 * 60_000 });
    } else if (state === 'challenge') {
      ctx.setStatus('needs_attention', `${mod.label} is showing a security check. Please complete it manually.`, 10);
      await ctx.waitForUser(`Complete the security check (CAPTCHA / verification) on ${mod.label} in its tab (press Show tab), then press Continue.`, { until, timeoutMs: 20 * 60_000 });
    } else {
      ctx.setStatus('needs_attention', `Could not tell whether you're signed in to ${mod.label}.`, 10);
      await ctx.waitForUser(`Could not confirm the sign-in state on ${mod.label}. Press Show tab, sign in or dismiss any dialog, then press Continue.`, { until, timeoutMs: 20 * 60_000 });
    }
  }
  throw new Error(`Still not signed in to ${mod.label} after several attempts.`);
}
