import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Hosted dashboards (e.g. your Netlify site) allowed to use this engine, from SPA_ALLOWED_ORIGINS
 * (comma-separated) and/or "allowedOrigins" in engine.config.json at the project root.
 */
function loadAllowedOrigins(): string[] {
  const fromEnv = (process.env.SPA_ALLOWED_ORIGINS ?? '').split(',');
  let fromFile: string[] = [];
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine.config.json');
    fromFile = JSON.parse(fs.readFileSync(file, 'utf8')).allowedOrigins ?? [];
  } catch {
    /* no config file */
  }
  return [...fromEnv, ...fromFile]
    .map((o) => String(o).trim().replace(/\/$/, ''))
    .filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
}

const dataDir = process.env.SPA_DATA_DIR ? path.resolve(process.env.SPA_DATA_DIR) : path.join(os.homedir(), '.social-post-assistant');

export const config = {
  host: '127.0.0.1',
  allowedOrigins: loadAllowedOrigins(),
  port: Number(process.env.PORT ?? 5174),
  /** Serve the built dashboard (dist/) from the engine too. */
  production: process.env.NODE_ENV === 'production' || process.argv.includes('--prod'),
  dataDir,
  /** Persistent Chromium profile: holds your login sessions (cookies). Never synced anywhere. */
  profileDir: path.join(dataDir, 'browser-profile'),
  /** Temporary copies of media you add, needed so the browser can upload them. Wiped on start and on Clear. */
  stagingDir: path.join(dataDir, 'staging'),
  logDir: path.join(dataDir, 'logs'),
  /**
   * '' = Playwright's bundled Chromium. 'chrome' = your installed Google Chrome, which Google
   * sign-in tends to accept more readily than the bundled Chromium.
   */
  browserChannel: process.env.SPA_BROWSER_CHANNEL ?? '',
  /** Separate Chrome profile used in "My Google Chrome" mode (Chrome refuses automation of its default profile). */
  chromeProfileDir: path.join(dataDir, 'chrome-profile'),
  /** Local-only debugging port Chrome listens on in "My Google Chrome" mode. */
  chromeDebugPort: Number(process.env.SPA_CHROME_DEBUG_PORT ?? 9222),
  maxUploadBytes: Number(process.env.SPA_MAX_UPLOAD_BYTES ?? 8 * 1024 ** 3),
  maxUrlImportBytes: 1024 ** 3,
};
