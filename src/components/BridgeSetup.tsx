import { useState } from 'react';
import { CopyIcon, PuzzlePieceIcon } from '@phosphor-icons/react';
import type { BrowserState } from '../types/platform';

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
            /* clipboard unavailable: the text is selectable */
          }
        }}
      >
        <CopyIcon size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** One-time setup for "My Chrome profile" mode, shown until the extension connects. */
export function BridgeSetup({ browser }: { browser: BrowserState }) {
  const { bridge } = browser;
  return (
    <section className="card setup" aria-labelledby="bridge-title">
      <div className="setup-title">
        <PuzzlePieceIcon size={22} aria-hidden />
        <h2 id="bridge-title">Connect your Chrome (one time)</h2>
      </div>
      <ol className="steps">
        <li>
          In the Chrome profile where you're signed in to your accounts, open <code>chrome://extensions</code> (in Edge: <code>edge://extensions</code>) and turn on <strong>Developer mode</strong>.
        </li>
        <li>
          Click <strong>Load unpacked</strong> and choose this folder (in the picker, press ⌘⇧G and paste):
          <CopyLine text={bridge.extensionDir} />
        </li>
        <li>
          Click the extension's icon, paste this pairing code{bridge.port !== 5174 && <> and set <strong>Port</strong> to <strong>{bridge.port}</strong> (another Windows user on this PC uses 5174)</>}, then press <strong>Save &amp; connect</strong>:
          <CopyLine text={bridge.pairingCode} />
        </li>
      </ol>
      <p className="muted small">
        While a post is being prepared, Chrome shows a “started debugging this browser” bar. That's Chrome's safety notice; leave it until the job finishes. The extension only works with tabs Prepost opens, and never presses Publish.
      </p>
    </section>
  );
}
