import { useEffect, useRef, useState } from 'react';
import { CopyIcon, DotsThreeIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { enabledDestinations, planJobs } from '../../shared/validation';
import type { BatchPost } from '../../shared/types';

interface Props {
  posts: BatchPost[];
  activeId: string;
  /** post id → true when that post has a blocking error. */
  errors: Record<string, boolean>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/** Short summary for a post tab, e.g. "Reel · 3 tabs" or "nothing selected". */
function summary(post: BatchPost): string {
  const dests = enabledDestinations(post.draft);
  if (dests.length === 0) return 'no platform';
  const tabs = planJobs(post.draft).length;
  return `${tabs} ${tabs === 1 ? 'tab' : 'tabs'}`;
}

export function PostStrip({ posts, activeId, errors, onSelect, onAdd, onDuplicate, onRemove, onRename }: Props) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuId) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuId]);

  if (posts.length === 1 && !errors[posts[0].id] && !editingId) {
    // A single post: just the "+ New post" affordance, no clutter.
    return (
      <div className="post-strip">
        <span className="post-tab is-active single">{posts[0].title}</span>
        <button type="button" className="btn small ghost" onClick={onAdd}>
          <PlusIcon size={15} aria-hidden /> New post
        </button>
      </div>
    );
  }

  return (
    <div className="post-strip" role="tablist" aria-label="Posts">
      {posts.map((p) => (
        <div key={p.id} className={`post-tab${p.id === activeId ? ' is-active' : ''}${menuId === p.id ? ' has-menu' : ''}`}>
          {editingId === p.id ? (
            <input
              autoFocus
              className="post-rename"
              defaultValue={p.title}
              onBlur={(e) => {
                onRename(p.id, e.target.value);
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditingId(null);
              }}
            />
          ) : (
            <button type="button" role="tab" aria-selected={p.id === activeId} className="post-tab-main" onClick={() => onSelect(p.id)} onDoubleClick={() => setEditingId(p.id)}>
              {errors[p.id] && <span className="dot is-error" aria-label="Has errors" />}
              <span className="post-title">{p.title}</span>
              <small>{summary(p)}</small>
            </button>
          )}
          <div className="menu-anchor" ref={menuId === p.id ? menuRef : undefined}>
            <button type="button" className="btn icon ghost post-menu-btn" aria-label={`${p.title} options`} aria-expanded={menuId === p.id} onClick={() => setMenuId(menuId === p.id ? null : p.id)}>
              <DotsThreeIcon size={16} weight="bold" />
            </button>
            {menuId === p.id && (
              <div className="popover post-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEditingId(p.id);
                    setMenuId(null);
                  }}
                >
                  <PencilSimpleIcon size={15} aria-hidden /> Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onDuplicate(p.id);
                    setMenuId(null);
                  }}
                >
                  <CopyIcon size={15} aria-hidden /> Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  disabled={posts.length === 1}
                  onClick={() => {
                    onRemove(p.id);
                    setMenuId(null);
                  }}
                >
                  <TrashIcon size={15} aria-hidden /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="btn small ghost post-add" onClick={onAdd}>
        <PlusIcon size={15} aria-hidden /> New post
      </button>
    </div>
  );
}
