import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDraft, type Draft, type MediaItem } from '../shared/types';
import { appendLink, batchProblems, buildDestinationContent, graphemeLength, planBatch, planJobs, wordpressArticle, xWeightedLength } from '../shared/validation';

const img = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: `${id}.jpg`, mime: 'image/jpeg', size: 100_000, kind: 'image', source: 'upload', ...extra });
const vid = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({ id, name: `${id}.mp4`, mime: 'video/mp4', size: 5_000_000, kind: 'video', source: 'upload', durationSec: 30, ...extra });

function draftWith(patch: (d: Draft) => void): Draft {
  const d = emptyDraft();
  patch(d);
  return d;
}

const errors = (d: Draft, dest: Parameters<typeof buildDestinationContent>[1]) => buildDestinationContent(d, dest).issues.filter((i) => i.level === 'error').map((i) => i.message);

test('Arabic text, emoji and line breaks are preserved and counted as graphemes', () => {
  const text = 'مرحبا بالعالم 👋🏽\nسطر ثاني #خبر';
  const d = draftWith((x) => {
    x.sharedText = text;
    x.platforms.facebook.enabled = true;
    x.meta.pages = [{ name: 'Page', instagram: false }];
  });
  const c = buildDestinationContent(d, 'facebook');
  assert.equal(c.text, text);
  assert.equal(graphemeLength('👋🏽'), 1);
  assert.equal(c.issues.length, 0);
});

test('link is appended once, only where requested', () => {
  assert.equal(appendLink('Hello', 'https://a.example/x'), 'Hello\n\nhttps://a.example/x');
  assert.equal(appendLink('Hello https://a.example/x', 'https://a.example/x'), 'Hello https://a.example/x');
  const d = draftWith((x) => {
    x.sharedText = 'News';
    x.link = { url: 'https://a.example/x', mode: 'append' };
    x.platforms.x.enabled = true;
    x.platforms.facebook.enabled = true;
    x.platforms.facebook.includeLink = false;
  });
  assert.match(buildDestinationContent(d, 'x').text, /https:\/\/a\.example\/x$/);
  assert.equal(buildDestinationContent(d, 'facebook').text, 'News');
});

test('X weighted length counts URLs as 23 and emoji as 2', () => {
  assert.equal(xWeightedLength('https://example.com/a/very/long/path/that/is/long'), 23);
  assert.equal(xWeightedLength('ab😀'), 4);
  assert.equal(xWeightedLength('سلام'), 4);
});

test('X: more than 4 images and mixed media are errors; long text is a warning', () => {
  const d = draftWith((x) => {
    x.sharedText = 'a'.repeat(300);
    x.media = [img('1'), img('2'), img('3'), img('4'), img('5')];
    x.platforms.x.enabled = true;
  });
  const c = buildDestinationContent(d, 'x');
  assert.ok(c.issues.some((i) => i.level === 'warning' && /Premium/.test(i.message)));
  assert.ok(errors(d, 'x').some((m) => /at most 4/.test(m)));
  d.media = [img('1'), vid('2')];
  assert.ok(errors(d, 'x').some((m) => /cannot combine/.test(m)));
});

test('Instagram requires media; YouTube requires a video and a title', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Text only';
    x.platforms.instagram.enabled = true;
    x.platforms.youtube.enabled = true;
  });
  assert.ok(errors(d, 'instagram').some((m) => /at least one/.test(m)));
  assert.ok(errors(d, 'youtube').some((m) => /needs a video/.test(m)));
  assert.ok(errors(d, 'youtube').some((m) => /title/.test(m)));
  d.media = [vid('v'), img('t')];
  d.youtube.title = 'My video';
  d.coverId = 't';
  assert.deepEqual(errors(d, 'youtube'), []);
  assert.deepEqual(buildDestinationContent(d, 'youtube').media.map((m) => m.id), ['v']);
});

test('per-platform media selection and custom text do not leak to other platforms', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Shared';
    x.media = [img('a'), img('b')];
    x.platforms.x.enabled = true;
    x.platforms.facebook.enabled = true;
    x.platforms.x.mediaIds = ['b'];
    x.platforms.x.useSharedText = false;
    x.platforms.x.customText = 'Short for X';
  });
  assert.deepEqual(buildDestinationContent(d, 'x').media.map((m) => m.id), ['b']);
  assert.equal(buildDestinationContent(d, 'x').text, 'Short for X');
  assert.deepEqual(buildDestinationContent(d, 'facebook').media.map((m) => m.id), ['a', 'b']);
  assert.equal(buildDestinationContent(d, 'facebook').text, 'Shared');
});

