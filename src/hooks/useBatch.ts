import { useCallback, useEffect, useMemo, useState } from 'react';
import { emptyDraft, emptyPlatformConfig, type BatchPost, type DestinationId, type Draft, type PlatformConfig } from '../../shared/types';

// Posts (text and per-platform settings) live in sessionStorage: they survive a reload but
// disappear when the tab is closed. Only non-sensitive defaults go to localStorage.
const BATCH_KEY = 'spa.batch.v1';
const OLD_DRAFT_KEY = 'spa.draft.v3';
const PREFS_KEY = 'spa.prefs.v3';

interface Prefs {
  enabled: Partial<Record<DestinationId, boolean>>;
  youtube: Pick<Draft['youtube'], 'postType' | 'channel' | 'audience' | 'visibility' | 'advanceToVisibilityStep'>;
  meta: Pick<Draft['meta'], 'confirmDestinations' | 'pages' | 'videoAs'>;
  wordpress?: Pick<Draft['wordpress'], 'postType' | 'categories' | 'options'>;
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
/**
 * A fresh post. Platform defaults (Meta Pages, YouTube channel, video type) are seeded so they're
 * ready when you turn a platform on, but platforms themselves start OFF — otherwise a brand-new,
 * empty post would instantly block the whole batch with "add text or media". `seedEnabled` turns
 * the saved platform selection back on, used only to restore the very first post on load.
 */
function freshDraft(seedEnabled = false): Draft {
  const base = emptyDraft();
  const prefs = safeGet(() => localStorage, PREFS_KEY) as Prefs | null;
  if (prefs) {
    if (seedEnabled) for (const [d, on] of Object.entries(prefs.enabled ?? {})) if (d in base.platforms) base.platforms[d as DestinationId].enabled = !!on;
    Object.assign(base.youtube, prefs.youtube ?? {});
    Object.assign(base.meta, prefs.meta ?? {});
    Object.assign(base.wordpress, prefs.wordpress ?? {});
  }
  return base;
}

/** A platform's on/off choice from another post, without its custom text or media selection. */
function emptyPlatformConfigFrom(cfg: PlatformConfig): PlatformConfig {
  return { ...emptyPlatformConfig(cfg.enabled), includeLink: cfg.includeLink };
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
    wordpress: { ...base.wordpress, ...saved.wordpress },
  };
}

function initialPosts(): BatchPost[] {
  const stored = safeGet(() => sessionStorage, BATCH_KEY) as StoredPost[] | null;
  if (stored?.length) return stored.map((p) => ({ id: p.id, title: p.title, draft: mergeDraft(p.draft) }));
  // Migrate a single saved draft from the pre-batch version.
  const old = safeGet(() => sessionStorage, OLD_DRAFT_KEY) as Draft | null;
  if (old && typeof old.sharedText === 'string' && old.platforms) return [{ id: newId(), title: 'Post 1', draft: mergeDraft(old) }];
  return [{ id: newId(), title: 'Post 1', draft: freshDraft(true) }];
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
      wordpress: { postType: d.wordpress.postType, categories: d.wordpress.categories, options: d.wordpress.options },
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

  /**
   * One new Post per item captured from WhatsApp: its caption and image, with Post 1's platforms
   * and settings (not its text, title or tags). The post you're editing stays selected.
   */
  const addIncoming = useCallback(
    (items: { text: string; media: Draft['media'][number] }[]) => {
      if (!items.length) return;
      setPosts((prev) => {
        const template = prev[0].draft;
        const added: BatchPost[] = [];
        for (const item of items) {
          const draft = freshDraft();
          draft.sharedText = item.text;
          draft.media = [item.media];
          draft.platforms = Object.fromEntries(Object.entries(template.platforms).map(([k, v]) => [k, emptyPlatformConfigFrom(v)])) as Draft['platforms'];
          draft.youtube = { ...template.youtube, title: '' };
          draft.meta = structuredClone(template.meta);
          draft.wordpress = { ...structuredClone(template.wordpress), title: '', tags: '' };
          added.push({ id: newId(), title: nextTitle([...prev, ...added]), draft });
        }
        return [...prev, ...added];
      });
    },
    [nextTitle],
  );

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
    addIncoming,
    duplicatePost,
    removePost,
    renamePost,
    select,
  };
}
