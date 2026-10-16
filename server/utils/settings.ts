import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

// Small non-sensitive app settings (browser mode, bridge pairing code), stored privately.
const FILE = path.join(config.dataDir, 'settings.json');

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeSettings(patch: Record<string, unknown>) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify({ ...readSettings(), ...patch }), { mode: 0o600 });
}
