import { useEffect, useMemo, useState } from 'react';
import { Search, X, Globe, Cloud, Lock } from 'lucide-react';
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
      className="absolute inset-0 z-40 bg-black/65 backdrop-blur-md flex justify-end"
    >
      <div className="w-[420px] h-full bg-zinc-950/95 border-l border-white/10 flex flex-col text-white/90">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <Search size={14} strokeWidth={1.75} className="opacity-65" />
          <input
            data-testid="layer-library-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Знайти шар..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-white/35"
          />
          <button
            type="button"
            data-testid="layer-library-close"
            aria-label="Закрити"
            onClick={onClose}
            className="min-h-[28px] min-w-[28px] flex items-center justify-center text-white/65 hover:text-white"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
          <FilterChip
            testid="filter-all"
            active={category === 'all'}
            onClick={() => setCategory('all')}
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
          <span className="mx-1 opacity-25">|</span>
          <FilterChip testid="filter-online" active={mode === 'online'} onClick={() => setMode(mode === 'online' ? 'all' : 'online')} icon={<Cloud size={11} strokeWidth={1.75} />} label="online" />
          <FilterChip testid="filter-offline" active={mode === 'offline'} onClick={() => setMode(mode === 'offline' ? 'all' : 'offline')} icon={<Globe size={11} strokeWidth={1.75} />} label="offline" />
          <FilterChip testid="filter-root" active={mode === 'root'} onClick={() => setMode(mode === 'root' ? 'all' : 'root')} icon={<Lock size={11} strokeWidth={1.75} />} label="root" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div data-testid="layer-library-loading" className="px-3 py-3 text-xs text-white/50">
              завантаження...
            </div>
          )}
          {error && (
            <div data-testid="layer-library-error" className="px-3 py-3 text-xs text-amber-300">
              ⚠ {error}
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div data-testid="layer-library-empty" className="px-3 py-3 text-xs text-white/40">
              жодного шару — змініть фільтри
            </div>
          )}
          <ul data-testid="layer-library-list" className="divide-y divide-white/5">
            {visible.map((layer) => (
              <li
                key={layer.id}
                data-testid={`layer-row-${layer.id}`}
                data-active={layer.active}
                className="px-3 py-2 flex items-start gap-2 hover:bg-white/5"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono text-white/55">{layer.category}</span>
                    {layer.require_root && (
                      <span data-testid={`layer-row-${layer.id}-root`} className="text-amber-300">
                        ROOT
                      </span>
                    )}
                    {!layer.require_internet && (
                      <span className="text-emerald-300">offline</span>
                    )}
                  </div>
                  <div className="text-[13px] truncate">{layer.name_ua}</div>
                  <div className="text-[10px] text-white/45 truncate">
                    {layer.attribution}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`layer-row-${layer.id}-toggle`}
                  aria-pressed={layer.active}
                  disabled={busyId === layer.id}
                  onClick={() => toggleLayer(layer)}
                  className={`min-h-[28px] min-w-[64px] px-2 rounded-md text-[11px] transition-colors ${
                    layer.active
                      ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                      : 'bg-white/8 text-white/65 hover:bg-white/15'
                  } ${busyId === layer.id ? 'opacity-50' : ''}`}
                >
                  {layer.active ? 'on' : 'off'}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-white/10 text-[10px] text-white/40 flex items-center justify-between">
          <span>{response ? `${visible.length} / ${response.total} шарів` : '—'}</span>
          {response?.load_errors?.length ? (
            <span className="text-amber-400">⚠ помилок реєстру: {response.load_errors.length}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  testid: string;
}

function FilterChip({ active, onClick, label, icon, testid }: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      data-active={active}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[28px] flex items-center gap-1 px-2 rounded-full text-[10px] transition-colors ${
        active ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
