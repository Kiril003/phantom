/**
 * PHANTOM OS — Procedural Interactive AI Avatar Core (Fluid Neural Orb)
 * Реактивне процедурне 3D/Canvas ядро. Змінює колірний спектр, швидкість обертання
 * та амплітуду частот відповідно до обчислювального стану (Idle / Thinking / Coding / Analysis / Voice).
 */

import React, { useEffect, useRef } from 'react';
import { ComputeState, CognitivePersona } from '../../stores/aiSynthesisStore';

interface ProceduralAvatarCoreProps {
  computeState: ComputeState;
  persona?: CognitivePersona;
  voiceLevel?: number; // 0..1
  size?: number; // default: 72px
  interactive?: boolean;
  className?: string;
  onClick?: () => void;
}

interface StatePalette {
  primary: string;
  glow: string;
  accent: string;
  ring: string;
  speed: number;
  particles: number;
}

const PALETTES: Record<ComputeState, StatePalette> = {
  idle: {
    primary: '#E87A42', // Warm amber / terracotta
    glow: 'rgba(232, 122, 66, 0.35)',
    accent: '#F3B562',
    ring: 'rgba(232, 122, 66, 0.2)',
    speed: 0.015,
    particles: 24,
  },
  listening: {
    primary: '#4C8A55', // Emerald listening resonance
    glow: 'rgba(76, 138, 85, 0.45)',
    accent: '#82C78F',
    ring: 'rgba(76, 138, 85, 0.35)',
    speed: 0.04,
    particles: 36,
  },
  thinking: {
    primary: '#8A58D6', // Deep synaptic violet
    glow: 'rgba(138, 88, 214, 0.5)',
    accent: '#C792EA',
    ring: 'rgba(138, 88, 214, 0.3)',
    speed: 0.05,
    particles: 48,
  },
  coding: {
    primary: '#2B82BA', // Cyber / logic blue
    glow: 'rgba(43, 130, 186, 0.5)',
    accent: '#64B5F6',
    ring: 'rgba(43, 130, 186, 0.3)',
    speed: 0.06,
    particles: 40,
  },
  analysis: {
    primary: '#D97724', // Sun gold data pulse
    glow: 'rgba(217, 119, 36, 0.45)',
    accent: '#FFE082',
    ring: 'rgba(217, 119, 36, 0.25)',
    speed: 0.035,
    particles: 32,
  },
  synthesis: {
    primary: '#D14D72', // Magenta synthesis flare
    glow: 'rgba(209, 77, 114, 0.5)',
    accent: '#FF80AB',
    ring: 'rgba(209, 77, 114, 0.35)',
    speed: 0.055,
    particles: 44,
  },
  speaking: {
    primary: '#E87A42', // Vocal energetic wave
    glow: 'rgba(232, 122, 66, 0.6)',
    accent: '#FFD54F',
    ring: 'rgba(232, 122, 66, 0.4)',
    speed: 0.07,
    particles: 50,
  },
};

export const ProceduralAvatarCore: React.FC<ProceduralAvatarCoreProps> = ({
  computeState = 'idle',
  voiceLevel = 0,
  size = 72,
  interactive = true,
  className = '',
  onClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);
  const mouseRef = useRef<{ x: number; y: number; hover: boolean }>({ x: 0, y: 0, hover: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const palette = PALETTES[computeState] || PALETTES.idle;

    // Particle nodes for orbital core
    const particles = Array.from({ length: palette.particles }, (_, i) => ({
      angle: (i / palette.particles) * Math.PI * 2,
      dist: 0.28 + Math.sin(i * 1.5) * 0.12,
      speed: 0.01 + (i % 5) * 0.004,
      size: 1.2 + (i % 3) * 0.8,
      phase: i * 0.4,
    }));

    const render = () => {
      timeRef.current += palette.speed;
      const t = timeRef.current;
      const effectiveVoice = Math.min(1, Math.max(0, voiceLevel));

      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const radius = (size / 2) * 0.72;

      // 1. Ambient Dynamic Glow
      const glowGradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.4);
      glowGradient.addColorStop(0, palette.glow);
      glowGradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.4, 0, Math.PI * 2);
      ctx.fill();

      // 2. Outer Frequency Rings (Pulse based on state & voice)
      const ringCount = 3;
      for (let r = 0; r < ringCount; r++) {
        const ringT = t * (r % 2 === 0 ? 1 : -0.8) + r * 1.2;
        const ringScale = 0.85 + r * 0.18 + Math.sin(t * 2 + r) * 0.05 + effectiveVoice * 0.25;
        ctx.strokeStyle = palette.ring;
        ctx.lineWidth = 1.2;
        ctx.beginPath();

        const segments = 28;
        for (let s = 0; s <= segments; s++) {
          const theta = (s / segments) * Math.PI * 2;
          const wobble = Math.sin(theta * 3 + ringT) * (2 + effectiveVoice * 6);
          const px = cx + Math.cos(theta) * (radius * ringScale + wobble);
          const py = cy + Math.sin(theta) * (radius * ringScale + wobble);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // 3. Central Fluid Neural Core
      const coreGradient = ctx.createRadialGradient(
        cx - radius * 0.2,
        cy - radius * 0.25,
        radius * 0.1,
        cx,
        cy,
        radius * 0.95
      );
      coreGradient.addColorStop(0, '#FFFFFF');
      coreGradient.addColorStop(0.3, palette.accent);
      coreGradient.addColorStop(0.8, palette.primary);
      coreGradient.addColorStop(1, '#1A1815');

      ctx.fillStyle = coreGradient;
      ctx.beginPath();

      // Organic fluid deformation loop
      const points = 16;
      for (let p = 0; p <= points; p++) {
        const angle = (p / points) * Math.PI * 2;
        const wave =
          Math.sin(angle * 2 + t * 2) * 2.5 +
          Math.cos(angle * 4 - t * 1.5) * 1.5 +
          (mouseRef.current.hover ? Math.sin(angle * 6 + t * 4) * 2 : 0) +
          effectiveVoice * 8 * Math.sin(angle * 5 + t * 6);

        const dist = radius * (0.68 + Math.sin(t * 1.2) * 0.04) + wave;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;

        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.shadowColor = palette.primary;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 4. Orbiting Synaptic Quantum Particles
      particles.forEach((pt) => {
        const curAngle = pt.angle + t * pt.speed * 8;
        const curDist = radius * pt.dist * (1 + Math.sin(t * 3 + pt.phase) * 0.15 + effectiveVoice * 0.3);
        const px = cx + Math.cos(curAngle) * curDist;
        const py = cy + Math.sin(curAngle) * curDist;

        ctx.fillStyle = pt.size > 1.8 ? '#FFFFFF' : palette.accent;
        ctx.beginPath();
        ctx.arc(px, py, pt.size + effectiveVoice * 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // 5. Specular Highlights / Inner Pupil Reflection
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(cx - radius * 0.22, cy - radius * 0.26, radius * 0.14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(cx + radius * 0.15, cy - radius * 0.18, radius * 0.07, 0, Math.PI * 2);
      ctx.fill();

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [computeState, size, voiceLevel]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => {
        mouseRef.current.hover = true;
      }}
      onMouseLeave={() => {
        mouseRef.current.hover = false;
      }}
      className={`relative inline-flex items-center justify-center select-none ${
        interactive ? 'cursor-pointer transition-transform hover:scale-105 active:scale-95' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      title={`AI Companion Core: ${computeState.toUpperCase()}`}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="block drop-shadow-sm"
      />
    </div>
  );
};
