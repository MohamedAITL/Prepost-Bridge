import { useState } from 'react';
import { ArrowClockwiseIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import type { MetaPage } from '../../shared/types';
import { MiniLogo } from './Brand';

interface Props {
  pages: MetaPage[];
  selected: MetaPage[];
  onSelect: (pages: MetaPage[]) => void;
  onSavePages: (pages: MetaPage[]) => Promise<void>;
  onLoadFromBusinessSuite: () => Promise<void>;
}

/** Checkbox list of the user's Facebook Pages (each may have a linked Instagram account). */
export function MetaPagePicker({ pages, selected, onSelect, onSavePages, onLoadFromBusinessSuite }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIg, setNewIg] = useState(false);
  const isSelected = (p: MetaPage) => selected.some((s) => s.name === p.name);

  const toggle = (p: MetaPage, on: boolean) => {
    const names = new Set(selected.map((s) => s.name));
    if (on) names.add(p.name);
    else names.delete(p.name);
    onSelect(pages.filter((x) => names.has(x.name)));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await onLoadFromBusinessSuite();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name || pages.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    await onSavePages([...pages, { name, instagram: newIg }]);
    setNewName('');
    setNewIg(false);
  };

  return (
    <div className="sublist">
      <div className="sublist-head">
        <span>Pages</span>
        <div className="row">
          <button type="button" className="btn icon ghost" disabled={loading} onClick={load} title="Reload your Pages from Business Suite" aria-label="Reload Pages from Business Suite">
            <ArrowClockwiseIcon size={16} className={loading ? 'spin' : undefined} />
          </button>
          <button type="button" className={`btn icon ghost${editing ? ' is-pressed' : ''}`} aria-pressed={editing} onClick={() => setEditing((v) => !v)} title="Edit the list" aria-label="Edit the Page list">
            <PencilSimpleIcon size={16} />
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {pages.length === 0 && <p className="muted small">No Pages yet. Use the reload button to read them from Business Suite.</p>}
      <ul className="option-list">
        {pages.map((p) => (
          <li key={p.name}>
            <label className="option">
              <input type="checkbox" checked={isSelected(p)} onChange={(e) => toggle(p, e.target.checked)} />
              <span className="option-name" dir="auto">
                {p.name}
              </span>
              <span className="option-marks">
                <MiniLogo which="facebook" />
                {p.instagram && <MiniLogo which="instagram" />}
              </span>
            </label>
            {editing && (
              <span className="row">
                <label className="option small">
                  <input type="checkbox" checked={p.instagram} onChange={(e) => onSavePages(pages.map((x) => (x.name === p.name ? { ...x, instagram: e.target.checked } : x)))} /> Instagram
                </label>
                <button type="button" className="btn icon ghost danger" aria-label={`Remove ${p.name}`} onClick={() => onSavePages(pages.filter((x) => x.name !== p.name))}>
                  <TrashIcon size={14} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="add-row">
          <input className="input" dir="auto" placeholder="Page name as in Business Suite" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <label className="option small">
            <input type="checkbox" checked={newIg} onChange={(e) => setNewIg(e.target.checked)} /> Instagram
          </label>
          <button type="button" className="btn small" onClick={add} disabled={!newName.trim()}>
            <PlusIcon size={14} aria-hidden /> Add
          </button>
        </div>
      )}
      {selected.length > 1 && <p className="muted small">Each Page gets its own tab.</p>}
    </div>
  );
}
