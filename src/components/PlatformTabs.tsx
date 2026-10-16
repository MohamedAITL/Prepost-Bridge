import { useEffect, useState } from 'react';
import { hasErrors, type DestinationContent } from '../../shared/validation';
import type { Draft, PlatformConfig } from '../types/content';
import type { DestinationId } from '../types/platform';
import { BRAND_NAMES, PlatformLogo } from './Brand';
import { PlatformConfigCard } from './PlatformConfigCard';

interface Props {
  destinations: DestinationId[];
  draft: Draft;
  validation: Record<DestinationId, DestinationContent>;
  onPlatformChange: (d: DestinationId, patch: Partial<PlatformConfig>) => void;
  onDraftChange: (fn: (d: Draft) => Draft) => void;
}

/** One tab per selected platform: its settings next to a preview of exactly what gets filled in. */
export function PlatformTabs({ destinations, draft, validation, onPlatformChange, onDraftChange }: Props) {
  const [active, setActive] = useState<DestinationId>(destinations[0]);
  useEffect(() => {
    if (!destinations.includes(active)) setActive(destinations[0]);
  }, [destinations, active]);
  const current = destinations.includes(active) ? active : destinations[0];

  return (
    <div className="tabs">
      <div className="tab-list" role="tablist" aria-label="Platforms">
        {destinations.map((d) => {
          const bad = validation[d] && hasErrors(validation[d]);
          const warn = !bad && validation[d]?.issues.some((i) => i.level === 'warning');
          return (
            <button
              key={d}
              type="button"
              role="tab"
              id={`tab-${d}`}
              aria-selected={current === d}
              aria-controls={`panel-${d}`}
              className={`tab${current === d ? ' is-active' : ''}`}
              onClick={() => setActive(d)}
            >
              <PlatformLogo id={d} size={16} />
              {BRAND_NAMES[d]}
              {(bad || warn) && <span className={`dot ${bad ? 'is-error' : 'is-warn'}`} aria-label={bad ? 'Needs fixing' : 'Has warnings'} />}
            </button>
          );
        })}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`}>
        <PlatformConfigCard key={current} destination={current} draft={draft} onChange={(patch) => onPlatformChange(current, patch)} onDraftChange={onDraftChange} />
      </div>
    </div>
  );
}
