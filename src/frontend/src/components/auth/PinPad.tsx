import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Delete, RotateCcw } from 'lucide-react';

interface PinPadProps {
  maxLength?: number;
  onSubmit: (pin: string) => void;
  disabled?: boolean;
  error?: string;
  autoFocus?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Glass keypad with glow-pulse PIN dots — matches design-refs/login.html.
 * No ASCII decorations, no corner indices.
 */
export default function PinPad({
  maxLength = 6,
  onSubmit,
  disabled = false,
  error,
}: PinPadProps) {
  const [pin, setPin] = useState('');

  const handleKey = (key: string) => {
    if (disabled) return;
    if (key === 'CLEAR') {
      setPin('');
      return;
    }
    if (key === 'DEL') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= maxLength) return;
    const next = pin + key;
    setPin(next);
    if (next.length === maxLength) {
      onSubmit(next);
      setPin('');
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 select-none">
      {/* Glow-pulse dots */}
      <div className="flex gap-3" role="status" aria-label={`PIN ${pin.length} of ${maxLength}`}>
        {Array.from({ length: maxLength }).map((_, i) => {
          const filled = i < pin.length;
          const active = i === pin.length;
          return (
            <motion.div
              key={i}
              animate={{
                scale: filled ? 1 : 0.9,
                background: filled ? 'var(--accent)' : 'transparent',
                borderColor: filled || active ? 'var(--accent)' : 'var(--glass-border)',
                boxShadow: filled
                  ? '0 0 12px var(--accent-glow), inset 0 0 0 1px var(--glass-highlight)'
                  : active
                    ? '0 0 10px var(--accent-glow)'
                    : 'none',
              }}
              transition={{ duration: 0.18 }}
              style={{
                width: 14,
                height: 14,
                borderRadius: 9999,
                border: '2px solid',
              }}
            />
          );
        })}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            key={error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              color: 'var(--signal-alert)',
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-display)',
            }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Keypad — 3×4 glass tiles */}
      <div className="grid grid-cols-3 gap-3" style={{ width: 264 }}>
        {KEYS.map((k) => (
          <PadButton key={k} onClick={() => handleKey(k)} disabled={disabled}>
            <span className="font-display text-xl" style={{ fontWeight: 500 }}>
              {k}
            </span>
          </PadButton>
        ))}
        <PadButton
          onClick={() => handleKey('CLEAR')}
          disabled={disabled}
          variant="ghost"
          ariaLabel="Clear"
        >
          <RotateCcw size={18} strokeWidth={1.75} />
        </PadButton>
        <PadButton onClick={() => handleKey('0')} disabled={disabled}>
          <span className="font-display text-xl" style={{ fontWeight: 500 }}>
            0
          </span>
        </PadButton>
        <PadButton
          onClick={() => handleKey('DEL')}
          disabled={disabled}
          variant="ghost"
          ariaLabel="Backspace"
        >
          <Delete size={18} strokeWidth={1.75} />
        </PadButton>
      </div>
    </div>
  );
}

/* ─── Internal: keypad button ──────────────────────────────────────────── */

function PadButton({
  children,
  onClick,
  disabled,
  variant = 'default',
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'ghost';
  ariaLabel?: string;
}) {
  const isGhost = variant === 'ghost';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.94 }}
      className="flex items-center justify-center transition-all"
      style={{
        height: 56,
        minHeight: 44,
        borderRadius: 14,
        background: isGhost ? 'transparent' : 'var(--glass-subtle)',
        border: `1px solid ${isGhost ? 'transparent' : 'var(--glass-border)'}`,
        color: isGhost ? 'var(--ink-secondary)' : 'var(--ink-primary)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        backdropFilter: isGhost ? undefined : 'blur(8px)',
        WebkitBackdropFilter: isGhost ? undefined : 'blur(8px)',
      }}
      aria-label={ariaLabel}
      onMouseEnter={(e) => {
        if (disabled) return;
        const el = e.currentTarget;
        if (!isGhost) {
          el.style.borderColor = 'var(--accent)';
          el.style.boxShadow = '0 0 20px var(--accent-glow)';
          el.style.color = 'var(--ink-primary)';
        } else {
          el.style.color = 'var(--ink-primary)';
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        if (!isGhost) {
          el.style.borderColor = 'var(--glass-border)';
          el.style.boxShadow = 'none';
        } else {
          el.style.color = 'var(--ink-secondary)';
        }
      }}
    >
      {children}
    </motion.button>
  );
}
