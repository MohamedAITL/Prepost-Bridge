import { COVER_RULES, PLATFORM_RULES, YOUTUBE_POST_RULES, YOUTUBE_TITLE_LIMIT, type MediaRule, type PlatformRules } from './rules';
import {
  type BatchPost,
  DESTINATIONS,
  DESTINATION_LABELS,
  type DestinationId,
  type Draft,
  type MediaItem,
  type ModuleId,
  WORDPRESS_CHOICES,
} from './types';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export interface DestinationContent {
  destination: DestinationId;
  text: string;
  textLength: number;
  textLimit: number;
  media: MediaItem[];
  title?: string;
  thumbnail?: MediaItem | null;
  issues: Issue[];
}

export interface JobPlan {
  moduleId: ModuleId;
  targets: DestinationId[];
  /** Meta only: the Facebook Page this job posts as. */
  metaPage?: string;
  /** Batch: which post this job belongs to. */
  postId?: string;
  postTitle?: string;
}

// ---------- text helpers ----------

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters (an emoji or an Arabic letter with diacritics counts once). */
export function graphemeLength(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

const URL_RE = /https?:\/\/[^\s]+/gi;

/**
 * Approximation of X's weighted length: URLs count 23, code points in the Latin/Arabic/etc.
 * ranges count 1, everything else (CJK, emoji) counts 2.
 */
export function xWeightedLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  const rest = text.replace(URL_RE, '');
  let weight = urls.length * 23;
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    const light =
      (cp >= 0 && cp <= 4351) || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247);
    // Variation selectors / ZWJ inside emoji sequences add nothing visible.
    if (cp === 0xfe0f || cp === 0x200d) continue;
    weight += light ? 1 : 2;
  }
  return weight;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function appendLink(text: string, url: string): string {
  const link = url.trim();
  if (!link || text.includes(link)) return text;
  return text.trim() ? `${text.replace(/\s+$/, '')}\n\n${link}` : link;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// ---------- content resolution ----------

/** Text used for a destination before the link is appended. */
export function baseText(draft: Draft, d: DestinationId): string {
  const cfg = draft.platforms[d];
  return cfg.useSharedText ? draft.sharedText : cfg.customText;
}

export function finalText(draft: Draft, d: DestinationId): string {
  const cfg = draft.platforms[d];
  let text = baseText(draft, d);
  // A WordPress article never gets the link appended (a video article takes it as its Video URL).
  if (d !== 'wordpress' && draft.link.mode === 'append' && cfg.includeLink && isValidHttpUrl(draft.link.url)) {
    text = appendLink(text, draft.link.url);
  }
  return text;
}

export function selectedMedia(draft: Draft, d: DestinationId): MediaItem[] {
  const cfg = draft.platforms[d];
  let items = cfg.mediaIds === null ? draft.media : cfg.mediaIds.map((id) => draft.media.find((m) => m.id === id)).filter((m): m is MediaItem => !!m);
  // The cover image is only ever used as a cover, never as post media.
  if (draft.coverId) items = items.filter((m) => m.id !== draft.coverId);
  return items;
}

function checkMediaAgainstRule(items: MediaItem[], rule: MediaRule | null, kindLabel: string, d: DestinationId, issues: Issue[]) {
  if (items.length === 0) return;
  const label = DESTINATION_LABELS[d];
  if (!rule) {
    issues.push({ level: 'error', message: `${label} does not accept ${kindLabel}s here. Deselect: ${items.map((m) => m.name).join(', ')}.` });
    return;
  }
  if (items.length > rule.maxCount) {
    issues.push({ level: 'error', message: `${label} accepts at most ${rule.maxCount} ${kindLabel}${rule.maxCount > 1 ? 's' : ''} per post (${items.length} selected).` });
  }
  for (const m of items) {
    if (!rule.mimes.includes(m.mime)) {
      issues.push({ level: 'error', message: `${label} does not accept ${m.mime} files (${m.name}).` });
    }
    if (m.size > rule.maxBytes) {
      const msg = `${m.name} is ${formatBytes(m.size)}; ${label} allows up to ${formatBytes(rule.maxBytes)}${rule.sizeIsSoft ? ' for standard accounts; larger files may be refused' : ''}.`;
      issues.push({ level: rule.sizeIsSoft ? 'warning' : 'error', message: msg });
    }
    if (rule.maxDurationSec && m.durationSec && m.durationSec > rule.maxDurationSec) {
      const msg = `${m.name} is ${Math.round(m.durationSec)} s long; ${label} allows ${rule.maxDurationSec} s${rule.durationIsSoft ? ' for standard accounts' : ''}.`;
      issues.push({ level: rule.durationIsSoft ? 'warning' : 'error', message: msg });
    }
  }
}

export function rulesFor(draft: Draft, d: DestinationId): PlatformRules {
  return d === 'youtube' && draft.youtube.postType === 'post' ? YOUTUBE_POST_RULES : PLATFORM_RULES[d];
}

function buildSingle(draft: Draft, d: DestinationId): DestinationContent {
  const rules = rulesFor(draft, d);
  const label = DESTINATION_LABELS[d];
  const issues: Issue[] = [];
  const text = finalText(draft, d);
  const media = selectedMedia(draft, d);
  const images = media.filter((m) => m.kind === 'image');
  const videos = media.filter((m) => m.kind === 'video');

  if (draft.link.url.trim() && !isValidHttpUrl(draft.link.url)) {
    issues.push({ level: 'error', message: 'The link is not a valid http(s) URL.' });
  }

  const textLength = rules.textCounting === 'x-weighted' ? xWeightedLength(text) : graphemeLength(text);
  if (textLength > rules.textLimit) {
    issues.push({
      level: rules.textLimitIsHard ? 'error' : 'warning',
      message: rules.textLimitIsHard
        ? `${label} text is ${textLength}/${rules.textLimit} characters.`
        : d === 'x'
          ? `${label} text is ${textLength}/${rules.textLimit}. Only X Premium accounts can post longer text.`
          : `${label} text is ${textLength}/${rules.textLimit} characters; it may be refused or cut.`,
    });
  }
  if (rules.maxHashtags && countHashtags(text) > rules.maxHashtags) {
    issues.push({ level: 'error', message: `${label} allows at most ${rules.maxHashtags} hashtags.` });
  }

  if (!text.trim() && media.length === 0) {
    issues.push({ level: 'error', message: `Nothing to post on ${label}: add text or media.` });
  } else if (rules.requiresMedia && media.length === 0) {
    issues.push({ level: 'error', message: rules.requiresVideo ? `${label} needs a video file.` : `${label} needs at least one photo or video.` });
  }
  if (rules.requiresVideo && videos.length === 0 && media.length > 0) {
    issues.push({ level: 'error', message: `${label} video upload needs a video file. For images, set YouTube's Type to "Post with text / images".` });
  }
  if (!rules.allowMixedImageAndVideo && images.length > 0 && videos.length > 0) {
    issues.push({ level: 'error', message: `${label} cannot combine photos and a video in one post. Deselect one type for this destination.` });
  }
  checkMediaAgainstRule(images, rules.image, 'image', d, issues);
  checkMediaAgainstRule(videos, rules.video, 'video', d, issues);

  const result: DestinationContent = { destination: d, text, textLength, textLimit: rules.textLimit, media, issues };

  if (d === 'tiktok' && images.length > 0 && videos.length === 0) {
    issues.push({ level: 'warning', message: 'TikTok photo posts on the web are not available for every account/region. If the upload page refuses photos, the job stops and tells you.' });
  }

  if (d === 'youtube' && draft.youtube.postType === 'video') {
    const title = draft.youtube.title;
    result.title = title;
    if (!title.trim()) issues.push({ level: 'error', message: 'YouTube needs a video title.' });
    if (graphemeLength(title) > YOUTUBE_TITLE_LIMIT) issues.push({ level: 'error', message: `YouTube titles are limited to ${YOUTUBE_TITLE_LIMIT} characters.` });
    if (/[<>]/.test(title) || /[<>]/.test(text)) issues.push({ level: 'error', message: 'YouTube does not allow "<" or ">" in titles or descriptions.' });
    if (draft.youtube.audience === 'unset') {
      issues.push({ level: 'warning', message: 'Audience ("made for kids") is not set. YouTube requires it, so the job will stop on the Details step for you to choose.' });
    }
    if (text.trim() && /youtu\.?be/.test(draft.link.url) && media.length === 0) {
      issues.push({ level: 'warning', message: 'A YouTube link is not a video upload; it is only used as description text.' });
    }
  }

  // Cover / thumbnail for video posts.
  // A cover whose image is gone simply means "no custom cover".
  const cover = draft.coverId ? (draft.media.find((m) => m.id === draft.coverId) ?? null) : null;
  if (cover && videos.length && d !== 'instagram') {
    const supported = (d === 'youtube' && draft.youtube.postType === 'video') || d === 'tiktok' || (d === 'facebook' && draft.meta.videoAs === 'reel');
    const rule = COVER_RULES[d];
    if (supported && rule) {
      result.thumbnail = cover;
      if (cover.kind !== 'image' || !rule.mimes.includes(cover.mime)) {
        issues.push({ level: 'error', message: `${label} covers must be ${rule.mimes.map((m) => m.split('/')[1].toUpperCase()).join(', ')}.` });
      }
      if (cover.size > rule.maxBytes) issues.push({ level: 'error', message: `${label} covers must be at most ${formatBytes(rule.maxBytes)}.` });
      if (d === 'youtube') issues.push({ level: 'warning', message: 'Custom thumbnails need a verified YouTube channel.' });
    } else if (d === 'facebook') {
      issues.push({ level: 'warning', message: 'Business Suite only takes a custom cover for Reels; this video post will use Meta\'s automatic thumbnail.' });
    } else if (d === 'x') {
      issues.push({ level: 'warning', message: 'X has no custom video cover on the web; the cover image is not used here.' });
    }
  }

  if (d === 'instagram' && draft.link.mode === 'append' && draft.platforms.instagram.includeLink && isValidHttpUrl(draft.link.url)) {
    issues.push({ level: 'warning', message: 'Links in Instagram captions are not clickable.' });
  }

  return result;
}

/** The Meta destination's text/media settings also apply to the linked Instagram accounts. */
export function metaMirror(draft: Draft): Draft {
  return { ...draft, platforms: { ...draft.platforms, instagram: { ...draft.platforms.facebook } } };
}

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

export function isYouTubeUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && YOUTUBE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The Chouf News Desk text format: the title (or the WordPress Title field), an optional "شوف تيفي"
 * byline line, then the body. Tags come from the Tags field.
 */
export function wordpressArticle(draft: Draft): { title: string; body: string; tags: string[] } {
  const lines = baseText(draft, 'wordpress').split(/\r?\n/);
  const dropBlank = () => {
    while (lines.length && !lines[0].trim()) lines.shift();
  };
  let title = draft.wordpress.title.trim();
  if (!title) {
    dropBlank();
    title = (lines.shift() ?? '').trim();
  }
  dropBlank();
  if (lines[0]?.trim() === 'شوف تيفي') lines.shift();
  const body = lines.join('\n').trim();
  const tags = draft.wordpress.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean);
  return { title, body, tags };
}

