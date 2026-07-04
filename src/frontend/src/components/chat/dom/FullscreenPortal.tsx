import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Viewport-true fullscreen overlay. Rides a portal to document.body:
 * chat bubbles carry framer-motion transforms, and position:fixed inside
 * a transformed ancestor anchors to that ancestor instead of the screen.
 */
export function FullscreenPortal({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      data-testid="fullscreen-portal"
      className="flex flex-col"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--surface-deep, #0b0f14)' }}
    >
      <div
        className="flex shrink-0 items-center justify-between pl-4 pr-2 border-b border-white/10"
        style={{ minHeight: 44 }}
      >
        <span
          className="truncate font-mono tracking-wider uppercase"
          style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-micro)' }}
        >
          {title}
        </span>
        <button
          aria-label="закрити повний екран"
          onClick={onClose}
          className="flex items-center justify-center"
          style={{ minWidth: 44, minHeight: 44, background: 'none', border: 0, color: 'var(--ink-secondary)' }}
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>,
    document.body,
  );
}
