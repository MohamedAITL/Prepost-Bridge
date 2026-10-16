import type { Frame, Locator, Page } from 'playwright';

/** Selector candidates are tried in order; the first that matches wins. */
export type Candidates = readonly string[];

export class StepError extends Error {
  constructor(
    public step: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'StepError';
  }
}

export class NeedsAttention extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeedsAttention';
  }
}

function roots(page: Page): (Page | Frame)[] {
  // Main document first, then same-page frames (some upload UIs live in iframes).
  return [page, ...page.frames().filter((f) => f !== page.mainFrame())];
}

/** Poll until `fn` returns a truthy value or the timeout expires. Returns null on timeout. */
export async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 500): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      // Transient DOM errors (navigation, detached nodes) are retried; real failures propagate.
      if (!/context was destroyed|not attached|detached|navigat|Cannot find context/i.test(String((e as Error)?.message))) throw e;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** First candidate with a visible match, searched across the page and its frames. */
export async function findVisible(page: Page, candidates: Candidates, timeoutMs: number): Promise<Locator | null> {
  return pollUntil(async () => {
    for (const root of roots(page)) {
      for (const sel of candidates) {
        const loc = root.locator(sel);
        const n = await loc.count();
        for (let i = 0; i < Math.min(n, 5); i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
      }
    }
    return null;
  }, timeoutMs);
}

/** First candidate present in the DOM (visible or not, e.g. hidden file inputs). */
export async function findAttached(page: Page, candidates: Candidates, timeoutMs: number): Promise<Locator | null> {
  return pollUntil(async () => {
    for (const root of roots(page)) {
      for (const sel of candidates) {
        const loc = root.locator(sel);
        if ((await loc.count()) > 0) return loc.first();
      }
    }
    return null;
  }, timeoutMs);
}

export async function requireVisible(page: Page, candidates: Candidates, timeoutMs: number, what: string): Promise<Locator> {
  const loc = await findVisible(page, candidates, timeoutMs);
  if (!loc) throw new Error(`Could not find the ${what} (tried: ${candidates.join(' | ')}). The site layout may have changed; update the selectors.`);
  return loc;
}

export async function requireAttached(page: Page, candidates: Candidates, timeoutMs: number, what: string): Promise<Locator> {
  const loc = await findAttached(page, candidates, timeoutMs);
  if (!loc) throw new Error(`Could not find the ${what} (tried: ${candidates.join(' | ')}). The site layout may have changed; update the selectors.`);
  return loc;
}

export async function anyVisible(page: Page, candidates: Candidates): Promise<boolean> {
  return !!(await findVisible(page, candidates, 0));
}

export async function visibleText(page: Page, patterns: RegExp[]): Promise<string | null> {
  for (const re of patterns) {
    const loc = page.getByText(re).first();
    if (await loc.isVisible().catch(() => false)) return (await loc.innerText().catch(() => re.source)).slice(0, 200);
  }
  return null;
}

/**
 * Letters, digits and line structure only: robust against emoji rendering, link decoration and
 * spacing changes, but still detects lost line breaks (each run of line breaks becomes one "|").
 */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\p{L}\p{N}\n]/gu, '')
    .replace(/\n+/g, '|')
    .replace(/^\||\|$/g, '')
    .toLowerCase();
}

export async function readFieldText(locator: Locator): Promise<string> {
  // Bounded: an unresponsive page must not hang a check for the default 30 s.
  return locator.evaluate(
    (el) => {
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
      return (el as HTMLElement).innerText ?? el.textContent ?? '';
    },
    undefined,
    { timeout: 10_000 },
  );
}

export async function fieldContains(locator: Locator, expected: string): Promise<boolean> {
  const actual = normalizeForCompare(await readFieldText(locator));
  const want = normalizeForCompare(expected);
  return want.length === 0 ? actual.length === 0 : actual.includes(want);
}

async function clearField(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
}

/** Dispatch a paste event carrying plain text. Rich editors (Draft.js, Lexical) insert it themselves. */
async function pasteText(locator: Locator, text: string) {
  await locator.evaluate((el, value) => {
    (el as HTMLElement).focus();
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Insert line by line; Shift+Enter makes a line break without ever triggering a submit shortcut. */
async function insertLines(page: Page, text: string, mode: 'insert' | 'type') {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Shift+Enter');
    if (!lines[i]) continue;
    if (mode === 'insert') await page.keyboard.insertText(lines[i]);
    else await page.keyboard.type(lines[i]);
  }
}

/**
 * Replace the content of a text field (textarea, input or contenteditable editor) with `text`,
 * preserving line breaks, emoji and RTL text, and verify the result. Tries a paste event first,
 * then native text insertion, then key-by-key typing.
 */
export async function fillTextField(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const isPlain = await locator.evaluate((el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement);
  if (isPlain) {
    await locator.fill(text);
    if (await fieldContains(locator, text)) return;
    throw new Error('The text field did not accept the text.');
  }

  await clearField(page, locator);
  if (!text) return;

  await pasteText(locator, text);
  if (await pollUntil(() => fieldContains(locator, text), 2500, 250)) return;

  for (const mode of ['insert', 'type'] as const) {
    await clearField(page, locator);
    await locator.focus();
    await insertLines(page, text, mode);
    if (await pollUntil(() => fieldContains(locator, text), 4000, 250)) return;
  }
  throw new Error('The text could not be entered reliably (the editor content does not match).');
}

export async function setFiles(input: Locator, paths: string[]) {
  const multiple = await input.evaluate((el) => (el as HTMLInputElement).multiple).catch(() => true);
  if (paths.length > 1 && !multiple) throw new Error('This upload field accepts only one file at a time.');
  await input.setInputFiles(paths);
}
