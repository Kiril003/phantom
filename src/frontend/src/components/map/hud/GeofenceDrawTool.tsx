import { useState } from 'react';
import { Target, Circle, Square, Save } from 'lucide-react';

/**
 * Phase 24-I — Geofence draw tool.
 *
 * Allows the operator to sketch alert zones on the map.
 * In this v1: simple point-click for circular zones.
 */

export interface GeofenceDrawToolProps {
  active?: boolean;
  onToggle?: () => void;
  onSave?: (name: string, kind: 'circle' | 'polygon', geom: any) => void;
}

export function GeofenceDrawTool({
  active = false,
  onToggle,
  onSave,
}: GeofenceDrawToolProps): JSX.Element {
  const [kind, setKind] = useState<'circle' | 'polygon'>('circle');
  const [name, setName] = useState('');

  return (
    <div
      data-testid="geofence-draw-tool"
      className={`flex flex-col gap-2 p-2 rounded-2xl bg-black/65 backdrop-blur-xl border border-white/10 text-white shadow-2xl transition-all ${
        active ? 'w-[200px]' : 'w-[44px] overflow-hidden'
      }`}
    >
      <button
        onClick={onToggle}
        className={`min-h-[44px] min-w-[44px] flex items-center justify-center gap-2 rounded-lg transition-all ${
          active ? 'text-rose-400' : 'text-white/60 hover:text-white'
        }`}
      >
        <Target size={18} strokeWidth={2} className="ml-1" />
        {active && <span className="text-[10px] font-bold uppercase tracking-wider">Малювання зон</span>}
      </button>

      {active && (
        <div className="flex flex-col gap-3 p-1 animate-in fade-in slide-in-from-top-1">
          <div className="flex gap-1 p-0.5 rounded-lg bg-white/5">
            <button
              onClick={() => setKind('circle')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-md transition-all ${
                kind === 'circle' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              <Circle size={14} />
              <span className="text-[8px] uppercase">Коло</span>
            </button>
            <button
              onClick={() => setKind('polygon')}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-md transition-all ${
                kind === 'polygon' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              <Square size={14} />
              <span className="text-[8px] uppercase">Полігон</span>
            </button>
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Назва зони..."
            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[10px] outline-none focus:border-rose-400/50"
          />

          <button
            onClick={() => onSave?.(name, kind, {})}
            disabled={!name}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 transition-all"
          >
            <Save size={12} />
            Зберегти
          </button>
        </div>
      )}
    </div>
  );
}
