import { useRef, type ReactNode } from 'react';
import { FilmStripIcon, ImageSquareIcon, TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import { buildDestinationContent, graphemeLength, wordpressArticle, youtubeTitle } from '../../shared/validation';
import { YOUTUBE_TITLE_LIMIT } from '../../shared/rules';
import { WORDPRESS_CHOICES, wordpressDefaults } from '../../shared/types';
import { api } from '../api';
import type { Draft, PlatformConfig } from '../types/content';
import type { DestinationId } from '../types/platform';
import { BRAND_NAMES } from './Brand';
import { PlatformPreview } from './PlatformPreview';

interface Props {
  destination: DestinationId;
  draft: Draft;
  onChange: (patch: Partial<PlatformConfig>) => void;
  onDraftChange: (fn: (d: Draft) => Draft) => void;
  onYouTubeFiles: (files: File[]) => void;
  onYouTubeThumbnail: (file: File) => void;
  onRemoveMedia: (id: string) => void;
}

/** A compact "A | B" choice. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlatformConfigCard({ destination: d, draft, onChange, onDraftChange, onYouTubeFiles, onYouTubeThumbnail, onRemoveMedia }: Props) {
  const ytFileRef = useRef<HTMLInputElement>(null);
  const ytThumbRef = useRef<HTMLInputElement>(null);
  const cfg = draft.platforms[d];
  const content = buildDestinationContent(draft, d);
  const selectedIds = cfg.mediaIds ?? draft.media.map((m) => m.id);
  const ytPost = d === 'youtube' && draft.youtube.postType === 'post';
  const ytVideo = d === 'youtube' && !ytPost;
  const name = BRAND_NAMES[d];
  const textLabel = ytVideo ? 'Description' : d === 'tiktok' ? 'Caption' : d === 'wordpress' ? 'Article' : 'Text';
  // YouTube set to video upload, but this post only has images: offer the image-post type.
  const onlyImages = content.media.length > 0 && content.media.every((m) => m.kind === 'image');
  const ytOwn = draft.media.filter((m) => m.youtubeOnly && m.id !== draft.youtube.thumbnailId);
  const ytThumb = draft.media.find((m) => m.id === draft.youtube.thumbnailId);
  const setYt = (patch: Partial<Draft['youtube']>) => onDraftChange((x) => ({ ...x, youtube: { ...x.youtube, ...patch } }));
  const setMeta = (patch: Partial<Draft['meta']>) => onDraftChange((x) => ({ ...x, meta: { ...x.meta, ...patch } }));
  const setWp = (patch: Partial<Draft['wordpress']>) => onDraftChange((x) => ({ ...x, wordpress: { ...x.wordpress, ...patch } }));
  const wp = draft.wordpress;
  // What the News Desk format detects from the text (shown in the Title/Tags placeholders).
  const wpArticle = d === 'wordpress' ? wordpressArticle(draft) : null;
  const wpChoices = WORDPRESS_CHOICES[wp.postType];
  const toggleWp = (key: 'options' | 'categories', name: string, on: boolean) =>
    setWp({ [key]: wpChoices[key].filter((x) => (x === name ? on : wp[key].includes(x))) });
  const media = draft.media.filter((m) => m.id !== draft.coverId && !m.youtubeOnly);

  const toggleMedia = (id: string, on: boolean) => {
    const set = new Set(selectedIds);
    if (on) set.add(id);
    else set.delete(id);
    // Keep the post order of the shared media list.
    onChange({ mediaIds: draft.media.map((m) => m.id).filter((x) => set.has(x)) });
  };

  return (
    <div className="config">
      <div className="config-form">
        {d === 'youtube' && (
          <div className="field">
            <span className="field-label">Type</span>
            <Segmented
              label="YouTube post type"
              value={draft.youtube.postType}
              onChange={(postType) => setYt({ postType })}
              options={[
                { value: 'video', label: 'Video or Short' },
                { value: 'post', label: 'Channel post' },
              ]}
            />
            {ytPost && <p className="muted small">Text with up to 10 images, posted on your channel's Posts tab.</p>}
          </div>
        )}

        {d === 'facebook' && (
          <div className="field">
            <span className="field-label">A video goes out as</span>
            <Segmented
              label="Meta video type"
              value={draft.meta.videoAs}
              onChange={(videoAs) => setMeta({ videoAs })}
              options={[
                { value: 'reel', label: 'Reel' },
                { value: 'post', label: 'Regular post' },
              ]}
            />
          </div>
        )}

        {d === 'wordpress' && (
          <>
            <div className="field">
              <span className="field-label">Type</span>
              <Segmented
                label="WordPress article type"
                value={wp.postType}
                // Each type has its own options and sections: switch to that type's defaults, keep title and tags.
                onChange={(postType) => setWp({ ...wordpressDefaults(postType), title: wp.title, tags: wp.tags })}
                options={[
                  { value: 'press', label: 'News' },
                  { value: 'program', label: 'Video' },
                ]}
              />
              <p className="muted small">Write it like the News Desk: title on the first line, then the body, tags on the last line (comma-separated).</p>
              {wp.postType === 'program' && (
                <p className="muted small" dir="auto">
                  {wpArticle?.videoUrl ? `Video URL: ${wpArticle.videoUrl}` : 'A YouTube link on any line of the text (or in Link) fills the Video URL.'}
                </p>
              )}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="wp-title">
                Title
              </label>
              <input id="wp-title" className="input" dir="auto" placeholder={wpArticle?.title ? `From the text: ${wpArticle.title}` : 'Empty = the first line of the text'} value={wp.title} onChange={(e) => setWp({ title: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="wp-tags">
                Tags
              </label>
              <input id="wp-tags" className="input" dir="auto" placeholder={wpArticle?.tags.length ? `From the text: ${wpArticle.tags.join('، ')}` : 'Empty = the last line of the text'} value={wp.tags} onChange={(e) => setWp({ tags: e.target.value })} />
            </div>
            {(['options', 'categories'] as const).map((key) => (
              <fieldset key={key} className="field">
                <legend className="field-label">{key === 'options' ? 'Options' : wp.postType === 'program' ? 'Programs' : 'Sections'}</legend>
                <div className="row">
                  {wpChoices[key].map((name) => (
                    <label key={name} className="option small" dir="auto">
                      <input type="checkbox" checked={wp[key].includes(name)} onChange={(e) => toggleWp(key, name, e.target.checked)} /> {name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </>
        )}

        {ytVideo && (
          <div className="field">
            <label className="field-label" htmlFor="yt-title">
              Title <span className="muted">{graphemeLength(youtubeTitle(draft))}/{YOUTUBE_TITLE_LIMIT}</span>
            </label>
            <input id="yt-title" className="input" dir="auto" placeholder={draft.youtube.title ? undefined : youtubeTitle(draft) ? `From the text: ${youtubeTitle(draft)}` : 'Empty = the first line of the text'} value={draft.youtube.title} onChange={(e) => setYt({ title: e.target.value })} />
          </div>
        )}

        <div className="field">
          <span className="field-label">{textLabel}</span>
          <Segmented
            label={`${name} text`}
            value={cfg.useSharedText ? 'shared' : 'custom'}
            onChange={(v) => onChange(v === 'shared' ? { useSharedText: true } : { useSharedText: false, customText: cfg.customText || draft.sharedText })}
            options={[
              { value: 'shared', label: 'Same as main text' },
              { value: 'custom', label: `Custom for ${name}` },
            ]}
          />
          {!cfg.useSharedText && (
            <>
              <textarea className="editor small" dir="auto" rows={5} value={cfg.customText} onChange={(e) => onChange({ customText: e.target.value })} />
              <div className="row">
                <button type="button" className="btn small ghost" onClick={() => onChange({ customText: draft.sharedText })}>
                  Reset to main text
                </button>
                <button type="button" className="btn small ghost" onClick={() => onDraftChange((x) => ({ ...x, sharedText: cfg.customText }))} title="Copies this text into the main text (affects every platform using it)">
                  Make this the main text
                </button>
              </div>
            </>
          )}
          {draft.link.url.trim() && draft.link.mode === 'append' && d !== 'wordpress' && (
            <label className="option small">
              <input type="checkbox" checked={cfg.includeLink} onChange={(e) => onChange({ includeLink: e.target.checked })} /> Add the link on {name}
            </label>
          )}
        </div>

        {d === 'youtube' && (
          <div className="field">
            <span className="field-label">Media for YouTube only</span>
            {ytOwn.length > 0 && (
              <ul className="option-list">
                {ytOwn.map((m) => (
                  <li key={m.id}>
                    <span className="option-name truncate" title={m.name}>
                      {m.name}
                    </span>
                    <button type="button" className="btn icon ghost danger" aria-label={`Remove ${m.name}`} onClick={() => onRemoveMedia(m.id)}>
                      <TrashIcon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row">
              <button type="button" className="btn small" onClick={() => ytFileRef.current?.click()}>
                <UploadSimpleIcon size={14} aria-hidden /> Upload for YouTube only
              </button>
            </div>
            <input
              ref={ytFileRef}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo"
              onChange={(e) => {
                onYouTubeFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <p className="muted small">{ytOwn.length ? 'YouTube uses this instead of the shared media. Other platforms never get it.' : 'Use a different file on YouTube in this same post. The upload progress shows under Photos and videos.'}</p>
          </div>
        )}

        {ytVideo && (
          <div className="field">
            <span className="field-label">Thumbnail for YouTube only</span>
            <div className="cover-box">
              {ytThumb ? (
                <img className="cover-thumb" src={api.mediaUrl(ytThumb)} alt="YouTube thumbnail" />
              ) : (
                <span className="cover-empty" aria-hidden>
                  <ImageSquareIcon size={22} />
                </span>
              )}
              <div className="cover-text">
                <strong>YouTube thumbnail</strong>
                <small>16:9, JPG, PNG or GIF, up to 2 MB. Used instead of the shared video cover.</small>
              </div>
              <div className="cover-actions">
                <button type="button" className="btn small" onClick={() => ytThumbRef.current?.click()}>
                  {ytThumb ? 'Change' : 'Upload thumbnail'}
                </button>
                {ytThumb && (
                  <button type="button" className="btn small ghost" onClick={() => onRemoveMedia(ytThumb.id)}>
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={ytThumbRef}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/gif"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onYouTubeThumbnail(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        {media.length > 0 && !(d === 'youtube' && ytOwn.length > 0) && (
          <div className="field">
            <span className="field-label">Media</span>
            <div className="media-pick">
              {media.map((m) => (
                <label key={m.id} className={`pick${selectedIds.includes(m.id) ? ' is-on' : ''}`} title={m.name}>
                  <input type="checkbox" checked={selectedIds.includes(m.id)} onChange={(e) => toggleMedia(m.id, e.target.checked)} aria-label={m.name} />
                  {m.kind === 'image' ? (
                    <img src={api.mediaUrl(m)} alt="" />
                  ) : (
                    <span className="pick-video">
                      <FilmStripIcon size={18} aria-hidden />
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {ytVideo && (
          <div className="field grid2">
            <label>
              <span className="field-label">Made for kids?</span>
              <select className="input" value={draft.youtube.audience} onChange={(e) => setYt({ audience: e.target.value as Draft['youtube']['audience'] })}>
                <option value="unset">I'll choose in YouTube</option>
                <option value="not_kids">No</option>
                <option value="kids">Yes</option>
              </select>
            </label>
            <label>
              <span className="field-label">Visibility</span>
              <select className="input" value={draft.youtube.visibility} onChange={(e) => setYt({ visibility: e.target.value as Draft['youtube']['visibility'] })}>
                <option value="unset">I'll choose in YouTube</option>
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </label>
            <label className="option small span2">
              <input type="checkbox" checked={draft.youtube.advanceToVisibilityStep} onChange={(e) => setYt({ advanceToVisibilityStep: e.target.checked })} />
              Go through to the Visibility step (Save stays for you)
            </label>
            {draft.youtube.advanceToVisibilityStep && (
              <div className="span2">
                <label className="option small">
                  <input type="checkbox" checked={draft.youtube.adSuitabilityNone} onChange={(e) => setYt({ adSuitabilityNone: e.target.checked })} />
                  Ad suitability: "None of the above" for this video
                </label>
                <p className="muted small">Tick only if this video has none of YouTube's listed content: inappropriate language, adult content, violence, shocking content, firearms, sensitive events, controversial issues and the like. This is your declaration to YouTube and can't be changed once submitted. It applies to this post only.</p>
              </div>
            )}
          </div>
        )}

        {d === 'facebook' && (
          <label className="option small">
            <input type="checkbox" checked={draft.meta.confirmDestinations} onChange={(e) => setMeta({ confirmDestinations: e.target.checked })} />
            Pause so I can check "Post to" before filling
          </label>
        )}
      </div>

      <PlatformPreview
        content={content}
        account={d === 'facebook' && draft.meta.pages.length ? draft.meta.pages.map((p) => p.name).join(', ') : d === 'youtube' && draft.youtube.channel ? draft.youtube.channel : undefined}
        fix={ytVideo && onlyImages ? { label: 'Switch to a channel post', onClick: () => setYt({ postType: 'post' }) } : undefined}
      />
    </div>
  );
}
