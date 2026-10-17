import type { DestinationId } from './types';

// Platform limits used for validation. These reflect the official web composers as
// documented by each platform at the time of writing; platforms change them, so keep
// them here in one place and adjust as needed.

export interface MediaRule {
  mimes: string[];
  maxBytes: number;
  maxCount: number;
  maxDurationSec?: number;
  /** When true, exceeding maxDurationSec is a warning (some accounts have higher limits). */
  durationIsSoft?: boolean;
  /** When true, exceeding maxBytes is a warning (e.g. X Premium / Instagram allow larger files). */
  sizeIsSoft?: boolean;
}

export interface PlatformRules {
  textLimit: number;
  /** 'x-weighted' approximates X's counting (URLs = 23, wide characters/emoji = 2). */
  textCounting: 'graphemes' | 'x-weighted';
  /** When false, exceeding the limit is a warning (e.g. X Premium accounts allow longer posts). */
  textLimitIsHard: boolean;
  requiresMedia: boolean;
  requiresVideo?: boolean;
  image: MediaRule | null;
  video: MediaRule | null;
  allowMixedImageAndVideo: boolean;
  maxHashtags?: number;
  notes: string[];
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const JPEG_PNG = ['image/jpeg', 'image/png'];
const COMMON_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MP4_MOV = ['video/mp4', 'video/quicktime'];

export const PLATFORM_RULES: Record<DestinationId, PlatformRules> = {
  facebook: {
    textLimit: 63206,
    textCounting: 'graphemes',
    textLimitIsHard: true,
    requiresMedia: false,
    image: { mimes: COMMON_IMAGES, maxBytes: 30 * MB, maxCount: 10 },
    video: { mimes: [...MP4_MOV, 'video/webm'], maxBytes: 4 * GB, maxCount: 1 },
    allowMixedImageAndVideo: false,
    notes: ['Business Suite posts photos or one video per post; mixing photos and a video is not supported in one post.'],
  },
  instagram: {
    textLimit: 2200,
    textCounting: 'graphemes',
    textLimitIsHard: true,
    requiresMedia: true,
    image: { mimes: JPEG_PNG, maxBytes: 8 * MB, maxCount: 10 },
    video: { mimes: MP4_MOV, maxBytes: 1 * GB, maxCount: 10, maxDurationSec: 15 * 60, durationIsSoft: true, sizeIsSoft: true },
    allowMixedImageAndVideo: true,
    maxHashtags: 30,
    notes: ['Instagram needs at least one photo or video.', 'Carousels hold up to 10 items.'],
  },
  x: {
    textLimit: 280,
    textCounting: 'x-weighted',
    textLimitIsHard: false,
    requiresMedia: false,
    image: { mimes: COMMON_IMAGES, maxBytes: 5 * MB, maxCount: 4 },
    video: { mimes: MP4_MOV, maxBytes: 512 * MB, maxCount: 1, maxDurationSec: 140, durationIsSoft: true, sizeIsSoft: true },
    allowMixedImageAndVideo: false,
    notes: ['Up to 4 images or 1 video.', 'Text over 280 characters requires X Premium.'],
  },
  youtube: {
    textLimit: 5000,
    textCounting: 'graphemes',
    textLimitIsHard: true,
    requiresMedia: true,
    requiresVideo: true,
    image: null,
    video: {
      mimes: [...MP4_MOV, 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/mpeg', 'video/3gpp'],
      maxBytes: 256 * GB,
      maxCount: 1,
      maxDurationSec: 15 * 60,
      durationIsSoft: true,
    },
    allowMixedImageAndVideo: false,
    notes: ['Exactly one video file. A YouTube link is used as text, not as an upload.', 'Videos over 15 minutes need a verified channel.'],
  },
  tiktok: {
    textLimit: 4000,
    textCounting: 'graphemes',
    textLimitIsHard: true,
    requiresMedia: true,
    image: { mimes: JPEG_PNG.concat('image/webp'), maxBytes: 20 * MB, maxCount: 35 },
    video: { mimes: [...MP4_MOV, 'video/webm'], maxBytes: 4 * GB, maxCount: 1, maxDurationSec: 60 * 60, durationIsSoft: true },
    allowMixedImageAndVideo: false,
    notes: ['One video, or a photo post (photo posts on the web depend on your account and region).'],
  },
};

export const YOUTUBE_TITLE_LIMIT = 100;
export const YOUTUBE_THUMBNAIL: MediaRule = { mimes: ['image/jpeg', 'image/png', 'image/gif'], maxBytes: 2 * MB, maxCount: 1 };

/**
 * YouTube channel posts (the "Posts" tab composer): text, optionally with up to 10 images.
 * YouTube doesn't document a text limit for posts; 5000 is used as a soft guide.
 */
export const YOUTUBE_POST_RULES: PlatformRules = {
  textLimit: 5000,
  textCounting: 'graphemes',
  textLimitIsHard: false,
  requiresMedia: false,
  image: { mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], maxBytes: 16 * MB, maxCount: 10 },
  video: null,
  allowMixedImageAndVideo: false,
  notes: ['Text with up to 10 images, posted on your channel\'s Posts tab.'],
};

/** Cover / thumbnail images, per destination that supports a custom one for videos. */
export const COVER_RULES: Partial<Record<DestinationId, MediaRule>> = {
  youtube: YOUTUBE_THUMBNAIL,
  tiktok: { mimes: ['image/jpeg', 'image/png'], maxBytes: 20 * MB, maxCount: 1 },
  facebook: { mimes: ['image/jpeg', 'image/png'], maxBytes: 10 * MB, maxCount: 1 },
};