function buildWordPress(draft: Draft): DestinationContent {
  const result = buildSingle(draft, 'wordpress');
  const wp = draft.wordpress;
  const { title, body, tags } = wordpressArticle(draft);
  const choices = WORDPRESS_CHOICES[wp.postType];
  // Replaced by the more precise title/body messages below.
  const issues = result.issues.filter((i) => !i.message.startsWith('Nothing to post'));
  if (!title) issues.push({ level: 'error', message: 'WordPress needs a title: fill Title, or put it on the first line of the text.' });
  if (!body) issues.push({ level: 'error', message: 'WordPress needs the article body (the text under the title line).' });
  if (!tags.length) issues.push({ level: 'error', message: 'WordPress needs at least one tag.' });
  const unknown = [...wp.categories.filter((c) => !choices.categories.includes(c)), ...wp.options.filter((o) => !choices.options.includes(o))];
  if (unknown.length) issues.push({ level: 'error', message: `Not a WordPress choice for this type: ${unknown.join(', ')}.` });
  if (wp.postType === 'program') {
    const url = draft.link.url.trim();
    if (url && !isYouTubeUrl(url)) issues.push({ level: 'error', message: 'A WordPress video needs a YouTube link in Link.' });
    else if (!url) issues.push({ level: 'warning', message: 'No YouTube link in Link: the article\'s Video URL stays empty.' });
  }
  return { ...result, title, text: body, textLength: graphemeLength(body), issues };
}

