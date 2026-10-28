// Types shared by the React frontend and the Node backend.

export type DestinationId = 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok' | 'wordpress';

/**
 * Destinations offered in the UI. 'facebook' is the Meta destination: each selected Page is posted
 * through Meta Business Suite, and the Page's linked Instagram account is included by Meta itself.
 * 'instagram' stays as an id only so Instagram's rules can be applied to Pages that have one.
 */
export const DESTINATIONS: DestinationId[] = ['facebook', 'x', 'youtube', 'tiktok', 'wordpress'];

export const DESTINATION_LABELS: Record<DestinationId, string> = {
  facebook: 'Meta',
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube Studio',
  tiktok: 'TikTok Studio',
  wordpress: 'WordPress (Chouf)',
};

/** Automation modules. Facebook and Instagram both go through Meta Business Suite. */
export type ModuleId = 'meta' | 'x' | 'youtube' | 'tiktok' | 'wordpress';

export const MODULE_LABELS: Record<ModuleId, string> = {
  meta: 'Meta Business Suite',
  x: 'X',
  youtube: 'YouTube Studio',
  tiktok: 'TikTok Studio',
  wordpress: 'WordPress (Chouf)',
};

export const DESTINATION_MODULE: Record<DestinationId, ModuleId> = {
  facebook: 'meta',
  instagram: 'meta',
  x: 'x',
  youtube: 'youtube',
  tiktok: 'tiktok',
  wordpress: 'wordpress',
};

export type MediaKind = 'image' | 'video';

export interface MediaItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: MediaKind;
  source: 'upload' | 'url';
  /** Unguessable per-file token so a hosted dashboard can show previews from the local engine. */
  token?: string;
  width?: number;
  height?: number;
  durationSec?: number;
}

/** How the optional link is used: appended to the text/description, or not used at all. */
export type LinkMode = 'append' | 'none';

export interface PlatformConfig {
  enabled: boolean;
  /** true = use the shared main text; false = use customText for this destination only. */
  useSharedText: boolean;
  customText: string;
  includeLink: boolean;
  /** null = every media item in the post; otherwise the explicit subset (in post order). */
  mediaIds: string[] | null;
}

export type YouTubeAudience = 'unset' | 'not_kids' | 'kids';
export type YouTubeVisibility = 'unset' | 'private' | 'unlisted' | 'public';

export type YouTubePostType = 'video' | 'post';

/** A YouTube channel the signed-in Google account can switch to. */
export interface YouTubeChannel {
  name: string;
  handle: string;
}

export interface YouTubeOptions {
  /** 'video' = upload a video in Studio; 'post' = a channel post (text + up to 10 images). */
  postType: YouTubePostType;
  /**
   * Channel to prepare on (name as in YouTube's channel switcher); '' = the current one.
   * YouTube's active channel is browser-wide, so one channel per preparation.
   */
  channel: string;
  title: string;
  audience: YouTubeAudience;
  /** Only selected in the Visibility step; choosing it never publishes. */
  visibility: YouTubeVisibility;
  /** Click "Next" through Details → Video elements → Checks → Visibility (never Save/Publish). */
  advanceToVisibilityStep: boolean;
}

/** A Facebook Page in Business Suite; `instagram` = it has a linked Instagram account. */
export interface MetaPage {
  name: string;
  instagram: boolean;
}

export interface MetaOptions {
  /** Pages selected for this post (one Business Suite composer each). */
  pages: MetaPage[];
  /** Pause so the user can double-check "Post to" before the composer is filled. */
  confirmDestinations: boolean;
  /** A single video goes out as a Reel (Business Suite's "Create reel") or as a regular post. */
  videoAs: 'reel' | 'post';
}

/** Chouf's WordPress: 'press' = a news article, 'program' = a video (YouTube link from the Link field). */
export type WordPressPostType = 'press' | 'program';

export interface WordPressOptions {
  postType: WordPressPostType;
  /** Article title; '' = the first line of the text. */
  title: string;
  /** Comma-separated tags ("," or "،"). */
  tags: string;
  /** Ticked sections (WordPress categories), from WORDPRESS_CHOICES. */
  categories: string[];
  /** Ticked article options (e.g. "شريط الأخبار"), from WORDPRESS_CHOICES. */
  options: string[];
}

export interface Draft {
  sharedText: string;
  /**
   * Image used as the cover / thumbnail of video posts (YouTube videos and Shorts, TikTok videos,
   * Meta Reels). It is never posted as regular media.
   */
  coverId: string | null;
  link: { url: string; mode: LinkMode };
  media: MediaItem[];
  platforms: Record<DestinationId, PlatformConfig>;
  youtube: YouTubeOptions;
  meta: MetaOptions;
  wordpress: WordPressOptions;
}

/** One post in a batch: its own text, media, cover and platform choices. */
export interface BatchPost {
  id: string;
  title: string;
  draft: Draft;
}

export function emptyPlatformConfig(enabled = false): PlatformConfig {
  return { enabled, useSharedText: true, customText: '', includeLink: true, mediaIds: null };
}

export function emptyDraft(): Draft {
  return {
    sharedText: '',
    coverId: null,
    link: { url: '', mode: 'append' },
    media: [],
    platforms: {
      facebook: emptyPlatformConfig(),
      instagram: emptyPlatformConfig(),
      x: emptyPlatformConfig(),
      youtube: emptyPlatformConfig(),
      tiktok: emptyPlatformConfig(),
      wordpress: emptyPlatformConfig(),
    },
    youtube: { postType: 'video', channel: '', title: '', audience: 'unset', visibility: 'unset', advanceToVisibilityStep: true },
    meta: { pages: [], confirmDestinations: false, videoAs: 'reel' },
    wordpress: wordpressDefaults('press'),
  };
}

/**
 * The options and sections Chouf's WordPress offers per type (copied from the Chouf News Desk
 * extension). Defaults match the News Desk site: every option ticked, one default section.
 */
export const WORDPRESS_CHOICES: Record<WordPressPostType, { options: string[]; categories: string[]; defaultCategories: string[] }> = {
  press: {
    options: ['يظهر في الصفحة الرئيسية', 'شريط الأخبار'],
    categories: ['سياسة', 'مجتمع', 'حوادث وحقوق', 'أخبار', 'دولي', 'فن وثقافة', 'اقتصاد'],
    defaultCategories: ['سياسة'],
  },
  program: {
    options: ['Featured Program Video', 'الحلقات', 'مقاطع'],
    categories: ['خارج البلاطو', 'بوز', 'حالة خاصة', 'زووم', 'نسولو الناس'],
    defaultCategories: ['بوز'],
  },
};

export function wordpressDefaults(postType: WordPressPostType): WordPressOptions {
  const c = WORDPRESS_CHOICES[postType];
  return { postType, title: '', tags: '', categories: [...c.defaultCategories], options: [...c.options] };
}
