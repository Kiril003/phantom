/** СВІТ — the living city. One Canvas 2D surface, 30fps, zero DOM churn.
 * Buildings grow with mission progress, citizens walk to their districts,
 * the town-hall bell swings when a gate awaits the operator, reactors
 * glow with key-quota headroom. Every animation carries state. */
import React, { useEffect, useRef, useCallback } from 'react';
import { usePolisStore } from '../../stores/polisStore';
import type { PolisMission, PolisCitizen, ManagedKeyPublic } from '@shared/types';
import { CITY_W, CITY_H, DISTRICTS, districtOf, slotIn } from './cityMap';
import { domainColor, themeColor, withAlpha } from './theme';

interface Walker {
  x: number;
  y: number;
  tx: number;
  ty: number;
  phase: number;
}

interface HitZone {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'mission' | 'bell' | 'power' | 'citizen';
  id: string;
}

export function CityCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const walkers = useRef<Map<string, Walker>>(new Map());
  const hits = useRef<HitZone[]>([]);
  const raf = useRef<number>(0);

  const selectMission = usePolisStore((s) => s.selectMission);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);

  const draw = useCallback((ctx: CanvasRenderingContext2D, t: number) => {
    const { missions, citizens, keys, gates, governor } =
      usePolisStore.getState();
    const zones: HitZone[] = [];
    ctx.clearRect(0, 0, CITY_W, CITY_H);

    const night = governor.night_mode;
    ctx.fillStyle = night ? withAlpha(themeColor('--surface-void'), 0.28) : withAlpha(themeColor('--ink-faint'), 0.10);
    ctx.fillRect(0, 0, CITY_W, CITY_H);

    for (const d of DISTRICTS) {
      ctx.strokeStyle = withAlpha(themeColor('--ink-faint'), 0.20);
      ctx.lineWidth = 1;
      roundRect(ctx, d.x, d.y, d.w, d.h, 14);
      ctx.stroke();
      ctx.fillStyle = withAlpha(themeColor('--ink-muted'), 0.75);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.letterSpacing = '2px';
      ctx.fillText(d.label, d.x + 10, d.y + 16);
    }

    drawTownHall(ctx, t, gates.length > 0, zones);
    drawPower(ctx, t, keys, zones);
    drawMissions(ctx, t, missions, zones);
    drawCitizens(ctx, t, citizens, walkers.current, missions);

    if (night) {
      ctx.fillStyle = withAlpha(themeColor('--surface-void'), 0.20);
      ctx.fillRect(0, 0, CITY_W, CITY_H);
      ctx.fillStyle = themeColor('--ink-primary');
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText('нічна хвиля', CITY_W - 110, 20);
    }
    hits.current = zones;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let last = 0;
    const loop = (ts: number) => {
      raf.current = requestAnimationFrame(loop);
      if (ts - last < 33) return; // 30fps ceiling — Radxa breathes
      last = ts;
      draw(ctx, ts / 1000);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [draw]);

  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CITY_W;
    const y = ((e.clientY - rect.top) / rect.height) * CITY_H;
    for (const z of [...hits.current].reverse()) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) {
        if (z.kind === 'mission') {
          selectMission(z.id);
          setRoomTab('talk');
        } else if (z.kind === 'bell') {
          setRoomTab('talk');
        }
        return;
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={CITY_W}
      height={CITY_H}
      onPointerDown={onTap}
      className="w-full h-full"
      style={{ touchAction: 'none' }}
      data-testid="polis-city-canvas"
    />
  );
}

