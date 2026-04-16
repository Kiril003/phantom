import { motion, AnimatePresence } from 'framer-motion';
import { useSystemStore } from '../../stores/systemStore';
import { SystemState } from '@shared/types';
import { EASE_PHANTOM } from '../../styles/motion';
import {
  Eye,
  Crosshair,
  MessageCircle,
  ShieldAlert,
  Ghost,
  Moon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface StateVisual {
  icon: LucideIcon;
  label: string;
  description: string;
}

const STATE_VISUALS: Record<SystemState, StateVisual> = {
  [SystemState.SHADOW]: {
    icon: Eye,
    label: 'SHADOW',
    description: 'Passive observation',
  },
  [SystemState.FOCUS]: {
    icon: Crosshair,
    label: 'FOCUS',
    description: 'Workspace active',
  },
  [SystemState.DIALOGUE]: {
    icon: MessageCircle,
    label: 'DIALOGUE',
    description: 'Conversation',
  },
  [SystemState.SENTINEL]: {
    icon: ShieldAlert,
    label: 'SENTINEL',
    description: 'Threat assessment',
  },
  [SystemState.GHOST]: {
    icon: Ghost,
    label: 'GHOST',
    description: 'Encrypted recording',
  },
  [SystemState.DREAM]: {
    icon: Moon,
    label: 'DREAM',
    description: 'Night mode',
  },
};

interface StateIndicatorProps {
  showLabel?: boolean;
  showDescription?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: { icon: 14, dot: 6, text: 'text-[11px]' },
  md: { icon: 18, dot: 8, text: 'text-[13px]' },
  lg: { icon: 24, dot: 10, text: 'text-[15px]' },
} as const;

export function StateIndicator({
  showLabel = true,
  showDescription = false,
  size = 'md',
  className = '',
}: StateIndicatorProps) {
  const state = useSystemStore((s) => s.state);
  const visual = STATE_VISUALS[state];
  const s = SIZES[size];
  const Icon = visual.icon;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Pulsing dot */}
      <div className="relative flex items-center justify-center" style={{ width: s.dot * 2, height: s.dot * 2 }}>
        <motion.div
          className="absolute rounded-full"
          style={{
            width: s.dot * 2,
            height: s.dot * 2,
            background: 'var(--accent)',
            opacity: 0.3,
          }}
          animate={{
            scale: [1, 1.8, 1],
            opacity: [0.3, 0.1, 0.3],
          }}
          transition={{
            duration: state === SystemState.SENTINEL ? 0.6 : 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <div
          className="rounded-full relative"
          style={{
            width: s.dot,
            height: s.dot,
            background: 'var(--accent)',
            boxShadow: '0 0 6px var(--accent-glow)',
          }}
        />
      </div>

      {/* Icon + Label */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          className="flex items-center gap-1.5"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 4 }}
          transition={{ duration: 0.15, ease: EASE_PHANTOM as unknown as number[] }}
        >
          <Icon
            size={s.icon}
            strokeWidth={1.5}
            style={{ color: 'var(--accent)' }}
          />
          {showLabel && (
            <span
              className={`${s.text} tracking-widest font-mono`}
              style={{ color: 'var(--accent)' }}
            >
              {visual.label}
            </span>
          )}
          {showDescription && (
            <span className={`${s.text} ml-1`} style={{ color: 'var(--ink-secondary)' }}>
              {visual.description}
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
