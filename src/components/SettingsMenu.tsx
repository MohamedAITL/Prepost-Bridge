import { useEffect, useRef, useState } from 'react';
import { DesktopIcon, GearSixIcon, MoonIcon, SunIcon } from '@phosphor-icons/react';
import { api } from '../api';
import type { BrowserMode, BrowserState } from '../types/platform';

interface Props {
  browser: BrowserState | null;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
}

const MODES: { value: BrowserMode; label: string; hint: string }[] = [
  { value: 'extension', label: 'My Chrome profile', hint: 'Uses the accounts you are signed in to, via the extension' },
  { value: 'chrome', label: 'Google Chrome, separate profile', hint: 'Sign in once inside that Chrome' },
  { value: 'bundled', label: 'Built-in browser', hint: 'Playwright Chromium with its own profile' },
];

type Theme = 'light' | 'dark' | 'auto';

function readTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || t === 'auto' ? t : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('prepost.theme', theme);
  } catch {
    /* storage unavailable: applies for this visit only */
  }
}

/** Appearance, browser choice and connection controls, kept out of the way in a small popover. */
export function SettingsMenu({ browser, busy, run }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const mode = browser?.mode ?? 'bundled';
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="btn ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <GearSixIcon size={18} weight="regular" aria-hidden />
        <span>Settings</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Settings">
          <p className="popover-title">Appearance</p>
          <div className="segmented full" role="radiogroup" aria-label="Appearance">
            {(
              [
                ['light', 'Light', SunIcon],
                ['dark', 'Dark', MoonIcon],
                ['auto', 'Auto', DesktopIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                className={theme === value ? 'is-on' : ''}
                onClick={() => {
                  applyTheme(value);
                  setTheme(value);
                }}
              >
                <Icon size={15} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <p className="popover-title">Which browser prepares the posts</p>
          <div className="choice-list" role="radiogroup">
            {MODES.map((m) => (
              <label key={m.value} className={`choice${mode === m.value ? ' is-on' : ''}${busy ? ' is-disabled' : ''}`}>
                <input
                  type="radio"
                  name="browser-mode"
                  checked={mode === m.value}
                  disabled={busy || !browser || (m.value === 'chrome' && !browser.chromeAvailable)}
                  onChange={() => run(() => api.setBrowserMode(m.value))}
                />
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {busy && <p className="hint">Finish or cancel running preparations to switch.</p>}
          {browser && mode !== 'extension' && (
            <div className="popover-actions">
              {browser.open ? (
                <>
                  {mode === 'chrome' && (
                    <button type="button" className="btn small" onClick={() => run(api.openDashboardInBrowser)}>
                      Open dashboard in Chrome
                    </button>
                  )}
                  <button type="button" className="btn small" disabled={busy} onClick={() => run(api.closeBrowser)}>
                    {mode === 'bundled' ? 'Close browser' : 'Disconnect Chrome'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn small" onClick={() => run(api.launchBrowser)}>
                  {mode === 'chrome' ? 'Connect Chrome' : 'Open browser'}
                </button>
              )}
            </div>
          )}
          {browser && mode === 'extension' && browser.open && (
            <div className="popover-actions">
              <button type="button" className="btn small" disabled={busy} onClick={() => run(api.closeBrowser)}>
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
