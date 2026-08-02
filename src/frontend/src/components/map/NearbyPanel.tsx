/**
 * Phase 9.4b — Nearby places overlay.
 *
 * Auto-fetches `/map/nearby` when the map is zoomed >= 14 AND a position is
 * available. Renders three sections: remembered (MemoryFacts), osm
 * (Overpass features), pois (user-saved). The collapsed state is a small
 * pill at the map corner; it surfaces loading / error / empty states
 * instead of silently disappearing so the operator always knows the
 * subsystem is alive.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Landmark, Brain, ChevronRight, RefreshCw, AlertTriangle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);

  const shouldFetch = lat !== null && lon !== null && zoom >= MIN_ZOOM;

  const fetchNow = useCallback(async () => {
    if (lat === null || lon === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await mapApi.getNearby(lat, lon, radiusM);
      setData(res);
    } catch (e) {
      setData(null);
      setError((e as Error).message || 'Nearby lookup failed');
    } finally {
      setLoading(false);
    }
  }, [lat, lon, radiusM]);

  useEffect(() => {
    if (!shouldFetch) {
      setData(null);
      setExpanded(false);
      setError(null);
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

  if (!shouldFetch) return null;

  // Error state
  if (error) {
    return (
      <button
        type="button"
        onClick={() => void fetchNow()}
        aria-label="Не вдалося знайти поруч — повторити"
        className="px-3 py-2 min-h-[40px] rounded-full bg-rose-500/10 border border-rose-500/30 text-[10px] font-bold uppercase tracking-wider text-rose-300 hover:bg-rose-500/20 flex items-center gap-2 shadow-2xl"
      >
        <AlertTriangle size={14} />
        <span>Помилка пошуку — повторити</span>
      </button>
    );
  }

  // Loading state
  if (loading && total === 0) {
    return (
      <div
        className="px-3 py-2 min-h-[40px] rounded-full bg-black/65 backdrop-blur-xl border border-white/10 text-[10px] font-bold uppercase tracking-wider text-amber-200/80 flex items-center gap-2 shadow-2xl"
      >
        <RefreshCw size={14} className="animate-spin text-amber-500" />
        <span>Сканування околиць…</span>
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="px-3 py-2 min-h-[40px] rounded-full bg-black/50 backdrop-blur-xl border border-white/5 text-[10px] font-bold uppercase tracking-wider text-white/30 flex items-center gap-2">
        <MapPin size={12} />
        <span>Околиці пусті</span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`${total} місць поруч`}
        className="px-3 py-2 min-h-[40px] rounded-full bg-black/65 backdrop-blur-xl border border-white/10 text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:bg-white/5 flex items-center gap-2 shadow-2xl active:scale-95 transition-all"
      >
        <MapPin size={14} className="text-amber-500" />
        <span>{total} поруч</span>
        <ChevronRight size={12} className="opacity-50" />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      className="w-[320px] max-h-[400px] bg-black/75 backdrop-blur-2xl border border-white/10 rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <header className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <span className="text-amber-400 font-bold uppercase tracking-widest text-[10px]">
          Околиці ({total})
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-white/40 hover:text-white transition-colors"
        >
          <ChevronRight size={16} className="rotate-90" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        {data?.remembered && data.remembered.length > 0 && (
          <Section icon={<Brain size={14} />} label="Пам'ять" tone="cyan">
            {data.remembered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect?.({ kind: 'remembered', item: m })}
                className="w-full text-left px-3 py-2 hover:bg-white/5 rounded-xl flex items-center justify-between gap-2 transition-colors group"
              >
                <span className="truncate text-xs text-white/80 group-hover:text-white">{m.place_name || m.content}</span>
                <span className="text-[10px] font-mono text-white/30 shrink-0">
                  {m.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
        {data?.osm && data.osm.length > 0 && (
          <Section icon={<Landmark size={14} />} label="Об'єкти" tone="white">
            {data.osm.slice(0, 10).map((f) => (
              <button
                key={f.osm_id}
                type="button"
                onClick={() => onSelect?.({ kind: 'osm', item: f })}
                className="w-full text-left px-3 py-2 hover:bg-white/5 rounded-xl flex items-center justify-between gap-2 transition-colors group"
              >
                <span className="truncate text-xs text-white/80 group-hover:text-white">
                  {f.name || f.type || `node#${f.osm_id}`}
                </span>
                <span className="text-[10px] font-mono text-white/30 shrink-0">
                  {f.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
        {data?.pois && data.pois.length > 0 && (
          <Section icon={<MapPin size={14} />} label="Збережене" tone="yellow">
            {data.pois.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect?.({ kind: 'poi', item: p })}
                className="w-full text-left px-3 py-2 hover:bg-white/5 rounded-xl flex items-center justify-between gap-2 transition-colors group"
              >
                <span className="truncate text-xs text-white/80 group-hover:text-white">{p.name}</span>
                <span className="text-[10px] font-mono text-white/30 shrink-0">
                  {p.distance_m}m
                </span>
              </button>
            ))}
          </Section>
        )}
      </div>
      <footer className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-white/20 border-t border-white/5 flex items-center justify-between">
        <span>Радіус {radiusM}м</span>
        <button
          type="button"
          onClick={() => void fetchNow()}
          disabled={loading}
          className="hover:text-amber-400 transition-colors disabled:opacity-20"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
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
      ? 'text-cyan-400'
      : tone === 'yellow'
        ? 'text-amber-500'
        : 'text-white/50';
  return (
    <div className="mb-2 px-1">
      <div className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${toneClass}`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
