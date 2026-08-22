import { useCallback, useRef, useState } from 'react';
import { useDeskStore, type DeskPane, type PaneRect } from '../../stores/deskStore';
import { Pane } from './Pane';

const MIN_W = 280;
const MIN_H = 180;
const SNAP_THRESHOLD = 20;

type SnapSide = 'left' | 'right' | 'top' | 'bottom' | null;

/**
 * Вільне вікно пейна — успадкований двигун FloatingWindow без клітки
 * 1024×600: межі дає виміряна поверхня стола (bounds). Сніп до половин
 * лишається. Координати вікна — локальні до поверхні стола.
 */
export function DeskWindow({
  pane,
  deskId,
  bounds,
}: {
  pane: DeskPane;
  deskId: string;
  bounds: { width: number; height: number };
}) {
  const setFloatRect = useDeskStore((s) => s.setFloatRect);
  const focusPane = useDeskStore((s) => s.focusPane);

  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [draftRect, setDraftRect] = useState<PaneRect | null>(null);
  const [snapGuide, setSnapGuide] = useState<SnapSide>(null);

  const rect = clampRect(draftRect ?? pane.floatRect ?? fallbackRect(bounds), bounds);

  const activate = useCallback(() => focusPane(deskId, pane.id), [focusPane, deskId, pane.id]);

  /* ── Перетягування за хедер ─────────────────────────────────────────── */
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragOffset.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y };
      activate();
    },
    [rect.x, rect.y, activate],
  );

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragOffset.current) return;
      const x = Math.max(0, Math.min(bounds.width - rect.width, e.clientX - dragOffset.current.dx));
      const y = Math.max(0, Math.min(bounds.height - rect.height, e.clientY - dragOffset.current.dy));
      const guide: SnapSide =
        x < SNAP_THRESHOLD
          ? 'left'
          : x + rect.width > bounds.width - SNAP_THRESHOLD
            ? 'right'
            : y < SNAP_THRESHOLD
              ? 'top'
              : y + rect.height > bounds.height - SNAP_THRESHOLD
                ? 'bottom'
                : null;
      setSnapGuide(guide);
      setDraftRect({ x, y, width: rect.width, height: rect.height });
    },
    [bounds.width, bounds.height, rect.width, rect.height],
  );

  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragOffset.current) return;
      dragOffset.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (draftRect) {
        let final = { ...draftRect };
        const halfW = Math.round(bounds.width / 2);
        const halfH = Math.round(bounds.height / 2);
        if (snapGuide === 'left') final = { x: 0, y: 0, width: halfW, height: bounds.height };
        else if (snapGuide === 'right')
          final = { x: bounds.width - halfW, y: 0, width: halfW, height: bounds.height };
        else if (snapGuide === 'top') final = { x: 0, y: 0, width: bounds.width, height: halfH };
        else if (snapGuide === 'bottom')
          final = { x: 0, y: bounds.height - halfH, width: bounds.width, height: halfH };
        setFloatRect(deskId, pane.id, final);
      }
      setDraftRect(null);
      setSnapGuide(null);
    },
    [draftRect, snapGuide, bounds.width, bounds.height, setFloatRect, deskId, pane.id],
  );

  /* ── Ресайз за нижній правий кут ────────────────────────────────────── */
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizeStart.current = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
      activate();
    },
    [rect.width, rect.height, activate],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!resizeStart.current) return;
      const width = Math.max(
        MIN_W,
        Math.min(bounds.width - rect.x, resizeStart.current.width + e.clientX - resizeStart.current.x),
      );
      const height = Math.max(
        MIN_H,
        Math.min(bounds.height - rect.y, resizeStart.current.height + e.clientY - resizeStart.current.y),
      );
      setDraftRect({ x: rect.x, y: rect.y, width, height });
    },
    [bounds.width, bounds.height, rect.x, rect.y],
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!resizeStart.current) return;
      resizeStart.current = null;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (draftRect) setFloatRect(deskId, pane.id, draftRect);
      setDraftRect(null);
    },
    [draftRect, setFloatRect, deskId, pane.id],
  );

  return (
    <>
      {snapGuide && <SnapGuide guide={snapGuide} bounds={bounds} />}
      <div
        onPointerDown={activate}
        className="absolute flex flex-col"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          zIndex: 40 + pane.z,
          borderRadius: 'var(--ph-radius-m)',
          overflow: 'hidden',
          border: '1px solid var(--ph-color-border)',
          boxShadow: 'var(--ph-shadow-3)',
          background: 'var(--ph-color-surface)',
        }}
      >
        <Pane
          pane={pane}
          deskId={deskId}
          headerProps={{
            onPointerDown: onHeaderPointerDown,
            onPointerMove: onHeaderPointerMove,
            onPointerUp: onHeaderPointerUp,
            onPointerCancel: onHeaderPointerUp,
            style: { cursor: 'grab', touchAction: 'none' },
          }}
        />
        <div
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          aria-label="Змінити розмір"
          title="Змінити розмір"
          className="absolute bottom-0 right-0"
          style={{ width: 18, height: 18, cursor: 'nwse-resize', touchAction: 'none' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <g stroke="var(--ph-color-ink-muted)" strokeWidth="1.2" strokeLinecap="round">
              <line x1="14" y1="4" x2="4" y2="14" />
              <line x1="14" y1="9" x2="9" y2="14" />
            </g>
          </svg>
        </div>
      </div>
    </>
  );
}

function fallbackRect(bounds: { width: number; height: number }): PaneRect {
  const width = Math.max(MIN_W, Math.round(bounds.width * 0.45));
  const height = Math.max(MIN_H, Math.round(bounds.height * 0.6));
  return {
    x: Math.max(0, Math.round((bounds.width - width) / 2)),
    y: Math.max(0, Math.round((bounds.height - height) / 3)),
    width,
    height,
  };
}

function clampRect(rect: PaneRect, bounds: { width: number; height: number }): PaneRect {
  if (bounds.width === 0 || bounds.height === 0) return rect;
  const width = Math.max(MIN_W, Math.min(bounds.width, rect.width));
  const height = Math.max(MIN_H, Math.min(bounds.height, rect.height));
  return {
    x: Math.max(0, Math.min(bounds.width - width, rect.x)),
    y: Math.max(0, Math.min(bounds.height - height, rect.y)),
    width,
    height,
  };
}

function SnapGuide({ guide, bounds }: { guide: Exclude<SnapSide, null>; bounds: { width: number; height: number } }) {
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;
  const rect: React.CSSProperties =
    guide === 'left'
      ? { left: 0, top: 0, width: halfW, height: bounds.height }
      : guide === 'right'
        ? { left: halfW, top: 0, width: halfW, height: bounds.height }
        : guide === 'top'
          ? { left: 0, top: 0, width: bounds.width, height: halfH }
          : { left: 0, top: halfH, width: bounds.width, height: halfH };
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        background: 'color-mix(in srgb, var(--ph-color-accent) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--ph-color-accent) 50%, transparent)',
        borderRadius: 'var(--ph-radius-m)',
        pointerEvents: 'none',
        zIndex: 39,
        ...rect,
      }}
    />
  );
}
