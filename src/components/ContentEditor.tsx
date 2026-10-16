import { countHashtags, graphemeLength, xWeightedLength } from '../../shared/validation';

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
  const chars = graphemeLength(value);
  const tags = countHashtags(value);
  return (
    <div className="field">
      <label className="field-label" htmlFor="main-text">
        {label}
      </label>
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
  );
}
