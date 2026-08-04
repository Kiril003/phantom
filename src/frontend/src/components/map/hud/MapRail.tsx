import type { ReactNode } from 'react';

export interface RailItem {
  key: string;
  icon: ReactNode;
  /** Доступна назва — повна, з поточним значенням. */
  label: string;
  /** Видимий підпис під іконкою; коротший за `label`. */
  short: string;
  active?: boolean;
  /**
   * Скільки записів стоїть за кнопкою. `null` — величина не рахується
   * (вигляд, інструмент). `0` — кнопка вмикає порожнечу, і мусить це
   * показати, а не світитись так само, як робоча.
   */
  count?: number | null;
  onClick: () => void;
}

/**
 * Вертикальна рейка мапи.
 *
 * Раніше все — сім шарів, три види, п'ять панелей — стояло в ОДНІЙ колонці
 * на п'ятнадцять кнопок із власним скролом і підписами на 7.5 пікселя. На
 * семидюймовому тачі це стовпчик загадок, який ще й не вміщався. Тепер
 * рейка знає лише одну роль, а ролей дві: ліворуч — що намальовано на мапі,
 * праворуч — що з нею робити.
 */
export function MapRail({ items, ariaLabel }: { items: RailItem[]; ariaLabel: string }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="glass-card flex w-[62px] flex-col items-center rounded-[20px] px-1 py-2 shadow-2xl"
    >
      {items.map((item) => {
        const empty = item.count === 0;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            aria-label={empty ? `${item.label} — записів немає` : item.label}
            aria-pressed={item.active}
            title={empty ? `${item.label} — записів немає` : item.label}
            className={`relative flex min-h-[46px] w-[54px] flex-col items-center justify-center gap-[2px] rounded-[14px] transition-all active:scale-90 ${
              item.active && !empty
                ? 'border border-amber-500/40 bg-amber-500/20 text-[color:var(--primary-shadow,#5c3d05)] shadow-[0_0_14px_rgba(244,175,37,0.2)]'
                : empty
                  ? 'text-[color:var(--ink-muted)] opacity-45'
                  : 'text-[color:var(--ink-primary)] hover:bg-white/5'
            }`}
          >
            {item.icon}
            {/* Пристрій тач — hover не існує, тож `title` не з'явиться ніколи. */}
            <span className="max-w-[52px] truncate text-[9px] font-semibold uppercase leading-[10px] tracking-[0.02em]">
              {item.short}
            </span>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="absolute right-1 top-1 rounded-full bg-amber-500 px-1 text-[8px] font-bold leading-[12px] text-[color:var(--primary-shadow,#5c3d05)]">
                {item.count > 99 ? '99+' : item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
