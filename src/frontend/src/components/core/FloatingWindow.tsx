import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Minus, Square, Maximize2, X, Minimize2 } from 'lucide-react';
import { useUIStore, type OverlayName } from '../../stores/uiStore';
import { EASE_PHANTOM } from '../../styles/motion';

const FRAME_W = 1024;
const FRAME_H = 600;
const MIN_W = 280;
const MIN_H = 200;
const TOOLBAR_HEIGHT = 60; // approx. floating toolbar height + margin
const SNAP_THRESHOLD = 20;

export interface FloatingWindowProps {
  id: OverlayName;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Called when window becomes active (clicked/focused). */
  onFocus?: () => void;
}

/**
 * FloatingWindow — draggable, resizable, minimizable, maximizable glass window.
 *
 * Positions and sizes come from uiStore (persisted to localStorage).
 * - Drag: pointer on titlebar → updates rect on pointermove
 * - Resize: pointer on bottom-right grip → updates width/height
 * - Snap: when window center enters SNAP_THRESHOLD of any frame edge, snap to that half
 * - Minimize: collapses to a floating chip above the main toolbar
 * - Maximize/restore: fills the frame minus toolbar area
 * - Escape: closes the focused window (handled at root; we just ensure click focuses)
 */
export function FloatingWindow({ id, title, icon, children, onFocus }: FloatingWindowProps) {
  const win = useUIStore((s) => s.windows[id]);
  const setRect = useUIStore((s) => s.setRect);
  const minimize = useUIStore((s) => s.minimize);
  const maximize = useUIStore((s) => s.maximize);
  const restore = useUIStore((s) => s.restore);
  const close = useUIStore((s) => s.closeOverlay);
  const focus = useUIStore((s) => s.focus);

  const shellRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStart = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [draftRect, setDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const [snapGuide, setSnapGuide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);

  const activate = useCallback(() => {
    focus(id);
    onFocus?.();
  }, [focus, id, onFocus]);

  /* ── Drag ─────────────────────────────────────────────────────────── */
  const onTitlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (win.maximized) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragOffset.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
      activate();
    },
    [win.x, win.y, win.maximized, activate]
  );

  const onTitlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragOffset.current) return;
      // Clamp so the whole window stays visible inside the frame, above the toolbar.
      const maxY = Math.max(0, FRAME_H - TOOLBAR_HEIGHT - win.height);
      const x = Math.max(0, Math.min(FRAME_W - win.width, e.clientX - dragOffset.current.dx));
      const y = Math.max(0, Math.min(maxY, e.clientY - dragOffset.current.dy));

      // Snap detection
      const cx = x + win.width / 2;
      const cy = y + win.height / 2;
      const guide =
        x < SNAP_THRESHOLD
          ? 'left'
          : x + win.width > FRAME_W - SNAP_THRESHOLD
            ? 'right'
            : y < SNAP_THRESHOLD
              ? 'top'
              : y + win.height > FRAME_H - SNAP_THRESHOLD - TOOLBAR_HEIGHT
                ? 'bottom'
                : null;
      setSnapGuide(guide);
      setDraftRect({ x, y, width: win.width, height: win.height });
      void cx;
      void cy;
    },
    [win.width, win.height]
  );

  const onTitlePointerUp = useCallback(
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
        if (snapGuide === 'left') {
          final = { x: 0, y: 0, width: Math.round(FRAME_W / 2), height: FRAME_H - TOOLBAR_HEIGHT };
        } else if (snapGuide === 'right') {
          const w = Math.round(FRAME_W / 2);
          final = { x: FRAME_W - w, y: 0, width: w, height: FRAME_H - TOOLBAR_HEIGHT };
        } else if (snapGuide === 'top') {
          final = { x: 0, y: 0, width: FRAME_W, height: Math.round((FRAME_H - TOOLBAR_HEIGHT) / 2) };
        } else if (snapGuide === 'bottom') {
          const h = Math.round((FRAME_H - TOOLBAR_HEIGHT) / 2);
          final = { x: 0, y: FRAME_H - TOOLBAR_HEIGHT - h, width: FRAME_W, height: h };
        }
        setRect(id, final);
      }
      setDraftRect(null);
      setSnapGuide(null);
    },
    [draftRect, snapGuide, setRect, id]
  );

  /* ── Resize ───────────────────────────────────────────────────────── */
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (win.maximized) return;
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        width: win.width,
        height: win.height,
      };
      activate();
    },
    [win.width, win.height, win.maximized, activate]
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!resizeStart.current) return;
      const dx = e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;
      const width = Math.max(
        MIN_W,
        Math.min(FRAME_W - win.x, resizeStart.current.width + dx)
      );
      const height = Math.max(
        MIN_H,
        Math.min(FRAME_H - TOOLBAR_HEIGHT - win.y, resizeStart.current.height + dy)
      );
      setDraftRect({ x: win.x, y: win.y, width, height });
    },
    [win.x, win.y]
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
      if (draftRect) {
        setRect(id, { width: draftRect.width, height: draftRect.height });
      }
      setDraftRect(null);
    },
    [draftRect, setRect, id]
  );

  /* ── Render ───────────────────────────────────────────────────────── */

  if (!win.open) return null;
  if (win.minimized) return null;

  const rect = draftRect ?? win;
  const finalRect = win.maximized
    ? { x: 8, y: 8, width: FRAME_W - 16, height: FRAME_H - TOOLBAR_HEIGHT - 8 }
    : rect;

  return (
    <>
      {snapGuide && (
        <SnapGuide guide={snapGuide} />
      )}
      <motion.div
        ref={shellRef}
        onPointerDown={activate}
        className="absolute glass-elevated pointer-events-auto flex flex-col"
        style={{
          left: finalRect.x,
          top: finalRect.y,
          width: finalRect.width,
          height: finalRect.height,
          borderRadius: win.maximized ? 14 : 18,
          overflow: 'hidden',
          zIndex: 100 + win.z,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow:
            '0 24px 56px -16px rgba(0,0,0,0.55), 0 0 0 1px var(--glass-border), inset 0 1px 0 var(--glass-highlight)',
          transition: draftRect || dragOffset.current || resizeStart.current
            ? 'none'
            : 'left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 4 }}
        transition={{ duration: 0.22, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <header
          className="flex items-center gap-2 shrink-0 select-none"
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onPointerCancel={onTitlePointerUp}
          style={{
            height: 40,
            padding: '0 12px 0 14px',
            borderBottom: '1px solid var(--glass-border)',
            background: 'var(--glass-subtle)',
            cursor: win.maximized ? 'default' : 'grab',
            touchAction: 'none',
          }}
        >
          <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icon}</span>
          <span
            className="flex-1 uppercase truncate"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-micro)',
              letterSpacing: 'var(--tracking-widest)',
              color: 'var(--ink-secondary)',
            }}
          >
            {title}
          </span>
          <WindowButton
            label="Minimize"
            onClick={() => minimize(id)}
            icon={<Minus size={13} strokeWidth={1.75} />}
          />
          {win.maximized ? (
            <WindowButton
              label="Restore"
              onClick={() => restore(id)}
              icon={<Minimize2 size={13} strokeWidth={1.75} />}
            />
          ) : (
            <WindowButton
              label="Maximize"
              onClick={() => maximize(id)}
              icon={<Square size={12} strokeWidth={1.75} />}
            />
          )}
          <WindowButton
            label="Close"
            onClick={() => close(id)}
            icon={<X size={14} strokeWidth={1.75} />}
            tone="alert"
          />
        </header>

        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>

        {!win.maximized && (
          <div
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            aria-label="Resize"
            title="Resize"
            className="absolute bottom-0 right-0"
            style={{
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              touchAction: 'none',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <g stroke="var(--ink-muted)" strokeWidth="1.2" strokeLinecap="round">
                <line x1="14" y1="4" x2="4" y2="14" />
                <line x1="14" y1="9" x2="9" y2="14" />
                <line x1="14" y1="14" x2="13" y2="15" />
              </g>
            </svg>
          </div>
        )}
      </motion.div>
    </>
  );
}

function WindowButton({
  label,
  onClick,
  icon,
  tone = 'default',
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
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
      className="flex items-center justify-center transition-all"
      style={{
        width: 26,
        height: 26,
        minWidth: 26,
        minHeight: 26,
        borderRadius: 8,
        color:
          tone === 'alert' ? 'var(--ink-muted)' : 'var(--ink-muted)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          tone === 'alert'
            ? 'color-mix(in srgb, var(--signal-alert) 16%, transparent)'
            : 'var(--glass-border)';
        (e.currentTarget as HTMLElement).style.color =
          tone === 'alert' ? 'var(--signal-alert)' : 'var(--ink-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--ink-muted)';
      }}
    >
      {icon}
    </button>
  );
}

function SnapGuide({ guide }: { guide: 'left' | 'right' | 'top' | 'bottom' }) {
  const commonStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    border: '1px solid color-mix(in srgb, var(--accent) 50%, transparent)',
    borderRadius: 12,
    pointerEvents: 'none',
    transition: 'opacity 140ms ease',
    zIndex: 90,
  };
  let rect: React.CSSProperties;
  const halfW = FRAME_W / 2;
  const halfH = (FRAME_H - TOOLBAR_HEIGHT) / 2;
  if (guide === 'left') rect = { left: 0, top: 0, width: halfW, height: FRAME_H - TOOLBAR_HEIGHT };
  else if (guide === 'right')
    rect = { left: halfW, top: 0, width: halfW, height: FRAME_H - TOOLBAR_HEIGHT };
  else if (guide === 'top') rect = { left: 0, top: 0, width: FRAME_W, height: halfH };
  else rect = { left: 0, top: FRAME_H - TOOLBAR_HEIGHT - halfH, width: FRAME_W, height: halfH };
  return <div style={{ ...commonStyle, ...rect }} aria-hidden />;
}
