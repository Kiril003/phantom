/**
 * Phase 9.4b — Nearby places overlay.
 *
 * Auto-fetches `/map/nearby` when the map is zoomed > 14 AND a position is
 * available. Renders three sections: remembered (MemoryFacts), osm
 * (Overpass features), pois (user-saved). Idle/collapsed state is a small
 * pill at the map corner showing the combined count.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Landmark, Brain, ChevronRight } from 'lucide-react';
import {
  mapApi,
  type NearbyResponse,
  type NearbyRememberedItem,
  type NearbyOsmItem,
  type NearbyPoiItem,
} from '../../services/api';

export interface NearbyPanelProps {
  lat: number | null;
  lon: number | null;
  zoom: number;
  radiusM?: number;
  onSelect?: (
    item:
      | { kind: 'remembered'; item: NearbyRememberedItem }
      | { kind: 'osm'; item: NearbyOsmItem }
      | { kind: 'poi'; item: NearbyPoiItem }
  ) => void;
}

const MIN_ZOOM = 14;

export function NearbyPanel({
  lat,
  lon,
  zoom,
  radiusM = 500,
  onSelect,
}: NearbyPanelProps) {
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const shouldFetch = lat !== null && lon !== null && zoom >= MIN_ZOOM;

  const fetchNow = useCallback(async () => {
    if (lat === null || lon === null) return;
    setLoading(true);
    try {
      const res = await mapApi.getNearby(lat, lon, radiusM);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, radiusM]);

  useEffect(() => {
    if (!shouldFetch) {
      setData(null);
      setExpanded(false);
      return;
    }
    void fetchNow();
  }, [shouldFetch, fetchNow]);

  const total = useMemo(
    () =>
      (data?.remembered.length ?? 0) +
      (data?.osm.length ?? 0) +
      (data?.pois.length ?? 0),
    [data],
  );

  if (!shouldFetch || total === 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="absolute bottom-24 right-4 z-20 px-3 py-2 min-w-[44px] min-h-[44px] rounded-full bg-black/70 backdrop-blur border border-cyan-500/30 text-xs text-cyan-200 hover:bg-cyan-500/10 flex items-center gap-2"
        aria-label={`${total} places nearby — expand`}
      >
        <MapPin size={14} />
        <span>{total} nearby</span>
        <ChevronRight size={12} />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Nearby places"
      className="absolute bottom-4 right-4 w-[320px] max-h-[60%] z-20 bg-black/80 backdrop-blur-md border border-cyan-500/30 rounded-lg flex flex-col text-[13px]"
    >
      <header className="px-4 py-2 border-b border-cyan-500/20 flex items-center justify-between">
        <span className="text-cyan-300 uppercase tracking-wider text-xs">
          Nearby ({total})
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-white/60 hover:text-white px-2 min-w-[44px] min-h-[44px] text-xs"
          aria-label="Collapse nearby panel"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        {data?.remembered && data.remembered.length > 0 && (
          <Section icon={<Brain size={14} />} label="Remembered" tone="cyan">
            {data.remembered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect?.({ kind: 'remembered', item: m })}
                className="w-full text-left px-3 py-1.5 hover:bg-cyan-500/10 rounded flex items-center justify-between gap-2"
              >
                <span className="truncate">{m.place_name || m.content}</span>
                <span className="text-white/40 text-[11px] shrink-0">
                  {m.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
        {data?.osm && data.osm.length > 0 && (
          <Section icon={<Landmark size={14} />} label="OSM" tone="white">
            {data.osm.slice(0, 10).map((f) => (
              <button
                key={f.osm_id}
                type="button"
                onClick={() => onSelect?.({ kind: 'osm', item: f })}
                className="w-full text-left px-3 py-1.5 hover:bg-white/10 rounded flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {f.name || f.type || `node#${f.osm_id}`}
                </span>
                <span className="text-white/40 text-[11px] shrink-0">
                  {f.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
        {data?.pois && data.pois.length > 0 && (
          <Section icon={<MapPin size={14} />} label="Saved" tone="yellow">
            {data.pois.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect?.({ kind: 'poi', item: p })}
                className="w-full text-left px-3 py-1.5 hover:bg-yellow-500/10 rounded flex items-center justify-between gap-2"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-white/40 text-[11px] shrink-0">
                  {p.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
      <footer className="px-3 py-1.5 text-[11px] text-white/40 border-t border-cyan-500/10">
        {loading ? 'Loading…' : `radius ${radiusM}m`}
      </footer>
    </div>
  );
}

function Section({
  icon,
  label,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'cyan' | 'white' | 'yellow';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'cyan'
      ? 'text-cyan-300'
      : tone === 'yellow'
        ? 'text-yellow-300'
        : 'text-white/70';
  return (
    <div className="mb-2">
      <div className={`px-3 text-[11px] uppercase tracking-wider mb-0.5 flex items-center gap-1.5 ${toneClass}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="px-1">{children}</div>
    </div>
  );
}
