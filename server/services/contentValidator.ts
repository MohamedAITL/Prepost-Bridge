import { z } from 'zod';
import type { Draft, MetaPage } from '../../shared/types';

export const metaPagesSchema = z.array(z.object({ name: z.string().trim().min(1).max(200), instagram: z.boolean() })).max(100);

export function parseMetaPages(input: unknown): MetaPage[] {
  const pages = metaPagesSchema.parse(input);
  const seen = new Set<string>();
  return pages.filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()));
}

// Shape validation for drafts arriving from the frontend. Content rules (limits, formats,
// combinations) live in shared/validation.ts so the UI and the server apply the same ones.

const platformConfig = z.object({
  enabled: z.boolean(),
  useSharedText: z.boolean(),
  customText: z.string().max(100_000),
  includeLink: z.boolean(),
  mediaIds: z.array(z.string().uuid()).max(50).nullable(),
});

const mediaItem = z.object({
  id: z.string().uuid(),
  name: z.string().max(300),
  mime: z.string().max(100),
  size: z.number().nonnegative(),
  kind: z.enum(['image', 'video']),
  source: z.enum(['upload', 'url']),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  durationSec: z.number().positive().optional(),
});

const draftSchema = z.object({
  sharedText: z.string().max(100_000),
  coverId: z.string().uuid().nullable(),
  link: z.object({ url: z.string().max(4000), mode: z.enum(['append', 'none']) }),
  media: z.array(mediaItem).max(50),
  platforms: z.object({
    facebook: platformConfig,
    instagram: platformConfig,
    x: platformConfig,
    youtube: platformConfig,
    tiktok: platformConfig,
  }),
  youtube: z.object({
    postType: z.enum(['video', 'post']),
    channel: z.string().max(200),
    title: z.string().max(1000),
    audience: z.enum(['unset', 'not_kids', 'kids']),
    visibility: z.enum(['unset', 'private', 'unlisted', 'public']),
    advanceToVisibilityStep: z.boolean(),
  }),
  meta: z.object({ pages: z.array(z.object({ name: z.string().min(1).max(200), instagram: z.boolean() })).max(100), confirmDestinations: z.boolean(), videoAs: z.enum(['reel', 'post']) }),
});

export function parseDraft(input: unknown): Draft {
  return draftSchema.parse(input) as Draft;
}

export function parseYouTubeChannels(input: unknown) {
  const list = z.array(z.object({ name: z.string().trim().min(1).max(200), handle: z.string().trim().max(200) })).max(50).parse(input);
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()));
}
