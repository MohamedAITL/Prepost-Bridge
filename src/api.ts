import type { Draft, MediaItem } from './types/content';
import type { MetaPage, YouTubeChannel } from '../shared/types';
import type { BrowserMode, BrowserState, JobSnapshot, ModuleId } from './types/platform';

/**
 * Where the engine runs. '' = same origin (the engine serves this dashboard, or Vite proxies it).
 * A hosted dashboard (Netlify) sets VITE_ENGINE_URL=http://127.0.0.1:5174 at build time.
 */
export const ENGINE_URL = ((import.meta.env.VITE_ENGINE_URL as string | undefined) ?? '').replace(/\/$/, '');
export const IS_HOSTED = ENGINE_URL !== '';
const u = (path: string) => `${ENGINE_URL}${path}`;

export class ApiError extends Error {
  constructor(
    message: string,
    public details?: unknown,
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
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data.details);
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

  prepare: (draft: Draft) => request<{ jobs: JobSnapshot[] }>('POST', '/api/prepare', { draft }),
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
