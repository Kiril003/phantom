import { Search, Sparkles, MapPin, Wifi } from 'lucide-react';
import { useMapStore } from '../../../stores/mapStore';
import { useMemo } from 'react';
import { expandQuery } from '../../../services/translit';
import { mapApi } from '../../../services/api';

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onResults?: (results: any) => void;
  className?: string;
}

export function SearchBar({ value, onChange, onResults, className = '' }: SearchBarProps) {
  const { pois, wardrivingRecords, setCenter, setZoom, setSearchQuery, tactical } = useMapStore((s) => ({
    pois: s.pois,
    wardrivingRecords: s.wardrivingRecords,
    setCenter: s.setCenter,
    setZoom: s.setZoom,
    setSearchQuery: s.setSearchQuery,
    tactical: s.tactical,
  }));

  const localResults = useMemo(() => {
    const rawQueries = expandQuery(value).map((q) => q.toLowerCase());
    if (rawQueries.length === 0 || !value) return null;
    
    const matches = (haystack: string) =>
      rawQueries.some((q) => haystack.includes(q));
      
    const nets = wardrivingRecords
      .filter((r) => matches((r.ssid ?? '').toLowerCase()) || matches(r.mac.toLowerCase()))
      .slice(0, 5);
      
    const intel = pois
      .filter((p) => matches(p.name.toLowerCase()) || matches(p.category.toLowerCase()))
      .slice(0, 5);
      
    return { intel, nets, total: intel.length + nets.length };
  }, [value, pois, wardrivingRecords]);

  const handleFullSearch = async () => {
    if (!value || !onResults) return;
    try {
      const res = await mapApi.get(`/nearby?lat=${tactical.lat ?? 50.45}&lon=${tactical.lon ?? 30.52}&radius_m=5000`);
      onResults(res);
      setSearchQuery('');
    } catch (err) {
      console.error('Full search failed:', err);
    }
  };

  return (
    <div className={`relative flex w-full flex-col items-center ${className}`}>
      {localResults && (
        <div 
          className="glass-elevated absolute bottom-full mb-3 w-[440px] p-2 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200"
          style={{ maxHeight: 300, overflowY: 'auto' }}
        >
          {localResults.total === 0 ? (
            <div className="p-4 text-center italic text-xs text-ink-muted font-serif">
              Локально нічого не знайдено — натисніть Enter для глибокого пошуку
            </div>
          ) : (
            <div className="space-y-2">
              {localResults.intel.length > 0 && (
                <div className="space-y-1">
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-ink-muted">Intel</div>
                  {localResults.intel.map(poi => (
                    <button
                      key={poi.id}
                      onClick={() => {
                        setCenter([poi.lon, poi.lat]);
                        setZoom(17);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-white/5 text-left transition-colors"
                    >
                      <MapPin size={14} className="text-amber-500" />
                      <span className="flex-1 text-xs text-ink-primary truncate font-display">{poi.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {localResults.nets.length > 0 && (
                <div className="space-y-1">
                  <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-ink-muted">Networks</div>
                  {localResults.nets.map(rec => (
                    <button
                      key={rec.mac}
                      onClick={() => {
                        setCenter([rec.lon, rec.lat]);
                        setZoom(17);
                        setSearchQuery('');
                      }}
                      className="w-full flex items-center gap-2 p-2 rounded-xl hover:bg-white/5 text-left transition-colors"
                    >
                      <Wifi size={14} className="text-amber-500" />
                      <span className="flex-1 text-xs text-ink-primary truncate font-mono">{rec.ssid || '(hidden)'}</span>
                      <span className="text-[10px] text-ink-muted tabular-nums">{rec.rssi} dBm</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ширина була зашита в 440 px. Поруч у тому ж рядку стоять керування
          й «поруч», і на 1024 вони переставали вміщатись — поле тепер
          віддає зайве сусідам. */}
      <div
        className="glass-card flex w-full items-center gap-2 px-3 shadow-2xl"
        style={{ height: 44, borderRadius: 9999, minWidth: 200 }}
      >
        <Search size={16} strokeWidth={1.75} className="text-amber-500/70" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFullSearch();
          }}
          placeholder="Знайти місце / мережу / точку…"
          className="flex-1 bg-transparent outline-none border-none text-sm text-ink-primary font-display"
        />
        <span
          className="uppercase inline-flex items-center gap-1 px-2 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600 text-[10px] font-bold tracking-widest cursor-pointer hover:bg-amber-500/20 transition-colors"
          style={{ height: 22 }}
          onClick={handleFullSearch}
        >
          <Sparkles size={10} strokeWidth={2} />
          <span>AI</span>
        </span>
      </div>
    </div>
  );
}
