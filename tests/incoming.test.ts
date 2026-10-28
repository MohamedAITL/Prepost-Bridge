import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The engine's data folder is read at import time: point it at a throwaway folder first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-incoming-'));
process.env.SPA_DATA_DIR = dataDir;
const { incoming, parseWhatsAppDraft } = await import('../server/services/incoming');
const { mediaStore } = await import('../server/services/mediaStore');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const draft = (title: string, image = `data:image/png;base64,${PNG}`) => ({ id: 'x', title, image, chat: 'Chouf desk', imageHash: 'ignored' });

before(async () => {
  await mediaStore.init();
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('WhatsApp items: invalid ones are refused', () => {
  assert.throws(() => parseWhatsAppDraft(draft('')), /caption/);
  assert.throws(() => parseWhatsAppDraft(draft('t', 'data:text/html;base64,PGI+')), /not a JPEG, PNG or WebP/);
  assert.throws(() => parseWhatsAppDraft(draft('t', 'https://example.com/a.png')), /not a JPEG, PNG or WebP/);
  assert.throws(() => parseWhatsAppDraft(draft('t', `data:image/png;base64,${'A'.repeat(17 * 1024 * 1024)}`)), /12 MB/);
});

test('WhatsApp items: stored as image media, duplicates skipped (spacing ignored), claimed once', async () => {
  assert.equal(await incoming.add(draft('خبر  عاجل')), 'added');
  assert.equal(await incoming.add(draft('خبر عاجل')), 'duplicate', 'same chat, caption and image');
  assert.equal(await incoming.add(draft('خبر آخر')), 'added', 'a different caption is a different item');
  assert.equal(incoming.count(), 2);

  const items = incoming.claim();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'خبر  عاجل');
  assert.equal(items[0].chat, 'Chouf desk');
  assert.equal(items[0].media.kind, 'image');
  assert.ok(mediaStore.get(items[0].media.id), 'the image is in the media store');
  assert.deepEqual(incoming.claim(), [], 'a second dashboard gets nothing');

  // The ledger is on disk, so a restarted engine still knows the item.
  const ledger = JSON.parse(fs.readFileSync(path.join(dataDir, 'whatsapp-seen.json'), 'utf8'));
  assert.equal(Object.keys(ledger).length, 2);
});
