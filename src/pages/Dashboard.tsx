import { useCallback, useEffect, useMemo, useState } from 'react';
import { BroomIcon, PaperPlaneTiltIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { emptyPlatformConfig, type MetaPage, type YouTubeChannel } from '../../shared/types';
import { batchProblems, enabledDestinations, planBatch, planJobs, validateDraft } from '../../shared/validation';
import { ApiError, IS_HOSTED, api, connectEngine, probeMedia, type EngineInfo } from '../api';
import { AutomationStatus } from '../components/AutomationStatus';
import { AppLogo, BRAND_NAMES } from '../components/Brand';
import { BridgeSetup } from '../components/BridgeSetup';
import { ContentEditor } from '../components/ContentEditor';
import { EnginePicker, EngineSetup } from '../components/EngineSetup';
import { LinkInput } from '../components/LinkInput';
import { MediaUploader, type PendingUpload } from '../components/MediaUploader';
import { MetaPagePicker } from '../components/MetaPagePicker';
import { PlatformTabs } from '../components/PlatformTabs';
import { PlatformSelector } from '../components/PlatformSelector';
import { SettingsMenu } from '../components/SettingsMenu';
import { YouTubeChannelPicker } from '../components/YouTubeChannelPicker';
import { PostStrip } from '../components/PostStrip';
import { useBatch } from '../hooks/useBatch';
import { ACTIVE_STATUSES, type BrowserState, type JobSnapshot } from '../types/platform';

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.posts?.length) {
    return `${e.message} ${e.posts.map((x) => `${x.title}: ${x.messages.join(' ')}`).join(' · ')}`;
  }
  if (e instanceof ApiError && Array.isArray(e.details)) {
    const lines = (e.details as ({ destination: string; messages: string[] } | string)[]).map((d) => (typeof d === 'string' ? d : `${d.destination}: ${d.messages.join(' ')}`));
    return `${e.message} ${lines.join(' · ')}`;
  }
  return (e as Error).message;
}

type EngineState = 'checking' | 'up' | 'down';