test('Meta: one composer per ticked Page; linked Instagram adds its rules', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Same';
    x.platforms.facebook.enabled = true;
  });
  assert.ok(errors(d, 'facebook').some((m) => /at least one Page/.test(m)));
  d.meta.pages = [
    { name: 'Chouf Sport Officiel', instagram: true },
    { name: 'Chouftv.ma', instagram: false },
  ];
  assert.deepEqual(planJobs(d), [
    { moduleId: 'meta', targets: ['facebook', 'instagram'], metaPage: 'Chouf Sport Officiel' },
    { moduleId: 'meta', targets: ['facebook'], metaPage: 'Chouftv.ma' },
  ]);
  // Text-only is fine for Facebook, but the linked Instagram account needs media.
  assert.ok(errors(d, 'facebook').some((m) => /^Instagram \(linked to Chouf Sport Officiel\)/.test(m)));
  d.media = [img('a')];
  assert.deepEqual(errors(d, 'facebook'), []);
});

test('oversized and wrong-type files are reported', () => {
  const d = draftWith((x) => {
    x.media = [img('big', { size: 50 * 1024 * 1024 }), img('heic', { mime: 'image/gif' })];
    x.platforms.instagram.enabled = true;
  });
  const errs = errors(d, 'instagram');
  assert.ok(errs.some((m) => /allows up to/.test(m)));
  assert.ok(errs.some((m) => /does not accept image\/gif/.test(m)));
});

test('a large video is a warning on X/Instagram (soft), still an error on Facebook (hard)', () => {
  const big = { size: 1.2 * 1024 ** 3 };
  // X: over 512 MB → warning, not a blocking error.
  const x = draftWith((d) => {
    d.media = [vid('clip', big)];
    d.platforms.x.enabled = true;
  });
  assert.deepEqual(errors(x, 'x'), []);
  assert.ok(buildDestinationContent(x, 'x').issues.some((i) => i.level === 'warning' && /allows up to/.test(i.message)));
  // Facebook: 4 GB hard limit, 5 GB → error.
  const fb = draftWith((d) => {
    d.media = [vid('clip', { size: 5 * 1024 ** 3 })];
    d.platforms.facebook.enabled = true;
    d.meta.pages = [{ name: 'Page', instagram: false }];
  });
  assert.ok(errors(fb, 'facebook').some((m) => /allows up to/.test(m)));
});

test('YouTube post mode: text-only or up to 10 images; videos and >10 images are refused', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Community update';
    x.platforms.youtube.enabled = true;
    x.youtube.postType = 'post';
  });
  assert.deepEqual(errors(d, 'youtube'), [], 'text-only post, no title needed');
  d.media = Array.from({ length: 10 }, (_, i) => img(`i${i}`));
  assert.deepEqual(errors(d, 'youtube'), []);
  d.media.push(img('i10'));
  assert.ok(errors(d, 'youtube').some((m) => /at most 10/.test(m)));
  d.media = [vid('v')];
  assert.ok(errors(d, 'youtube').some((m) => /does not accept videos/.test(m)));
});

test('a cover whose image is gone is ignored, not an error', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Video';
    x.media = [vid('v')];
    x.coverId = 'gone';
    x.platforms.tiktok.enabled = true;
  });
  assert.deepEqual(errors(d, 'tiktok'), []);
  assert.equal(buildDestinationContent(d, 'tiktok').thumbnail ?? null, null);
});

test('planBatch: one job per post × platform, tagged with the post', () => {
  const p1 = draftWith((x) => {
    x.sharedText = 'Post one';
    x.platforms.x.enabled = true;
    x.platforms.tiktok.enabled = true;
    x.media = [vid('v1')];
  });
  const p2 = draftWith((x) => {
    x.sharedText = 'Post two';
    x.platforms.x.enabled = true;
    x.media = [img('a')];
  });
  const plans = planBatch([
    { id: 'A', title: 'Post 1', draft: p1 },
    { id: 'B', title: 'Post 2', draft: p2 },
  ]);
  assert.deepEqual(
    plans.map((pl) => `${pl.postId}:${pl.moduleId}`),
    ['A:x', 'A:tiktok', 'B:x'],
  );
  assert.equal(plans[0].postTitle, 'Post 1');
});

