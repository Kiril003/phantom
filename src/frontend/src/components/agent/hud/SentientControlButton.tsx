import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useSystemStore } from '../../../stores/systemStore';

interface Props {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'alert';
  large?: boolean;
}

export function SentientControlButton({
  icon,
  label,
  onClick,
  tone = 'default',
  large = false,
}: Props) {
  const [isHovered, setIsHovered] = useState(false);
  const sentience = useSystemStore((s) => s.sentience);
  
  const color = useMemo(() => {
    if (tone === 'alert') return 'var(--signal-alert)';
    if (tone === 'primary') return 'var(--accent)';
    return 'var(--ink-secondary)';
  }, [tone]);

  // Kinetic Friction: High cortisol makes actions feel 'heavier' or more resistant
  const friction = sentience.cortisol > 0.6 ? 1.5 : 1.0;
  
  const handleInteraction = () => {
    // If stress is high, we might want to prevent accidental clicks
    // or simulate 'resistance'
    onClick();
  };

  return (
    <motion.button
      type="button"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleInteraction}
      className="flex items-center gap-1 px-3 relative overflow-hidden"
      style={{
        minHeight: 44,
        minWidth: large ? 96 : 64,
        borderRadius: 12,
        background:
          tone === 'alert'
            ? 'color-mix(in srgb, var(--signal-alert) 18%, transparent)'
            : 'color-mix(in srgb, var(--accent) 8%, transparent)',
        color,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        fontSize: large ? 'var(--fs-sm)' : 'var(--fs-xs)',
        fontFamily: 'var(--font-mono)',
        letterSpacing: 'var(--tracking-wider)',
        cursor: 'pointer',
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 / friction }}
      animate={{
        // Predictive Ghosting: gentle pulse when near (hovered)
        boxShadow: isHovered 
          ? `0 0 20px color-mix(in srgb, ${color} 30%, transparent)`
          : `0 0 0px transparent`,
        borderWidth: isHovered ? 2 : 1,
      }}
      aria-label={label}
    >
      {/* Predictive Ghosting Pulse Effect */}
      {isHovered && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.2, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{ background: color }}
        />
      )}
      
      {icon}
      <span>{label}</span>
      
      {/* Kinetic Heat Effect - Glow if dopamine is high */}
      {sentience.dopamine > 0.8 && (
        <div 
          className="absolute -right-1 -top-1 w-2 h-2 rounded-full"
          style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}
        />
      )}
    </motion.button>
  );
}