/* ── painters ────────────────────────────────────────────────────────── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTownHall(
  ctx: CanvasRenderingContext2D,
  t: number,
  hasGates: boolean,
  zones: HitZone[],
) {
  const d = districtOf('townhall');
  const cx = d.x + d.w / 2;
  const base = d.y + d.h - 18;
  ctx.fillStyle = withAlpha(themeColor('--ink-muted'), 0.30);
  roundRect(ctx, cx - 34, base - 46, 68, 46, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 40, base - 46);
  ctx.lineTo(cx, base - 74);
  ctx.lineTo(cx + 40, base - 46);
  ctx.closePath();
  ctx.fillStyle = withAlpha(themeColor('--ink-muted'), 0.40);
  ctx.fill();

  const swing = hasGates ? Math.sin(t * 6) * 0.6 : 0;
  ctx.save();
  ctx.translate(cx, base - 78);
  ctx.rotate(swing);
  ctx.fillStyle = hasGates ? themeColor('--primary') : withAlpha(themeColor('--ink-muted'), 0.60);
  if (hasGates) {
    ctx.shadowColor = themeColor('--primary');
    ctx.shadowBlur = 14 + Math.sin(t * 6) * 6;
  }
  ctx.beginPath();
  ctx.arc(0, 0, 7, Math.PI, 0);
  ctx.lineTo(6, 8);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (hasGates) {
    zones.push({ x: cx - 30, y: base - 110, w: 60, h: 60, kind: 'bell', id: 'bell' });
  }
}

function drawPower(
  ctx: CanvasRenderingContext2D,
  t: number,
  keys: ManagedKeyPublic[],
  zones: HitZone[],
) {
  const d = districtOf('power');
  const shown = keys.slice(0, 6);
  const gap = d.w / (Math.max(shown.length, 1) + 1);
  shown.forEach((k, i) => {
    const x = d.x + gap * (i + 1);
    const y = d.y + d.h - 26;
    const alive = k.state === 'active';
    const cooling = k.state === 'cooling' || k.state === 'exhausted';
    const h = 34;
    ctx.fillStyle = themeColor('--glass-card');
    roundRect(ctx, x - 8, y - h, 16, h, 5);
    ctx.fill();
    const glow = alive
      ? 0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i))
      : cooling
        ? 0.15
        : 0;
    if (glow > 0) {
      ctx.fillStyle = withAlpha(alive ? themeColor('--accent') : themeColor('--primary'), glow);
      ctx.shadowColor = alive ? themeColor('--accent') : themeColor('--primary');
      ctx.shadowBlur = alive ? 12 : 4;
      roundRect(ctx, x - 5, y - h + 6, 10, h - 12, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (k.state === 'invalid') {
      ctx.strokeStyle = themeColor('--signal-alert');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - h + 6);
      ctx.lineTo(x + 6, y - 8);
      ctx.moveTo(x + 6, y - h + 6);
      ctx.lineTo(x - 6, y - 8);
      ctx.stroke();
    }
  });
  if (!shown.length) {
    ctx.fillStyle = withAlpha(themeColor('--signal-alert'), 0.75);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('аварійна лампа: локальний Ollama', d.x + 12, d.y + d.h / 2 + 8);
    const lampGlow = 0.4 + 0.3 * Math.abs(Math.sin(t * 1.5));
    ctx.beginPath();
    ctx.arc(d.x + d.w - 24, d.y + 28, 5, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(themeColor('--signal-alert'), lampGlow);
    ctx.shadowColor = themeColor('--signal-alert');
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  zones.push({ ...districtOf('power'), kind: 'power', id: 'power' });
}

function drawMissions(
  ctx: CanvasRenderingContext2D,
  t: number,
  missions: PolisMission[],
  zones: HitZone[],
) {
  const byDomain = new Map<string, PolisMission[]>();
  for (const m of missions) {
    if (m.status === 'killed') continue;
    const list = byDomain.get(m.domain) ?? [];
    list.push(m);
    byDomain.set(m.domain, list);
  }
  for (const [domain, list] of byDomain) {
    const d = districtOf(domain);
    list.forEach((m, i) => {
      const [cx, cyBase] = slotIn(d, i, list.length);
      const groundY = Math.min(cyBase + 26, d.y + d.h - 8);
      const height = 26 + Math.round(m.progress * 52);
      const w = 34;
      const tint = domainColor(domain);
      const running = m.nodes.some((n) => n.status === 'running');
      const failed = m.nodes.some((n) => n.status === 'failed');
      const blocked = m.status === 'paused' || m.status === 'awaiting_gate';

      ctx.fillStyle = themeColor('--glass-card');
      ctx.strokeStyle = withAlpha(tint, 0.34);
      ctx.lineWidth = 1;
      roundRect(ctx, cx - w / 2, groundY - height, w, height, 4);
      ctx.fill();
      ctx.stroke();

      const floors = Math.max(1, Math.floor(height / 12));
      for (let f = 0; f < floors; f++) {
        const wy = groundY - 8 - f * 12;
        const lit = running && (f + Math.floor(t)) % 2 === 0;
        ctx.fillStyle = lit ? tint : withAlpha(tint, 0.2);
        if (lit) {
          ctx.shadowColor = tint;
          ctx.shadowBlur = 6;
        }
        ctx.fillRect(cx - 10, wy, 6, 5);
        ctx.fillRect(cx + 4, wy, 6, 5);
        ctx.shadowBlur = 0;
      }

      if (blocked) {
        ctx.strokeStyle = 'rgba(244,175,37,0.8)';
        ctx.setLineDash([4, 3]);
        roundRect(ctx, cx - w / 2 - 4, groundY - height - 4, w + 8, height + 8, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (failed) {
        const sy = groundY - height - 6 - (t * 12) % 18;
        ctx.fillStyle = withAlpha(themeColor('--signal-alert'), 0.5 - ((t * 12) % 18) / 40);
        ctx.beginPath();
        ctx.arc(cx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (m.status === 'done') {
        ctx.strokeStyle = tint;
        ctx.beginPath();
        ctx.moveTo(cx, groundY - height);
        ctx.lineTo(cx, groundY - height - 14);
        ctx.stroke();
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(cx, groundY - height - 14);
        ctx.lineTo(cx + 12, groundY - height - 10);
        ctx.lineTo(cx, groundY - height - 6);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = withAlpha(themeColor('--ink-primary'), 0.85);
      ctx.font = '9px "JetBrains Mono", monospace';
      const short =
        m.title.length > 14 ? `${m.title.slice(0, 13)}…` : m.title;
      ctx.fillText(short, cx - w / 2 - 6, groundY + 12);

      zones.push({
        x: cx - w / 2 - 8,
        y: groundY - height - 16,
        w: w + 16,
        h: height + 30,
        kind: 'mission',
        id: m.id,
      });
    });
  }
}

function drawCitizens(
  ctx: CanvasRenderingContext2D,
  t: number,
  citizens: PolisCitizen[],
  walkers: Map<string, Walker>,
  missions: PolisMission[],
) {
  const byDistrict = new Map<string, number>();
  for (const c of citizens) {
    const d = districtOf(c.district);
    const idx = byDistrict.get(d.id) ?? 0;
    byDistrict.set(d.id, idx + 1);
    const total = citizens.filter((cc) => cc.district === c.district).length;
    const [tx, ty] = slotIn(d, idx, total);

    let w = walkers.get(c.id);
    if (!w) {
      const plaza = districtOf('plaza');
      w = { x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2, tx, ty, phase: Math.random() * 6 };
      walkers.set(c.id, w);
    }
    w.tx = tx;
    w.ty = ty;
    const dx = w.tx - w.x;
    const dy = w.ty - w.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const speed = Math.min(1.6, dist * 0.06);
      w.x += (dx / dist) * speed;
      w.y += (dy / dist) * speed;
    }

    const working = c.activity === 'working';
    const reviewing = c.activity === 'reviewing';
    const tint = working || reviewing
      ? domainColor(missions.find((m) => m.id === c.mission_id)?.domain ?? 'generic')
      : withAlpha(themeColor('--ink-muted'), 0.80);

    const bob = Math.sin(t * 3 + w.phase) * (dist > 2 ? 1.6 : 0.6);
    ctx.beginPath();
    ctx.arc(w.x, w.y + bob, working ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = tint;
    if (working) {
      ctx.shadowColor = tint;
      ctx.shadowBlur = 8;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    if (working) {
      const spin = t * 4 + w.phase;
      ctx.beginPath();
      ctx.arc(w.x + Math.cos(spin) * 8, w.y + bob + Math.sin(spin) * 8, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(tint, 0.67);
      ctx.fill();
    } else if (reviewing) {
      ctx.strokeStyle = tint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w.x, w.y + bob, 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (const id of [...walkers.keys()]) {
    if (!citizens.some((c) => c.id === id)) walkers.delete(id);
  }
}
