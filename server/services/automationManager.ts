import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { ACTIVE_STATUSES, type JobCheck, type JobSnapshot, type JobStatus } from '../../shared/jobs';
import { DESTINATION_LABELS, MODULE_LABELS, type BatchPost, type Draft, type MetaPage, type ModuleId, type YouTubeChannel } from '../../shared/types';
import { batchProblems, buildDestinationContent, hasErrors, planBatch, planJobs, wordpressArticle, type JobPlan, type PostProblem } from '../../shared/validation';
import { browserManager } from '../browser/browserManager';
import { StepError } from '../automation/helpers';
import { publishClick, SafetyError } from '../automation/safeActions';
import { metaModule, readMetaPages } from '../platforms/meta';
import { tiktokStudioModule } from '../platforms/tiktokStudio';
import type { JobContent, PlatformModule, PrepareContext, WaitForUserOptions } from '../platforms/types';
import { xModule } from '../platforms/x';
import { readYouTubeChannels, youtubeStudioModule } from '../platforms/youtubeStudio';
import { wordpressModule } from '../platforms/wordpress';
import { logger } from '../utils/logger';
import { cdpRelay } from '../bridge/cdpRelay';
import { savePageOutline } from '../utils/diagnostics';
import { mediaStore } from './mediaStore';

export const MODULES: Record<ModuleId, PlatformModule> = {
  meta: metaModule,
  x: xModule,
  youtube: youtubeStudioModule,
  tiktok: tiktokStudioModule,
  wordpress: wordpressModule,
};

function planLabel(plan: JobPlan, draft?: Draft): string {
  const prefix = plan.postTitle ? `${plan.postTitle} · ` : '';
  return prefix + planBody(plan, draft);
}

function planBody(plan: JobPlan, draft?: Draft): string {
  if (plan.moduleId === 'youtube' && draft) {
    const kind = draft.youtube.postType === 'post' ? 'post' : 'video';
    return draft.youtube.channel ? `YouTube: ${draft.youtube.channel} (${kind})` : `YouTube (${kind})`;
  }
  if (plan.moduleId !== 'meta') return MODULE_LABELS[plan.moduleId];
  const where = plan.targets.includes('instagram') ? 'Facebook + Instagram' : 'Facebook';
  return `${plan.metaPage || 'Meta'} (${where})`;
}

function samePlan(a: JobPlan, b: JobPlan) {
  return a.moduleId === b.moduleId && a.targets.join() === b.targets.join() && (a.metaPage ?? '') === (b.metaPage ?? '') && (a.postId ?? '') === (b.postId ?? '');
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export class ValidationFailure extends Error {
  constructor(public details: { destination: string; messages: string[] }[]) {
    super('Some destinations have errors.');
  }
}

/** Per-post validation failures for a batch. */
export class BatchFailure extends Error {
  constructor(public posts: PostProblem[]) {
    super('Some posts have errors.');
  }
}

interface Job {
  snap: JobSnapshot;
  plan: JobPlan;
  draft: Draft;
  page: Page | null;
  /** Extension mode: the Chrome tab id, kept after the tab is released so it can still be shown. */
  bridgeTabId: number | null;
  released: boolean;
  /** Scheduler: the job has been taken off the queue and started. */
  started: boolean;
  /** Set while this job's tab is shown for an upload. */
  foreground: { restore: () => Promise<void>; release: () => void } | null;
  cancelled: boolean;
  resume: (() => void) | null;
  abortWait: ((e: Error) => void) | null;
  /** The user switched auto-publish on for this batch: press the final button once every check passes. */
  publish: boolean;
  /** showTab() was asked for and hideTab() hasn't been called yet (the tab may still be waiting its turn). */
  wantsForeground: boolean;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), ms)));
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/**
 * Runs one independent job per destination group. Each job gets its own tab in the shared
 * persistent browser; a failure in one never affects the others.
 */
