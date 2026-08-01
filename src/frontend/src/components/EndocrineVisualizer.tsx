import { useEffect, useRef } from 'react';
import { useEndocrineStore } from '../stores/endocrineStore';

/**
 * Renders the Digital Endocrine System levels as an organic, animated radial gauge.
 */
export function EndocrineVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // We subscribe to the store, but to avoid React re-render spam at 60fps,
  // we actually poll the store directly inside the requestAnimationFrame loop.
  // We just need a mount effect.
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    let time = 0;
    
    const draw = () => {
      time += 0.05;
      const { cortisol, dopamine, oxytocin } = useEndocrineStore.getState();
      
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(cx, cy) - 10;
      
      ctx.clearRect(0, 0, width, height);
      
      // Draw background
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();
      
      const drawRing = (val: number, color: string, rOff: number, phase: number, waveAmplitude: number) => {
        ctx.beginPath();
        for (let i = 0; i <= Math.PI * 2; i += 0.1) {
          // Organic wobble
          const wobble = Math.sin(i * 3 + time + phase) * waveAmplitude * val;
          const r = radius + rOff + wobble;
          const x = cx + Math.cos(i) * r;
          const y = cy + Math.sin(i) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 + val * 4;
        ctx.stroke();
        
        // Glow
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * val;
      };
      
      // Cortisol (Red/Harsh, high frequency wobble)
      drawRing(cortisol, `rgba(255, 50, 50, ${0.2 + cortisol * 0.8})`, -5, 0, 8);
      ctx.shadowBlur = 0; // reset
      
      // Dopamine (Blue/Electric, bright bursts)
      drawRing(dopamine, `rgba(50, 200, 255, ${0.2 + dopamine * 0.8})`, -15, Math.PI, 4);
      ctx.shadowBlur = 0;
      
      // Oxytocin (Gold/Warm, slow gentle breath)
      drawRing(oxytocin, `rgba(255, 200, 50, ${0.2 + oxytocin * 0.8})`, -25, time * 0.2, 2);
      ctx.shadowBlur = 0;
      
      animationId = requestAnimationFrame(draw);
    };
    
    draw();
    return () => cancelAnimationFrame(animationId);
  }, []);
  
  return (
    <div className="relative group" title="Digital Endocrine System (Cortisol, Dopamine, Oxytocin)">
      <canvas 
        ref={canvasRef} 
        width={100} 
        height={100} 
        className="w-16 h-16 opacity-70 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}