export function buildDestinationContent(draft: Draft, d: DestinationId): DestinationContent {
  if (d === 'wordpress') return buildWordPress(draft);
  if (d !== 'facebook') return buildSingle(draft, d);
  const result = buildSingle(draft, 'facebook');
  if (draft.platforms.facebook.enabled && draft.meta.pages.length === 0) {
    result.issues.unshift({ level: 'error', message: 'Tick at least one Page under Post to → Meta.' });
  }
  if (draft.meta.videoAs === 'reel' && result.media.some((m) => m.kind === 'video') && result.media.length > 1) {
    result.issues.push({ level: 'error', message: 'A Reel takes exactly one video. Deselect the other files for Meta, or choose "regular post".' });
  }
  const withIg = draft.meta.pages.filter((p) => p.instagram).map((p) => p.name);
  if (withIg.length) {
    const ig = buildSingle(metaMirror(draft), 'instagram');
    const seen = new Set(result.issues.map((i) => i.message));
    for (const issue of ig.issues) {
      if (seen.has(issue.message)) continue;
      result.issues.push({ ...issue, message: `Instagram (linked to ${withIg.join(', ')}): ${issue.message}` });
    }
  }
  return result;
}

export function enabledDestinations(draft: Draft): DestinationId[] {
  return DESTINATIONS.filter((d) => draft.platforms[d].enabled);
}

