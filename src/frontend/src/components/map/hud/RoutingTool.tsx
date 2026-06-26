import { useState } from 'react';
import { Route, Navigation, MapPin, ArrowRight } from 'lucide-react';

/**
 * Phase 24-C — Routing tool.
 *
 * Allows the operator to plan routes between two points using
 * the backend routing facade (BRouter/ORS).
 */

export interface RoutingToolProps {
  active?: boolean;
  onToggle?: () => void;
  onPlan?: (from: string, to: string) => void;
}

export function RoutingTool({
  active = false,
  onToggle,
  onPlan,
}: RoutingToolProps): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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
                placeholder="Звідки (або клік)..."
                className="flex-1 bg-transparent text-[10px] outline-none"
              />
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/5">
              <Navigation size={12} className="text-cyan-400" />
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Куди..."
                className="flex-1 bg-transparent text-[10px] outline-none"
              />
            </div>
          </div>

          <button
            onClick={() => onPlan?.(from, to)}
            disabled={!from || !to}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 transition-all"
          >
            Прокласти
            <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
