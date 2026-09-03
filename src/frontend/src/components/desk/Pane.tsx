import React from 'react';
import { LayoutGrid, Maximize2, Minimize2, PictureInPicture2, X } from 'lucide-react';
import { useDeskStore, type DeskPane } from '../../stores/deskStore';
import { PANE_REGISTRY } from './paneRegistry';

export const PANE_HEADER_H = 32;

/**
 * Пейн — один і той самий компонент у всіх трьох агрегатних станах
 * (плитка / вільне вікно / повний екран): хедер 32px зі словом-назвою і
 * чіпом джерела, тіло — вміст із реєстру. Порожньо = порожньо словом.
 */
export function Pane({
  pane,
  deskId,
  headerProps,
}: {
  pane: DeskPane;
  deskId: string;
  /** Перетягування вільного вікна: обробники висять на хедері. */
  headerProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const setPaneMode = useDeskStore((s) => s.setPaneMode);
  const closePane = useDeskStore((s) => s.closePane);
  const def = PANE_REGISTRY[pane.kind];

  const exitFullMode = pane.home === 'grid' ? 'tile' : 'float';

  return (
    <section
      aria-label={def.title}
      className="flex flex-col w-full h-full min-h-0 min-w-0"
      style={{
        background: 'var(--ph-color-surface)',
        color: 'var(--ph-color-ink)',
      }}
    >
      <header
        {...headerProps}
        className="flex items-center shrink-0 select-none"
        style={{
          height: PANE_HEADER_H,
          gap: 8,
          padding: '0 8px 0 12px',
          borderBottom: '1px solid var(--ph-color-border)',
          background: 'var(--ph-color-glass)',
          ...headerProps?.style,
        }}
      >
        {/* Назва пейна — підмет заголовка, вона не ріжеться ніколи.
            Живий чіп джерела вміє бути довгим («Gemini не відповість →
            Ollama · локально · модель ще не в памʼяті»), і 03.09.2026 він
            з'їв назву до «ДІА…». Поступається чіп, не назва. */}
        <span
          className="uppercase shrink-0"
          style={{
            fontFamily: 'var(--ph-font-display)',
            fontSize: 'var(--ph-type-micro-size)',
            letterSpacing: 'var(--ph-type-micro-tracking)',
            color: 'var(--ph-color-ink)',
          }}
        >
          {def.title}
        </span>
        <span
          className="truncate min-w-0"
          title="Джерело вмісту"
          style={{
            fontSize: 9,
            lineHeight: '14px',
            padding: '0 6px',
            borderRadius: 'var(--ph-radius-pill)',
            border: '1px solid var(--ph-color-border)',
            color: 'var(--ph-color-ink-muted)',
          }}
        >
          {def.SourceChip ? <def.SourceChip /> : def.source}
        </span>
        <span className="flex-1" />
        {pane.mode === 'tile' && (
          <>
            <PaneButton
              label="У вільне вікно"
              icon={<PictureInPicture2 size={13} strokeWidth={1.75} />}
              onClick={() => setPaneMode(deskId, pane.id, 'float')}
            />
            <PaneButton
              label="На весь стіл"
              icon={<Maximize2 size={13} strokeWidth={1.75} />}
              onClick={() => setPaneMode(deskId, pane.id, 'full')}
            />
          </>
        )}
        {pane.mode === 'float' && (
          <>
            {pane.home === 'grid' && (
              <PaneButton
                label="Повернути в сітку"
                icon={<LayoutGrid size={13} strokeWidth={1.75} />}
                onClick={() => setPaneMode(deskId, pane.id, 'tile')}
              />
            )}
            <PaneButton
              label="На весь стіл"
              icon={<Maximize2 size={13} strokeWidth={1.75} />}
              onClick={() => setPaneMode(deskId, pane.id, 'full')}
            />
            <PaneButton
              label="Закрити вікно"
              icon={<X size={14} strokeWidth={1.75} />}
              tone="alert"
              onClick={() => closePane(deskId, pane.id)}
            />
          </>
        )}
        {pane.mode === 'full' && (
          <PaneButton
            label="Вийти з повного екрана"
            icon={<Minimize2 size={13} strokeWidth={1.75} />}
            onClick={() => setPaneMode(deskId, pane.id, exitFullMode)}
          />
        )}
      </header>

      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        {def.Content ? (
          <React.Suspense fallback={<PaneWord word="Завантажую…" />}>
            <def.Content />
          </React.Suspense>
        ) : (
          <PaneWord word="Порожньо" />
        )}
      </div>
    </section>
  );
}

/** Стан несе слово: порожній пейн каже «Порожньо», не малює риштування. */
function PaneWord({ word }: { word: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <span
        style={{
          fontSize: 12,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ph-color-ink-muted)',
        }}
      >
        {word}
      </span>
    </div>
  );
}

function PaneButton({
  label,
  icon,
  onClick,
  tone = 'default',
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'alert';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 24,
        height: 24,
        borderRadius: 'var(--ph-radius-s)',
        color: 'var(--ph-color-ink-muted)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          tone === 'alert'
            ? 'color-mix(in srgb, var(--ph-color-danger) 16%, transparent)'
            : 'var(--ph-color-border)';
        e.currentTarget.style.color =
          tone === 'alert' ? 'var(--ph-color-danger)' : 'var(--ph-color-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ph-color-ink-muted)';
      }}
    >
      {icon}
    </button>
  );
}
