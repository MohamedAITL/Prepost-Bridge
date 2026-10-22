import type { Draft, MediaItem } from './types/content';
import type { BatchPost } from '../shared/types';
import type { MetaPage, YouTubeChannel } from '../shared/types';
import type { BrowserMode, BrowserState, JobSnapshot, ModuleId } from './types/platform';

/**
 * Where the engine runs. '' = same origin (the engine serves this dashboard, or Vite proxies it).
 * A hosted dashboard (Netlify) sets VITE_ENGINE_URL=http://127.0.0.1:5174 at build time.
 */
export let ENGINE_URL = ((import.meta.env.VITE_ENGINE_URL as string | undefined) ?? '').replace(/\/$/, '');
export const IS_HOSTED = ENGINE_URL !== '';
const u = (path: string) => `${ENGINE_URL}${path}`;

// ---------- several Windows users on one PC ----------
// They share 127.0.0.1, so each user's engine runs on its own port (5174–5183, see server/index.ts).

export interface EngineInfo {
  url: string;
  /** The Windows (or macOS) user running that engine; '' for engines older than this check. */
  user: string;
}

const USER_KEY = 'prepost.engineUser';
/** The engine the dashboard is talking to (hosted dashboard only). */
export let engineUser: string | null = null;

export async function findEngines(): Promise<EngineInfo[]> {
  const base = new URL(ENGINE_URL);
  const found = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const url = `${base.protocol}//${base.hostname}:${5174 + i}`;
      try {
        const h = await (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })).json();
        return h?.app === 'prepost-engine' ? { url, user: String(h.user ?? '') } : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((e): e is EngineInfo => !!e);
}

function savedUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function chooseEngineUser(user: string | null) {
  try {
    if (user === null) localStorage.removeItem(USER_KEY);
    else localStorage.setItem(USER_KEY, user);
  } catch {
    /* storage unavailable: asks again next visit */
  }
}

/**
 * Connect to this person's engine. Returns null when connected, or the engines to choose from when
 * several Windows users run Prepost here (or the remembered user's engine isn't running).
 * Throws when no engine is running.
 */
export async function connectEngine(): Promise<EngineInfo[] | null> {
  if (!IS_HOSTED) {
    await api.health();
    return null;
  }
  const engines = await findEngines();
  if (!engines.length) throw new ApiError('No engine is running on this computer.');
  // "Switch user" always shows the list, even with a single engine, so you see who was found.
  if (new URLSearchParams(window.location.search).has('switch-user')) return engines;
  const saved = savedUser();
  const pick = saved !== null ? engines.find((e) => e.user === saved) : engines.length === 1 ? engines[0] : undefined;
  if (!pick) return engines;
  ENGINE_URL = pick.url;
  engineUser = pick.user;
  return null;
}

export interface PostProblem {
  postId: string;
  title: string;
  messages: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public details?: unknown,
    /** Set for a batch failure: which posts have errors. */
    public posts?: PostProblem[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(u(url), {
    method,
    headers: { 'X-SPA-Client': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data.details, data.posts);
  return data as T;
}

export const api = {
  listMedia: () => request<MediaItem[]>('GET', '/api/media'),
  importMedia: (url: string) => request<MediaItem>('POST', '/api/media/import', { url }),
  removeMedia: (id: string) => request('DELETE', `/api/media/${id}`),
  clearMedia: () => request('DELETE', '/api/media'),
  mediaUrl: (m: Pick<MediaItem, 'id' | 'token'>) => u(`/api/media/${m.id}/file${m.token ? `?t=${m.token}` : ''}`),
  eventsUrl: () => u('/api/events'),
  health: () => request<{ ok: boolean }>('GET', '/api/health'),

  prepareBatch: (posts: BatchPost[]) => request<{ jobs: JobSnapshot[] }>('POST', '/api/prepare', { posts }),
  retry: (id: string) => request<JobSnapshot>('POST', `/api/jobs/${id}/retry`),
  continueJob: (id: string) => request('POST', `/api/jobs/${id}/continue`),
  cancel: (id: string) => request('POST', `/api/jobs/${id}/cancel`),
  focus: (id: string) => request('POST', `/api/jobs/${id}/focus`),
  dismiss: (id: string) => request('DELETE', `/api/jobs/${id}`),
  clearFinished: () => request('DELETE', '/api/jobs'),

  getMetaPages: () => request<{ pages: MetaPage[] }>('GET', '/api/meta/pages'),
  saveMetaPages: (pages: MetaPage[]) => request<{ pages: MetaPage[] }>('PUT', '/api/meta/pages', { pages }),
  refreshMetaPages: () => request<{ pages: MetaPage[] }>('POST', '/api/meta/pages/refresh'),

  getYouTubeChannels: () => request<{ channels: YouTubeChannel[] }>('GET', '/api/youtube/channels'),
  saveYouTubeChannels: (channels: YouTubeChannel[]) => request<{ channels: YouTubeChannel[] }>('PUT', '/api/youtube/channels', { channels }),
  refreshYouTubeChannels: () => request<{ channels: YouTubeChannel[] }>('POST', '/api/youtube/channels/refresh'),

  launchBrowser: () => request<BrowserState>('POST', '/api/browser/launch'),
  setBrowserMode: (mode: BrowserMode) => request<BrowserState>('POST', '/api/browser/mode', { mode }),
  openDashboardInBrowser: () => request<BrowserState>('POST', '/api/browser/open-dashboard', { origin: window.location.origin }),
  closeBrowser: () => request<BrowserState>('POST', '/api/browser/close'),
  openPlatform: (platform: ModuleId) => request<BrowserState>('POST', '/api/browser/open', { platform }),

  /** Upload with progress reporting (fetch has no upload progress). */
  uploadMedia(file: File, hints: { width?: number; height?: number; durationSec?: number }, onProgress: (fraction: number) => void): Promise<MediaItem> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(hints)) if (v) form.append(k, String(v));
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', u('/api/media'));
      xhr.setRequestHeader('X-SPA-Client', '1');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data: { error?: string } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* empty */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as MediaItem);
        else reject(new ApiError(data.error ?? `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new ApiError('Upload failed: the local server is not reachable.'));
      xhr.send(form);
    });
  },
};

/** Read image dimensions / video duration in the browser so validation can warn early. */
export function probeMedia(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  const url = URL.createObjectURL(file);
  const done = <T,>(v: T) => {
    URL.revokeObjectURL(url);
    return v;
  };
  if (file.type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(done({ width: img.naturalWidth, height: img.naturalHeight }));
      img.onerror = () => resolve(done({}));
      img.src = url;
    });
  }
  if (file.type.startsWith('video/')) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, durationSec: Number.isFinite(v.duration) ? v.duration : undefined }));
      v.onerror = () => resolve(done({}));
      v.src = url;
    });
  }
  return Promise.resolve(done({}));
}