export function validateDraft(draft: Draft): Record<DestinationId, DestinationContent> {
  const out = {} as Record<DestinationId, DestinationContent>;
  for (const d of enabledDestinations(draft)) out[d] = buildDestinationContent(draft, d);
  return out;
}

export function hasErrors(c: DestinationContent): boolean {
  return c.issues.some((i) => i.level === 'error');
}

/** One Meta Business Suite composer per selected Page; one job for each other platform. */
export function planJobs(draft: Draft): JobPlan[] {
  const enabled = enabledDestinations(draft);
  const plans: JobPlan[] = [];
  if (enabled.includes('facebook')) {
    for (const page of draft.meta.pages) {
      plans.push({ moduleId: 'meta', targets: page.instagram ? ['facebook', 'instagram'] : ['facebook'], metaPage: page.name });
    }
  }
  for (const d of ['x', 'youtube', 'tiktok', 'wordpress'] as const) if (enabled.includes(d)) plans.push({ moduleId: d, targets: [d] });
  return plans;
}

// ---------- batches (several independent posts prepared at once) ----------

export interface PostProblem {
  postId: string;
  title: string;
  messages: string[];
}

/** Posts that will actually be prepared: the ones with at least one platform switched on. */
export function activePosts(posts: BatchPost[]): BatchPost[] {
  return posts.filter((p) => enabledDestinations(p.draft).length > 0);
}

/**
 * Blocking problems per post, plus batch-wide rules. YouTube's active channel applies to the whole
 * browser, so all posts in one batch must use the same YouTube channel.
 */
export function batchProblems(posts: BatchPost[]): PostProblem[] {
  const problems: PostProblem[] = [];
  const active = activePosts(posts);
  for (const p of active) {
    const v = validateDraft(p.draft);
    const messages = Object.values(v).flatMap((c) => c.issues.filter((i) => i.level === 'error').map((i) => `${DESTINATION_LABELS[c.destination]}: ${i.message}`));
    if (messages.length) problems.push({ postId: p.id, title: p.title, messages });
  }
  const yt = active.filter((p) => p.draft.platforms.youtube.enabled);
  const channels = new Set(yt.map((p) => p.draft.youtube.channel));
  if (channels.size > 1) {
    for (const p of yt) {
      const msg = 'YouTube can only be prepared for one channel at a time. Use the same channel in every post, or prepare these posts separately.';
      const existing = problems.find((x) => x.postId === p.id);
      if (existing) existing.messages.push(msg);
      else problems.push({ postId: p.id, title: p.title, messages: [msg] });
    }
  }
  return problems;
}

/** One job per post × platform (Meta: per Page). */
export function planBatch(posts: BatchPost[]): JobPlan[] {
  return activePosts(posts).flatMap((p) => planJobs(p.draft).map((plan) => ({ ...plan, postId: p.id, postTitle: p.title })));
}
