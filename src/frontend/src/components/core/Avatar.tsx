import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystemStore } from '../../stores/systemStore';
import { SystemState } from '@shared/types';
import { EASE_PHANTOM } from '../../styles/motion';

/**
 * Avatar — the visual embodiment of PHANTOM.
 * Renders a state-reactive animated core with orbital rings.
 * Each state has distinct rhythm, scale, and glow behavior.
 */

interface AvatarConfig {
  coreSize: number;
  ringCount: number;
  pulseSpeed: number;
  glowIntensity: number;
  ringRotation: boolean;
}

const STATE_CONFIGS: Record<SystemState, AvatarConfig> = {
  [SystemState.SHADOW]: {
    coreSize: 32,
    ringCount: 1,
    pulseSpeed: 4,
    glowIntensity: 0.2,
    ringRotation: false,
  },
  [SystemState.FOCUS]: {
    coreSize: 48,
    ringCount: 2,
    pulseSpeed: 2.5,
    glowIntensity: 0.5,
    ringRotation: true,
  },
  [SystemState.DIALOGUE]: {
    coreSize: 56,
    ringCount: 3,
    pulseSpeed: 1.8,
    glowIntensity: 0.7,
    ringRotation: true,
  },
  [SystemState.SENTINEL]: {
    coreSize: 44,
    ringCount: 2,
    pulseSpeed: 0.6,
    glowIntensity: 0.9,
    ringRotation: true,
  },
  [SystemState.GHOST]: {
    coreSize: 8,
    ringCount: 0,
    pulseSpeed: 6,
    glowIntensity: 0.1,
    ringRotation: false,
  },
  [SystemState.DREAM]: {
    coreSize: 40,
    ringCount: 1,
    pulseSpeed: 5,
    glowIntensity: 0.3,
    ringRotation: false,
  },
};

interface AvatarProps {
  size?: number;
  className?: string;
  speaking?: boolean;
  listening?: boolean;
}

export function Avatar({ size = 120, className = '', speaking = false, listening = false }: AvatarProps) {
  const state = useSystemStore((s) => s.state);
  const config = STATE_CONFIGS[state];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    let t = 0;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, size, size);

      const accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim() || '#4fc3f7';

      t += 0.016;

      // Core pulse
      const pulseFactor = Math.sin(t * (Math.PI * 2) / config.pulseSpeed) * 0.5 + 0.5;
      const coreR = (config.coreSize / 2) * (1 + pulseFactor * 0.08);

      // Speaking modulation — faster, larger pulse
      const speakMod = speaking ? Math.sin(t * 12) * 0.15 + 1 : 1;
      // Listening modulation — gentle throb
      const listenMod = listening ? Math.sin(t * 6) * 0.08 + 1 : 1;
      const finalR = coreR * speakMod * listenMod;

      // Glow
      const glowR = finalR * 2.5;
      const glow = ctx.createRadialGradient(cx, cy, finalR * 0.5, cx, cy, glowR);
      glow.addColorStop(0, hexToRgba(accentColor, config.glowIntensity * 0.6));
      glow.addColorStop(1, hexToRgba(accentColor, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Rings
      for (let i = 0; i < config.ringCount; i++) {
        const ringR = finalR + 12 + i * 10;
        const rotation = config.ringRotation ? t * (0.5 + i * 0.3) : 0;
        const ringAlpha = 0.15 + pulseFactor * 0.15 - i * 0.04;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);

        ctx.strokeStyle = hexToRgba(accentColor, Math.max(ringAlpha, 0.05));
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6 + i * 4]);
        ctx.beginPath();
        ctx.arc(0, 0, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, finalR);
      coreGrad.addColorStop(0, hexToRgba(accentColor, 0.9));
      coreGrad.addColorStop(0.7, hexToRgba(accentColor, 0.5));
      coreGrad.addColorStop(1, hexToRgba(accentColor, 0.15));

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, finalR, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright point
      ctx.fillStyle = hexToRgba('#ffffff', 0.4 + pulseFactor * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, finalR * 0.2, 0, Math.PI * 2);
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [state, size, config, speaking, listening]);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        className={`relative flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.6, ease: EASE_PHANTOM as unknown as number[] }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
        />
      </motion.div>
    </AnimatePresence>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(79,195,247,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
