import { useState } from 'react';
import { Route, Navigation, MapPin, ArrowRight, Loader2, X } from 'lucide-react';

/**
 * Phase 24-C — Routing tool.
 *
 * Collects an origin + destination and asks the backend to plan a route
 * (BRouter → ORS → OSRM fallback via `/map/route`). An empty origin means
 * "from my current position". The planned route is drawn by `RouteLayer`;
 * this panel only surfaces progress, the result summary, and a clear
 * affordance.
 */

export interface RoutingToolProps {
  active?: boolean;
  onToggle?: () => void;
  onPlan?: (from: string, to: string) => void;
  /** True while a plan request (geocode + route) is in flight. */
  loading?: boolean;
  /** Last failure message, shown inline. */
  error?: string | null;
  /** Preformatted summary of the active route (e.g. "12.4 км · 18 хв"). */
  summary?: string | null;
  /** Clear the active route + inputs. */
  onClear?: () => void;
}

export function RoutingTool({
  active = false,
  onToggle,
  onPlan,
  loading = false,
  error = null,
  summary = null,
  onClear,
}: RoutingToolProps): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const clear = () => {
    setFrom('');
    setTo('');
    onClear?.();
  };

  return (
    <div
      data-testid="routing-tool"
      className={`glass-elevated flex flex-col gap-2 rounded-2xl p-2 text-[color:var(--ink-primary)] shadow-2xl transition-all ${
        active ? 'w-[240px]' : 'w-[44px] overflow-hidden'
      }`}
    >
      <button
        onClick={onToggle}
        className={`min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 rounded-lg transition-all ${
          active ? 'text-[color:var(--primary-shadow,#5c3d05)]' : 'text-[color:var(--ink-secondary)]'
        }`}
      >
        <Route size={18} strokeWidth={2} className="ml-1" />
        {active && <span className="text-[10px] font-bold uppercase tracking-wider">Маршрути</span>}
      </button>

      {active && (
        <div className="flex flex-col gap-3 p-1 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-black/5 bg-black/[0.04]">
              <MapPin size={12} className="text-emerald-600" />
              <input
                type="text"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Звідки (порожньо = моє місце)"
                className="flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-black/5 bg-black/[0.04]">
              <Navigation size={12} className="text-amber-600" />
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && to.trim() && !loading) onPlan?.(from, to);
                }}
                placeholder="Куди..."
                className="flex-1 bg-transparent text-xs outline-none"
              />
            </div>
          </div>

          <button
            onClick={() => onPlan?.(from, to)}
            disabled={!to.trim() || loading}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/20 text-[10px] font-bold uppercase tracking-widest text-[color:var(--primary-shadow,#5c3d05)] transition-all hover:bg-amber-500/30 disabled:opacity-30"
          >
            {loading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Прокладаю
              </>
            ) : (
              <>
                Прокласти
                <ArrowRight size={12} />
              </>
            )}
          </button>

          {error && (
            <div className="px-2 text-[11px] leading-tight text-rose-600" role="alert">
              {error}
            </div>
          )}

          {summary && !loading && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
              <span className="text-[11px] font-semibold text-[color:var(--ink-primary)]">{summary}</span>
              <button
                onClick={clear}
                aria-label="Очистити маршрут"
                className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md text-[color:var(--ink-muted)] transition-all hover:bg-black/5"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
