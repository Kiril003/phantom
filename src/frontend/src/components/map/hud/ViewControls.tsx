import { Box, Compass, Satellite } from 'lucide-react';

const STYLE_UA: Record<string, string> = {
  dark: 'темний',
  streets: 'вулиці',
  satellite: 'супутник',
};

/**
 * Як я дивлюсь на мапу: вигляд, об'єм, північ. Три кнопки, що керують
 * КАМЕРОЮ, а не вмістом — тому вони живуть окремо від рейки шарів, угорі
 * ліворуч, де раніше вдруге дублювався стан системи з верхньої панелі.
 */
export function ViewControls({
  bearing,
  mapStyle,
  tilted,
  onCycleStyle,
  onToggleTilt,
  onResetBearing,
}: {
  bearing: number;
  mapStyle: string;
  tilted: boolean;
  onCycleStyle: () => void;
  onToggleTilt: () => void;
  onResetBearing: () => void;
}) {
  const deg = ((Math.round(bearing) % 360) + 360) % 360;
  return (
    <div
      role="group"
      aria-label="Вигляд мапи"
      className="glass-card flex items-center gap-0.5 rounded-full p-1 shadow-2xl"
    >
      <ViewButton
        icon={<Satellite size={16} strokeWidth={1.75} />}
        label={`Вигляд · ${STYLE_UA[mapStyle] ?? mapStyle}`}
        active={mapStyle !== 'dark'}
        onClick={onCycleStyle}
      />
      <ViewButton
        icon={<Box size={16} strokeWidth={1.75} />}
        label={tilted ? 'Об’єм · увімкнено' : 'Об’єм · вимкнено'}
        active={tilted}
        onClick={onToggleTilt}
      />
      <ViewButton
        icon={
          <Compass
            size={16}
            strokeWidth={1.75}
            style={{ transform: `rotate(${bearing}deg)` }}
            aria-hidden
          />
        }
        label={`Напрямок · ${deg}°. Повернути на північ`}
        active={deg > 0}
        onClick={onResetBearing}
      />
    </div>
  );
}

function ViewButton({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-all active:scale-90 ${
        active
          ? 'bg-amber-500/20 text-[color:var(--primary-shadow,#5c3d05)]'
          : 'text-[color:var(--ink-secondary)] hover:bg-white/5'
      }`}
    >
      {icon}
    </button>
  );
}
