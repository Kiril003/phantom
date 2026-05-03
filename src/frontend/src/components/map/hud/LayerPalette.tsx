import { Layers as LayersIcon } from 'lucide-react';
import { useMapStore, type MapLayerKey } from '../../../stores/mapStore';

/**
 * Phase 24-D — quick-toggle palette of currently-active layers.
 *
 * Sits at the bottom-left of the OmniMap. Each chip toggles the
 * corresponding `mapStore.layers[key]`. Double-tap on any chip is the
 * 24-E entry point to the full LayerLibrary; for now the chip just
 * emits a `data-double-tap` event the parent can listen for.
 *
 * Doctrine §7.1.
 */

const LAYER_LABELS: Record<MapLayerKey, string> = {
  base: 'Базовий',
  presence: 'Я',
  wardriving: 'Wi-Fi',
  heatmap: 'Heat',
  intel: 'Intel',
  recon: 'Recon',
  facts: 'Памʼять',
};

const LAYER_ORDER: ReadonlyArray<MapLayerKey> = [
  'base',
  'presence',
  'wardriving',
  'heatmap',
  'intel',
  'recon',
  'facts',
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
  return (
    <div
      data-testid="layer-palette"
      className={`flex items-center gap-1 px-1.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/5 ${className}`}
    >
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
            className={`min-h-[28px] min-w-[44px] px-2 rounded-full text-[10px] font-mono transition-colors ${
              active
                ? 'bg-white/15 text-white'
                : 'bg-transparent text-white/55 hover:text-white/80'
            }`}
          >
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
          className="min-h-[28px] min-w-[28px] flex items-center justify-center text-white/65 hover:text-white"
        >
          <LayersIcon size={12} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
