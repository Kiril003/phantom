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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
/** Скільки OSM-обʼєктів показуємо; решта — чесним словом у заголовку. */
const OSM_LIMIT = 10;

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
  // Гонтлет Р2, Н1: заголовок обіцяє 9, у вікні видно 5 — і жодного натяку,
  // що далі є ще. Стежимо, чи список обрізаний вікном, і кажемо це словом.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [hasBelow, setHasBelow] = useState(false);
  const measureOverflow = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setHasBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const raf = requestAnimationFrame(measureOverflow);
    return () => cancelAnimationFrame(raf);
  }, [expanded, data, measureOverflow]);

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
  // Заголовок обіцяє рівно стільки рядків, скільки панель справді малює:
  // OSM ріжеться до OSM_LIMIT, і лічильник мусить це визнавати.
  const shown = useMemo(
    () =>
      (data?.remembered.length ?? 0) +
      Math.min(data?.osm.length ?? 0, OSM_LIMIT) +
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
        className="glass-card px-3 py-2 min-h-[44px] rounded-full border border-rose-500/40 text-[10px] font-bold uppercase tracking-wider text-[color:var(--signal-alert)] hover:bg-rose-500/10 flex items-center gap-2 shadow-2xl"
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
        className="glass-card flex min-h-[44px] items-center gap-2 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink-secondary)] shadow-2xl"
      >
        <RefreshCw size={14} className="animate-spin text-amber-500" />
        <span>Сканування околиць…</span>
      </div>
    );
  }

  if (total === 0) {
    // Порожнеча — словом, а не рядками-привидами (гонтлет Р1, удар №1).
    return (
      <div className="glass-card flex min-h-[44px] items-center gap-2 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink-secondary)]">
        <MapPin size={12} className="text-[color:var(--ink-muted)]" />
        <span>Околиці · даних немає</span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`${total} місць поруч`}
        className="glass-card flex min-h-[44px] items-center gap-2 rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[color:var(--ink-primary)] shadow-2xl transition-all hover:bg-amber-500/10 active:scale-95"
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
      aria-label="Околиці"
      /* Скло тут було напівпрозорим білим поверх бежевої підложки — дев'ять
         рядків розчинялись у мапі (гонтлет Р1, удар №1, 6/6 голосів).
         Списку, який треба ЧИТАТИ, належить непрозора поверхня.
         Ширина 360 + shrink-0 (гонтлет Р2, Н3): панель живе у флекс-слоті
         HUD шириною 168px, і без shrink-0 її «320px» мовчки стискались до
         168 — саме тому «Софійський соб…» різався при вільному місці на
         мапі. Слот має justify-end, тож ширша панель чесно виростає вліво
         поверх мапи, а не тисне сусідів. */
      className="flex max-h-[320px] w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--glass-border)] shadow-2xl animate-in zoom-in-95 duration-200"
      style={{ background: 'var(--surface-raised)' }}
    >
      <header className="pl-4 pr-2 py-1.5 border-b border-[color:var(--glass-border)] flex items-center justify-between">
        <span className="font-bold uppercase tracking-widest text-[10px] text-[color:var(--ink-secondary)] flex items-center gap-1.5">
          <MapPin size={12} className="text-amber-600" aria-hidden />
          Околиці ({shown}{total > shown ? ` з ${total}` : ''})
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Згорнути околиці"
          className="flex h-11 w-11 items-center justify-center rounded-full text-[color:var(--ink-muted)] hover:text-[color:var(--ink-primary)] transition-colors"
        >
          <ChevronRight size={16} className="rotate-90" />
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={measureOverflow}
        className="flex-1 overflow-y-auto py-2 custom-scrollbar"
      >
        {data?.remembered && data.remembered.length > 0 && (
          <Section icon={<Brain size={14} />} label="Пам'ять" tone="cyan">
            {data.remembered.map((m) => (
              <NearbyRow
                key={m.id}
                name={m.place_name || m.content}
                distanceM={m.distance_m}
                onClick={() => onSelect?.({ kind: 'remembered', item: m })}
              />
            ))}
          </Section>
        )}
        {data?.osm && data.osm.length > 0 && (
          <Section
            icon={<Landmark size={14} />}
            label={
              data.osm.length > OSM_LIMIT
                ? `Об'єкти · перші ${OSM_LIMIT} з ${data.osm.length}`
                : "Об'єкти"
            }
            tone="white"
          >
            {data.osm.slice(0, OSM_LIMIT).map((f) => (
              <NearbyRow
                key={f.osm_id}
                name={f.name || f.type || `node#${f.osm_id}`}
                distanceM={f.distance_m}
                onClick={() => onSelect?.({ kind: 'osm', item: f })}
              />
            ))}
          </Section>
        )}
        {data?.pois && data.pois.length > 0 && (
          <Section icon={<MapPin size={14} />} label="Збережене" tone="yellow">
            {data.pois.map((p) => (
              <NearbyRow
                key={p.id}
                name={p.name}
                distanceM={p.distance_m}
                onClick={() => onSelect?.({ kind: 'poi', item: p })}
              />
            ))}
          </Section>
        )}
      </div>
      {hasBelow && (
        <div
          aria-hidden
          className="flex items-center justify-center gap-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[color:var(--ink-muted)] border-t border-[color:var(--glass-border)] bg-[color:var(--surface-raised)]"
        >
          <ChevronRight size={10} className="rotate-90" />
          <span>нижче ще</span>
        </div>
      )}
      <footer className="px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-[color:var(--ink-muted)] border-t border-[color:var(--glass-border)] flex items-center justify-between">
        <span>Радіус {radiusM} м</span>
        <button
          type="button"
          onClick={() => void fetchNow()}
          disabled={loading}
          aria-label="Оновити околиці"
          className="hover:text-amber-600 transition-colors disabled:opacity-30"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </footer>
    </div>
  );
}

/**
 * Один рядок списку. Текст — чорнилом теми, а не білим-на-білому:
 * рядок, який неможливо прочитати, гірший за відсутній.
 *
 * Гонтлет Р2, Н3: ім'я — корисне навантаження навігаційного списку,
 * а колонка дистанцій коротка. Довге ім'я переносимо на другий рядок;
 * еліпсис — лише коли справді нема куди (після двох рядків), і тоді
 * повне ім'я лишається доступним через title.
 */
function NearbyRow({
  name,
  distanceM,
  onClick,
}: {
  name: string;
  distanceM: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className="w-full text-left px-3 py-2 hover:bg-amber-500/10 rounded-xl flex items-baseline justify-between gap-2 transition-colors"
    >
      <span className="line-clamp-2 break-words min-w-0 flex-1 text-xs leading-snug text-[color:var(--ink-primary)]">
        {name}
      </span>
      <span className="text-[10px] tabular-nums text-[color:var(--ink-muted)] shrink-0">
        {distanceM} м
      </span>
    </button>
  );
}

/**
 * Роль секції каже кольорова крапка-бейдж і вага шрифту, а не прозорість
 * тексту: колір — декорація, читабельність — з чорнила теми.
 */
const SECTION_DOT: Record<'cyan' | 'white' | 'yellow', string> = {
  cyan: '#0891b2',
  yellow: '#d97706',
  white: 'var(--ink-muted)',
};

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
  return (
    <div className="mb-2 px-1">
      <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-[color:var(--ink-secondary)]">
        <span
          aria-hidden
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: SECTION_DOT[tone] }}
        />
        {icon}
        <span>{label}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
