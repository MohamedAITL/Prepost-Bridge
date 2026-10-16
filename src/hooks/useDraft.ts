import { useCallback, useEffect, useState } from 'react';
import { emptyDraft, type DestinationId, type Draft, type PlatformConfig } from '../../shared/types';

// The draft (text and per-platform settings) lives in sessionStorage: it survives a page reload
// but disappears when the tab is closed. Only non-sensitive preferences (which destinations are
// selected, YouTube/Meta defaults) go to localStorage.
const DRAFT_KEY = 'spa.draft.v3';
const PREFS_KEY = 'spa.prefs.v3';

interface Prefs {
  enabled: Partial<Record<DestinationId, boolean>>;
  youtube: Pick<Draft['youtube'], 'postType' | 'channel' | 'audience' | 'visibility' | 'advanceToVisibilityStep'>;
  meta: Pick<Draft['meta'], 'confirmDestinations' | 'pages' | 'videoAs'>;
}

function safeGet(storage: () => Storage, key: string): unknown {
  try {
    const raw = storage().getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function initialDraft(): Draft {
  const base = emptyDraft();
  const saved = safeGet(() => sessionStorage, DRAFT_KEY) as Draft | null;
  if (saved && typeof saved.sharedText === 'string' && saved.platforms) {
    // Media comes back from the server (it owns the files).
    return { ...base, ...saved, media: [], platforms: { ...base.platforms, ...saved.platforms }, youtube: { ...base.youtube, ...saved.youtube }, meta: { ...base.meta, ...saved.meta } };
  }
  const prefs = safeGet(() => localStorage, PREFS_KEY) as Prefs | null;
  if (prefs) {
    for (const [d, on] of Object.entries(prefs.enabled ?? {})) if (d in base.platforms) base.platforms[d as DestinationId].enabled = !!on;
    Object.assign(base.youtube, prefs.youtube ?? {});
    Object.assign(base.meta, prefs.meta ?? {});
  }
  return base;
}

export function useDraft() {
  const [draft, setDraft] = useState<Draft>(initialDraft);

  useEffect(() => {
    const { media: _m, ...rest } = draft;
    safeSet(() => sessionStorage, DRAFT_KEY, rest);
    const prefs: Prefs = {
      enabled: Object.fromEntries(Object.entries(draft.platforms).map(([k, v]) => [k, v.enabled])),
      youtube: { postType: draft.youtube.postType, channel: draft.youtube.channel, audience: draft.youtube.audience, visibility: draft.youtube.visibility, advanceToVisibilityStep: draft.youtube.advanceToVisibilityStep },
      meta: { confirmDestinations: draft.meta.confirmDestinations, pages: draft.meta.pages, videoAs: draft.meta.videoAs },
    };
    safeSet(() => localStorage, PREFS_KEY, prefs);
  }, [draft]);

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft(fn), []);

  const updatePlatform = useCallback((d: DestinationId, patch: Partial<PlatformConfig>) => {
    setDraft((prev) => ({ ...prev, platforms: { ...prev.platforms, [d]: { ...prev.platforms[d], ...patch } } }));
  }, []);

  return { draft, update, updatePlatform, setDraft };
}
