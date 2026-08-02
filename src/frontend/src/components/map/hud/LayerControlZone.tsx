import {
  Layers, Radar, Wifi, Flame, MapPin, Route, Sparkles, Satellite, Compass,
  Clock, Activity, BookOpen, Shield, HardDrive, Box,
} from 'lucide-react';
import { useMapStore, type MapLayerKey } from '../../../stores/mapStore';

/** Назви стилів мапи приходять службовими ключами. */
const STYLE_UA: Record<string, string> = {
  dark: 'темний',
  streets: 'вулиці',
  satellite: 'супутник',
};

// Підписи шарів були англійськими — на боковій рейці мапи це єдиний
// текст, який пояснює, що вмикає кнопка.
const LATERAL_ITEMS: Array<{
  key: MapLayerKey; icon: React.ReactNode; label: string; short?: string;
}> = [
  { key: 'base', icon: <Layers size={18} strokeWidth={1.75} />, label: 'Основа' },
  { key: 'presence', icon: <Radar size={18} strokeWidth={1.75} />, label: 'Присутність', short: 'Поруч' },
  { key: 'wardriving', icon: <Wifi size={18} strokeWidth={1.75} />, label: 'Мережі' },
  { key: 'heatmap', icon: <Flame size={18} strokeWidth={1.75} />, label: 'Теплокарта', short: 'Тепло' },
  { key: 'intel', icon: <MapPin size={18} strokeWidth={1.75} />, label: 'Місця' },
  { key: 'recon', icon: <Route size={18} strokeWidth={1.75} />, label: 'Розвідка' },
  { key: 'facts', icon: <Sparkles size={18} strokeWidth={1.75} />, label: 'Спогади' },
];

export function LayerControlZone({
  bearing,
  mapStyle,
  onCycleStyle,
  onResetBearing,
  onToggleTilt,
  tilted,
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
  onToggleTilt: () => void;
  tilted: boolean;
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
          short={item.short}
          active={layers[item.key]}
          onClick={() => toggleLayer(item.key)}
        />
      ))}
      <span className="block w-6 h-px bg-white/10 my-1 shrink-0" />
      <LateralButton
        icon={<Satellite size={18} strokeWidth={1.75} />}
        label={`Вигляд · ${STYLE_UA[mapStyle] ?? mapStyle}`}
        short="Вигляд"
        active={mapStyle !== 'dark'}
        onClick={onCycleStyle}
      />
      <LateralButton
        icon={<Box size={18} strokeWidth={1.75} />}
        label={tilted ? 'Об’єм · увімкнено' : 'Об’єм · вимкнено'}
        short="Об’єм"
        active={tilted}
        onClick={onToggleTilt}
      />
      <LateralButton
        icon={<Compass size={18} strokeWidth={1.75} />}
        label={`Напрямок · ${Math.round(bearing)}°`}
        short="Північ"
        active={Math.abs(bearing) > 0.5}
        onClick={onResetBearing}
      />
      <span className="block w-6 h-px bg-white/10 my-1 shrink-0" />
      {/* Ці п'ять панелей давно написані й вкручені в OmniMap — бракувало
          лише кнопок, і вони стояли тут закоментовані як «мертві». Зовні це
          читалось як «половини мапи немає». */}
      <LateralButton
        icon={<Clock size={18} strokeWidth={1.75} />}
        label="Час"
        active={timelineOpen}
        onClick={onToggleTimeline}
      />
      <LateralButton
        icon={<Activity size={18} strokeWidth={1.75} />}
        label="Аналіз"
        active={analysisOpen}
        onClick={onToggleAnalysis}
      />
      <LateralButton
        icon={<BookOpen size={18} strokeWidth={1.75} />}
        label="Історія"
        active={storyOpen}
        onClick={onToggleStory}
      />
      <LateralButton
        icon={<Shield size={18} strokeWidth={1.75} />}
        label="Привид"
        active={ghostOpen}
        onClick={onToggleGhost}
      />
      <LateralButton
        icon={<HardDrive size={18} strokeWidth={1.75} />}
        label="Офлайн"
        active={offlineOpen}
        onClick={onToggleOffline}
      />
    </div>
  );
}

function LateralButton({
  icon,
  label,
  short,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** Видимий підпис, коли `label` задовгий; доступна назва лишається `label`. */
  short?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-[1px] w-12 min-h-[44px] py-1 rounded-[14px] transition-all active:scale-90 ${active
          // Бурштин — колір ЗАЛИВКИ, не чорнила: `text-amber-500` по
          // бурштиновій підкладці давав контраст 1.8, тобто підпис
          // активного шару читався гірше за неактивний.
          ? 'bg-amber-500/20 text-[color:var(--primary-shadow,#5c3d05)] border border-amber-500/40 shadow-[0_0_14px_rgba(244,175,37,0.2)]'
          : 'text-[color:var(--ink-primary)] hover:bg-white/5'
        }`}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {icon}
      {/* Пристрій тач — hover не існує, тож `title` не з'явиться ніколи, і
          рейка читалась як стовпчик загадок. */}
      <span
        style={{
          fontSize: 7.5, lineHeight: '8px', fontWeight: active ? 700 : 600,
          letterSpacing: '0.02em', textTransform: 'uppercase',
          maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {short ?? label}
      </span>
    </button>
  );
}
