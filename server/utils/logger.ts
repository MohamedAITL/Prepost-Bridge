import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
}

// Never let credentials or session material reach the logs.
const SECRET_PATTERNS: RegExp[] = [
  /((?:set-)?cookie|authorization|password|passwd|pass|token|access_token|auth|secret|session(?:id)?|csrf)(["']?\s*[:=]\s*["']?)[^\s,;"'&]+/gi,
  /(bearer\s+)[a-z0-9._~+/-]+=*/gi,
];

export function redact(message: string): string {
  let out = message;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, a: string, b?: string) => `${a}${b ?? ''}[redacted]`);
  // URL query strings can carry tokens; keep only origin + path.
  out = out.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1?…');
  return out;
}

const buffer: LogEntry[] = [];
const MAX = 2000;
let stream: fs.WriteStream | null = null;

function fileStream() {
  if (!stream) {
    fs.mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
    stream = fs.createWriteStream(path.join(config.logDir, 'app.log'), { flags: 'a', mode: 0o600 });
  }
  return stream;
}

export function log(level: LogLevel, scope: string, message: string): LogEntry {
  const entry: LogEntry = { ts: Date.now(), level, scope, message: redact(message) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const line = `${new Date(entry.ts).toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${entry.message}`;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
  try {
    fileStream().write(line + '\n');
  } catch {
    // Logging must never crash the app.
  }
  return entry;
}

export const logger = {
  info: (scope: string, msg: string) => log('info', scope, msg),
  warn: (scope: string, msg: string) => log('warn', scope, msg),
  error: (scope: string, msg: string) => log('error', scope, msg),
  recent: (limit = 300) => buffer.slice(-limit),
};
