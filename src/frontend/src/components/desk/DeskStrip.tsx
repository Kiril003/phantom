import { useEffect, useState } from 'react';
import { useDeskStore } from '../../stores/deskStore';

/** Компактна висота смуги — лише для точного вказівника (миша/трекпад). */
export const DESK_STRIP_H = 28;
/** Тач-висота: доктрина «touch targets min 44×44px» — непорушна. */
export const DESK_STRIP_TOUCH_H = 44;

/**
 * Первинний вказівник грубий (палець)? Живе слухачем: планшет із
 * докнутою клавіатурою міняє відповідь на льоту. Без matchMedia
 * (jsdom/старий WebView) чесно вважаємо вказівник точним.
 * any-pointer, не pointer: тач-ноутбук із трекпадом-первинним звітує
 * pointer:fine, а пальцю на його екрані все одно потрібні 44px.
 */
function usePointerCoarse(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(any-pointer: coarse)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(any-pointer: coarse)');
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    // Стан міг змінитись між рендером і підпискою.
    setCoarse(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

/**
 * Смуга столів — тонкий низ екрана: ЛИШЕ перемикач столів словами,
 * активний підсвічений. Вердикт власника: «багато знизу кнопок — погано»
 * — старий док тут не відтворюється; входи станів і додатків чекають
 * дизайн-дебату, навігація — за Ctrl+K (К4).
 *
 * Розміри (гонтлет №1, У13): на точному вказівнику смуга компактна
 * (28px), на тач-екрані таби — повноцінні цілі ≥44px (правило №2
 * CLAUDE.md; хром тоді 30 + 44 = 74px ≤ 76px).
 */
export function DeskStrip() {
  const desks = useDeskStore((s) => s.desks);
  const activeDeskId = useDeskStore((s) => s.activeDeskId);
  const setActiveDesk = useDeskStore((s) => s.setActiveDesk);
  const coarse = usePointerCoarse();
  const stripH = coarse ? DESK_STRIP_TOUCH_H : DESK_STRIP_H;

  return (
    <nav
      aria-label="Столи"
      className="flex items-stretch shrink-0 select-none"
      style={{
        height: stripH,
        gap: 'var(--ph-space-1)',
        padding: '0 var(--ph-space-2)',
        borderTop: 'var(--ph-stroke-hair) solid var(--ph-color-border)',
        background: 'var(--ph-color-surface)',
      }}
    >
      {desks.map((desk) => {
        const active = desk.id === activeDeskId;
        return (
          <button
            key={desk.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => setActiveDesk(desk.id)}
            className="uppercase transition-colors"
            style={{
              padding: '0 var(--ph-space-3)',
              minWidth: coarse ? DESK_STRIP_TOUCH_H : undefined,
              fontFamily: 'var(--ph-font-display)',
              fontSize: 'var(--ph-type-micro-size)',
              fontWeight: 'var(--ph-type-micro-weight)' as unknown as number,
              letterSpacing: 'var(--ph-type-micro-tracking)',
              color: active ? 'var(--ph-color-accent)' : 'var(--ph-color-ink-muted)',
              boxShadow: active
                ? 'inset 0 calc(-1 * var(--ph-stroke-thin)) 0 var(--ph-color-accent)'
                : 'none',
              background: 'transparent',
            }}
          >
            {desk.name}
          </button>
        );
      })}
    </nav>
  );
}
