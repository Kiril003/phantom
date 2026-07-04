/** Живий DAG місії — вузли по шарах залежностей, зв'язки течуть енергією
 * від готового до наступного, хвиля пульсує на працюючих. Тап = інспектор
 * воркера. Canvas 2D, 30fps. */
import { useEffect, useRef, useCallback } from 'react';
import { usePolisStore } from '../../../stores/polisStore';
import type { PolisMission, PolisNode } from '@shared/types';
import { DOMAIN_TINT } from '../cityMap';

const W = 900;
const H = 460;
const R = 30;

const STATUS_TINT: Record<string, string> = {
  running: '#22d3ee',
  review: '#f4af25',
  done: '#34d399',
  failed: '#f43f5e',
  blocked: '#f43f5e',
  pending: '#64748b',
  ready: '#94a3b8',
  skipped: '#475569',
};

interface Placed {
  node: PolisNode;
  x: number;
  y: number;
}

function layout(mission: PolisMission): Map<string, Placed> {
  const depth = new Map<string, number>();
  const nodesById = new Map(mission.nodes.map((n) => [n.id, n]));
  const resolve = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = nodesById.get(id);
    const d = n && n.depends_on.length
      ? 1 + Math.max(...n.depends_on.map((p) => resolve(p, seen)))
      : 0;
    depth.set(id, d);
    return d;
  };
  mission.nodes.forEach((n) => resolve(n.id, new Set()));

  const byLayer = new Map<number, PolisNode[]>();
  mission.nodes.forEach((n) => {
    const d = depth.get(n.id) ?? 0;
    const arr = byLayer.get(d) ?? [];
    arr.push(n);
    byLayer.set(d, arr);
  });

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const placed = new Map<string, Placed>();
  const colGap = W / (layers.length + 1);
  layers.forEach((d, ci) => {
    const col = byLayer.get(d)!;
    const rowGap = H / (col.length + 1);
    col.forEach((n, ri) => {
      placed.set(n.id, {
        node: n,
        x: colGap * (ci + 1),
        y: rowGap * (ri + 1),
      });
    });
  });
  return placed;
}

export function GraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number>(0);
  const hits = useRef<Placed[]>([]);
  const missionId = usePolisStore((s) => s.selectedMissionId);
  const openInspector = usePolisStore((s) => s.openInspector);

  const draw = useCallback((ctx: CanvasRenderingContext2D, t: number) => {
    const st = usePolisStore.getState();
    const mission = st.missions.find((m) => m.id === st.selectedMissionId);
    ctx.clearRect(0, 0, W, H);
    if (!mission) return;
    const tint = DOMAIN_TINT[mission.domain] ?? DOMAIN_TINT.generic;
    const placed = layout(mission);
    hits.current = [...placed.values()];

    // edges
    for (const { node, x, y } of placed.values()) {
      for (const dep of node.depends_on) {
        const from = placed.get(dep);
        if (!from) continue;
        const depDone = from.node.status === 'done';
        const active = depDone && (node.status === 'ready' || node.status === 'running');
        ctx.beginPath();
        ctx.moveTo(from.x + R, from.y);
        const midX = (from.x + x) / 2;
        ctx.bezierCurveTo(midX, from.y, midX, y, x - R, y);
        ctx.strokeStyle = active ? `${tint}` : depDone ? `${tint}44` : 'rgba(148,163,184,0.15)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.stroke();
        if (active) {
          // energy pulse travelling along the edge
          const p = (t * 0.4) % 1;
          const bx = bezier(from.x + R, midX, midX, x - R, p);
          const by = bezier(from.y, from.y, y, y, p);
          ctx.beginPath();
          ctx.arc(bx, by, 3, 0, Math.PI * 2);
          ctx.fillStyle = tint;
          ctx.shadowColor = tint;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    // nodes
    for (const { node, x, y } of placed.values()) {
      const c = STATUS_TINT[node.status] ?? '#64748b';
      const running = node.status === 'running';
      const pulse = running ? 1 + Math.sin(t * 4) * 0.06 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);

      if (running) {
        ctx.beginPath();
        ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
        ctx.strokeStyle = `${c}55`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.fill();
      ctx.lineWidth = node.kind === 'gate' ? 3 : 2;
      ctx.strokeStyle = c;
      if (running) {
        ctx.shadowColor = c;
        ctx.shadowBlur = 14;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ring = progress of budget for running, check/cross for terminal
      if (node.status === 'done') {
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-9, 0);
        ctx.lineTo(-3, 7);
        ctx.lineTo(10, -8);
        ctx.stroke();
      } else if (node.status === 'failed') {
        ctx.strokeStyle = c;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
        ctx.moveTo(7, -7); ctx.lineTo(-7, 7);
        ctx.stroke();
      } else if (node.kind === 'gate') {
        ctx.fillStyle = c;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◆', 0, 0);
      }
      ctx.restore();

      // label
      ctx.fillStyle = 'rgba(241,245,249,0.85)';
      ctx.font = '10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title;
      ctx.fillText(label, x, y + R + 6);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let last = 0;
    const loop = (ts: number) => {
      raf.current = requestAnimationFrame(loop);
      if (ts - last < 33) return;
      last = ts;
      draw(ctx, ts / 1000);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [draw]);

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    for (const p of hits.current) {
      if (Math.hypot(p.x - x, p.y - y) <= R + 4) {
        openInspector(p.node.id);
        return;
      }
    }
  };

  if (!missionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p style={{ color: 'var(--ink-muted)' }}>Обери місію, щоб побачити її граф.</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-2">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onTap}
        className="max-w-full max-h-full"
        style={{ touchAction: 'none' }}
        data-testid="graph-canvas"
      />
    </div>
  );
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
