/**
 * Phase 9.4b — Collapsible timeline drawer for LocationHistory.
 *
 * Hidden by default. Opens via a button on the TacticalMap overlay. Fetches
 * the most recent 200 entries on open and on manual refresh. Clicking an
 * entry centers the map there (via the `onSelect` callback).
 */
import { useEffect, useMemo, useState } from 'react';
import { Clock, RefreshCw, X } from 'lucide-react';
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
      const day = new Date(e.timestamp).toLocaleDateString();
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }
    return Array.from(byDay.entries());
  }, [entries]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Location timeline"
      className="absolute top-0 right-0 h-full w-[360px] bg-black/80 backdrop-blur-md border-l border-cyan-500/20 flex flex-col z-30"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-cyan-400" />
          <span className="text-sm uppercase tracking-wider text-cyan-300">
            Timeline
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Refresh timeline"
            onClick={() => void load()}
            disabled={loading}
            className="w-8 h-8 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-cyan-500/10 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            aria-label="Close timeline"
            onClick={onClose}
            className="w-8 h-8 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-cyan-500/10"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3 text-[13px]">
        {error ? (
          <div className="px-4 py-6 text-sm text-red-400">{error}</div>
        ) : entries.length === 0 && !loading ? (
          <div className="px-4 py-6 text-sm text-white/50">
            No entries yet. The history writer appends when you move more than
            50 m or every 5 minutes.
          </div>
        ) : (
          grouped.map(([day, items]) => (
            <div key={day} className="mb-3">
              <div className="px-3 text-xs uppercase tracking-wide text-white/40 mb-1">
                {day}
              </div>
              <ul className="space-y-1">
                {items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(e)}
                      className="w-full text-left px-3 py-2 rounded hover:bg-cyan-500/10 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-white truncate">
                          {e.place_name ||
                            e.city ||
                            `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`}
                        </div>
                        <div className="text-white/50 text-xs flex items-center gap-2">
                          <span>
                            {new Date(e.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="uppercase">
                            {sourceLabel[e.source] ?? e.source}
                          </span>
                          {e.country_code && <span>{e.country_code}</span>}
                        </div>
                      </div>
                      <span className="text-[11px] text-white/40 mt-1">
                        {Math.round((e.confidence ?? 0) * 100)}%
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
