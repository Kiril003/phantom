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
      className={`flex items-center gap-2 p-1.5 rounded-full glass-elevated text-[color:var(--ink-primary)] shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-2 px-2 border-r border-black/10">
        <History size={14} className="text-violet-700" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-200">
          Машина часу
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => shiftDate(-1)}
          className="p-1.5 rounded-full hover:bg-black/10 text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)] transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        
        <div className="flex items-center gap-2 px-1 text-[11px] font-mono font-medium text-[color:var(--ink-primary)]">
          <Calendar size={12} className="text-[color:var(--ink-muted)]" />
          {date}
        </div>

        <button
          onClick={() => shiftDate(1)}
          className="p-1.5 rounded-full hover:bg-black/10 text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)] transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
