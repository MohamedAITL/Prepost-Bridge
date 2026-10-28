import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { MediaItem } from '../../shared/types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { mediaStore } from './mediaStore';

/**
 * Image+caption messages captured from WhatsApp Web by the Prepost Bridge extension. They wait
 * here until a dashboard claims them and turns each one into a new Post.
 */
export interface IncomingItem {
  id: string;
  text: string;
  chat: string;
  media: MediaItem;
  receivedAt: number;
}

export class IncomingError extends Error {}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const LEDGER_SIZE = 1500;

/** Validate what the extension sent (it's untrusted: any page could have been scraped). */
export function parseWhatsAppDraft(input: unknown): { text: string; chat: string; mime: string; bytes: Buffer } {
  const d = (input ?? {}) as Record<string, unknown>;
  const text = typeof d.title === 'string' ? d.title.trim() : '';
  if (!text || text.length > 5000) throw new IncomingError('The caption is missing or longer than 5000 characters.');
  const chat = typeof d.chat === 'string' ? d.chat.trim().slice(0, 200) : '';
  const m = typeof d.image === 'string' ? DATA_URL.exec(d.image) : null;
  if (!m) throw new IncomingError('The attachment is not a JPEG, PNG or WebP image.');
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new IncomingError('The image is empty or larger than 12 MB.');
  return { text, chat, mime: m[1], bytes };
}

/** Same chat + same caption (spacing ignored) + same image bytes = the same news item. */
export function whatsappFingerprint(chat: string, text: string, bytes: Buffer): string {
  const imageHash = crypto.createHash('sha256').update(bytes).digest('hex');
  return crypto.createHash('sha256').update(`${chat}␟${text.replace(/\s+/g, ' ')}␟${imageHash}`).digest('hex');
}

class IncomingQueue extends EventEmitter {
  private items: IncomingItem[] = [];
  private seen: Map<string, number> | null = null;

  private get ledgerFile() {
    return path.join(config.dataDir, 'whatsapp-seen.json');
  }

  /** Fingerprints of everything already imported; kept on disk so an engine restart never re-imports. */
  private ledger(): Map<string, number> {
    if (!this.seen) {
      try {
        this.seen = new Map(Object.entries(JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8')) as Record<string, number>));
      } catch {
        this.seen = new Map();
      }
    }
    return this.seen;
  }

  private saveLedger() {
    const recent = [...this.ledger()].sort((a, b) => a[1] - b[1]).slice(-LEDGER_SIZE);
    this.seen = new Map(recent);
    fs.writeFileSync(this.ledgerFile, JSON.stringify(Object.fromEntries(recent)), { mode: 0o600 });
  }

  /** 'duplicate' when this news item was already imported. Throws IncomingError for bad input. */
  async add(input: unknown): Promise<'added' | 'duplicate'> {
    const { text, chat, mime, bytes } = parseWhatsAppDraft(input);
    const fp = whatsappFingerprint(chat, text, bytes);
    const seen = this.ledger();
    if (seen.has(fp)) return 'duplicate';
    // Reserved before any await, so the same item arriving twice at once is still a duplicate.
    seen.set(fp, Date.now());
    let media: MediaItem;
    try {
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const tmp = path.join(mediaStore.tmpDir, `whatsapp-${crypto.randomUUID()}.${ext}`);
      await fsp.writeFile(tmp, bytes, { mode: 0o600 });
      media = await mediaStore.adopt(tmp, `whatsapp-${fp.slice(0, 8)}.${ext}`, 'upload', {});
      if (media.kind !== 'image') {
        await mediaStore.remove(media.id);
        throw new IncomingError('The attachment is not an image.');
      }
    } catch (e) {
      seen.delete(fp);
      throw e;
    }
    this.saveLedger();
    this.items.push({ id: crypto.randomUUID(), text, chat, media, receivedAt: Date.now() });
    logger.info('whatsapp', `New post from WhatsApp${chat ? ` (${chat})` : ''}: ${text.slice(0, 60)}`);
    this.emit('change', this.items.length);
    return 'added';
  }

  count(): number {
    return this.items.length;
  }

  /** Hands every waiting item to one dashboard, once. */
  claim(): IncomingItem[] {
    const out = this.items;
    this.items = [];
    if (out.length) this.emit('change', 0);
    return out;
  }
}

export const incoming = new IncomingQueue();
