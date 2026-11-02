import { useState } from 'react';
import { ArrowClockwiseIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';

interface Props {
  channels: string[];
  selected: string[];
  onSelect: (channels: string[]) => void;
  onSaveChannels: (channels: string[]) => Promise<void>;
  onLoadFromWhatsApp: () => Promise<void>;
}

/** Checkbox list of the WhatsApp Channels you run. Each ticked channel gets its own update. */
export function WhatsAppChannelPicker({ channels, selected, onSelect, onSaveChannels, onLoadFromWhatsApp }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await onLoadFromWhatsApp();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name || channels.includes(name)) return;
    await onSaveChannels([...channels, name]);
    setNewName('');
  };

  return (
    <div className="sublist">
      <div className="sublist-head">
        <span>Channels</span>
        <div className="row">
          <button type="button" className="btn icon ghost" disabled={loading} onClick={load} title="Reload your channels from WhatsApp" aria-label="Reload channels from WhatsApp">
            <ArrowClockwiseIcon size={16} className={loading ? 'spin' : undefined} />
          </button>
          <button type="button" className={`btn icon ghost${editing ? ' is-pressed' : ''}`} aria-pressed={editing} onClick={() => setEditing((v) => !v)} title="Edit the list" aria-label="Edit the channel list">
            <PencilSimpleIcon size={16} />
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {channels.length === 0 && <p className="muted small">No channels yet. Use the reload button to read them from WhatsApp Web.</p>}
      <ul className="option-list">
        {channels.map((c) => (
          <li key={c}>
            <label className="option">
              <input type="checkbox" checked={selected.includes(c)} onChange={(e) => onSelect(channels.filter((x) => (x === c ? e.target.checked : selected.includes(x))))} />
              <span className="option-name" dir="auto">
                {c}
              </span>
            </label>
            {editing && (
              <button type="button" className="btn icon ghost danger" aria-label={`Remove ${c}`} onClick={() => onSaveChannels(channels.filter((x) => x !== c))}>
                <TrashIcon size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="add-row">
          <input className="input" dir="auto" placeholder="Channel name as in WhatsApp" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" className="btn small" onClick={add} disabled={!newName.trim()}>
            <PlusIcon size={14} aria-hidden /> Add
          </button>
        </div>
      )}
      {selected.length > 1 && <p className="muted small">Each channel gets its own update, one after the other.</p>}
    </div>
  );
}
