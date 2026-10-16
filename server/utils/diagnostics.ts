import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { config } from '../config';

/**
 * Save the page's URL (without query) and accessibility outline locally, for fixing selectors.
 * The outline holds what's on screen (headings, buttons, text), never cookies or storage.
 */
export async function savePageOutline(page: Page, label: string, note = ''): Promise<string | null> {
  if (page.isClosed()) return null;
  try {
    const outline = await page.locator('body').ariaSnapshot({ timeout: 5000 });
    const dir = path.join(config.logDir, 'diagnostics');
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    await fsp.writeFile(file, `URL: ${page.url().replace(/\?.*$/, '')}\n${note}\n\n${outline.slice(0, 400_000)}`, { mode: 0o600 });
    return file;
  } catch {
    return null;
  }
}
