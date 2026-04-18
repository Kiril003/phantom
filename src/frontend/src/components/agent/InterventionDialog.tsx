import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  open: boolean;
  prompt?: string | null;
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}

export function InterventionDialog({ open, prompt, onSubmit, onClose }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-elevated p-5 flex flex-col gap-3"
            style={{
              width: 480,
              maxWidth: '90%',
              borderRadius: 16,
              boxShadow:
                '0 24px 48px -12px rgba(0,0,0,0.6), 0 0 0 1px var(--glass-border)',
            }}
          >
            <h3
              className="font-display"
              style={{ color: 'var(--ink-primary)', fontSize: 'var(--fs-lg)' }}
            >
              Intervene
            </h3>
            {prompt && (
              <p style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-sm)' }}>{prompt}</p>
            )}
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Add instruction or context…"
              className="font-mono px-3 py-2"
              style={{
                background: 'var(--glass-subtle)',
                border: '1px solid var(--glass-border)',
                borderRadius: 12,
                color: 'var(--ink-primary)',
                fontSize: 'var(--fs-sm)',
                resize: 'vertical',
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4"
                style={{
                  minHeight: 44,
                  minWidth: 88,
                  borderRadius: 12,
                  background: 'transparent',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--ink-secondary)',
                  fontSize: 'var(--fs-xs)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() || busy}
                className="px-4"
                style={{
                  minHeight: 44,
                  minWidth: 88,
                  borderRadius: 12,
                  background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                  color: 'var(--accent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
                  opacity: !text.trim() || busy ? 0.4 : 1,
                  fontSize: 'var(--fs-xs)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {busy ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
