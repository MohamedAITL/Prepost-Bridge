// Types shared by the React frontend and the Node backend.

export type DestinationId = 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok';

/**
 * Destinations offered in the UI. 'facebook' is the Meta destination: each selected Page is posted
 * through Meta Business Suite, and the Page's linked Instagram account is included by Meta itself.
 * 'instagram' stays as an id only so Instagram's rules can be applied to Pages that have one.
 */
export const DESTINATIONS: DestinationId[] = ['facebook', 'x', 'youtube', 'tiktok'];

export const DESTINATION_LABELS: Record<DestinationId, string> = {
  facebook: 'Meta',
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube Studio',
  tiktok: 'TikTok Studio',
};

/** Automation modules. Facebook and Instagram both go through Meta Business Suite. */
export type ModuleId = 'meta' | 'x' | 'youtube' | 'tiktok';

export const MODULE_LABELS: Record<ModuleId, string> = {
  meta: 'Meta Business Suite',
  x: 'X',
  youtube: 'YouTube Studio',
  tiktok: 'TikTok Studio',
};

export const DESTINATION_MODULE: Record<DestinationId, ModuleId> = {
  facebook: 'meta',
  instagram: 'meta',
  x: 'x',
  youtube: 'youtube',
  tiktok: 'tiktok',
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
    },
    youtube: { postType: 'video', channel: '', title: '', audience: 'unset', visibility: 'unset', advanceToVisibilityStep: true },
    meta: { pages: [], confirmDestinations: false, videoAs: 'reel' },
  };
}
