import { useState } from 'react';
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CopyIcon,
  CircleNotchIcon,
  EyeIcon,
  PlayIcon,
  QuestionIcon,
  StopIcon,
  TrayIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from '@phosphor-icons/react';
import { ACTIVE_STATUSES, JOB_STATUS_LABELS, type JobSnapshot } from '../types/platform';
import { PlatformLogo } from './Brand';

interface Props {
  jobs: JobSnapshot[];
  onRetry: (id: string) => void;
  onContinue: (id: string) => void;
  onCancel: (id: string) => void;
  onFocus: (id: string) => void;
  onDismiss: (id: string) => void;
}

const CHECK_ICON = {
  pass: <CheckCircleIcon size={16} weight="fill" aria-label="Passed" />,
  fail: <XCircleIcon size={16} weight="fill" aria-label="Failed" />,
  unverified: <QuestionIcon size={16} weight="bold" aria-label="Not verified" />,
};

function StatusIcon({ job }: { job: JobSnapshot }) {
  if (job.status === 'ready' || job.status === 'published') return <CheckCircleIcon size={18} weight="fill" aria-hidden />;
  if (job.status === 'failed') return <XCircleIcon size={18} weight="fill" aria-hidden />;
  if (job.status === 'needs_attention' || job.status === 'login_required' || job.awaitingUser) return <WarningCircleIcon size={18} weight="fill" aria-hidden />;
  if (job.status === 'cancelled') return <StopIcon size={18} aria-hidden />;
  return <CircleNotchIcon size={18} className="spin" aria-hidden />;
}

/** WordPress: the article's title and link, copied together like the Chouf News Desk did. */
function ArticleLink({ article }: { article: NonNullable<JobSnapshot['article']> }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${article.title}\n${article.url}`);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  return (
    <div className="article-link">
      <div className="article-link-text">
        <strong dir="auto">{article.title}</strong>
        <a href={article.url} target="_blank" rel="noreferrer" dir="ltr">
          {article.url}
        </a>
        <span className="muted small">
          {copied === 'yes' ? 'Title and link copied.' : copied === 'failed' ? 'Copy blocked by the browser: select the title and link and copy them.' : article.published ? 'Published.' : 'The link works once you publish the article in WordPress.'}
        </span>
      </div>
      <button type="button" className="btn small" onClick={copy}>
        <CopyIcon size={14} aria-hidden /> Copy title &amp; link
      </button>
    </div>
  );
}

function JobRow({ job, onRetry, onContinue, onCancel, onFocus, onDismiss }: { job: JobSnapshot } & Omit<Props, 'jobs'>) {
  const [open, setOpen] = useState(false);
  const active = ACTIVE_STATUSES.includes(job.status);
  const tone = job.awaitingUser || job.status === 'needs_attention' || job.status === 'login_required' ? 'warn' : job.status === 'ready' || job.status === 'published' ? 'ok' : job.status === 'failed' ? 'error' : job.status === 'cancelled' ? 'muted' : 'busy';
  const logo = job.moduleId === 'meta' ? 'facebook' : job.moduleId;

  return (
    <li className={`job tone-${tone}`}>
      <div className="job-head">
        <span className="job-logo">
          <PlatformLogo id={logo} size={20} />
        </span>
        <div className="job-title">
          <strong>{job.label}</strong>
          <span className="job-message">{job.message}</span>
        </div>
        <span className={`status tone-${tone}`}>
          <StatusIcon job={job} />
          {job.awaitingUser ? 'Your turn' : JOB_STATUS_LABELS[job.status]}
        </span>
      </div>
      {active && <progress className="job-progress" max={100} value={job.progress} aria-label="Progress" />}

      {job.awaitingUser && (
        <div className="awaiting">
          <p>{job.awaitingUser}</p>
          <div className="row">
            <button type="button" className="btn primary small" onClick={() => onContinue(job.id)}>
              <PlayIcon size={14} weight="fill" aria-hidden /> Continue
            </button>
            {job.hasPage && (
              <button type="button" className="btn small" onClick={() => onFocus(job.id)}>
                <EyeIcon size={14} aria-hidden /> Show tab
              </button>
            )}
          </div>
        </div>
      )}

      {job.article && <ArticleLink article={job.article} />}

      <div className="job-actions">
        {job.hasPage && (job.status === 'ready' || job.status === 'needs_attention' || job.status === 'published') && (
          <button type="button" className="btn primary small" onClick={() => onFocus(job.id)}>
            <EyeIcon size={14} aria-hidden /> {job.status === 'published' ? 'Show tab' : 'Review post'}
          </button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'needs_attention') && (
          <button type="button" className="btn small" onClick={() => onRetry(job.id)}>
            <ArrowClockwiseIcon size={14} aria-hidden /> Retry
          </button>
        )}
        {active && (
          <button type="button" className="btn small ghost danger" onClick={() => onCancel(job.id)}>
            <StopIcon size={14} aria-hidden /> Cancel
          </button>
        )}
        <button type="button" className="btn small ghost details-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Details <CaretDownIcon size={12} aria-hidden />
        </button>
        {!active && (
          <button type="button" className="btn icon ghost push-right" aria-label="Remove from list" onClick={() => onDismiss(job.id)}>
            <XIcon size={14} />
          </button>
        )}
      </div>

      {open && (
        <div className="job-details">
          {job.checks.length > 0 && (
            <ul className="checks">
              {job.checks.map((c) => (
                <li key={c.label} className={`check-${c.state}`}>
                  {CHECK_ICON[c.state]}
                  <span>
                    {c.label}
                    {c.detail && <small> · {c.detail}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {job.currentStep && active && <p className="muted">Current step: {job.currentStep}</p>}
          <pre className="job-logs">{job.logs.map((l) => `${new Date(l.ts).toLocaleTimeString()}  ${l.message}`).join('\n')}</pre>
        </div>
      )}
    </li>
  );
}

export function AutomationStatus(props: Props) {
  if (props.jobs.length === 0) {
    return (
      <div className="empty">
        <TrayIcon size={28} aria-hidden />
        <p>
          <strong>Nothing prepared yet.</strong>
          <span>Write your post, choose where it goes, then press Prepare posts.</span>
        </p>
      </div>
    );
  }
  // Group by post only when more than one post is present.
  const postIds = new Set(props.jobs.map((j) => j.postId));
  const grouped = postIds.size > 1 && props.jobs.some((j) => j.postTitle);
  if (!grouped) {
    return (
      <ul className="job-list">
        {props.jobs.map((job) => (
          <JobRow key={job.id} job={job} {...props} />
        ))}
      </ul>
    );
  }
  const byPost = new Map<string, { title: string; jobs: typeof props.jobs }>();
  for (const job of props.jobs) {
    const g = byPost.get(job.postId) ?? { title: job.postTitle || 'Post', jobs: [] };
    g.jobs.push(job);
    byPost.set(job.postId, g);
  }
  return (
    <div className="job-groups">
      {[...byPost.values()].map((g) => (
        <div key={g.title} className="job-group">
          <h3 className="job-group-title">{g.title}</h3>
          <ul className="job-list">
            {g.jobs.map((job) => (
              <JobRow key={job.id} job={job} {...props} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
