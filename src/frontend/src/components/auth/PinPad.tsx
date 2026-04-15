import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Hex values from CSS variables in globals.css — used in Framer Motion animate
const CYAN = '#00d4ff';      // --phantom-cyan
const CYAN_DIM = 'rgba(0,212,255,0.2)'; // --phantom-cyan at 20% opacity

interface PinPadProps {
  maxLength?: number;
  onSubmit: (pin: string) => void;
  disabled?: boolean;
  error?: string;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['CLR', '0', '⌫'],
];

export default function PinPad({
  maxLength = 6,
  onSubmit,
  disabled = false,
  error,
}: PinPadProps) {
  const [pin, setPin] = useState('');

  const handleKey = (key: string) => {
    if (disabled) return;
    if (key === 'CLR') {
      setPin('');
      return;
    }
    if (key === '⌫') {
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
    <div className="flex flex-col items-center gap-4 select-none">
      {/* PIN display dots */}
      <div className="flex gap-3 h-8 items-center">
        {Array.from({ length: maxLength }).map((_, i) => (
          <motion.div
            key={i}
            animate={{
              scale: i < pin.length ? 1 : 0.6,
              backgroundColor: i < pin.length ? CYAN : CYAN_DIM,
            }}
            transition={{ duration: 0.1 }}
            className="w-3 h-3 rounded-full"
          />
        ))}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-phantom-danger text-xs"
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Keypad */}
      <div className="grid grid-rows-4 gap-2">
        {KEYS.map((row, ri) => (
          <div key={ri} className="flex gap-2">
            {row.map((key) => (
              <motion.button
                key={key}
                onClick={() => handleKey(key)}
                whileTap={{ scale: 0.9 }}
                disabled={disabled}
                className={[
                  'w-[72px] h-[56px] rounded phantom-panel',
                  'text-phantom-text font-mono text-lg tracking-wide',
                  'flex items-center justify-center',
                  'transition-colors hover:border-phantom-cyan',
                  'disabled:opacity-40 cursor-pointer',
                  key === 'CLR' ? 'text-phantom-warning text-sm' : '',
                  key === '⌫' ? 'text-phantom-danger text-sm' : '',
                ].join(' ')}
              >
                {key}
              </motion.button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
