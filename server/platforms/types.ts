import type { Locator, Page } from 'playwright';
import type { JobCheck, JobStatus } from '../../shared/jobs';
import type { DestinationId, MediaItem, ModuleId, YouTubeOptions } from '../../shared/types';

export type SessionState = 'logged_in' | 'logged_out' | 'challenge' | 'unknown';

export interface PreparedMedia {
  item: MediaItem;
  /** Absolute path of the staged copy; resolved server-side from the media id only. */
  path: string;
}

export interface JobContent {
  targets: DestinationId[];
  text: string;
  media: PreparedMedia[];
  title?: string;
  thumbnail?: PreparedMedia | null;
  youtube?: YouTubeOptions;
  /** Meta: the Page to post as ('' = whichever Page is open) and whether to pause before filling. */
  meta?: { page: string; confirmDestinations: boolean; videoAs: 'reel' | 'post' };
}

export interface WaitForUserOptions {
  /** Resolves the wait automatically when it returns true (polled). The user can always press Continue. */
  until?: () => Promise<boolean>;
  timeoutMs?: number;
}

export interface PrepareContext {
  page: Page;
  content: JobContent;
  setStatus(status: JobStatus, message: string, progress?: number): void;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  check(label: string, state: JobCheck['state'], detail?: string): void;
  /** Runs a named step; failures are reported with the step name. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  waitForUser(message: string, opts?: WaitForUserOptions): Promise<void>;
  /**
   * Show this tab while a video uploads (Chrome pauses that work in hidden tabs). Uploads take
   * turns; hideTab() (or the end of the job) gives the user their previous tab back.
   */
  showTab(reason: string): Promise<void>;
  hideTab(): Promise<void>;
  /** Save the page outline locally for troubleshooting (no cookies, best effort). */
  snapshot(label: string): Promise<void>;
  throwIfCancelled(): void;
  /** Press the final Post/Publish/Share button. Refuses unless auto-publish is on for this job. */
  publishClick(locator: Locator, purpose: string): Promise<void>;
}

export interface PlatformModule {
  id: ModuleId;
  label: string;
  /** Official page opened by "Open platform" (for logging in). */
  entryUrl: string;
  /** Instant, side-effect-free look at the current page. */
  detectSession(page: Page): Promise<SessionState>;
  /** Fill the composer and stop before any final submission. */
  prepare(ctx: PrepareContext): Promise<void>;
  /**
   * Auto-publish only, after prepare() with every check passed: press the final button and confirm
   * the platform accepted it. Throws if it can't confirm.
   */
  publish(ctx: PrepareContext): Promise<void>;
}
