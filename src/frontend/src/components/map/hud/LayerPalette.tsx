import { useState } from 'react';
import { Layers as LayersIcon, ChevronDown } from 'lucide-react';
import { useMapStore, type MapLayerKey } from '../../../stores/mapStore';

/**
 * Швидка палітра шарів у нижньому лівому куті OmniMap.
 *
 * Сім постійно розгорнутих чипів займали ~400 px і на 1024×600 налізали на
 * центральну навігацію, тож ряд згорнуто під тригер із лічильником увімкнених
 * шарів. Розгортається вгору — там вільно.
 */

const LAYER_LABELS: Record<MapLayerKey, string> = {
  base: 'Базовий',
  presence: 'Я',
  wardriving: 'Wi-Fi',
  heatmap: 'Тепло',
  intel: 'Розвідка',
  recon: 'Огляд',
  facts: 'Памʼять',
  cliff_scree: 'Скелі/осипи',
};

const LAYER_ORDER: ReadonlyArray<MapLayerKey> = [
  'base',
  'presence',
  'wardriving',
  'heatmap',
  'intel',
  'recon',
  'facts',
  'cliff_scree',
];

export interface LayerPaletteProps {
  className?: string;
  onOpenLibrary?: () => void;
}

export function LayerPalette({
  className = '',
  onOpenLibrary,
}: LayerPaletteProps): JSX.Element {
  const layers = useMapStore((s) => s.layers);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const [open, setOpen] = useState(false);

  const activeCount = LAYER_ORDER.filter((k) => !!layers[k]).length;

  return (
    <div data-testid="layer-palette" className={`relative ${className}`}>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 flex flex-col gap-1 p-1.5 rounded-2xl bg-black/70 backdrop-blur-md border border-white/5 min-w-[150px]">
          {LAYER_ORDER.map((key) => {
            const active = !!layers[key];
            return (
              <button
                key={key}
                type="button"
                data-testid={`layer-palette-${key}`}
                data-active={active}
                aria-pressed={active}
                onClick={() => toggleLayer(key)}
                className={`min-h-[44px] px-3 rounded-xl text-[11px] font-mono text-left transition-colors flex items-center gap-2 ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'bg-transparent text-white/55 hover:text-white/85'
                }`}
              >
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: active ? '#f4af25' : 'rgba(255,255,255,0.25)' }}
                />
                {LAYER_LABELS[key]}
              </button>
            );
          })}
          {onOpenLibrary && (
            <button
              type="button"
              data-testid="layer-palette-library"
              aria-label="Каталог шарів"
              onClick={onOpenLibrary}
              className="min-h-[44px] px-3 rounded-xl text-[11px] font-mono text-left text-white/55 hover:text-white flex items-center gap-2 border-t border-white/5 mt-0.5 pt-1"
            >
              <LayersIcon size={12} strokeWidth={1.75} />
              Каталог шарів
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        data-testid="layer-palette-toggle"
        aria-expanded={open}
        aria-label="Шари мапи"
        onClick={() => setOpen(!open)}
        className="min-h-[44px] flex items-center gap-2 px-3 rounded-full bg-black/55 backdrop-blur-md border border-white/5 text-[10px] font-mono text-white/80 hover:text-white transition-colors"
      >
        <LayersIcon size={13} strokeWidth={1.75} />
        Шари · {activeCount}
        <ChevronDown
          size={12}
          strokeWidth={2}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </button>
    </div>
  );
}
