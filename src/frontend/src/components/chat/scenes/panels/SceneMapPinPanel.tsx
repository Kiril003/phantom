/**
 * Панель `map-pin` у стрічці чату.
 *
 * Раніше тут був текстовий маніфест: «5 markers» і стовпчик градусів. Для
 * людини «50.4501, 30.5234» пʼять разів поспіль — шум, а не відповідь.
 * Мапа вже написана (`MapResponse`), тож панель показує саме її, а список
 * лишається легендою з назвами.
 *
 * MapResponse тягне MapLibre (~1,2 МБ), тому вантажиться лениво — чат без
 * гео-відповідей за нього не платить.
 */
import { Suspense, lazy } from 'react';
import type { ScenePanel } from '@shared/types';
import { MapPin } from 'lucide-react';
import { pluralUa } from '../../../../utils/format';

const MapResponse = lazy(() =>
  import('../../MapResponse').then((m) => ({ default: m.MapResponse })),
);

type MapPinPanelData = Extract<ScenePanel, { kind: 'map-pin' }>['data'];

const shell = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-micro)',
  letterSpacing: 'var(--tracking-wide)',
} as const;

export function SceneMapPinPanel({ data }: { data: MapPinPanelData }) {
  const markers = data.markers ?? [];

  if (!markers.length) {
    return (
      <div
        className="rounded glass-subtle px-3 py-2"
        style={{ ...shell, color: 'var(--ink-muted)' }}
        data-testid="scene-map-pin-panel-empty"
      >
        Нічого поруч не знайшов
      </div>
    );
  }

  const count = `${markers.length} ${pluralUa(markers.length, 'місце', 'місця', 'місць')}`;

  return (
    <div
      className="rounded glass-subtle overflow-hidden"
      style={shell}
      data-testid="scene-map-pin-panel"
      data-marker-count={markers.length}
    >
      <Suspense
        fallback={
          <div
            style={{ height: 220, color: 'var(--ink-muted)' }}
            className="flex items-center justify-center"
          >
            Малюю мапу…
          </div>
        }
      >
        <MapResponse data={{ markers, center: data.center, zoom: data.zoom }} />
      </Suspense>

      <div
        className="px-3 py-2 flex flex-col gap-1"
        style={{ borderTop: '1px solid var(--line-subtle)' }}
      >
        <div className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          <MapPin size={11} strokeWidth={1.75} aria-hidden />
          <span>{count}</span>
        </div>
        <ul className="flex flex-col gap-0.5">
          {markers.map((marker, idx) => (
            <li key={`${marker.label}-${idx}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="block rounded-full shrink-0"
                style={{
                  width: 6,
                  height: 6,
                  background: marker.color ?? 'var(--accent)',
                }}
              />
              <span style={{ color: 'var(--ink-secondary)' }}>{marker.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
