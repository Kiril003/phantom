import { useState } from 'react';
import { History, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Phase 24-H — Time Machine slider.
 *
 * Allows the operator to scrub through time for temporal layers
 * (S2 cloudless, historical mosaics, weather forecasts).
 */

export interface TimeMachineSliderProps {
  className?: string;
  onDateChange?: (date: string) => void;
}

export function TimeMachineSlider({ className = '', onDateChange }: TimeMachineSliderProps): JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const shiftDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    const newDate = d.toISOString().split('T')[0];
    setDate(newDate);
    onDateChange?.(newDate);
  };

  return (
    <div
      data-testid="time-machine-slider"
      className={`flex items-center gap-2 p-1.5 rounded-full bg-black/65 backdrop-blur-xl border border-white/10 text-white shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-2 px-2 border-r border-white/10">
        <History size={14} className="text-violet-400" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-200">
          Машина часу
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => shiftDate(-1)}
          className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        
        <div className="flex items-center gap-2 px-1 text-[11px] font-mono font-medium text-white/90">
          <Calendar size={12} className="text-white/40" />
          {date}
        </div>

        <button
          onClick={() => shiftDate(1)}
          className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
