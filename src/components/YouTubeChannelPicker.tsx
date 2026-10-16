import { useState } from 'react';
import { ArrowClockwiseIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import type { YouTubeChannel } from '../../shared/types';

interface Props {
  channels: YouTubeChannel[];
  /** '' = whichever channel YouTube is on now. */
  selected: string;
  onSelect: (name: string) => void;
  onSaveChannels: (channels: YouTubeChannel[]) => Promise<void>;
  onLoadFromYouTube: () => Promise<void>;
}

/** One YouTube channel per preparation: YouTube's active channel applies to the whole browser. */
export function YouTubeChannelPicker({ channels, selected, onSelect, onSaveChannels, onLoadFromYouTube }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await onLoadFromYouTube();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name || channels.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    await onSaveChannels([...channels, { name, handle: '' }]);
    setNewName('');
  };

  return (
    <div className="sublist">
      <div className="sublist-head">
        <span>Channel</span>
        <div className="row">
          <button type="button" className="btn icon ghost" disabled={loading} onClick={load} title="Reload your channels from YouTube" aria-label="Reload channels from YouTube">
            <ArrowClockwiseIcon size={16} className={loading ? 'spin' : undefined} />
          </button>
          <button type="button" className={`btn icon ghost${editing ? ' is-pressed' : ''}`} aria-pressed={editing} onClick={() => setEditing((v) => !v)} title="Edit the list" aria-label="Edit the channel list">
            <PencilSimpleIcon size={16} />
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      <ul className="option-list" role="radiogroup" aria-label="YouTube channel">
        <li>
          <label className="option">
            <input type="radio" name="yt-channel" checked={selected === ''} onChange={() => onSelect('')} />
            <span className="option-name">Current channel</span>
          </label>
        </li>
        {channels.map((c) => (
          <li key={c.name}>
            <label className="option">
              <input type="radio" name="yt-channel" checked={selected === c.name} onChange={() => onSelect(c.name)} />
              <span className="option-name" dir="auto">
                {c.name}
              </span>
              {c.handle && <small className="muted">{c.handle}</small>}
            </label>
            {editing && (
              <button type="button" className="btn icon ghost danger" aria-label={`Remove ${c.name}`} onClick={() => onSaveChannels(channels.filter((x) => x.name !== c.name))}>
                <TrashIcon size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="add-row">
          <input className="input" dir="auto" placeholder="Channel name as on YouTube" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="button" className="btn small" onClick={add} disabled={!newName.trim()}>
            <PlusIcon size={14} aria-hidden /> Add
          </button>
        </div>
      )}
      <p className="muted small">One channel at a time: YouTube switches channels for the whole browser.</p>
    </div>
  );
}
