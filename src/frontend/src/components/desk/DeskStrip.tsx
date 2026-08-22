import { useDeskStore } from '../../stores/deskStore';

export const DESK_STRIP_H = 28;

/**
 * Смуга столів — тонкий низ екрана: ЛИШЕ перемикач столів словами,
 * активний підсвічений. Вердикт власника: «багато знизу кнопок — погано»
 * — старий док тут не відтворюється; входи станів і додатків чекають
 * дизайн-дебату, навігація — за Ctrl+K (К4).
 * Хром стола: StatusBar 44px + смуга 28px = 72px ≤ 76px.
 */
export function DeskStrip() {
  const desks = useDeskStore((s) => s.desks);
  const activeDeskId = useDeskStore((s) => s.activeDeskId);
  const setActiveDesk = useDeskStore((s) => s.setActiveDesk);

  return (
    <nav
      aria-label="Столи"
      className="flex items-stretch shrink-0 select-none"
      style={{
        height: DESK_STRIP_H,
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
