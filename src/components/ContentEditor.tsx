import { useState } from 'react';
import { countHashtags, graphemeLength, xWeightedLength } from '../../shared/validation';

/** Your own app, shown in place of the text area when "CHDL" is selected. */
const CHDL_URL = 'https://chdl.lovable.app/';
const VIEW_KEY = 'prepost.editorView';

type View = 'text' | 'chdl';

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'chdl' ? 'chdl' : 'text';
  } catch {
    return 'text';
  }
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  rows?: number;
  /** Show the X-weighted count too (useful when X is selected). */
  showXCount?: boolean;
}

export function ContentEditor({ value, onChange, label = 'Text', placeholder, rows = 9, showXCount }: Props) {
  const [view, setView] = useState<View>(savedView);
  // Load CHDL once it's first opened, then keep it mounted so its state survives switching back.
  const [chdlLoaded, setChdlLoaded] = useState(view === 'chdl');
  const chars = graphemeLength(value);
  const tags = countHashtags(value);

  const choose = (v: View) => {
    setView(v);
    if (v === 'chdl') setChdlLoaded(true);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable: applies for this visit only */
    }
  };

  return (
    <div className="field">
      <div className="editor-head">
        <label className="field-label" htmlFor="main-text">
          {label}
        </label>
        <div className="segmented" role="radiogroup" aria-label="Editor view">
          <button type="button" role="radio" aria-checked={view === 'text'} className={view === 'text' ? 'is-on' : ''} onClick={() => choose('text')}>
            Text
          </button>
          <button type="button" role="radio" aria-checked={view === 'chdl'} className={view === 'chdl' ? 'is-on' : ''} onClick={() => choose('chdl')}>
            CHDL
          </button>
        </div>
      </div>

      <div hidden={view !== 'text'}>
        <textarea
          id="main-text"
          className="editor"
          dir="auto"
          rows={rows}
          value={value}
          placeholder={placeholder ?? 'Write your caption or description. Arabic, French, English and emoji all work.'}
          onChange={(e) => onChange(e.target.value)}
          spellCheck
        />
        <div className="counter-row">
          <span>{chars.toLocaleString()} characters</span>
          {tags > 0 && <span>{tags} hashtags</span>}
          {showXCount && <span title="X counts links as 23 and emoji or wide characters as 2">{xWeightedLength(value)} / 280 on X</span>}
        </div>
      </div>

      {chdlLoaded && (
        <div className="embed-frame" hidden={view !== 'chdl'}>
          <iframe src={CHDL_URL} title="CHDL" allow="clipboard-read; clipboard-write" />
        </div>
      )}
    </div>
  );
}
