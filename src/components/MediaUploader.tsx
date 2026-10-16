import { useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, FilmStripIcon, ImageSquareIcon, TrashIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react';
import { formatBytes } from '../../shared/validation';
import { api } from '../api';
import type { MediaItem } from '../types/content';

export interface PendingUpload {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

interface Props {
  media: MediaItem[];
  /** Image used as the cover / thumbnail of video posts. */
  coverId: string | null;
  onSetCover: (id: string | null) => void;
  /** Upload an image and use it as the video cover. */
  onUploadCover: (file: File) => void;
  pending: PendingUpload[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDismissPending: (key: string) => void;
}

function formatDuration(sec?: number) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaUploader({ media, coverId, onSetCover, onUploadCover, pending, onFiles, onRemove, onMove, onDismissPending }: Props) {
  const hasVideo = media.some((m) => m.kind === 'video');
  const cover = coverId ? media.find((m) => m.id === coverId) : undefined;
  const coverInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const postMedia = media.filter((m) => m.id !== coverId);

  return (
    <div className="field">
      <span className="field-label">Photos and videos</span>
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${media.length ? ' is-compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <UploadSimpleIcon size={media.length ? 18 : 26} aria-hidden />
        <span>
          <strong>{media.length ? 'Add more' : 'Drop photos or videos'}</strong>
          <small>or click to browse · JPG, PNG, GIF, WebP, MP4, MOV, WebM</small>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {pending.length > 0 && (
        <ul className="pending-list">
          {pending.map((p) => (
            <li key={p.key} className={p.error ? 'is-error' : ''}>
              <span className="truncate">{p.name}</span>
              {p.error ? (
                <>
                  <span className="error-text">{p.error}</span>
                  <button type="button" className="btn icon ghost" aria-label="Dismiss" onClick={() => onDismissPending(p.key)}>
                    <XIcon size={14} />
                  </button>
                </>
              ) : (
                <progress max={1} value={p.progress} aria-label={`Uploading ${p.name}`} />
              )}
            </li>
          ))}
        </ul>
      )}

      {postMedia.length > 0 && (
        <ol className="media-grid">
          {postMedia.map((m) => {
            const i = media.indexOf(m);
            return (
              <li key={m.id} className="media-card">
                <div className="media-thumb">
                  {m.kind === 'image' ? <img src={api.mediaUrl(m)} alt={m.name} loading="lazy" /> : <video src={api.mediaUrl(m)} preload="metadata" muted />}
                  <span className="media-kind" aria-hidden>
                    {m.kind === 'image' ? <ImageSquareIcon size={14} weight="fill" /> : <FilmStripIcon size={14} weight="fill" />}
                    {formatDuration(m.durationSec)}
                  </span>
                  <div className="media-actions">
                    <button type="button" className="btn icon" aria-label="Move earlier" disabled={i === 0} onClick={() => onMove(m.id, -1)}>
                      <ArrowLeftIcon size={14} />
                    </button>
                    <button type="button" className="btn icon" aria-label="Move later" disabled={i === media.length - 1} onClick={() => onMove(m.id, 1)}>
                      <ArrowRightIcon size={14} />
                    </button>
                    <button type="button" className="btn icon danger" aria-label={`Remove ${m.name}`} onClick={() => onRemove(m.id)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </div>
                <div className="media-meta">
                  <span className="truncate" title={m.name}>
                    {m.name}
                  </span>
                  <small>
                    {formatBytes(m.size)}
                    {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
                    {m.source === 'url' ? ' · from link' : ''}
                  </small>
                </div>
                {m.kind === 'image' && hasVideo && (
                  <button type="button" className="btn small ghost cover-pick" onClick={() => onSetCover(m.id)} title="Use this image as the video cover instead of posting it">
                    Use as cover
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {hasVideo && (
        <div className="cover-box">
          {cover ? (
            <img className="cover-thumb" src={api.mediaUrl(cover)} alt="Video cover" />
          ) : (
            <span className="cover-empty" aria-hidden>
              <ImageSquareIcon size={22} />
            </span>
          )}
          <div className="cover-text">
            <strong>Video cover</strong>
            <small>For YouTube (videos and Shorts), TikTok and Meta Reels. 16:9 for YouTube, 9:16 for Reels and TikTok.</small>
          </div>
          <div className="cover-actions">
            <button type="button" className="btn small" onClick={() => coverInputRef.current?.click()}>
              {cover ? 'Change' : 'Upload cover'}
            </button>
            {cover && (
              <button type="button" className="btn small ghost" onClick={() => onSetCover(null)} title="Stop using this image as the cover (it moves back to your photos)">
                Remove
              </button>
            )}
          </div>
          <input
            ref={coverInputRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/gif"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadCover(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}
