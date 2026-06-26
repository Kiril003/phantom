import { useEffect, useState } from 'react';
import { Download, Trash2, Database, RefreshCw, HardDrive } from 'lucide-react';
import { mapApi, type OfflineRegion } from '../../../services/api';

/**
 * Phase 24-G — Offline region manager HUD component.
 *
 * Provides a list of downloaded PMTiles regions, disk usage stats,
 * and actions to download new areas or delete existing ones.
 */

export interface OfflineRegionManagerProps {
  className?: string;
}

export function OfflineRegionManager({ className = '' }: OfflineRegionManagerProps): JSX.Element {
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [used, setUsed] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await mapApi.getOfflineRegions();
      setRegions(res.regions);
      setUsed(res.used_bytes);
      setCapacity(res.capacity_bytes);
    } catch (e) {
      console.error('Failed to load offline regions:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const pct = capacity > 0 ? (used / capacity) * 100 : 0;

  return (
    <div
      data-testid="offline-region-manager"
      className={`flex flex-col gap-3 p-4 w-[320px] rounded-2xl bg-black/75 backdrop-blur-xl border border-white/10 text-white ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider">Офлайн карти</span>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
          title="Оновити список"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-white/50 uppercase tracking-widest">
          <span>Сховище (Radxa)</span>
          <span>{formatSize(used)} / {formatSize(capacity)}</span>
        </div>
        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {regions.length === 0 && !loading && (
          <div className="py-8 text-center text-white/30 italic text-xs">
            Немає завантажених регіонів
          </div>
        )}
        {regions.map((r) => (
          <div
            key={r.id}
            className="group flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/15 transition-all"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-white/90">{r.name}</span>
              <div className="flex items-center gap-2 text-[9px] text-white/40 uppercase tracking-tighter">
                <span className="flex items-center gap-1">
                  <HardDrive size={8} />
                  {formatSize(r.size_bytes)}
                </span>
                <span>•</span>
                <span>{r.layers.join(', ')}</span>
              </div>
            </div>
            <button
              onClick={async () => {
                if (confirm(`Видалити ${r.name}?`)) {
                  await mapApi.deleteOfflineRegion(r.id);
                  void load();
                }
              }}
              className="p-2 text-white/30 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <button
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-[0.98]"
      >
        <Download size={14} />
        Завантажити область
      </button>
    </div>
  );
}
