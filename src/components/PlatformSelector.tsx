import type { ReactNode } from 'react';
import { DESTINATIONS, type DestinationId } from '../types/platform';
import type { Draft } from '../types/content';
import { BRAND_NAMES, PlatformLogo } from './Brand';

interface Props {
  platforms: Draft['platforms'];
  onToggle: (d: DestinationId, enabled: boolean) => void;
  /** Rendered inside the Meta row when it's on (the Page checkboxes). */
  metaPagePicker?: ReactNode;
  /** Rendered inside the YouTube row when it's on (the channel choice). */
  youtubeChannelPicker?: ReactNode;
}

const SUBTITLE: Record<DestinationId, string> = {
  facebook: 'Facebook Pages and their Instagram',
  instagram: 'Through Meta Business Suite',
  x: 'Up to 4 images or 1 video',
  youtube: 'Video, Short or channel post',
  tiktok: 'Video or photos',
};

export function PlatformSelector({ platforms, onToggle, metaPagePicker, youtubeChannelPicker }: Props) {
  return (
    <ul className="platform-list">
      {DESTINATIONS.map((d) => {
        const on = platforms[d].enabled;
        return (
          <li key={d} className={`platform-row${on ? ' is-on' : ''}`}>
            <div className="platform-main">
              <label className="platform-toggle">
                <span className="platform-icon">
                  <PlatformLogo id={d} size={22} />
                </span>
                <span className="platform-text">
                  <strong>{BRAND_NAMES[d]}</strong>
                  <small>{SUBTITLE[d]}</small>
                </span>
                <input type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => onToggle(d, e.target.checked)} aria-label={`Post to ${BRAND_NAMES[d]}`} />
              </label>
            </div>
            {d === 'facebook' && on && metaPagePicker}
            {d === 'youtube' && on && youtubeChannelPicker}
          </li>
        );
      })}
    </ul>
  );
}
