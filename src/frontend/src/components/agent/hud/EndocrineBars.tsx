import type { AgentEmotionVector } from '@shared/types';

interface EndocrineBarsProps {
  emotion: AgentEmotionVector | null;
}

export function EndocrineBars({ emotion }: EndocrineBarsProps) {
  if (!emotion) return null;

  return (
    <div className="flex gap-0.5 h-0.5 w-full opacity-60 px-1 mt-1">
      <div className="flex-1 bg-blue-400/30 overflow-hidden rounded-full">
        <div 
          className="h-full bg-blue-400 transition-all duration-700" 
          style={{ width: `${emotion.focus * 100}%` }} 
        />
      </div>
      <div className="flex-1 bg-amber-400/30 overflow-hidden rounded-full">
        <div 
          className="h-full bg-amber-400 transition-all duration-700" 
          style={{ width: `${emotion.curiosity * 100}%` }} 
        />
      </div>
      <div className="flex-1 bg-red-400/30 overflow-hidden rounded-full">
        <div 
          className="h-full bg-red-400 transition-all duration-700" 
          style={{ width: `${emotion.concern * 100}%` }} 
        />
      </div>
      <div className="flex-1 bg-slate-400/30 overflow-hidden rounded-full">
        <div 
          className="h-full bg-slate-400 transition-all duration-700" 
          style={{ width: `${emotion.fatigue * 100}%` }} 
        />
      </div>
    </div>
  );
}
