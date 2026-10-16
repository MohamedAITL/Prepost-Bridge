import { useCallback, useEffect, useMemo, useState } from 'react';
import { BroomIcon, ListChecksIcon, PaperPlaneTiltIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { emptyPlatformConfig, type MetaPage, type YouTubeChannel } from '../../shared/types';
import { enabledDestinations, hasErrors, planJobs, validateDraft } from '../../shared/validation';
import { ApiError, IS_HOSTED, api, probeMedia } from '../api';
import { AutomationStatus } from '../components/AutomationStatus';
import { AppLogo, BRAND_NAMES } from '../components/Brand';
import { BridgeSetup } from '../components/BridgeSetup';
import { ContentEditor } from '../components/ContentEditor';
import { EngineSetup } from '../components/EngineSetup';
import { LinkInput } from '../components/LinkInput';
import { MediaUploader, type PendingUpload } from '../components/MediaUploader';
import { MetaPagePicker } from '../components/MetaPagePicker';
import { PlatformTabs } from '../components/PlatformTabs';
import { PlatformSelector } from '../components/PlatformSelector';
import { SettingsMenu } from '../components/SettingsMenu';
import { YouTubeChannelPicker } from '../components/YouTubeChannelPicker';
import { useDraft } from '../hooks/useDraft';
import { ACTIVE_STATUSES, type BrowserState, type JobSnapshot, type ModuleId } from '../types/platform';

function errorText(e: unknown): string {
  if (e instanceof ApiError && Array.isArray(e.details)) {
    const lines = (e.details as ({ destination: string; messages: string[] } | string)[]).map((d) => (typeof d === 'string' ? d : `${d.destination}: ${d.messages.join(' ')}`));
    return `${e.message} ${lines.join(' · ')}`;
  }
  return (e as Error).message;
}

type EngineState = 'checking' | 'up' | 'down';

export function Dashboard() {
  const { draft, update, updatePlatform } = useDraft();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [engine, setEngine] = useState<EngineState>('checking');
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
    api
      .health()
      .then(() => {
        if (!alive) return;
        setEngine('up');
        api.listMedia().then((media) => update((d) => ({ ...d, media })));
        api.getMetaPages().then(({ pages }) => applyMetaPages(pages));
        api.getYouTubeChannels().then(({ channels }) => applyYtChannels(channels));
      })
      .catch(() => alive && setEngine('down'));
    return () => {
      alive = false;
    };
  }, [update, applyMetaPages, applyYtChannels]);

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

  const removeMedia = (id: string) =>
    run(async () => {
      await api.removeMedia(id);
      update((d) => ({
        ...d,
        media: d.media.filter((m) => m.id !== id),
        coverId: d.coverId === id ? null : d.coverId,
        platforms: Object.fromEntries(Object.entries(d.platforms).map(([k, v]) => [k, v.mediaIds ? { ...v, mediaIds: v.mediaIds.filter((x) => x !== id) } : v])) as typeof d.platforms,
      }));
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
      await api.clearMedia();
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
    }, 'Content cleared. Posts already prepared in your browser are not affected.');

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const selected = enabledDestinations(draft);
  const blocking = selected.filter((d) => hasErrors(validation[d]));
  const plans = useMemo(() => planJobs(draft), [draft]);
  const anyActive = jobs.some((j) => ACTIVE_STATUSES.includes(j.status));
  const uploading = pending.some((p) => !p.error);
  const canPrepare = selected.length > 0 && blocking.length === 0 && !uploading && engine === 'up';

  const prepare = () =>
    run(async () => {
      setNotice(null);
      await api.prepare(draft);
      document.getElementById('progress')?.scrollIntoView({ behavior: 'smooth' });
    });

  if (IS_HOSTED && engine === 'down') return <EngineSetup onRetry={() => window.location.reload()} />;

  const connectionChip =
    engine !== 'up' ? (
      <span className="chip is-off">Engine offline</span>
    ) : browser?.mode === 'extension' ? (
      <span className={`chip ${browser.bridge.extensionConnected ? 'is-on' : 'is-off'}`}>{browser.bridge.extensionConnected ? 'Chrome connected' : 'Extension not connected'}</span>
    ) : (
      <span className={`chip ${browser?.open ? 'is-on' : ''}`}>{browser?.open ? 'Browser ready' : 'Browser closed'}</span>
    );

  const summary =
    selected.length === 0
      ? 'Choose where to post.'
      : blocking.length
        ? `Fix ${blocking.map((d) => BRAND_NAMES[d]).join(', ')} first.`
        : uploading
          ? 'Waiting for uploads to finish…'
          : `${plans.length} ${plans.length === 1 ? 'tab' : 'tabs'}: ${plans.map((p) => p.metaPage ?? BRAND_NAMES[p.targets[0]]).join(', ')}`;

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
              <span>Clear text and media?</span>
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

      <main className="workspace">
        <section className="card compose" id="compose" aria-labelledby="compose-title">
          <h2 id="compose-title" className="card-title">
            Your post
          </h2>
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
          <h2 id="dest-title" className="card-title">
            Post to
          </h2>
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
            onOpenPlatform={(m: ModuleId) => run(() => api.openPlatform(m))}
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
          <h2 id="review-title" className="card-title">
            Check each platform
          </h2>
          <PlatformTabs destinations={selected} draft={draft} validation={validation} onPlatformChange={updatePlatform} onDraftChange={update} />
        </section>
      )}

      <div className="action-bar">
        <p className={`action-summary${blocking.length ? ' is-error' : ''}`}>{summary}</p>
        <button type="button" className="btn primary large" disabled={!canPrepare} onClick={prepare}>
          <PaperPlaneTiltIcon size={18} weight="bold" aria-hidden />
          Prepare posts
        </button>
      </div>

      <section className="card progress" id="progress" aria-labelledby="progress-title">
        <div className="card-head">
          <h2 id="progress-title" className="card-title">
            <ListChecksIcon size={20} aria-hidden /> Progress
          </h2>
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

      <footer className="footnote">Prepost never publishes. Each post waits in its tab until you review it and press the platform's own Publish button.</footer>
    </div>
  );
}
