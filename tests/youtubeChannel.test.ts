import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_PAGE } from '../server/platforms/youtubeStudio';

test('only youtube.com channel pages count as "on the channel page", never YouTube Studio', () => {
  assert.ok(CHANNEL_PAGE.test('https://www.youtube.com/channel/UCGp-es74qDCOa9QJVBZmV_g'));
  assert.ok(CHANNEL_PAGE.test('https://www.youtube.com/@choufsport'));
  assert.ok(!CHANNEL_PAGE.test('https://studio.youtube.com/channel/UCGp-es74qDCOa9QJVBZmV_g/videos/upload'));
  assert.ok(!CHANNEL_PAGE.test('https://www.youtube.com/account'));
});