/** Which tab a job runs in: one per platform (one per Meta Page), reused across runs. */
function tabKey(plan: JobPlan): string {
  const post = plan.postId ?? 'single';
  return plan.moduleId === 'meta' ? `post:${post}:meta:${plan.metaPage ?? ''}` : `post:${post}:${plan.moduleId}`;
}

/** How many jobs of each module may run at the same time. YouTube's active channel and TikTok's
 *  single upload draft are browser-wide, so those run one at a time. */
const MODULE_LIMITS: Record<ModuleId, number> = { youtube: 1, tiktok: 1, meta: 3, x: 2, wordpress: 2 };
const MAX_CONCURRENT = 6;

class AutomationManager extends EventEmitter {
  private jobs = new Map<string, Job>();
  /** The platform tabs: kept open and reused instead of opening/closing tabs every run. */
  private platformTabs = new Map<string, { page: Page | null; bridgeTabId: number | null }>();

  /** Reuse this platform's tab when it still exists; otherwise open one (in the background). */
  private async acquireTab(key: string): Promise<Page> {
    const slot = this.platformTabs.get(key);
    let page: Page | null = null;
    if (slot?.page && !slot.page.isClosed()) page = slot.page;
    else if (slot?.bridgeTabId != null && browserManager.currentMode === 'extension') {
      page = await browserManager.adoptBridgeTab(slot.bridgeTabId).catch((e) => {
        logger.info('browser', `Could not reuse the ${key} tab (${(e as Error).message}); opening a new one`);
        return null;
      });
    }
    page ??= await browserManager.newPage({ background: true });
    const tagged = page as Page & { __dialogs?: boolean };
    if (!tagged.__dialogs) {
      tagged.__dialogs = true;
      // Re-preparing in the same tab replaces the previous draft: accept "Leave page?" prompts.
      page.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => undefined));
    }
    this.platformTabs.set(key, { page, bridgeTabId: browserManager.bridgeTabId(page) ?? slot?.bridgeTabId ?? null });
    return page;
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map((j) => j.snap);
  }

  private emitChange() {
    this.emit('change', this.list());
  }

  /** Resolve media ids against the server-side store; the client's metadata is never trusted for paths. */
  private buildContent(plan: JobPlan, draft: Draft): JobContent {
    const serverDraft: Draft = {
      ...draft,
      media: draft.media.map((m) => {
        const stored = mediaStore.get(m.id);
        if (!stored) throw new Error(`Media "${m.name}" is no longer available. Remove it and add it again.`);
        const { filePath: _p, ...item } = stored;
        return { ...item, width: m.width ?? item.width, height: m.height ?? item.height, durationSec: m.durationSec ?? item.durationSec };
      }),
    };
    const first = buildDestinationContent(serverDraft, plan.targets[0]);
    // Meta: the 'facebook' content already includes the rules of linked Instagram accounts.
    for (const t of plan.moduleId === 'meta' ? (['facebook'] as const) : plan.targets) {
      const c = buildDestinationContent(serverDraft, t);
      if (hasErrors(c)) throw new ValidationFailure([{ destination: planLabel(plan), messages: c.issues.filter((i) => i.level === 'error').map((i) => i.message) }]);
    }
    const resolve = (id: string) => ({ item: serverDraft.media.find((m) => m.id === id)!, path: mediaStore.get(id)!.filePath });
    const article = plan.moduleId === 'wordpress' ? wordpressArticle(serverDraft) : null;
    return {
      targets: plan.targets,
      text: first.text,
      media: first.media.map((m) => resolve(m.id)),
      title: first.title,
      thumbnail: first.thumbnail ? resolve(first.thumbnail.id) : null,
      youtube: plan.moduleId === 'youtube' ? draft.youtube : undefined,
      meta: plan.moduleId === 'meta' ? { confirmDestinations: draft.meta.confirmDestinations, videoAs: draft.meta.videoAs, page: plan.metaPage ?? '' } : undefined,
      wordpress: article
        ? { postType: draft.wordpress.postType, tags: article.tags, categories: draft.wordpress.categories, options: draft.wordpress.options, videoUrl: article.videoUrl }
        : undefined,
    };
  }

  /** Single post (kept for the old API shape). */
  prepare(draft: Draft): JobSnapshot[] {
    return this.prepareBatch([{ id: 'single', title: '', draft }]);
  }

  /** Several independent posts, each prepared on its own platforms; `publish` = auto-publish switched on. */
  prepareBatch(posts: BatchPost[], publish = false): JobSnapshot[] {
    const plans = planBatch(posts);
    if (plans.length === 0) throw new BatchFailure([{ postId: 'all', title: 'All', messages: ['Select at least one destination in a post.'] }]);

    // Per-post validation (content rules, plus the one-YouTube-channel rule).
    const problems = batchProblems(posts);
    // Resolving media server-side can also fail (a file was removed); attach that per post.
    const byId = new Map(posts.map((p) => [p.id, p]));
    for (const plan of plans) {
      try {
        this.buildContent(plan, byId.get(plan.postId!)!.draft);
      } catch (e) {
        const msg = e instanceof ValidationFailure ? e.details.flatMap((d) => d.messages).join(' ') : (e as Error).message;
        const found = problems.find((x) => x.postId === plan.postId);
        if (found) found.messages.push(msg);
        else problems.push({ postId: plan.postId!, title: plan.postTitle ?? '', messages: [msg] });
      }
    }
    if (problems.length) throw new BatchFailure(problems);

    const busy = [...this.jobs.values()].find((j) => plans.some((p) => samePlan(j.plan, p)) && ACTIVE_STATUSES.includes(j.snap.status));
    if (busy) throw new BatchFailure([{ postId: busy.snap.postId, title: busy.snap.postTitle, messages: [`"${busy.snap.label}" is still being prepared. Wait for it or cancel it first.`] }]);

    // Replace finished jobs for the same post × destination (their tabs stay open and are reused).
    for (const [id, job] of this.jobs) {
      if (plans.some((p) => samePlan(p, job.plan))) this.jobs.delete(id);
    }

    const created = plans.map((plan) => this.createJob(plan, byId.get(plan.postId!)!.draft, publish));
    this.emitChange();
    this.pump();
    return created.map((j) => j.snap);
  }

  // ---- concurrency scheduler ----

  /** Jobs waiting for a turn, in submission order. */
  private queue: Job[] = [];

  private runningByModule(moduleId: ModuleId): number {
    return [...this.jobs.values()].filter((j) => j.started && j.plan.moduleId === moduleId && ACTIVE_STATUSES.includes(j.snap.status)).length;
  }

  private totalRunning(): number {
    return [...this.jobs.values()].filter((j) => j.started && ACTIVE_STATUSES.includes(j.snap.status)).length;
  }

  /** Start as many queued jobs as the limits allow. */
  private pump() {
    for (const job of this.jobs.values()) if (!job.started && !this.queue.includes(job)) this.queue.push(job);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < this.queue.length; i++) {
        const job = this.queue[i];
        if (job.cancelled) {
          this.queue.splice(i, 1);
          this.update(job, { status: 'cancelled', message: 'Cancelled. Nothing was published.' });
          progressed = true;
          break;
        }
        if (this.totalRunning() >= MAX_CONCURRENT) return;
        if (this.runningByModule(job.plan.moduleId) >= MODULE_LIMITS[job.plan.moduleId]) continue;
        this.queue.splice(i, 1);
        job.started = true;
        void this.run(job).finally(() => this.pump());
        progressed = true;
        break;
      }
    }
  }

  private createJob(plan: JobPlan, draft: Draft, publish: boolean): Job {
    const label = planLabel(plan, draft);
    const now = Date.now();
    const job: Job = {
      plan,
      draft: structuredClone(draft),
      page: null,
      bridgeTabId: null,
      released: false,
      started: false,
      foreground: null,
      cancelled: false,
      resume: null,
      abortWait: null,
      publish,
      wantsForeground: false,
      snap: {
        id: crypto.randomUUID(),
        moduleId: plan.moduleId,
        targets: plan.targets,
        postId: plan.postId ?? 'single',
        postTitle: plan.postTitle ?? '',
        label,
        status: 'waiting',
        progress: 0,
        message: 'Waiting for its turn…',
        currentStep: null,
        failedStep: null,
        error: null,
        checks: [],
        awaitingUser: null,
        hasPage: false,
        startedAt: now,
        updatedAt: now,
        logs: [],
      },
    };
    this.jobs.set(job.snap.id, job);
    return job;
  }

  private update(job: Job, patch: Partial<JobSnapshot>) {
    job.snap = { ...job.snap, ...patch, updatedAt: Date.now() };
    this.emitChange();
  }

  private jobLog(job: Job, message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const entry = logger[level](`job:${job.plan.moduleId}`, message);
    const logs = [...job.snap.logs, { ts: entry.ts, level, message: entry.message }].slice(-200);
    this.update(job, { logs });
  }

  private makeContext(job: Job, page: Page, content: JobContent): PrepareContext {
    const throwIfCancelled = () => {
      if (job.cancelled) throw new CancelledError();
    };
    return {
      page,
      content,
      throwIfCancelled,
      setStatus: (status: JobStatus, message: string, progress?: number) => {
        throwIfCancelled();
        if (status !== job.snap.status || message !== job.snap.message) {
          if (status !== job.snap.status) this.jobLog(job, `${status}: ${message}`);
          this.update(job, { status, message, progress: progress ?? job.snap.progress });
        }
      },
      log: (message, level = 'info') => this.jobLog(job, message, level),
      check: (label: string, state: JobCheck['state'], detail?: string) => {
        const checks = [...job.snap.checks.filter((c) => c.label !== label), { label, state, detail }];
        this.update(job, { checks });
        this.jobLog(job, `Check "${label}": ${state}${detail ? ` (${detail})` : ''}`, state === 'fail' ? 'warn' : 'info');
      },
      step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        throwIfCancelled();
        this.update(job, { currentStep: name });
        this.jobLog(job, `Step: ${name}`);
        try {
          const result = await fn();
          // Cleared so an error outside any step isn't blamed on the last step that succeeded.
          if (job.snap.currentStep === name) this.update(job, { currentStep: null });
          return result;
        } catch (e) {
          if (e instanceof StepError || e instanceof SafetyError || e instanceof CancelledError) throw e;
          throw new StepError(name, e);
        }
      },
      waitForUser: (message: string, opts: WaitForUserOptions = {}) => this.waitForUser(job, message, opts),
      snapshot: (label: string) => this.saveDiagnostics(job, label),
      showTab: (reason: string) => this.showTab(job, page, reason),
      hideTab: () => this.hideTab(job),
      publishClick: (locator, purpose) => {
        throwIfCancelled();
        this.jobLog(job, `Pressing "${purpose}" (auto-publish is on)`, 'warn');
        return publishClick(locator, purpose, job.publish);
      },
    };
  }

  /** Uploads take turns at being the visible tab. */
  private foregroundQueue: Promise<void> = Promise.resolve();

  /**
   * Ask for this job's tab to be shown while its upload runs. Doesn't hold the job up: the upload
   * starts right away (the extension keeps hidden tabs awake) and the tab comes to the front when
   * it's this job's turn. hideTab() before the turn arrives cancels the request.
   */
  private async showTab(job: Job, page: Page, reason: string) {
    if (job.foreground || job.wantsForeground || page.isClosed()) return;
    job.wantsForeground = true;
    let release!: () => void;
    const turn = this.foregroundQueue;
    this.foregroundQueue = new Promise<void>((r) => (release = r));
    void (async () => {
      await turn;
      if (!job.wantsForeground || job.cancelled || page.isClosed()) return release();
      try {
        const restore = await browserManager.showTab(page);
        if (!job.wantsForeground) {
          // The upload finished while the tab was being shown.
          await withTimeout(restore(), 10_000).catch(() => undefined);
          return release();
        }
        job.foreground = { restore, release };
        this.jobLog(job, `Showing this tab while ${reason} (Chrome pauses uploads in hidden tabs)`);
      } catch (e) {
        release();
        this.jobLog(job, `Could not show the tab: ${(e as Error).message}`, 'warn');
      }
    })();
  }

  private async hideTab(job: Job) {
    job.wantsForeground = false;
    const fg = job.foreground;
    if (!fg) return;
    job.foreground = null;
    // Bounded: a tab that can't be switched back must not hold up every later upload.
    await withTimeout(fg.restore(), 10_000).catch(() => undefined);
    fg.release();
  }

  private waitForUser(job: Job, message: string, opts: WaitForUserOptions): Promise<void> {
    if (job.cancelled) return Promise.reject(new CancelledError());
    const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
    this.update(job, { awaitingUser: message });
    this.jobLog(job, `Waiting for you: ${message}`);
    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      let poll: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        job.resume = null;
        job.abortWait = null;
        this.update(job, { awaitingUser: null });
      };
      job.resume = () => {
        cleanup();
        resolve();
      };
      job.abortWait = (e) => {
        cleanup();
        reject(e);
      };
      timer = setTimeout(() => job.abortWait?.(new Error('Timed out waiting for your action in the browser.')), timeoutMs);
      if (opts.until) {
        let checking = false;
        poll = setInterval(async () => {
          if (checking) return;
          checking = true;
          try {
            if (await opts.until!()) job.resume?.();
          } catch {
            /* page navigating; check again */
          } finally {
            checking = false;
          }
        }, 1500);
      }
    });
  }

  private async run(job: Job) {
    const mod = MODULES[job.plan.moduleId];
    try {
      const content = this.buildContent(job.plan, job.draft);
      this.update(job, { status: 'opening', message: `Opening ${mod.label}…`, progress: 3 });
      const page = await this.acquireTab(tabKey(job.plan));
      job.page = page;
      job.bridgeTabId = browserManager.bridgeTabId(page);
      this.update(job, { hasPage: true });
      page.on('close', () => {
        if (job.page !== page) return;
        job.page = null;
        if (!job.released) this.update(job, { hasPage: false });
        if (ACTIVE_STATUSES.includes(job.snap.status) || job.snap.awaitingUser) job.abortWait?.(new Error('The browser tab was closed.'));
      });
      this.jobLog(job, `Preparing ${job.snap.label}: ${content.media.length} media file(s), ${content.text.length} characters of text`);
      const ctx = this.makeContext(job, page, content);
      await mod.prepare(ctx);

      const failed = job.snap.checks.filter((c) => c.state === 'fail');
      const unverified = job.snap.checks.filter((c) => c.state === 'unverified');
      if (job.publish && !failed.length && !unverified.length) {
        // Auto-publish: only when every check passed.
        ctx.setStatus('publishing', 'Publishing…', 97);
        await ctx.step('Publish', () => mod.publish(ctx));
        this.update(job, { status: 'published', progress: 100, currentStep: null, message: 'Published. Open the tab to see it on the platform.' });
      } else if (job.publish) {
        const why = [...failed, ...unverified].map((c) => c.label).join('; ');
        this.update(job, { status: 'needs_attention', progress: 100, currentStep: null, message: `Not published automatically: ${why} could not be confirmed. Check the post and publish it yourself.` });
      } else if (failed.length) {
        this.update(job, { status: 'needs_attention', progress: 100, currentStep: null, message: `Prepared, but some checks failed: ${failed.map((c) => c.label).join('; ')}. Review the post carefully.` });
      } else {
        this.update(job, {
          status: 'ready',
          progress: 100,
          currentStep: null,
          message: unverified.length ? `Ready for manual review. Please double-check: ${unverified.map((c) => c.label).join('; ')}.` : 'Ready for manual review. Check it, then publish it yourself.',
        });
      }
      this.jobLog(job, `Finished: ${job.snap.status}`);
    } catch (e) {
      const err = e as Error;
      if (err instanceof CancelledError || job.cancelled) {
        this.update(job, { status: 'cancelled', message: 'Cancelled. Nothing was published.', awaitingUser: null });
        this.jobLog(job, 'Cancelled by user', 'warn');
        return;
      }
      const step = err instanceof StepError ? err.step : job.snap.currentStep;
      let message = err.message.split('\n')[0];
      if (/Target page, context or browser has been closed|Target closed|browser has been closed|Frame has been detached|Session closed/i.test(err.message)) message = 'The browser or tab was closed.';
      const reason = job.bridgeTabId != null ? cdpRelay.detachReason(job.bridgeTabId) : null;
      if (reason === 'canceled_by_user') {
        message = 'Chrome\'s "started debugging this browser" bar was cancelled, which stops the automation. Leave that bar alone while a job runs (it goes away when the job finishes), then press Retry.';
      } else if (reason === 'tab_closed') {
        message = 'The tab was closed before the job finished.';
      }
      await this.saveDiagnostics(job);
      if (err instanceof SafetyError) message = `Safety stop: ${err.message}`;
      if (step === 'Publish') message = `${message} The post may already be live: check the platform before publishing again.`;
      if (/setFileInputFiles|Not allowed to read local|file access/i.test(err.message)) {
        message = 'The browser refused to hand the file to the page. Open the extensions page (chrome://extensions or edge://extensions), open Prepost Bridge → Details, turn on "Allow access to file URLs", then press Retry.';
      }
      this.update(job, { status: 'failed', failedStep: step ?? null, error: message, message: `Failed${step ? ` at "${step}"` : ''}: ${message}`, awaitingUser: null });
      this.jobLog(job, `Failed${step ? ` at "${step}"` : ''}: ${message}`, 'error');
    } finally {
      await this.hideTab(job);
      // Extension mode: hand the tab back to the user so Chrome's debugging bar disappears.
      if (job.page && job.bridgeTabId != null) {
        job.released = true;
        await browserManager.releasePage(job.page).catch(() => undefined);
      }
    }
  }

  /**
   * After a failure, save the page's URL and accessibility outline (no cookies, no form values
   * beyond what's shown on screen) locally, so a broken selector can be fixed.
   */
  private async saveDiagnostics(job: Job, label?: string) {
    if (!job.page) return;
    const file = await savePageOutline(job.page, label ?? job.plan.moduleId, `Step: ${job.snap.currentStep ?? ''}`);
    if (file) this.jobLog(job, `Saved a page outline for troubleshooting: ${file}`);
  }

  retry(id: string): JobSnapshot {
    const old = this.jobs.get(id);
    if (!old) throw new Error('Unknown job.');
    if (ACTIVE_STATUSES.includes(old.snap.status)) throw new Error('This job is still running.');
    this.jobs.delete(id);
    // The retry runs in the same platform tab (it's reused, not closed). It never auto-publishes:
    // a failed publish may still have gone live, so a second press could post twice.
    const job = this.createJob(old.plan, old.draft, false);
    this.emitChange();
    this.pump();
    return job.snap;
  }

  continue(id: string) {
    const job = this.jobs.get(id);
    if (!job?.resume) throw new Error('This job is not waiting for you.');
    this.jobLog(job, 'You pressed Continue');
    job.resume();
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    job.cancelled = true;
    const qi = this.queue.indexOf(job);
    if (qi >= 0) this.queue.splice(qi, 1);
    job.abortWait?.(new CancelledError());
    if (!ACTIVE_STATUSES.includes(job.snap.status) && !job.snap.awaitingUser) return;
    this.update(job, { message: 'Cancelling…' });
  }

  async focus(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job.');
    if (job.bridgeTabId != null) return browserManager.focusBridgeTab(job.bridgeTabId);
    if (!job.page) throw new Error('The tab for this job is no longer open.');
    await job.page.bringToFront();
  }

  dismiss(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (ACTIVE_STATUSES.includes(job.snap.status)) throw new Error('Cancel the job before removing it.');
    this.jobs.delete(id);
    this.emitChange();
  }

  /** Called when the browser closes: everything still running stops. */
  abortAll(reason: string) {
    for (const job of this.jobs.values()) {
      job.page = null;
      if (job.snap.hasPage) this.update(job, { hasPage: false });
      if (ACTIVE_STATUSES.includes(job.snap.status)) job.abortWait?.(new Error(reason));
    }
  }

  clearFinished() {
    for (const [id, job] of this.jobs) if (!ACTIVE_STATUSES.includes(job.snap.status)) this.jobs.delete(id);
    this.emitChange();
  }

  /** Any active job of this module (across all posts). */
  private moduleBusy(moduleId: ModuleId): boolean {
    return [...this.jobs.values()].some((j) => j.plan.moduleId === moduleId && ACTIVE_STATUSES.includes(j.snap.status));
  }

  /** Extension mode: hand the tab back (removes Chrome's debugging bar); it stays open for reuse. */
  private async releaseTab(page: Page) {
    if (browserManager.bridgeTabId(page) != null) await browserManager.releasePage(page).catch(() => undefined);
  }

  /** Read the Page list from Business Suite, in an existing Meta tab when there's an idle one. */
  async refreshMetaPages(): Promise<MetaPage[]> {
    if (this.moduleBusy('meta')) throw new Error('A Meta post is being prepared; try again when it has finished.');
    const page = await this.acquireTab('meta:pages');
    try {
      const pages = await readMetaPages(page).catch(async (e) => {
        const file = await savePageOutline(page, 'meta-pages', `Error: ${(e as Error).message}`);
        if (file) logger.warn('meta', `Saved a page outline for troubleshooting: ${file}`);
        throw e;
      });
      logger.info('meta', `Found ${pages.length} Page(s) in Business Suite`);
      return pages;
    } finally {
      await this.releaseTab(page);
    }
  }

  /** Read the channel list from YouTube's channel switcher, in the YouTube tab. */
  async refreshYouTubeChannels(): Promise<YouTubeChannel[]> {
    if (this.moduleBusy('youtube')) throw new Error('A YouTube post is being prepared; try again when it has finished.');
    const page = await this.acquireTab('youtube:channels');
    try {
      const channels = await readYouTubeChannels(page).catch(async (e) => {
        const file = await savePageOutline(page, 'youtube-channels', `Error: ${(e as Error).message}`);
        if (file) logger.warn('youtube', `Saved a page outline for troubleshooting: ${file}`);
        throw e;
      });
      logger.info('youtube', `Found ${channels.length} channel(s)`);
      return channels;
    } finally {
      await this.releaseTab(page);
    }
  }

  /** Show this platform's tab (opening it once if needed), e.g. to sign in. */
  async openPlatform(moduleId: ModuleId) {
    const mod = MODULES[moduleId];
    // If a post on this platform is being prepared, show that tab instead of opening another.
    const running = [...this.jobs.values()].find((j) => j.plan.moduleId === moduleId && ACTIVE_STATUSES.includes(j.snap.status));
    if (running) return this.focus(running.snap.id);
    const page = await this.acquireTab(`${moduleId}:open`);
    // Only navigate when the tab isn't already on this platform (keeps whatever you were doing there).
    if (!page.url().includes(new URL(mod.entryUrl).hostname.replace(/^www\./, ''))) {
      await page.goto(mod.entryUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    const tabId = browserManager.bridgeTabId(page);
    await this.releaseTab(page);
    if (tabId != null) await browserManager.focusBridgeTab(tabId);
    else await page.bringToFront();
    logger.info('browser', `Showing ${mod.label}`);
  }
}

export const automationManager = new AutomationManager();
