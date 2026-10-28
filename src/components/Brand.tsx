import { siFacebook, siInstagram, siMeta, siTiktok, siWordpress, siX, siYoutube, type SimpleIcon } from 'simple-icons';
import type { DestinationId } from '../types/platform';

// Official brand marks (Simple Icons, CC0). X and TikTok are black marks, so they follow the text
// color to stay visible in dark mode.
const ICONS: Record<DestinationId, { icon: SimpleIcon; color: string }> = {
  facebook: { icon: siMeta, color: `#${siMeta.hex}` },
  instagram: { icon: siInstagram, color: `#${siInstagram.hex}` },
  x: { icon: siX, color: 'currentColor' },
  youtube: { icon: siYoutube, color: `#${siYoutube.hex}` },
  tiktok: { icon: siTiktok, color: 'currentColor' },
  wordpress: { icon: siWordpress, color: `#${siWordpress.hex}` },
};

export const BRAND_NAMES: Record<DestinationId, string> = {
  facebook: 'Meta',
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  wordpress: 'WordPress',
};

export function PlatformLogo({ id, size = 20, title }: { id: DestinationId; size?: number; title?: string }) {
  const { icon, color } = ICONS[id];
  return (
    <svg className="platform-logo" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title ?? BRAND_NAMES[id]} fill={color}>
      <path d={icon.path} />
    </svg>
  );
}

/** Small Facebook / Instagram marks shown next to a Meta Page. */
export function MiniLogo({ which }: { which: 'facebook' | 'instagram' }) {
  const icon = which === 'facebook' ? siFacebook : siInstagram;
  return (
    <svg className="mini-logo" width={14} height={14} viewBox="0 0 24 24" role="img" aria-label={which === 'facebook' ? 'Facebook' : 'Instagram'} fill={`#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  );
}

/** App mark: a draft card with a check, i.e. "prepared, waiting for you". */
export function AppLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="app-logo">
      <rect x="3" y="5" width="22" height="22" rx="6" fill="var(--accent)" opacity="0.25" />
      <rect x="7" y="3" width="22" height="22" rx="6" fill="var(--accent)" />
      <path d="M12.5 14.5l3 3 6-6.5" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
