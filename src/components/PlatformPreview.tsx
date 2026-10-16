import { CheckCircleIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { api } from '../api';
import type { DestinationContent } from '../types/content';
import { BRAND_NAMES, PlatformLogo } from './Brand';

interface Props {
  content: DestinationContent;
  account?: string;
  /** Optional one-click fix shown above the errors. */
  fix?: { label: string; onClick: () => void };
}

/** Read-only rendering of exactly what will be filled in for one destination. */
export function PlatformPreview({ content, account, fix }: Props) {
  const over = content.textLength > content.textLimit;
  const errors = content.issues.filter((i) => i.level === 'error');
  const warnings = content.issues.filter((i) => i.level === 'warning');
  return (
    <div className="preview">
      <div className="preview-head">
        <PlatformLogo id={content.destination} size={18} />
        <strong>{BRAND_NAMES[content.destination]} preview</strong>
        {account && (
          <span className="muted truncate" dir="auto">
            {account}
          </span>
        )}
      </div>
      <div className="preview-body">
        {content.title !== undefined && (
          <div className="preview-title" dir="auto">
            {content.title || <em className="muted">No title yet</em>}
          </div>
        )}
        <div className="preview-text" dir="auto">
          {content.text || <em className="muted">No text</em>}
        </div>
        {content.media.length > 0 && (
          <div className="preview-media">
            {content.media.map((m) => (m.kind === 'image' ? <img key={m.id} src={api.mediaUrl(m)} alt={m.name} /> : <video key={m.id} src={api.mediaUrl(m)} preload="metadata" muted />))}
          </div>
        )}
        {content.thumbnail && (
          <div className="preview-thumb">
            <img src={api.mediaUrl(content.thumbnail)} alt="Cover" />
            <small className="muted">Cover</small>
          </div>
        )}
        <div className={`counter${over ? ' is-error' : ''}`}>
          {content.textLength.toLocaleString()} / {content.textLimit.toLocaleString()}
        </div>
      </div>
      {fix && (
        <button type="button" className="btn primary small" onClick={fix.onClick}>
          {fix.label}
        </button>
      )}
      {errors.length > 0 && (
        <ul className="issues">
          {errors.map((i) => (
            <li key={i.message} className="is-error">
              <XCircleIcon size={16} weight="fill" aria-hidden />
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="issues">
          {warnings.map((i) => (
            <li key={i.message} className="is-warn">
              <WarningCircleIcon size={16} weight="fill" aria-hidden />
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
      {errors.length === 0 && (
        <p className="ok-line">
          <CheckCircleIcon size={16} weight="fill" aria-hidden /> Ready to prepare
        </p>
      )}
    </div>
  );
}
