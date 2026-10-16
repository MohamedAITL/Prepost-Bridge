import { useState } from 'react';
import { DownloadSimpleIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import { isValidHttpUrl } from '../../shared/validation';
import type { Draft } from '../types/content';

interface Props {
  link: Draft['link'];
  onChange: (link: Draft['link']) => void;
  onImportAsMedia: (url: string) => Promise<void>;
}

export function LinkInput({ link, onChange, onImportAsMedia }: Props) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const hasUrl = link.url.trim() !== '';
  const invalid = hasUrl && !isValidHttpUrl(link.url);

  const doImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      await onImportAsMedia(link.url.trim());
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor="link-url">
        Link <span className="muted">(optional)</span>
      </label>
      <div className={`input-icon${invalid ? ' is-invalid' : ''}`}>
        <LinkSimpleIcon size={16} aria-hidden />
        <input id="link-url" type="url" dir="ltr" className="input" placeholder="https://example.com/article" value={link.url} onChange={(e) => onChange({ ...link, url: e.target.value })} />
      </div>
      {invalid && <p className="error-text">Enter a full link starting with https://</p>}
      {hasUrl && !invalid && (
        <div className="link-options">
          <label className="option small">
            <input type="checkbox" checked={link.mode === 'append'} onChange={(e) => onChange({ ...link, mode: e.target.checked ? 'append' : 'none' })} />
            Add the link at the end of the text
          </label>
          <button type="button" className="btn small ghost" disabled={importing} onClick={doImport} title="Only for a direct link to an image or video file">
            <DownloadSimpleIcon size={14} aria-hidden /> {importing ? 'Downloading…' : 'Use the file at this link as media'}
          </button>
        </div>
      )}
      {importError && <p className="error-text">{importError}</p>}
    </div>
  );
}
