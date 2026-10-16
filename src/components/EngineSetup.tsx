import { useState } from 'react';
import { ArrowClockwiseIcon, CopyIcon, DesktopIcon } from '@phosphor-icons/react';
import { ENGINE_URL } from '../api';
import { AppLogo } from './Brand';

const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) ?? '';

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <code dir="ltr">{text}</code>
      <button
        type="button"
        className="btn small ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* the text is selectable */
          }
        }}
      >
        <CopyIcon size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * Shown on the hosted dashboard when this computer has no engine running: the automation needs a
 * real browser and the person's own logins, so it always runs locally.
 */
export function EngineSetup({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-head">
          <AppLogo size={36} />
          <div>
            <h1>Start Prepost on this computer</h1>
            <p className="muted">
              The dashboard is online, but the part that fills in the posts runs on your own computer, in your own Chrome, with your own accounts. It isn't running yet at <code>{ENGINE_URL}</code>.
            </p>
          </div>
        </div>
        <ol className="steps">
          <li>
            <strong>Install Node.js 20 or newer</strong> from nodejs.org (once).
          </li>
          <li>
            <strong>Get the app</strong> and install it (once):
            <CopyLine text={`git clone ${REPO_URL || '<repository URL>'} prepost && cd prepost && npm install && npm run setup:browser`} />
          </li>
          <li>
            <strong>Start it</strong> (each time you work):
            <CopyLine text="npm start" />
          </li>
          <li>
            <strong>Add the Chrome extension</strong> once: open <code>chrome://extensions</code>, turn on Developer mode, click <em>Load unpacked</em> and choose the <code>extension</code> folder. The dashboard then shows your pairing code.
          </li>
        </ol>
        <div className="setup-foot">
          <span className="muted">
            <DesktopIcon size={16} aria-hidden /> Chrome may ask to allow this site to connect to devices on your network: allow it.
          </span>
          <button type="button" className="btn primary" onClick={onRetry}>
            <ArrowClockwiseIcon size={16} aria-hidden /> Check again
          </button>
        </div>
      </div>
    </div>
  );
}
