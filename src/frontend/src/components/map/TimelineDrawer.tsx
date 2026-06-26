/**
 * Phase 9.4b — Collapsible timeline drawer for LocationHistory.
 *
 * Hidden by default. Opens via a button on the TacticalMap overlay. Fetches
 * the most recent 200 entries on open and on manual refresh. Clicking an
 * entry centers the map there (via the `onSelect` callback).
 */
import { useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { mapApi, type LocationHistoryEntry } from '../../services/api';

export interface TimelineDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (entry: LocationHistoryEntry) => void;
}

const sourceLabel: Record<string, string> = {
  gps_hardware: 'GPS',
  browser_geolocation: 'Browser',
  ip_estimate: 'IP',
  user_stated: 'Stated',
  none: '—',
};

export function TimelineDrawer({ open, onClose, onSelect }: TimelineDrawerProps) {
  const [entries, setEntries] = useState<LocationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mapApi.getLocationHistory(undefined, undefined, 200);
      setEntries(res.entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const grouped = useMemo(() => {
    const byDay = new Map<string, LocationHistoryEntry[]>();
    for (const e of entries) {
      const day = new Date(e.timestamp).toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }
    return Array.from(byDay.entries());
  }, [entries]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      className="h-full w-[360px] bg-black/75 backdrop-blur-2xl border-l border-white/10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300"
    >
      <header className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
            <Clock size={18} />
          </div>
          <span className="text-sm font-bold uppercase tracking-widest text-ink-primary">
            Історія переміщень
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="p-2 rounded-full hover:bg-white/5 disabled:opacity-20 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close timeline"
            className="p-2 rounded-full hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        {error ? (
          <div className="px-6 py-10 text-center">
            <AlertTriangle size={32} className="mx-auto text-rose-500 mb-3 opacity-50" />
            <div className="text-sm text-rose-400">{error}</div>
          </div>
        ) : entries.length === 0 && !loading ? (
          <div className="px-8 py-20 text-center space-y-3">
            <Clock size={48} className="mx-auto text-white/5" />
            <div className="text-xs text-white/30 italic font-serif leading-relaxed">
              Історія порожня. Записи з'являться автоматично при переміщенні або кожні 5 хвилин.
            </div>
          </div>
        ) : (
          grouped.map(([day, items]) => (
            <div key={day} className="mb-6 px-3">
              <div className="px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-3 flex items-center gap-4">
                <span className="shrink-0">{day}</span>
                <span className="h-px bg-white/5 flex-1" />
              </div>
              <div className="space-y-1">
                {items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelect?.(e)}
                    className="w-full text-left px-3 py-3 rounded-2xl hover:bg-white/5 flex items-start justify-between gap-4 transition-all group active:scale-[0.98]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-white/80 group-hover:text-white truncate font-display mb-0.5">
                        {e.place_name || e.city || `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/30 uppercase tracking-tighter">
                        <span className="text-amber-500/50">
                          {new Date(e.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                          {sourceLabel[e.source] ?? e.source}
                        </span>
                        {e.country_code && <span className="opacity-60">{e.country_code}</span>}
                      </div>
                    </div>
                    <div className="text-[9px] font-bold text-emerald-500/40 mt-1">
                      {Math.round((e.confidence ?? 0) * 100)}%
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
