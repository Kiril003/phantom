import { useEffect, useMemo, useState } from 'react';
import { Search, X, Globe, Cloud, Lock, RefreshCw, AlertTriangle } from 'lucide-react';
import { mapApi, type LayerCategory, type LayerManifest, type LayerRegistryResponse } from '../../../services/api';

/**
 * Phase 24-E — Layer Library panel.
 *
 * Slide-in catalogue of every registry-known layer (26 in v1, target
 * 80+). The operator searches, filters, and toggles layers here; the
 * panel POSTs `/map/layers/{id}/enable` and DELETEs `/map/layers/{id}`
 * straight to the backend so the AttributionStore stays
 * authoritative — the LayerPalette quick-toggle on the map's bottom
 * left is just a hot-key surface for the most-used layers.
 *
 * Doctrine §6 (Settings → Layers) + §3 (Registry).
 */

export interface LayerLibraryPanelProps {
  open: boolean;
  onClose: () => void;
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  testid?: string;
}

type FilterMode = 'all' | 'online' | 'offline' | 'root';

export function LayerLibraryPanel({ open, onClose }: LayerLibraryPanelProps): JSX.Element | null {
  const [response, setResponse] = useState<LayerRegistryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [category, setCategory] = useState<LayerCategory | 'all'>('all');
  const [mode, setMode] = useState<FilterMode>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await mapApi.getLayers();
      setResponse(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалось завантажити шари');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open]);

  const visible = useMemo(() => {
    if (!response) return [];
    const q = query.trim().toLowerCase();
    return response.layers.filter((layer) => {
      if (category !== 'all' && layer.category !== category) return false;
      if (mode === 'online' && layer.available_offline) return false;
      if (mode === 'offline' && !layer.available_offline) return false;
      if (mode === 'root' && !layer.require_root) return false;
      if (!q) return true;
      const haystack = `${layer.id} ${layer.name_ua} ${layer.name_en} ${(layer.tags ?? []).join(' ')} ${layer.attribution}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [response, query, category, mode]);

  const toggleLayer = async (layer: LayerManifest) => {
    setBusyId(layer.id);
    try {
      if (layer.active) {
        await mapApi.disableLayer(layer.id);
      } else {
        await mapApi.enableLayer(layer.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка перемикання шару');
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="layer-library-panel"
      className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px] flex justify-start pointer-events-none"
      onClick={onClose}
    >
      <div
        className="w-[420px] h-full bg-black/80 backdrop-blur-2xl border-r border-white/10 flex flex-col text-white/90 shadow-2xl pointer-events-auto animate-in slide-in-from-left duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
          <Search size={18} strokeWidth={2} className="text-amber-500/50" />
          <input
            data-testid="layer-library-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук у реєстрі шарів..."
            className="flex-1 bg-transparent outline-none text-sm font-display placeholder:text-white/20"
          />
          <button
            type="button"
            data-testid="layer-library-close"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5 overflow-x-auto no-scrollbar">
          <FilterChip
            testid="filter-all"
            active={category === 'all' && mode === 'all'}
            onClick={() => { setCategory('all'); setMode('all'); }}
            label="усі"
          />
          {(response?.categories ?? []).map((cat) => (
            <FilterChip
              key={cat}
              testid={`filter-cat-${cat}`}
              active={category === cat}
              onClick={() => setCategory(cat)}
              label={cat}
            />
          ))}
          <span className="w-px h-4 bg-white/10 mx-1" />
          <FilterChip testid="filter-online" active={mode === 'online'} onClick={() => setMode(mode === 'online' ? 'all' : 'online')} icon={<Cloud size={12} />} label="online" />
          <FilterChip testid="filter-offline" active={mode === 'offline'} onClick={() => setMode(mode === 'offline' ? 'all' : 'offline')} icon={<Globe size={12} />} label="offline" />
          <FilterChip testid="filter-root" active={mode === 'root'} onClick={() => setMode(mode === 'root' ? 'all' : 'root')} icon={<Lock size={12} />} label="root" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && (
            <div data-testid="layer-library-loading" className="px-10 py-20 text-center space-y-4">
              <RefreshCw size={32} className="mx-auto animate-spin text-amber-500/30" />
              <div className="text-xs text-white/30 uppercase tracking-widest font-bold">Оновлення реєстру...</div>
            </div>
          )}
          {error && (
            <div data-testid="layer-library-error" className="px-10 py-20 text-center space-y-4">
              <AlertTriangle size={32} className="mx-auto text-rose-500/50" />
              <div className="text-sm text-rose-400 font-display italic">{error}</div>
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="px-10 py-20 text-center text-xs text-white/30 italic font-serif">
              Жодного шару не знайдено — спробуйте змінити фільтри
            </div>
          )}
          <ul data-testid="layer-library-list" className="divide-y divide-white/5 px-2">
            {visible.map((layer) => (
              <li
                key={layer.id}
                data-testid={`layer-row-${layer.id}`}
                data-active={layer.active}
                className="px-3 py-4 flex items-center gap-4 hover:bg-white/5 rounded-2xl transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500/70 text-[8px] font-bold uppercase tracking-widest">{layer.category}</span>
                    {layer.require_root && (
                      <span data-testid={`layer-row-${layer.id}-root`} className="text-rose-400 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-rose-500/20">ROOT</span>
                    )}
                    {!layer.require_internet && (
                      <span className="text-emerald-400 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-emerald-500/20">OFFLINE</span>
                    )}
                  </div>
                  <div className="text-[14px] text-white/90 font-display group-hover:text-white transition-colors">{layer.name_ua}</div>
                  <div className="text-[10px] text-white/30 truncate mt-0.5">
                    {layer.attribution}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`layer-row-${layer.id}-toggle`}
                  aria-pressed={layer.active}
                  disabled={busyId === layer.id}
                  onClick={() => toggleLayer(layer)}
                  className={`min-h-[32px] min-w-[64px] px-3 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 ${layer.active
                      ? 'bg-amber-500 text-ink-inverse shadow-[0_0_12px_rgba(244,175,37,0.3)]'
                      : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white border border-white/5'
                    } ${busyId === layer.id ? 'opacity-50 cursor-wait' : ''}`}
                >
                  {layer.active ? 'Active' : 'Enable'}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5 text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 flex items-center justify-between">
          <span>{response ? `${visible.length} / ${response.total} layers` : '—'}</span>
          {response?.load_errors?.length ? (
            <span className="text-rose-500/60 flex items-center gap-1">
              <AlertTriangle size={10} />
              Registry errors: {response.load_errors.length}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, icon, testid }: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`min-h-[28px] flex items-center gap-1.5 px-3 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${active
          ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40'
          : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white border border-white/5'
        }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
