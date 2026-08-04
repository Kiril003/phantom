import { Search, MapPin, Navigation, Landmark, Heart, X, ChevronRight } from 'lucide-react';

/**
 * Phase 24-G — Search Results Panel.
 *
 * Displays unified results from SearchBar (Remembered, OSM, POIs).
 */

export interface SearchResult {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  type?: string;
  distance_m?: number;
  tags?: Record<string, string>;
}

export interface SearchResultsPanelProps {
  open: boolean;
  onClose: () => void;
  results: {
    remembered: SearchResult[];
    osm: SearchResult[];
    pois: SearchResult[];
  };
  onSelect: (res: SearchResult) => void;
}

export function SearchResultsPanel({ open, onClose, results, onSelect }: SearchResultsPanelProps) {
  if (!open) return null;

  const total = results.remembered.length + results.osm.length + results.pois.length;

  return (
    <div className="absolute top-20 left-[84px] w-80 max-h-[calc(100vh-230px)] flex flex-col bg-ink-primary/95 backdrop-blur-md border border-black/10 rounded-2xl shadow-2xl overflow-hidden z-20 transition-all animate-in slide-in-from-left-8">
      {/* Header */}
      <div className="p-4 border-b border-black/5 flex items-center justify-between bg-black/[0.04]">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-amber-500" />
          <span className="text-xs font-bold uppercase tracking-widest text-[color:var(--ink-primary)]">Результати ({total})</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-black/10 text-[color:var(--ink-muted)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {total === 0 ? (
          <div className="py-20 text-center space-y-2 opacity-30">
            <Search size={32} className="mx-auto" />
            <div className="text-[10px] uppercase font-bold tracking-tighter">Нічого не знайдено</div>
          </div>
        ) : (
          <div className="p-2 space-y-6">
            {results.pois.length > 0 && (
              <ResultSection 
                title="Збережені точки" 
                icon={<Heart size={10} />} 
                items={results.pois} 
                onSelect={onSelect}
                color="text-rose-500"
              />
            )}
            
            {results.remembered.length > 0 && (
              <ResultSection 
                title="З пам'яті (AI)" 
                icon={<Landmark size={10} />} 
                items={results.remembered} 
                onSelect={onSelect}
                color="text-amber-500"
              />
            )}

            {results.osm.length > 0 && (
              <ResultSection 
                title="Мапа (OSM)" 
                icon={<MapPin size={10} />} 
                items={results.osm} 
                onSelect={onSelect}
                color="text-blue-500"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultSection({ title, icon, items, onSelect, color }: { 
  title: string, 
  icon: React.ReactNode, 
  items: SearchResult[], 
  onSelect: (res: SearchResult) => void,
  color: string
}) {
  return (
    <div className="space-y-1">
      <div className={`px-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] ${color} opacity-80 mb-2`}>
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="w-full text-left p-2.5 rounded-xl hover:bg-black/5 group transition-all flex items-center gap-3 active:scale-[0.98]"
          >
            <div className="w-8 h-8 rounded-lg bg-black/[0.04] flex items-center justify-center text-[color:var(--ink-muted)] group-hover:text-[color:var(--ink-muted)] transition-colors shrink-0">
              <Navigation size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-[color:var(--ink-primary)] font-display truncate group-hover:text-[color:var(--ink-primary)] transition-colors">{item.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] text-[color:var(--ink-muted)] uppercase font-bold tracking-wider truncate">{item.type || item.category}</span>
                {item.distance_m && (
                  <span className="text-[9px] text-amber-500/50 font-bold tracking-tighter shrink-0">
                    {item.distance_m > 1000 ? `${(item.distance_m/1000).toFixed(1)} км` : `${item.distance_m} м`}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight size={12} className="text-[color:var(--ink-primary)]/10 group-hover:text-[color:var(--ink-muted)] transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
