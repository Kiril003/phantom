/**
 * ToastRail — глобальний контейнер тостів. Читає useUIStore.toasts і
 * рендерить кожен тост у вертикальній стрічці. Auto-dismiss 3s,
 * клік копіює message у clipboard. Кольори за kind.
 *
 * Mount once in OperatorLayout (any layout, насправді) — z-index високий
 * аби лежати над модалками.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useUIStore, type Toast, type ToastKind } from '../../stores/uiStore';
import { EASE_PHANTOM } from '../../styles/motion';

const COLORS: Record<ToastKind, { bg: string; border: string; fg: string }> = {
  error:   { bg: 'rgba(239, 68, 68, 0.95)',  border: '#dc2626', fg: '#fff' },
  warn:    { bg: 'rgba(245, 158, 11, 0.95)', border: '#d97706', fg: '#fff' },
  success: { bg: 'rgba(22, 163, 74, 0.95)',  border: '#15803d', fg: '#fff' },
  info:    { bg: 'rgba(244, 175, 37, 0.95)', border: '#ca8a04', fg: '#1a1108' },
};

const ICONS: Record<ToastKind, React.ReactNode> = {
  error: <AlertCircle size={14} />,
  warn: <AlertTriangle size={14} />,
  success: <CheckCircle2 size={14} />,
  info: <Info size={14} />,
};

const DISMISS_MS = 3000;

export function ToastRail() {
  const toasts = useUIStore((s) => s.toasts);

  return (
    <div
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center"
      style={{ bottom: 80 }}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useUIStore((s) => s.dismissToast);
  const palette = COLORS[toast.kind];

  useEffect(() => {
    const id = window.setTimeout(() => dismissToast(toast.id), DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [toast.id, dismissToast]);

  const onClick = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(toast.message).catch(() => {});
    }
    dismissToast(toast.id);
  };

  return (
    <motion.button
      type="button"
      role="alert"
      onClick={onClick}
      className="pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full font-mono text-[11px] tracking-wide shadow-lg"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        maxWidth: 720,
        backdropFilter: 'blur(8px)',
      }}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.18, ease: EASE_PHANTOM as unknown as number[] }}
      title="Tap to copy message"
    >
      <span style={{ color: palette.fg }}>{ICONS[toast.kind]}</span>
      <span className="truncate">{toast.message}</span>
    </motion.button>
  );
}