test('batchProblems: different YouTube channels in one batch is an error', () => {
  const mk = (channel: string) =>
    draftWith((x) => {
      x.platforms.youtube.enabled = true;
      x.youtube.postType = 'post';
      x.sharedText = 'hi';
      x.youtube.channel = channel;
    });
  const problems = batchProblems([
    { id: 'A', title: 'Post 1', draft: mk('ChoufSport') },
    { id: 'B', title: 'Post 2', draft: mk('ChoufTV Live') },
  ]);
  assert.equal(problems.length, 2);
  assert.ok(problems[0].messages.some((m) => /one channel at a time/.test(m)));
  // Same channel: no error.
  assert.deepEqual(
    batchProblems([
      { id: 'A', title: 'Post 1', draft: mk('ChoufSport') },
      { id: 'B', title: 'Post 2', draft: mk('ChoufSport') },
    ]),
    [],
  );
});

test('planBatch: posts with no platform selected are skipped', () => {
  const empty = draftWith((x) => (x.sharedText = 'nothing selected'));
  const one = draftWith((x) => {
    x.sharedText = 'x';
    x.platforms.x.enabled = true;
  });
  assert.equal(planBatch([{ id: 'A', title: 'Post 1', draft: empty }]).length, 0);
  assert.equal(
    planBatch([
      { id: 'A', title: 'Post 1', draft: empty },
      { id: 'B', title: 'Post 2', draft: one },
    ]).length,
    1,
  );
});

test('WordPress: title from the first line, "شوف تيفي" byline dropped, tags split on , and ،', () => {
  const d = draftWith((x) => {
    x.sharedText = 'عنوان الخبر\nشوف تيفي\nالفقرة الأولى\nالفقرة الثانية';
    x.platforms.wordpress.enabled = true;
    x.wordpress.tags = 'المغرب، شوف تيفي, أخبار';
    x.link = { url: 'https://example.com/a', mode: 'append' };
  });
  assert.deepEqual(wordpressArticle(d), { title: 'عنوان الخبر', body: 'الفقرة الأولى\nالفقرة الثانية', tags: ['المغرب', 'شوف تيفي', 'أخبار'] });
  const c = buildDestinationContent(d, 'wordpress');
  assert.equal(c.title, 'عنوان الخبر');
  assert.equal(c.text, 'الفقرة الأولى\nالفقرة الثانية', 'the link is never appended to an article');
  assert.deepEqual(errors(d, 'wordpress'), []);
  // An explicit Title keeps the whole text as the body.
  d.wordpress.title = 'Titre';
  assert.equal(wordpressArticle(d).body, 'عنوان الخبر\nشوف تيفي\nالفقرة الأولى\nالفقرة الثانية');
  assert.equal(planJobs(d).at(-1)?.moduleId, 'wordpress');
});

test('WordPress: needs a title, body and tags; one image ≤ 4 MB; no video; a video article needs a YouTube link', () => {
  const d = draftWith((x) => {
    x.sharedText = 'Only a title';
    x.platforms.wordpress.enabled = true;
  });
  const errs = errors(d, 'wordpress');
  assert.ok(errs.some((m) => /article body/.test(m)));
  assert.ok(errs.some((m) => /at least one tag/.test(m)));
  assert.ok(!errs.some((m) => /^Nothing to post/.test(m)));
  d.sharedText = 'Title\nBody';
  d.wordpress.tags = 'a';
  d.media = [img('big', { size: 5 * 1024 * 1024 }), img('two')];
  assert.ok(errors(d, 'wordpress').some((m) => /at most 1 image/.test(m)));
  assert.ok(errors(d, 'wordpress').some((m) => /allows up to 4.0 MB/.test(m)));
  d.media = [vid('v')];
  assert.ok(errors(d, 'wordpress').some((m) => /does not accept videos/.test(m)));
  d.media = [];
  d.wordpress = { ...d.wordpress, postType: 'program', categories: ['بوز'], options: [] };
  d.link = { url: 'https://example.com/not-youtube', mode: 'append' };
  assert.ok(errors(d, 'wordpress').some((m) => /YouTube link/.test(m)));
  d.link.url = 'https://youtu.be/abc';
  assert.deepEqual(errors(d, 'wordpress'), []);
  d.wordpress.categories = ['سياسة'];
  assert.ok(errors(d, 'wordpress').some((m) => /Not a WordPress choice/.test(m)), 'a news section on a video article');
});
