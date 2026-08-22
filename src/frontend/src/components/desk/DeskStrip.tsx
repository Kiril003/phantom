import { Settings } from 'lucide-react';
import { useDeskStore } from '../../stores/deskStore';

export const DESK_STRIP_H = 28;

/**
 * Смуга столів — тонкий низ екрана: слово-назви столів, активний
 * підсвічений. Праворуч — «Налаштування» (вільним вікном на активному
 * столі), щоб зі зникненням дока жоден екран не лишився недосяжним.
 * Хром стола: StatusBar 44px + смуга 28px = 72px ≤ 76px.
 */
export function DeskStrip() {
  const desks = useDeskStore((s) => s.desks);
  const activeDeskId = useDeskStore((s) => s.activeDeskId);
  const setActiveDesk = useDeskStore((s) => s.setActiveDesk);
  const openPane = useDeskStore((s) => s.openPane);

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
      <span className="flex-1" />
      <button
        type="button"
        aria-label="Налаштування"
        title="Налаштування"
        onClick={() => openPane('settings')}
        className="flex items-center justify-center self-center transition-colors"
        style={{
          width: 24,
          height: 24,
          borderRadius: 'var(--ph-radius-s)',
          color: 'var(--ph-color-ink-muted)',
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ph-color-ink)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ph-color-ink-muted)';
        }}
      >
        <Settings size={14} strokeWidth={1.75} />
      </button>
    </nav>
  );
}
