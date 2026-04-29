/**
 * Day-4 W-2 — `map-pin` scene panel.
 *
 * Day-4 ships a TEXT manifest of the markers (compact list with
 * lat/lon/label). The interactive MapLibre embed is Day-5 polish —
 * lazy-loading 1.2 MB of MapLibre + MapTiler styles for every recall
 * scene is wasteful when 90 % of recall scenes are read-once. The
 * Day-5 upgrade swaps the manifest for `<TacticalMap markers>`
 * BEHIND the same envelope shape, so this panel's data contract is
 * stable.
 *
 * If `markers` is empty (e.g., a recall miss), we render a muted
 * placeholder so the scene composition still flows.
 */
import type { ScenePanel } from '@shared/types';
import { MapPin } from 'lucide-react';

type MapPinPanelData = Extract<ScenePanel, { kind: 'map-pin' }>['data'];

export function SceneMapPinPanel({ data }: { data: MapPinPanelData }) {
  if (!data.markers.length) {
    return (
      <div
        className="rounded glass-subtle px-3 py-2"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-micro)',
          color: 'var(--ink-muted)',
          letterSpacing: 'var(--tracking-wide)',
        }}
        data-testid="scene-map-pin-panel-empty"
      >
        no markers
      </div>
    );
  }

  return (
    <div
      className="rounded glass-subtle px-3 py-2"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-micro)',
        color: 'var(--ink-primary)',
      }}
      data-testid="scene-map-pin-panel"
      data-marker-count={data.markers.length}
    >
      <div
        className="flex items-center gap-1 mb-1.5"
        style={{ color: 'var(--accent)' }}
      >
        <MapPin size={11} strokeWidth={1.75} aria-hidden />
        <span style={{ letterSpacing: 'var(--tracking-wide)' }}>
          {data.markers.length} marker{data.markers.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {data.markers.map((marker, idx) => (
          <li key={`${marker.label}-${idx}`} className="flex items-center gap-2">
            <span
              aria-hidden
              className="block rounded-full"
              style={{
                width: 6,
                height: 6,
                background: marker.color ?? 'var(--accent)',
              }}
            />
            <span style={{ color: 'var(--ink-secondary)' }}>{marker.label}</span>
            <span style={{ color: 'var(--ink-muted)' }} className="tabular-nums">
              {marker.lat.toFixed(4)}, {marker.lon.toFixed(4)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
