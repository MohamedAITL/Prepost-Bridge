import type { Locator } from 'playwright';

/**
 * The no-auto-publish guard.
 *
 * Platform modules must never call locator.click() directly; they go through safeClick(), which
 * inspects the element first and refuses anything that looks like a final submission control
 * (Post, Publish, Share, Send, Schedule, Save, Done… in English, French and Arabic), anything
 * matching a module's forbidden selectors, and any submit-type button. A refusal stops that
 * platform's job; it is never retried automatically.
 */

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

/** Whole-label matches (after trimming and lowercasing). */
const FORBIDDEN_EXACT: RegExp[] = [
  /^(post|post all|post now|post reel|publish|publish now|publish all|share|share now|send|send now|schedule|schedule post|tweet|tweet all|reply|save|save and publish|done|submit|confirm|go live|boost|boost post|upload and publish)$/i,
  /^(publier|publier maintenant|publier tout|partager|partager maintenant|envoyer|programmer|planifier|poster|enregistrer|terminé|termine|confirmer|valider)$/i,
  /^(نشر|انشر|النشر|نشر الآن|مشاركة|شارك|شارك الآن|إرسال|ارسال|أرسل|جدولة|حفظ|تم|تأكيد|إرسال المنشور)$/,
];

/** Words that are never acceptable anywhere in a clicked control's label. */
const FORBIDDEN_CONTAINS: RegExp[] = [
  /\bpublish/i,
  /\bschedul/i,
  /\bpublier\b/i,
  /\bprogrammer\b/i,
  /\bplanifier\b/i,
  /نشر/,
  /جدولة/,
  /\btweet\b/i,
  // Never end the user's session or remove things.
  /\blog ?out\b|\bsign ?out\b|se déconnecter|déconnexion|تسجيل الخروج/i,
  /\bdelete\b|\bsupprimer\b|حذف/i,
];

/** Test ids / ids of known final-submission buttons on the supported platforms. */
export const GLOBAL_FORBIDDEN_SELECTORS: string[] = [
  '[data-testid="tweetButton"]',
  '[data-testid="tweetButtonInline"]',
  '#done-button',
  '#publish-button',
  '[data-e2e="post_video_button"]',
  '[data-e2e="schedule_video_button"]',
];

export interface ElementDescription {
  names: string[];
  matchedForbiddenSelector: string | null;
  isSubmit: boolean;
  tag: string;
}

// Kept as a string: the TS loader (esbuild keepNames) would otherwise inject a `__name` helper
// into the function body, which does not exist inside the browser page.
const DESCRIBE_SCRIPT = `(el, selectors) => {
  const names = [];
  const push = (v) => { if (v && v.trim()) names.push(v.replace(/\\s+/g, ' ').trim()); };
  const target = el.closest('button, [role="button"], a, [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="option"]') || el;
  for (const node of new Set([el, target])) {
    push(node.getAttribute('aria-label'));
    push(node.getAttribute('title'));
    push(node.getAttribute('data-testid'));
    push(node.getAttribute('data-e2e'));
    push(node.id);
    push(node.value);
    push(node.innerText ? node.innerText.slice(0, 200) : '');
    const labelled = node.getAttribute('aria-labelledby');
    if (labelled) for (const id of labelled.split(/\\s+/)) { const ref = document.getElementById(id); push(ref && ref.textContent); }
  }
  let matched = null;
  for (const sel of selectors) {
    try { if (el.matches(sel) || el.closest(sel) || target.matches(sel)) { matched = sel; break; } } catch (e) { /* invalid selector */ }
  }
  const type = (target.getAttribute('type') || '').toLowerCase();
  const isSubmit = (target.tagName === 'BUTTON' && type === 'submit' && !!target.form) || (target.tagName === 'INPUT' && type === 'submit');
  return { names, matchedForbiddenSelector: matched, isSubmit, tag: target.tagName.toLowerCase() };
}`;

export async function describeElement(locator: Locator, forbiddenSelectors: string[]): Promise<ElementDescription> {
  const fn = new Function(`return ${DESCRIBE_SCRIPT}`)() as (el: Element, selectors: string[]) => ElementDescription;
  return locator.evaluate(fn, forbiddenSelectors);
}

export function forbiddenReason(desc: ElementDescription, allowLabels?: RegExp): string | null {
  if (!desc || !Array.isArray(desc.names)) return 'could not be inspected';
  if (desc.matchedForbiddenSelector) return `matches forbidden selector ${desc.matchedForbiddenSelector}`;
  if (desc.isSubmit) return 'is a form submit button';
  for (const raw of desc.names) {
    const name = raw.toLowerCase().replace(/[.!…:]+$/, '').trim();
    // Narrow exception for a confirm/save button inside an editor dialog (e.g. "Save cover").
    if (allowLabels && allowLabels.test(name)) continue;
    if (FORBIDDEN_EXACT.some((re) => re.test(name))) return `label "${raw}" is a final-submission action`;
    if (FORBIDDEN_CONTAINS.some((re) => re.test(name))) return `label "${raw}" contains a publishing keyword`;
  }
  return null;
}

/**
 * Click only after verifying the target is a single, visible, enabled, non-publishing control.
 * `purpose` is what the module expects to click (for logs/errors).
 */
export async function safeClick(
  locator: Locator,
  purpose: string,
  opts: {
    forbiddenSelectors?: string[];
    timeout?: number;
    /**
     * Exact labels allowed despite the word list, for a save/confirm button inside an editor dialog
     * (a cover editor), never a post's final button. Forbidden selectors and submit checks still apply.
     */
    allowLabels?: RegExp;
  } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 15_000;
  const target = locator.first();
  await target.waitFor({ state: 'visible', timeout });
  const count = await locator.count();
  if (count > 1) {
    // Ambiguous match: only proceed if every candidate is safe, and use the first.
    for (let i = 0; i < count; i++) {
      const reason = forbiddenReason(await describeElement(locator.nth(i), [...GLOBAL_FORBIDDEN_SELECTORS, ...(opts.forbiddenSelectors ?? [])]), opts.allowLabels);
      if (reason) throw new SafetyError(`Refused to click "${purpose}": an ambiguous match ${reason}.`);
    }
  }
  const desc = await describeElement(target, [...GLOBAL_FORBIDDEN_SELECTORS, ...(opts.forbiddenSelectors ?? [])]);
  const reason = forbiddenReason(desc, opts.allowLabels);
  if (reason) throw new SafetyError(`Refused to click "${purpose}": the element ${reason}. Final publication is always left to you.`);
  if (!(await target.isEnabled())) throw new Error(`"${purpose}" is disabled.`);
  try {
    await target.click({ timeout });
  } catch (e) {
    // Some editors draw a layer over their own buttons, so a pointer click never lands. The
    // element was already vetted above: press it directly instead.
    if (!/intercepts pointer events|Timeout/i.test((e as Error).message)) throw e;
    await target.evaluate((el) => (el as HTMLElement).click());
  }
}

/** Read-only check that a final submission button exists. It is never clicked. */
export async function observeOnly(locator: Locator): Promise<{ visible: boolean; enabled: boolean }> {
  const first = locator.first();
  const visible = await first.isVisible().catch(() => false);
  if (!visible) return { visible: false, enabled: false };
  const enabled = await first
    .evaluate((el) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-disabled="true"]'))
    .catch(() => false);
  return { visible, enabled };
}
