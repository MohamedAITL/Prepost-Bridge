import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyDraft, type BatchPost, type DestinationId, type Draft, type PlatformConfig } from '../../shared/types';

// Posts (text and per-platform settings) live in sessionStorage: they survive a reload but
// disappear when the tab is closed. Only non-sensitive defaults go to localStorage.
const BATCH_KEY = 'spa.batch.v1';
const OLD_DRAFT_KEY = 'spa.draft.v3';
const PREFS_KEY = 'spa.prefs.v3';

interface Prefs {
  enabled: Partial<Record<DestinationId, boolean>>;
  youtube: Pick<Draft['youtube'], 'postType' | 'channel' | 'audience' | 'visibility' | 'advanceToVisibilityStep'>;
  meta: Pick<Draft['meta'], 'confirmDestinations' | 'pages' | 'videoAs'>;
}

interface StoredPost {
  id: string;
  title: string;
  draft: Omit<Draft, 'media'>;
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

function newId(): string {
  return crypto.randomUUID();
}

/** A fresh post, seeded from saved preferences (selected platforms, YouTube/Meta defaults). */
function freshDraft(): Draft {
  const base = emptyDraft();
  const prefs = safeGet(() => localStorage, PREFS_KEY) as Prefs | null;
  if (prefs) {
    for (const [d, on] of Object.entries(prefs.enabled ?? {})) if (d in base.platforms) base.platforms[d as DestinationId].enabled = !!on;
    Object.assign(base.youtube, prefs.youtube ?? {});
    Object.assign(base.meta, prefs.meta ?? {});
  }
  return base;
}

function mergeDraft(saved: Partial<Draft>): Draft {
  const base = emptyDraft();
  // Media comes back from the engine (it owns the files), so it's never restored from storage.
  return {
    ...base,
    ...saved,
    media: [],
    platforms: { ...base.platforms, ...saved.platforms },
    youtube: { ...base.youtube, ...saved.youtube },
    meta: { ...base.meta, ...saved.meta },
  };
}

function initialPosts(): BatchPost[] {
  const stored = safeGet(() => sessionStorage, BATCH_KEY) as StoredPost[] | null;
  if (stored?.length) return stored.map((p) => ({ id: p.id, title: p.title, draft: mergeDraft(p.draft) }));
  // Migrate a single saved draft from the pre-batch version.
  const old = safeGet(() => sessionStorage, OLD_DRAFT_KEY) as Draft | null;
  if (old && typeof old.sharedText === 'string' && old.platforms) return [{ id: newId(), title: 'Post 1', draft: mergeDraft(old) }];
  return [{ id: newId(), title: 'Post 1', draft: freshDraft() }];
}

export function useBatch() {
  const [posts, setPosts] = useState<BatchPost[]>(initialPosts);
  const [activeId, setActiveId] = useState<string>(() => posts[0].id);

  const active = useMemo(() => posts.find((p) => p.id === activeId) ?? posts[0], [posts, activeId]);

  useEffect(() => {
    const stored: StoredPost[] = posts.map(({ id, title, draft }) => {
      const { media: _m, ...rest } = draft;
      return { id, title, draft: rest };
    });
    safeSet(() => sessionStorage, BATCH_KEY, stored);
    // Defaults follow the active post.
    const d = active.draft;
    const prefs: Prefs = {
      enabled: Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, v.enabled])),
      youtube: { postType: d.youtube.postType, channel: d.youtube.channel, audience: d.youtube.audience, visibility: d.youtube.visibility, advanceToVisibilityStep: d.youtube.advanceToVisibilityStep },
      meta: { confirmDestinations: d.meta.confirmDestinations, pages: d.meta.pages, videoAs: d.meta.videoAs },
    };
    safeSet(() => localStorage, PREFS_KEY, prefs);
  }, [posts, active]);

  /** Change the active post's draft. Same signature the components already use. */
  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      setPosts((prev) => prev.map((p) => (p.id === activeId ? { ...p, draft: fn(p.draft) } : p)));
    },
    [activeId],
  );

  const updatePlatform = useCallback(
    (d: DestinationId, patch: Partial<PlatformConfig>) => {
      update((prev) => ({ ...prev, platforms: { ...prev.platforms, [d]: { ...prev.platforms[d], ...patch } } }));
    },
    [update],
  );

  /** Apply a change to every post (used when the engine's media list reloads). */
  const updateAll = useCallback((fn: (d: Draft) => Draft) => {
    setPosts((prev) => prev.map((p) => ({ ...p, draft: fn(p.draft) })));
  }, []);

  const nextTitle = useCallback((list: BatchPost[]): string => {
    for (let n = 1; ; n++) {
      const title = `Post ${n}`;
      if (!list.some((p) => p.title === title)) return title;
    }
  }, []);

  const addPost = useCallback(() => {
    setPosts((prev) => {
      const post: BatchPost = { id: newId(), title: nextTitle(prev), draft: freshDraft() };
      queueMicrotask(() => setActiveId(post.id));
      return [...prev, post];
    });
  }, [nextTitle]);

  const duplicatePost = useCallback(
    (id: string) => {
      setPosts((prev) => {
        const src = prev.find((p) => p.id === id);
        if (!src) return prev;
        const copy: BatchPost = { id: newId(), title: nextTitle(prev), draft: structuredClone(src.draft) };
        queueMicrotask(() => setActiveId(copy.id));
        const i = prev.findIndex((p) => p.id === id);
        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
      });
    },
    [nextTitle],
  );

  const removePost = useCallback((id: string) => {
    setPosts((prev) => {
      if (prev.length === 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      queueMicrotask(() => setActiveId((cur) => (cur === id ? next[0].id : cur)));
      return next;
    });
  }, []);

  const renamePost = useCallback((id: string, title: string) => {
    const clean = title.trim().slice(0, 80);
    if (!clean) return;
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, title: clean } : p)));
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  return {
    posts,
    activeId: active.id,
    draft: active.draft,
    update,
    updatePlatform,
    updateAll,
    addPost,
    duplicatePost,
    removePost,
    renamePost,
    select,
  };
}
