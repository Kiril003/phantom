/**
 * PHANTOM OS — Interactive Parametric Math Canvas (3D Surface & Function Renderer)
 * Живий математичний рендерер: обертання поверхонь, зміна амплітуди,
 * частоти та фазових кутів у реальному часі через Canvas 2D/3D проекцію.
 */

import React, { useState, useRef, useEffect } from 'react';
import { RotateCw, Sliders } from 'lucide-react';
import { soundFx } from '../../utils/messengerSound';

export const InteractiveParametricMathCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [frequency, setFrequency] = useState(2.4);
  const [amplitude, setAmplitude] = useState(45);
  const [rotationAngle, setRotationAngle] = useState(35);
  const [gridResolution, setGridResolution] = useState(24);
  const [isRotating, setIsRotating] = useState(true);
  const [colorMode] = useState<'sunset' | 'cyber' | 'emerald'>('sunset');

  // Кут обертання живе у ref, а не читається зі стану всередині ефекту.
  // Інакше вибір без виходу: або `rotationAngle` у залежностях — і тоді
  // цикл rAF розбирається й будується наново КОЖЕН кадр (бо сам себе
  // оновлює через setRotationAngle), або його там немає — і лінтер має
  // рацію, що ефект читає застаріле значення. Ref знімає обидва:
  // джерелом правди для малювання є він, а стан лишається виключно
  // для підпису на екрані.
  const angleRef = useRef(rotationAngle);

  // Animation Loop for 3D projection
  useEffect(() => {
    let animId: number;
    let angle = angleRef.current;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      if (isRotating) {
        angle = (angle + 0.5) % 360;
        angleRef.current = angle;
        setRotationAngle(Math.round(angle));
      }

      const rad = (angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      const N = gridResolution;
      const step = 260 / N;

      // Project and draw parametric 3D grid
      ctx.lineWidth = 1.2;

      for (let i = -N / 2; i <= N / 2; i++) {
        ctx.beginPath();
        for (let j = -N / 2; j <= N / 2; j++) {
          const x = i * step;
          const y = j * step;
          const dist = Math.sqrt(x * x + y * y) * 0.05;
          const z = Math.sin(dist * frequency) * Math.cos(dist * frequency * 0.8) * amplitude;

          // 3D Isometric / Rotational Projection
          const rotX = x * cosA - y * sinA;
          const rotY = (x * sinA + y * cosA) * 0.5 - z;

          const screenX = cx + rotX;
          const screenY = cy + rotY;

          if (j === -N / 2) {
            ctx.moveTo(screenX, screenY);
          } else {
            ctx.lineTo(screenX, screenY);
          }
        }

        const gradient = ctx.createLinearGradient(0, cy - 80, 0, cy + 80);
        if (colorMode === 'sunset') {
          gradient.addColorStop(0, '#E87A42');
          gradient.addColorStop(0.5, '#F3B562');
          gradient.addColorStop(1, '#8A58D6');
        } else if (colorMode === 'emerald') {
          gradient.addColorStop(0, '#059669');
          gradient.addColorStop(1, '#34D399');
        } else {
          gradient.addColorStop(0, '#38BDF8');
          gradient.addColorStop(1, '#818CF8');
        }

        ctx.strokeStyle = gradient;
        ctx.stroke();
      }

      if (isRotating) {
        animId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [frequency, amplitude, gridResolution, isRotating, colorMode]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#18201B] text-[#E0D7C6] border-l border-[#3A423B] overflow-hidden select-none">
      {/* Canvas Top Bar */}
      <div className="p-3 bg-[#121614] border-b border-[#2D362F] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-xs text-white">Параметричне математичне полотно (3D Surface)</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => {
              soundFx.playTap();
              setIsRotating(!isRotating);
            }}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors ${
              isRotating ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50' : 'bg-[#2D362F] text-[#8A9186]'
            }`}
          >
            <RotateCw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />
            <span>{isRotating ? 'Обертання' : 'Пауза'}</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="flex-1 relative flex items-center justify-center bg-[#141A16] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560}
          height={380}
          className="max-w-full max-h-full"
        />

        {/* Formula Badge */}
        <div className="absolute top-3 left-3 p-2.5 bg-[#18201B]/80 backdrop-blur-md border border-[#2D362F] rounded-2xl font-mono text-[11px] text-amber-300 space-y-1">
          <div>z = sin(r · {frequency}) · cos(r · {(frequency * 0.8).toFixed(1)}) · {amplitude}</div>
          <div className="text-[9.5px] text-[#8A9186]">Кут: {rotationAngle}° | Сітка: {gridResolution}x{gridResolution}</div>
        </div>
      </div>

      {/* Parametric Controls Bar */}
      <div className="p-3.5 bg-[#121614] border-t border-[#2D362F] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <div className="flex justify-between text-[#8A9186] text-[10.5px] mb-1 font-bold">
            <span>Частота сигналу (ω):</span>
            <span className="text-white font-mono">{frequency}</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="6.0"
            step="0.1"
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value))}
            className="w-full accent-[#C25925]"
          />
        </div>

        <div>
          <div className="flex justify-between text-[#8A9186] text-[10.5px] mb-1 font-bold">
            <span>Амплітуда (A):</span>
            <span className="text-white font-mono">{amplitude}px</span>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            step="1"
            value={amplitude}
            onChange={(e) => setAmplitude(Number(e.target.value))}
            className="w-full accent-[#C25925]"
          />
        </div>

        <div>
          <div className="flex justify-between text-[#8A9186] text-[10.5px] mb-1 font-bold">
            <span>Роздільність сітки:</span>
            <span className="text-white font-mono">{gridResolution}</span>
          </div>
          <input
            type="range"
            min="12"
            max="40"
            step="2"
            value={gridResolution}
            onChange={(e) => setGridResolution(Number(e.target.value))}
            className="w-full accent-[#C25925]"
          />
        </div>
      </div>
    </div>
  );
};
