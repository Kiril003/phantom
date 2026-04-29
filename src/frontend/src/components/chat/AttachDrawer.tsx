/**
 * Day-4 Wave-2 W-3 — AttachDrawer.
 *
 * Five-option attach drawer that appears when the user taps the `+`
 * affordance on the chat input. Each entry is a closed-vocabulary
 * `AttachKind`; the actual data fetch (file picker, screenshot,
 * recall query, code paste, sandbox session) ships Day-5+ behind
 * the same `AttachKind` keys so the UI surface here remains stable.
 *
 * The drawer is a *card* per the operator's directive ("картки замість
 * довгого тексту") — five tap targets ≥ 44px each, glass-panel chrome,
 * keyboard-accessible (Escape closes, Tab cycles).
 *
 * Day-4 ship contract:
 *   - Selection emits a {kind, hint} object via `onSelect` callback.
 *   - The caller renders a chip strip + sends the selection as part of
 *     the next message metadata (Day-5 wires to backend).
 *   - No backend round-trip happens here.
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  Paperclip,
  Camera,
  Database,
  Code2,
  Box,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { getPhantomTransition } from '../../styles/motion';

/** Closed enum — extending requires ADR amendment + matching backend hook. */
export type AttachKind =
  | 'file'
  | 'screenshot'
  | 'recall'
  | 'code'
  | 'sandbox';

export interface AttachSelection {
  kind: AttachKind;
  hint: string;
}

export interface AttachDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (selection: AttachSelection) => void;
}

interface DrawerEntry {
  kind: AttachKind;
  label: string;
  hint: string;
  Icon: typeof Paperclip;
}

const ENTRIES: ReadonlyArray<DrawerEntry> = [
  {
    kind: 'file',
    label: 'File',
    hint: 'Attach a local file or image.',
    Icon: Paperclip,
  },
  {
    kind: 'screenshot',
    label: 'Screenshot',
    hint: 'Capture the current view.',
    Icon: Camera,
  },
  {
    kind: 'recall',
    label: 'Recall',
    hint: 'Pull a prior memory snippet.',
    Icon: Database,
  },
  {
    kind: 'code',
    label: 'Code',
    hint: 'Paste a code block with language hint.',
    Icon: Code2,
  },
  {
    kind: 'sandbox',
    label: 'Sandbox',
    hint: 'Run a one-shot inside the sandbox.',
    Icon: Box,
  },
];

export function AttachDrawer({ open, onClose, onSelect }: AttachDrawerProps) {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes; click-outside is the caller's responsibility (the
  // drawer overlay is anchored to the chat input rail, so the ChatWindow
  // owns the outside-click handler).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    // Auto-focus the first entry so screen-reader + keyboard users can
    // immediately Tab through.
    firstButtonRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="Attach drawer"
          aria-modal="false"
          className="absolute bottom-full left-0 right-0 mb-2 z-10"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={getPhantomTransition('panelReveal')}
          data-testid="attach-drawer"
        >
          <div
            className="glass-panel rounded-2xl p-3"
            style={{
              border: '1px solid var(--glass-border)',
              boxShadow:
                '0 8px 30px -8px color-mix(in srgb, var(--accent) 18%, transparent)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--ink-muted)',
                  letterSpacing: 'var(--tracking-wide)',
                  textTransform: 'uppercase',
                }}
              >
                attach
              </span>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 9999,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-muted)',
                }}
                aria-label="Close attach drawer"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              {ENTRIES.map((entry, idx) => {
                const Icon = entry.Icon;
                return (
                  <button
                    key={entry.kind}
                    ref={idx === 0 ? firstButtonRef : null}
                    type="button"
                    onClick={() => {
                      onSelect({ kind: entry.kind, hint: entry.hint });
                      onClose();
                    }}
                    className="flex flex-col items-center justify-center transition-colors"
                    style={{
                      minWidth: 44,
                      minHeight: 64,
                      padding: '10px 6px',
                      borderRadius: 12,
                      background: 'var(--glass-subtle)',
                      border: '1px solid var(--glass-border)',
                      color: 'var(--ink-primary)',
                    }}
                    aria-label={`Attach ${entry.label}`}
                    data-attach-kind={entry.kind}
                    title={entry.hint}
                  >
                    <Icon
                      size={18}
                      strokeWidth={1.75}
                      color="var(--accent)"
                      aria-hidden
                    />
                    <span
                      className="mt-1"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-micro)',
                        color: 'var(--ink-secondary)',
                        letterSpacing: 'var(--tracking-wide)',
                      }}
                    >
                      {entry.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
