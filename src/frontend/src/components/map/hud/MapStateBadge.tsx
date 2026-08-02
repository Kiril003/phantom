import { useSystemStore } from '../../../stores/systemStore';
import { SystemState } from '@shared/types';

/**
 * Phase 24-D — colored dot reflecting the current SystemState.
 *
 * Sits in the OmniMap top-left so the operator sees at a glance which
 * "lens" the map is rendered through (SHADOW dim, FOCUS sharp, RECON
 * tactical, GHOST red, DREAM violet). Doctrine §7.2.
 */

const STATE_TINT: Record<SystemState, { fill: string; label: string }> = {
  [SystemState.SHADOW]: { fill: '#5b6172', label: 'Тінь' },
  [SystemState.FOCUS]: { fill: '#7dd3fc', label: 'Фокус' },
  [SystemState.DIALOGUE]: { fill: '#facc15', label: 'Діалог' },
  [SystemState.SENTINEL]: { fill: '#f87171', label: 'Варта' },
  [SystemState.GHOST]: { fill: '#ef4444', label: 'Привид' },
  [SystemState.DREAM]: { fill: '#a78bfa', label: 'Сон' },
  [SystemState.OPERATOR]: { fill: '#34d399', label: 'Штаб' },
};

export interface MapStateBadgeProps {
  className?: string;
  /** Override (used by Storybook + tests). */
  state?: SystemState;
}

export function MapStateBadge({ className = '', state }: MapStateBadgeProps): JSX.Element {
  const live = useSystemStore((s) => s.state);
  const current = state ?? live;
  const tint = STATE_TINT[current] ?? STATE_TINT[SystemState.SHADOW];
  return (
    <div
      data-testid="map-state-badge"
      data-state={current}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/55 backdrop-blur-md text-[10px] text-white/85 border border-white/5 ${className}`}
      title={`Стан системи: ${tint.label}`}
    >
      <span
        aria-hidden
        className="w-2 h-2 rounded-full"
        style={{ background: tint.fill, boxShadow: `0 0 8px ${tint.fill}66` }}
      />
      <span className="uppercase tracking-wider">{tint.label}</span>
    </div>
  );
}
