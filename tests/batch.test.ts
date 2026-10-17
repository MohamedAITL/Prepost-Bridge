import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDraft, type BatchPost, type Draft, type MediaItem } from '../shared/types';
import { planBatch } from '../shared/validation';

const img: MediaItem = { id: 'a', name: 'a.jpg', mime: 'image/jpeg', size: 1000, kind: 'image', source: 'upload' };

function post(id: string, title: string, patch: (d: Draft) => void): BatchPost {
  const draft = emptyDraft();
  draft.media = [img];
  patch(draft);
  return { id, title, draft };
}

test('each post × platform gets its own tab key, stable when the same post re-prepares', () => {
  const posts = [
    post('A', 'Post 1', (d) => {
      d.platforms.x.enabled = true;
      d.meta.pages = [{ name: 'Chouf TV', instagram: false }];
      d.platforms.facebook.enabled = true;
    }),
    post('B', 'Post 2', (d) => {
      d.platforms.x.enabled = true;
    }),
  ];
  const key = (p: { postId?: string; moduleId: string; metaPage?: string }) => `post:${p.postId}:${p.moduleId}${p.metaPage ? ':' + p.metaPage : ''}`;
  const keys = planBatch(posts).map(key);
  // Post A: X + Meta(Chouf TV); Post B: X. All distinct.
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('post:A:x'));
  assert.ok(keys.includes('post:B:x'));
  assert.ok(keys.some((k) => k.startsWith('post:A:meta:')));
  // Re-planning the same posts yields the same keys.
  assert.deepEqual(planBatch(posts).map(key), keys);
});