export function Dashboard() {
  const { posts, activeId, draft, update, updatePlatform, updateAll, addPost, duplicatePost, removePost, renamePost, select } = useBatch();

  /** Delete a post, and any of its media files that no remaining post uses. */
  const deletePost = (id: string) =>
    run(async () => {
      const gone = posts.find((p) => p.id === id);
      removePost(id);
      if (!gone) return;
      const keptIds = new Set(posts.filter((p) => p.id !== id).flatMap((p) => p.draft.media.map((m) => m.id)));
      await Promise.all(gone.draft.media.filter((m) => !keptIds.has(m.id)).map((m) => api.removeMedia(m.id).catch(() => undefined)));
    });
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [engine, setEngine] = useState<EngineState>('checking');
  const [engineChoices, setEngineChoices] = useState<EngineInfo[] | null>(null);
  const [metaPages, setMetaPages] = useState<MetaPage[]>([]);
  const [ytChannels, setYtChannels] = useState<YouTubeChannel[]>([]);

  /** Keep the ticked Pages in sync with the saved list (renamed/removed Pages, Instagram flags). */
  const applyMetaPages = useCallback(
    (pages: MetaPage[]) => {
      setMetaPages(pages);
      update((d) => ({ ...d, meta: { ...d.meta, pages: pages.filter((p) => d.meta.pages.some((s) => s.name === p.name)) } }));
    },
    [update],
  );

  /** Keep the chosen channel valid when the list changes. */
  const applyYtChannels = useCallback(
    (channels: YouTubeChannel[]) => {
      setYtChannels(channels);
      update((d) => (d.youtube.channel && !channels.some((c) => c.name === d.youtube.channel) ? { ...d, youtube: { ...d.youtube, channel: '' } } : d));
    },
    [update],
  );

  // Find the engine, then load what it knows (media, Pages, channels).
  useEffect(() => {
    let alive = true;
    connectEngine()
      .then((choices) => {
        if (!alive) return;
        if (choices) return setEngineChoices(choices);
        setEngine('up');
        // The engine may have restarted (it clears uploads): drop references to files it no longer has.
        api.listMedia().then((media) =>
          updateAll((d) => {
            const ids = new Set(media.map((m) => m.id));
            // Each post keeps only the media it already referenced that still exists.
            const mine = d.media.filter((m) => ids.has(m.id));
            const mineIds = new Set(mine.map((m) => m.id));
            return {
              ...d,
              media: mine,
              coverId: d.coverId && mineIds.has(d.coverId) ? d.coverId : null,
              platforms: Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, v.mediaIds ? { ...v, mediaIds: v.mediaIds.filter((x) => mineIds.has(x)) } : v])) as typeof d.platforms,
            };
          }),
        );
        api.getMetaPages().then(({ pages }) => applyMetaPages(pages));
        api.getYouTubeChannels().then(({ channels }) => applyYtChannels(channels));
      })
      .catch(() => alive && setEngine('down'));
    return () => {
      alive = false;
    };
  }, [updateAll, applyMetaPages, applyYtChannels]);

  useEffect(() => {
    if (engine !== 'up') return;
    const es = new EventSource(api.eventsUrl());
    es.addEventListener('jobs', (e) => setJobs(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('browser', (e) => setBrowser(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => setEngine('up');
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setEngine('down');
    };
    return () => es.close();
  }, [engine]);

  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) setNotice({ kind: 'info', text: success });
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e) });
    }
  }, []);

  const onFiles = useCallback(
    (files: File[], opts: { asCover?: boolean } = {}) => {
      for (const file of files) {
        const key = `${file.name}-${file.size}-${Math.random()}`;
        setPending((p) => [...p, { key, name: file.name, progress: 0 }]);
        (async () => {
          try {
            const hints = await probeMedia(file);
            const item = await api.uploadMedia(file, hints, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
            update((d) => ({ ...d, media: [...d.media, item], coverId: opts.asCover && item.kind === 'image' ? item.id : d.coverId }));
            setPending((p) => p.filter((x) => x.key !== key));
          } catch (e) {
            setPending((p) => p.map((x) => (x.key === key ? { ...x, error: (e as Error).message } : x)));
          }
        })();
      }
    },
    [update],
  );

  /** Does any post other than the active one still use this media file? */
  const usedElsewhere = useCallback((id: string) => posts.some((p) => p.id !== activeId && p.draft.media.some((m) => m.id === id)), [posts, activeId]);

  const removeMedia = (id: string) =>
    run(async () => {
      update((d) => ({
        ...d,
        media: d.media.filter((m) => m.id !== id),
        coverId: d.coverId === id ? null : d.coverId,
        platforms: Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, v.mediaIds ? { ...v, mediaIds: v.mediaIds.filter((x) => x !== id) } : v])) as typeof d.platforms,
      }));
      // Keep the file in the engine while another post (e.g. a duplicate) still references it.
      if (!usedElsewhere(id)) await api.removeMedia(id);
    });

  const moveMedia = (id: string, dir: -1 | 1) =>
    update((d) => {
      const media = [...d.media];
      const i = media.findIndex((m) => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= media.length) return d;
      [media[i], media[j]] = [media[j], media[i]];
      const order = media.map((m) => m.id);
      const platforms = Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, v.mediaIds ? { ...v, mediaIds: order.filter((x) => v.mediaIds!.includes(x)) } : v])) as typeof d.platforms;
      return { ...d, media, platforms };
    });

  const importMedia = async (url: string) => {
    const item = await api.importMedia(url);
    update((d) => ({ ...d, media: [...d.media, item], link: d.link.url.trim() === url ? { ...d.link, url: '' } : d.link }));
    setNotice({ kind: 'info', text: `Imported ${item.name} as a media file and cleared it from the link field.` });
  };

  const clearContent = () =>
    run(async () => {
      // Delete only this post's files that no other post uses; leave the shared pool otherwise.
      const orphans = draft.media.filter((m) => !usedElsewhere(m.id)).map((m) => m.id);
      await Promise.all(orphans.map((id) => api.removeMedia(id).catch(() => undefined)));
      update((d) => ({
        ...d,
        sharedText: '',
        link: { url: '', mode: d.link.mode },
        media: [],
        coverId: null,
        youtube: { ...d.youtube, title: '' },
        platforms: Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, { ...emptyPlatformConfig(v.enabled) }])) as typeof d.platforms,
      }));
      setPending([]);
      setConfirmClear(false);
    }, 'This post was cleared. Other posts and anything already prepared are untouched.');

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const selected = enabledDestinations(draft);

  // Across all posts.
  const problems = useMemo(() => batchProblems(posts), [posts]);
  const problemIds = useMemo(() => Object.fromEntries(problems.map((x) => [x.postId, true])), [problems]);
  const batchPlans = useMemo(() => planBatch(posts), [posts]);
  const activePostCount = useMemo(() => posts.filter((pp) => enabledDestinations(pp.draft).length > 0).length, [posts]);

  const anyActive = jobs.some((j) => ACTIVE_STATUSES.includes(j.status));
  const uploading = pending.some((p) => !p.error);
  const canPrepare = batchPlans.length > 0 && problems.length === 0 && !uploading && engine === 'up';

  // Not remembered: every visit starts with Auto-publish off.
  const [autoPublish, setAutoPublish] = useState(false);
  const toggleAutoPublish = (on: boolean) => {
    if (on && !window.confirm('Turn on Auto-publish?\n\nPrepost will press Post / Publish / Share on every selected platform as soon as each post passes all its checks. The posts go live without a final review by you.\n\nIf any check can\'t be confirmed, that post is left for you to publish yourself.')) return;
    setAutoPublish(on);
  };

  const prepare = () =>
    run(async () => {
      setNotice(null);
      await api.prepareBatch(
        posts.map(({ id, title, draft: d }) => ({ id, title, draft: d })),
        autoPublish,
      );
      document.getElementById('progress')?.scrollIntoView({ behavior: 'smooth' });
    });

  if (IS_HOSTED && engine === 'down') return <EngineSetup onRetry={() => window.location.reload()} />;
  if (engineChoices) return <EnginePicker engines={engineChoices} />;

  const connectionChip =
    engine !== 'up' ? (
      <span className="chip is-off">Engine offline</span>
    ) : browser?.mode === 'extension' ? (
      <span className={`chip ${browser.bridge.extensionConnected ? 'is-on' : 'is-off'}`}>{browser.bridge.extensionConnected ? 'Chrome connected' : 'Extension not connected'}</span>
    ) : (
      <span className={`chip ${browser?.open ? 'is-on' : ''}`}>{browser?.open ? 'Browser ready' : 'Browser closed'}</span>
    );

  // The exact reasons the button is disabled, so it's never a mystery.
  const reasons: string[] = uploading
    ? ['Waiting for the uploads to finish.']
    : batchPlans.length === 0 && problems.length === 0
      ? ['Turn on at least one platform for a post.']
      : problems.flatMap((x) => x.messages.map((m) => (activePostCount > 1 ? `${x.title}: ${m}` : m)));
  const summary = canPrepare ? `${activePostCount} ${activePostCount === 1 ? 'post' : 'posts'} · ${batchPlans.length} ${batchPlans.length === 1 ? 'tab' : 'tabs'} ready` : '';

  return (
    <div className="app">
      <a className="skip-link" href="#compose">
        Skip to the editor
      </a>
      <header className="topbar">
        <div className="brand">
          <AppLogo />
          <span className="brand-name">Prepost</span>
        </div>
        {connectionChip}
        <div className="topbar-actions">
          <SettingsMenu browser={browser} busy={anyActive} run={run} />
          {confirmClear ? (
            <div className="confirm-inline" role="group" aria-label="Confirm clearing">
              <span>Clear this post?</span>
              <button type="button" className="btn small danger" onClick={clearContent}>
                Clear
              </button>
              <button type="button" className="btn small ghost" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost" onClick={() => setConfirmClear(true)}>
              <BroomIcon size={18} aria-hidden />
              <span>Clear</span>
            </button>
          )}
        </div>
      </header>

      {browser?.mode === 'extension' && !browser.bridge.extensionConnected && <BridgeSetup browser={browser} />}
      {!IS_HOSTED && engine === 'down' && (
        <div className="banner error" role="alert">
          <WarningCircleIcon size={18} aria-hidden /> The engine isn't running. Start it with <code>npm start</code>, then reload this page.
        </div>
      )}
      {notice && (
        <div className={`banner ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="btn icon ghost" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <XIcon size={16} />
          </button>
        </div>
      )}

      <PostStrip
        posts={posts}
        activeId={activeId}
        errors={problemIds}
        onSelect={select}
        onAdd={addPost}
        onDuplicate={duplicatePost}
        onRemove={deletePost}
        onRename={renamePost}
      />

      <main className="workspace">
        <section className="card compose" id="compose" aria-labelledby="compose-title">
          <header className="step-head">
            <span className="step-num">1</span>
            <div>
              <h2 id="compose-title" className="card-title">Write your post</h2>
              <p className="step-sub">Text, an optional link, and photos or videos.</p>
            </div>
          </header>
          <ContentEditor value={draft.sharedText} onChange={(sharedText) => update((d) => ({ ...d, sharedText }))} showXCount={draft.platforms.x.enabled} />
          <LinkInput link={draft.link} onChange={(link) => update((d) => ({ ...d, link }))} onImportAsMedia={importMedia} />
          <MediaUploader
            media={draft.media}
            coverId={draft.coverId}
            onSetCover={(coverId) => update((d) => ({ ...d, coverId }))}
            onUploadCover={(file) => onFiles([file], { asCover: true })}
            pending={pending}
            onFiles={onFiles}
            onRemove={removeMedia}
            onMove={moveMedia}
            onDismissPending={(key) => setPending((p) => p.filter((x) => x.key !== key))}
          />
        </section>

        <aside className="card destinations" aria-labelledby="dest-title">
          <header className="step-head">
            <span className="step-num">2</span>
            <div>
              <h2 id="dest-title" className="card-title">Choose where to post</h2>
              <p className="step-sub">Turn on each platform for this post.</p>
            </div>
          </header>
          <PlatformSelector
            platforms={draft.platforms}
            onToggle={(d, enabled) =>
              update((x) => {
                const next = { ...x, platforms: { ...x.platforms, [d]: { ...x.platforms[d], enabled } } };
                // Turning YouTube on for a post without any video: default to an image/text post.
                if (d === 'youtube' && enabled && !x.media.some((m) => m.kind === 'video')) next.youtube = { ...x.youtube, postType: 'post' };
                return next;
              })
            }
            metaPagePicker={
              <MetaPagePicker
                pages={metaPages}
                selected={draft.meta.pages}
                onSelect={(pages) => update((d) => ({ ...d, meta: { ...d.meta, pages } }))}
                onSavePages={(pages) => run(async () => applyMetaPages((await api.saveMetaPages(pages)).pages))}
                onLoadFromBusinessSuite={async () => applyMetaPages((await api.refreshMetaPages()).pages)}
              />
            }
            youtubeChannelPicker={
              <YouTubeChannelPicker
                channels={ytChannels}
                selected={draft.youtube.channel}
                onSelect={(channel) => update((d) => ({ ...d, youtube: { ...d.youtube, channel } }))}
                onSaveChannels={(channels) => run(async () => applyYtChannels((await api.saveYouTubeChannels(channels)).channels))}
                onLoadFromYouTube={async () => applyYtChannels((await api.refreshYouTubeChannels()).channels)}
              />
            }
          />
        </aside>
      </main>

      {selected.length > 0 && (
        <section className="card review" aria-labelledby="review-title">
          <header className="step-head">
            <span className="step-num">3</span>
            <div>
              <h2 id="review-title" className="card-title">Review each platform</h2>
              <p className="step-sub">What will be filled in, with any warnings.</p>
            </div>
          </header>
          <PlatformTabs destinations={selected} draft={draft} validation={validation} onPlatformChange={updatePlatform} onDraftChange={update} />
        </section>
      )}

      <div className="action-bar">
        {canPrepare ? (
          <p className="action-summary">{summary}</p>
        ) : (
          <div className="action-blockers">
            <strong>To prepare, fix:</strong>
            <ul>
              {reasons.slice(0, 4).map((r) => (
                <li key={r}>{r}</li>
              ))}
              {reasons.length > 4 && <li>and {reasons.length - 4} more…</li>}
            </ul>
          </div>
        )}
        <div className="action-go">
          <label className={`publish-switch${autoPublish ? ' is-on' : ''}`} title="Press Post / Publish / Share automatically when every check passes">
            <input type="checkbox" role="switch" className="switch" checked={autoPublish} onChange={(e) => toggleAutoPublish(e.target.checked)} />
            <span>Auto-publish{autoPublish ? ' ON' : ''}</span>
          </label>
          <button type="button" className={`btn primary large${autoPublish ? ' publish' : ''}`} disabled={!canPrepare} onClick={prepare}>
            <PaperPlaneTiltIcon size={18} weight="bold" aria-hidden />
            {autoPublish
              ? activePostCount > 1 ? `Prepare & publish all (${activePostCount})` : 'Prepare & publish'
              : activePostCount > 1 ? `Prepare all posts (${activePostCount})` : 'Prepare posts'}
          </button>
        </div>
      </div>

      <section className="card progress" id="progress" aria-labelledby="progress-title">
        <div className="card-head">
          <header className="step-head">
            <span className="step-num">4</span>
            <div>
              <h2 id="progress-title" className="card-title">Prepare &amp; review in your browser</h2>
              <p className="step-sub">Each post opens in its own tab, ready for you to publish.</p>
            </div>
          </header>
          {jobs.some((j) => !ACTIVE_STATUSES.includes(j.status)) && (
            <button type="button" className="btn small ghost" onClick={() => run(api.clearFinished)}>
              Clear finished
            </button>
          )}
        </div>
        <AutomationStatus
          jobs={jobs}
          onRetry={(id) => run(() => api.retry(id))}
          onContinue={(id) => run(() => api.continueJob(id))}
          onCancel={(id) => run(() => api.cancel(id))}
          onFocus={(id) => run(() => api.focus(id))}
          onDismiss={(id) => run(() => api.dismiss(id))}
        />
      </section>

      <footer className="footnote">
        {autoPublish
          ? 'Auto-publish is on: each post is published as soon as all its checks pass. Posts with an unconfirmed check wait in their tab for you.'
          : "Prepost doesn't publish unless you turn on Auto-publish. Each post waits in its tab until you review it and press the platform's own Publish button."}
      </footer>
    </div>
  );
}
