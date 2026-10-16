import type { DestinationId, ModuleId } from './types';

export type JobStatus =
  | 'waiting'
  | 'opening'
  | 'login_required'
  | 'preparing'
  | 'uploading'
  | 'filling'
  | 'verifying'
  | 'ready'
  | 'needs_attention'
  | 'failed'
  | 'cancelled';

// Deliberately no "published" state: this application never publishes.
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  waiting: 'Waiting',
  opening: 'Opening platform',
  login_required: 'Login required',
  preparing: 'Preparing content',
  uploading: 'Uploading media',
  filling: 'Filling fields',
  verifying: 'Verifying content',
  ready: 'Ready for manual review',
  needs_attention: 'Needs attention',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const ACTIVE_STATUSES: JobStatus[] = ['waiting', 'opening', 'login_required', 'preparing', 'uploading', 'filling', 'verifying'];

export interface JobCheck {
  label: string;
  state: 'pass' | 'fail' | 'unverified';
  detail?: string;
}

export interface JobLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface JobSnapshot {
  id: string;
  moduleId: ModuleId;
  targets: DestinationId[];
  label: string;
  status: JobStatus;
  progress: number;
  message: string;
  currentStep: string | null;
  failedStep: string | null;
  error: string | null;
  checks: JobCheck[];
  /** Set while the automation is paused waiting for the user to do something in the browser. */
  awaitingUser: string | null;
  hasPage: boolean;
  startedAt: number;
  updatedAt: number;
  logs: JobLogEntry[];
}

/**
 * 'bundled' = Playwright's Chromium; 'chrome' = your installed Google Chrome with a separate
 * profile; 'extension' = your everyday Chrome profile through the bridge extension.
 */
export type BrowserMode = 'bundled' | 'chrome' | 'extension';

export interface BrowserState {
  open: boolean;
  mode: BrowserMode;
  profileDir: string;
  channel: string;
  chromeAvailable: boolean;
  bridge: { extensionConnected: boolean; extensionVersion: string | null; controlledTabs: number; pairingCode: string; extensionDir: string };
}
