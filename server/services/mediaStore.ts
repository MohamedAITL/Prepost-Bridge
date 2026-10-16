import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MediaItem, MediaKind } from '../../shared/types';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface StoredMedia extends MediaItem {
  filePath: string;
}

interface Sniffed {
  mime: string;
  kind: MediaKind;
  ext: string;
}

/** Identify the file from its magic bytes; the extension and declared MIME type are not trusted. */
export async function sniffFile(filePath: string): Promise<Sniffed | null> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(32);
    await fh.read(buf, 0, 32, 0);
    const ascii = (start: number, end: number) => buf.toString('latin1', start, end);
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', kind: 'image', ext: '.jpg' };
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', kind: 'image', ext: '.png' };
    if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return { mime: 'image/gif', kind: 'image', ext: '.gif' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', kind: 'image', ext: '.webp' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ') return { mime: 'video/x-msvideo', kind: 'video', ext: '.avi' };
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      // EBML container: WebM or Matroska. The doctype string sits in the header.
      const head = Buffer.alloc(64);
      await fh.read(head, 0, 64, 0);
      return head.includes('webm') ? { mime: 'video/webm', kind: 'video', ext: '.webm' } : { mime: 'video/x-matroska', kind: 'video', ext: '.mkv' };
    }
    if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12);
      if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', ext: '.mov' };
      if (brand.startsWith('3g')) return { mime: 'video/3gpp', kind: 'video', ext: '.3gp' };
      if (/^(heic|heix|mif1|msf1|avif)/.test(brand)) return null; // HEIC/AVIF images: not accepted by most composers
      return { mime: 'video/mp4', kind: 'video', ext: '.mp4' };
    }
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && (buf[3] === 0xba || buf[3] === 0xb3)) return { mime: 'video/mpeg', kind: 'video', ext: '.mpg' };
    return null;
  } finally {
    await fh.close();
  }
}

function safeBaseName(name: string, ext: string): string {
  const base = path.basename(name).replace(/\.[^.]*$/, '');
  const cleaned = base.normalize('NFC').replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/^[.\s]+/, '').slice(0, 80).trim();
  return (cleaned || 'media') + ext;
}

export class MediaError extends Error {}

class MediaStore {
  private items = new Map<string, StoredMedia>();

  get tmpDir() {
    return path.join(config.stagingDir, '.incoming');
  }

  /** Wipe leftovers from a previous run and create the staging directory with private permissions. */
  async init() {
    await fsp.rm(config.stagingDir, { recursive: true, force: true });
    await fsp.mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(config.stagingDir, 0o700);
  }

  private readonly tokenKey = crypto.randomBytes(32);

  /** Preview token for a file: lets <img>/<video> load it from a hosted dashboard. */
  tokenFor(id: string): string {
    return crypto.createHmac('sha256', this.tokenKey).update(id).digest('base64url').slice(0, 32);
  }

  validToken(id: string, token: string): boolean {
    const want = Buffer.from(this.tokenFor(id));
    const got = Buffer.from(token);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  list(): MediaItem[] {
    return [...this.items.values()].map(({ filePath: _p, ...item }) => ({ ...item, token: this.tokenFor(item.id) }));
  }

  get(id: string): StoredMedia | undefined {
    return this.items.get(id);
  }

  /** Validate a file already written to the incoming dir and move it into its own folder. */
  async adopt(tempPath: string, originalName: string, source: 'upload' | 'url', hints: { width?: number; height?: number; durationSec?: number }): Promise<MediaItem> {
    const resolvedTemp = path.resolve(tempPath);
    if (!resolvedTemp.startsWith(path.resolve(this.tmpDir) + path.sep)) throw new MediaError('Unexpected upload location.');
    try {
      const sniffed = await sniffFile(resolvedTemp);
      if (!sniffed) throw new MediaError(`${originalName}: unsupported file type. Use JPG, PNG, GIF, WebP images or MP4, MOV, WebM, MKV, AVI videos.`);
      const stat = await fsp.stat(resolvedTemp);
      if (stat.size === 0) throw new MediaError(`${originalName} is empty.`);
      const id = crypto.randomUUID();
      const dir = path.join(config.stagingDir, id);
      await fsp.mkdir(dir, { mode: 0o700 });
      const filePath = path.join(dir, safeBaseName(originalName, sniffed.ext));
      await fsp.rename(resolvedTemp, filePath);
      await fsp.chmod(filePath, 0o600);
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
      const item: StoredMedia = {
        id,
        name: path.basename(filePath),
        mime: sniffed.mime,
        kind: sniffed.kind,
        size: stat.size,
        source,
        width: num(hints.width),
        height: num(hints.height),
        durationSec: num(hints.durationSec),
        filePath,
      };
      this.items.set(id, item);
      logger.info('media', `Added ${item.kind} ${item.name} (${item.mime}, ${item.size} bytes)`);
      const { filePath: _p, ...pub } = item;
      return { ...pub, token: this.tokenFor(id) };
    } catch (e) {
      await fsp.rm(resolvedTemp, { force: true });
      throw e;
    }
  }

  /**
   * Import a direct image/video URL. Only http(s); the response must declare an image/video type
   * and its bytes must match a supported format. Anything else stays a plain link.
   */
  async importFromUrl(raw: string): Promise<MediaItem> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new MediaError('Not a valid URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new MediaError('Only http(s) URLs can be imported.');
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new MediaError(`Could not download the URL: ${(e as Error).message}`);
    }
    if (!res.ok || !res.body) throw new MediaError(`The URL responded with HTTP ${res.status}.`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/') && !type.startsWith('video/')) {
      await res.body.cancel();
      throw new MediaError(`This URL is not a direct image or video file (it returns "${type || 'unknown'}"). Use it as a link in the text instead.`);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > config.maxUrlImportBytes) {
      await res.body.cancel();
      throw new MediaError('The file at this URL is too large to import.');
    }
    const tmp = path.join(this.tmpDir, crypto.randomUUID());
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > config.maxUrlImportBytes) cb(new MediaError('The file at this URL is too large to import.'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), limiter, fs.createWriteStream(tmp, { mode: 0o600 }));
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e instanceof MediaError ? e : new MediaError(`Download failed: ${(e as Error).message}`);
    }
    const name = decodeURIComponent(path.basename(url.pathname)) || 'imported';
    return this.adopt(tmp, name, 'url', {});
  }

  async remove(id: string) {
    const item = this.items.get(id);
    if (!item) return false;
    this.items.delete(id);
    await fsp.rm(path.dirname(item.filePath), { recursive: true, force: true });
    logger.info('media', `Removed ${item.name}`);
    return true;
  }

  async clear() {
    this.items.clear();
    await this.init();
    logger.info('media', 'Cleared all staged media');
  }
}

export const mediaStore = new MediaStore();
