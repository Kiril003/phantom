import { Layers, Radar, Wifi, Flame, MapPin, Route, Sparkles, Satellite, Compass } from 'lucide-react';
import { useMapStore, type MapLayerKey } from '../../../stores/mapStore';

/** Назви стилів мапи приходять службовими ключами. */
const STYLE_UA: Record<string, string> = {
  dark: 'темний',
  streets: 'вулиці',
  satellite: 'супутник',
};

// Підписи шарів були англійськими — на боковій рейці мапи це єдиний
// текст, який пояснює, що вмикає кнопка.
const LATERAL_ITEMS: Array<{ key: MapLayerKey; icon: React.ReactNode; label: string }> = [
  { key: 'base', icon: <Layers size={18} strokeWidth={1.75} />, label: 'Основа' },
  { key: 'presence', icon: <Radar size={18} strokeWidth={1.75} />, label: 'Присутність' },
  { key: 'wardriving', icon: <Wifi size={18} strokeWidth={1.75} />, label: 'Мережі' },
  { key: 'heatmap', icon: <Flame size={18} strokeWidth={1.75} />, label: 'Теплокарта' },
  { key: 'intel', icon: <MapPin size={18} strokeWidth={1.75} />, label: 'Місця' },
  { key: 'recon', icon: <Route size={18} strokeWidth={1.75} />, label: 'Розвідка' },
  { key: 'facts', icon: <Sparkles size={18} strokeWidth={1.75} />, label: 'Спогади' },
];

export function LayerControlZone({
  bearing,
  mapStyle,
  onCycleStyle,
  onResetBearing,
  // @ts-ignore
  timelineOpen,
  // @ts-ignore
  onToggleTimeline,
  // @ts-ignore
  offlineOpen,
  // @ts-ignore
  onToggleOffline,
  // @ts-ignore
  analysisOpen,
  // @ts-ignore
  onToggleAnalysis,
  // @ts-ignore
  storyOpen,
  // @ts-ignore
  onToggleStory,
  // @ts-ignore
  ghostOpen,
  // @ts-ignore
  onToggleGhost,
}: {
  bearing: number;
  mapStyle: string;
  onCycleStyle: () => void;
  onResetBearing: () => void;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  offlineOpen: boolean;
  onToggleOffline: () => void;
  analysisOpen: boolean;
  onToggleAnalysis: () => void;
  storyOpen: boolean;
  onToggleStory: () => void;
  ghostOpen: boolean;
  onToggleGhost: () => void;
}) {
  const { layers, toggleLayer } = useMapStore((s) => ({
    layers: s.layers,
    toggleLayer: s.toggleLayer,
  }));

  return (
    <div className="glass-card flex flex-col items-center py-2 px-1 gap-1 rounded-[20px] w-[56px] shadow-2xl overflow-y-auto max-h-[80vh] no-scrollbar">
      {LATERAL_ITEMS.map((item) => (
        <LateralButton
          key={item.key}
          icon={item.icon}
          label={item.label}
          active={layers[item.key]}
          onClick={() => toggleLayer(item.key)}
        />
      ))}
      <span className="block w-6 h-px bg-white/10 my-1 shrink-0" />
      <LateralButton
        icon={<Satellite size={18} strokeWidth={1.75} />}
        label={`Вигляд · ${STYLE_UA[mapStyle] ?? mapStyle}`}
        active={mapStyle !== 'dark'}
        onClick={onCycleStyle}
      />
      <LateralButton
        icon={<Compass size={18} strokeWidth={1.75} />}
        label={`Напрямок · ${String(Math.round(bearing)).padStart(3, '0')}°`}
        active={Math.abs(bearing) > 0.5}
        onClick={onResetBearing}
      />
      {/* 
      // DEAD BUTTONS (Unimplemented)
      <LateralButton
        icon={<Clock size={18} strokeWidth={1.75} />}
        label="Timeline"
        active={timelineOpen}
        onClick={onToggleTimeline}
      />
      <LateralButton
        icon={<Activity size={18} strokeWidth={1.75} />}
        label="Analysis"
        active={analysisOpen}
        onClick={onToggleAnalysis}
      />
      <LateralButton
        icon={<BookOpen size={18} strokeWidth={1.75} />}
        label="Story"
        active={storyOpen}
        onClick={onToggleStory}
      />
      <LateralButton
        icon={<Shield size={18} strokeWidth={1.75} />}
        label="Ghost"
        active={ghostOpen}
        onClick={onToggleGhost}
      />
      <LateralButton
        icon={<HardDrive size={18} strokeWidth={1.75} />}
        label="Offline"
        active={offlineOpen}
        onClick={onToggleOffline}
      />
      */}
    </div>
  );
}

function LateralButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center w-11 h-11 rounded-[14px] transition-all active:scale-90 ${active
          ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40 shadow-[0_0_14px_rgba(244,175,37,0.2)]'
          : 'text-ink-secondary hover:bg-white/5'
        }`}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {icon}
    </button>
  );
}
