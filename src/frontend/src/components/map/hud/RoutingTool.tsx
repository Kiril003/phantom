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
      className={`flex flex-col gap-2 p-2 rounded-2xl bg-black/65 backdrop-blur-xl border border-white/10 text-white shadow-2xl transition-all ${
        active ? 'w-[240px]' : 'w-[44px] overflow-hidden'
      }`}
    >
      <button
        onClick={onToggle}
        className={`min-h-[28px] min-w-[28px] flex items-center gap-2 rounded-lg transition-all ${
          active ? 'text-cyan-400' : 'text-white/60 hover:text-white'
        }`}
      >
        <Route size={18} strokeWidth={2} className="ml-1" />
        {active && <span className="text-[10px] font-bold uppercase tracking-wider">Маршрути</span>}
      </button>

      {active && (
        <div className="flex flex-col gap-3 p-1 animate-in fade-in slide-in-from-top-1">
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
              <MapPin size={12} className="text-emerald-400" />
              <input
                type="text"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Звідки (порожньо = моє місце)"
                className="flex-1 bg-transparent text-[10px] outline-none"
              />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
              <Navigation size={12} className="text-cyan-400" />
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && to.trim() && !loading) onPlan?.(from, to);
                }}
                placeholder="Куди..."
                className="flex-1 bg-transparent text-[10px] outline-none"
              />
            </div>
          </div>

          <button
            onClick={() => onPlan?.(from, to)}
            disabled={!to.trim() || loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 transition-all"
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
            <div className="px-2 text-[10px] leading-tight text-rose-300/90" role="alert">
              {error}
            </div>
          )}

          {summary && !loading && (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <span className="text-[10px] font-semibold text-cyan-200">{summary}</span>
              <button
                onClick={clear}
                aria-label="Очистити маршрут"
                className="min-h-[24px] min-w-[24px] flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-all"
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
