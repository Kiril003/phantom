/**
 * PhantomFamiliar — overlay component that hosts the Familiar wisp.
 *
 * Mounted ONCE at App-level (above content, below modals) by `App.tsx`.
 * Subscribes to `familiarStore.currentManifestation`. Renders nothing when
 * no manifestation is active.
 *
 * Behaviour by pose:
 *   - idle / waving / sleeping: parked at the manifestation's anchor
 *     (default: bottom-right corner with a 24px inset).
 *   - floating: drifts along a simple Bezier path from the entry edge to
 *     a target point, then loops back; uses Framer Motion `motion.div`
 *     with `animate.x`/`animate.y` keyframes.
 *   - pointing: positioned next to a DOM element (resolved from
 *     `target.selector` via `getBoundingClientRect`), with a tendril
 *     SVG (inside FamiliarSVG) that points at it. Re-positions on
 *     `resize` to keep the tendril correct.
 *   - peeking: anchored to the bottom edge, half-clipped by the SVG
 *     viewport so it reads as "climbing into view".
 *   - vanishing: stays in place but fades to mist particles.
 *
 * Reduce-motion: when `prefers-reduced-motion: reduce` is set, the whole
 * component flattens to a static fade-in/out at the anchor position; no
 * Bezier path, no rotation, no bob.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFamiliarStore } from '../../stores/familiarStore';
import type { FamiliarManifestation } from '@shared/types';
import { FamiliarSVG } from './FamiliarSVG';

// Phase-5 R2 3D Character integration.
// 130×182 px to fit the 3D Canvas aspect ratio and character rig.
const FAMILIAR_W = 130;
const FAMILIAR_H = 182;
const FRAME_W = 1024;
const FRAME_H = 600;

// 32-px inset from the bottom-right corner — the "home" pose anchor.
// Slightly more inset than before to clear the wider silhouette.
const HOME_X = FRAME_W - FAMILIAR_W - 32;
const HOME_Y = FRAME_H - FAMILIAR_H - 32;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduce;
}

interface AnchorPoint {
  /** Top-left of the FamiliarSVG bounding box, viewport-coords. */
  x: number;
  y: number;
  /** For pointing: the angle (radians) the tendril should reach. */
  pointAngle: number;
  pointLength: number;
}

const HOME_ANCHOR: AnchorPoint = {
  x: HOME_X,
  y: HOME_Y,
  pointAngle: 0,
  pointLength: 0,
};

/**
 * Resolve a target rect from a manifestation. Returns null when the
 * selector doesn't match or no target was supplied.
 */
function resolveTargetRect(
  m: FamiliarManifestation | null,
): { x: number; y: number } | null {
  if (!m || !m.target) return null;
  const t = m.target;
  if (typeof t.x === 'number' && typeof t.y === 'number') {
    return { x: t.x, y: t.y };
  }
  if (t.selector && typeof document !== 'undefined') {
    const node = document.querySelector(t.selector);
    if (node) {
      const r = (node as Element).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
}

/**
 * Куди поставити привида, щоб він нікого не накрив.
 *
 * Тут було два недогляди. Обхід перешкод питав `.glass-panel` — класу, якого
 * в макеті немає (картки звуться `.glass`), тож не бачив узагалі нічого. А
 * домашня поза до нього й не заходила: `default` повертав кут навпростець, і
 * привид ставав просто на картку, закриваючи кнопку «Пізніше».
 *
 * На 1024×600 порожнього місця немає ніде, тож вибираємо не «вільне», а
 * НАЙМЕНШ зайняте: кілька кутів, оцінка за площею перекриття, і кнопки з
 * полями важать удесятеро — накрити текст прикро, накрити кнопку не можна.
 */
function getSafeAnchor(preferredX: number, desiredY: number): { x: number; y: number } {
  const myW = FAMILIAR_W;
  const myH = FAMILIAR_H;
  if (typeof document === 'undefined') return { x: preferredX, y: desiredY };

  const candidates: Array<[number, number]> = [
    [preferredX, desiredY],
    [24, FRAME_H - myH - 24],
    [FRAME_W - myW - 24, 56],
    [24, 56],
    [(FRAME_W - myW) / 2, FRAME_H - myH - 12],
  ];

  const panels = Array.from(
    document.querySelectorAll('[role="dialog"], .glass, .glass-elevated, .sub-glass'),
  );
  const controls = Array.from(
    document.querySelectorAll('button, a, input, textarea, [role="button"]'),
  );

  const overlap = (x: number, y: number, r: DOMRect): number => {
    const w = Math.min(x + myW, r.right) - Math.max(x, r.left);
    const h = Math.min(y + myH, r.bottom) - Math.max(y, r.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  let best = candidates[0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const [x0, y0] of candidates) {
    const x = Math.max(0, Math.min(FRAME_W - myW, x0));
    const y = Math.max(0, Math.min(FRAME_H - myH, y0));
    let cost = 0;
    for (const el of panels) cost += overlap(x, y, el.getBoundingClientRect());
    for (const el of controls) cost += overlap(x, y, el.getBoundingClientRect()) * 10;
    if (cost < bestCost) {
      bestCost = cost;
      best = [x, y];
    }
  }
  return { x: best[0], y: best[1] };
}

function anchorFor(m: FamiliarManifestation | null): AnchorPoint {
  if (!m) {
    const safeHome = getSafeAnchor(HOME_X, HOME_Y); 
    return { ...HOME_ANCHOR, x: safeHome.x, y: safeHome.y };
  }

  switch (m.pose) {
    case 'pointing': {
      const target = resolveTargetRect(m);
      if (!target) {
        // No target → degrade to home anchor pointing at center.
        return {
          x: HOME_X,
          y: HOME_Y,
          pointAngle: Math.atan2(FRAME_H / 2 - HOME_Y, FRAME_W / 2 - HOME_X),
          pointLength: 18,
        };
      }
      // Park the wisp ~80px away from the target on a 45° offset so the
      // tendril has room to draw. Clamp inside the 1024×600 frame.
      const offX = -56;
      const offY = -56;
      const px = Math.max(
        4,
        Math.min(FRAME_W - FAMILIAR_W - 4, target.x + offX),
      );
      const py = Math.max(
        4,
        Math.min(FRAME_H - FAMILIAR_H - 4, target.y + offY),
      );
      const bodyCenterX = px + FAMILIAR_W / 2;
      const bodyCenterY = py + FAMILIAR_H / 2;
      const dx = target.x - bodyCenterX;
      const dy = target.y - bodyCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // FamiliarSVG point length is in svg-px (60×80 viewBox); we keep it
      // proportional to the screen distance, capped so it doesn't blow
      // off-canvas.
      const pointLength = Math.min(34, Math.max(8, dist / 4));
      return {
        x: px,
        y: py,
        pointAngle: Math.atan2(dy, dx),
        pointLength,
      };
    }

    case 'peeking':
      return {
        x: 32,
        y: FRAME_H - FAMILIAR_H + 24, // half-clipped at the bottom edge
        pointAngle: 0,
        pointLength: 0,
      };

    case 'floating': {
      // Use the `target` if present, otherwise drift to mid-screen.
      const target = resolveTargetRect(m);
      const tx = target?.x ?? FRAME_W * 0.5;
      const ty = target?.y ?? FRAME_H * 0.45;
      const base = {
        x: Math.max(4, Math.min(FRAME_W - FAMILIAR_W - 4, tx - FAMILIAR_W / 2)),
        y: Math.max(4, Math.min(FRAME_H - FAMILIAR_H - 4, ty - FAMILIAR_H / 2))
      };
      const safe = getSafeAnchor(base.x, base.y);
      return {
        x: safe.x,
        y: safe.y,
        pointAngle: 0,
        pointLength: 0,
      };
    }

    default: {
      // Домашня поза теж шукає вільне місце. Раніше вона одна йшла в кут
      // навпростець — і саме вона видима найчастіше.
      const safe = getSafeAnchor(HOME_X, HOME_Y);
      return { ...HOME_ANCHOR, x: safe.x, y: safe.y };
    }
  }
}

/**
 * Bezier path keyframe builder for the `floating` pose. Returns a list of
 * {x, y} samples from an off-screen entry point through two control
 * points to the destination anchor.
 */
function buildFloatPath(
  destX: number,
  destY: number,
): { x: number[]; y: number[] } {
  // Enter from off-screen left or right at random.
  const enterFromLeft = Math.random() < 0.5;
  const startX = enterFromLeft ? -FAMILIAR_W : FRAME_W;
  const startY = 80 + Math.random() * (FRAME_H - 200);
  // Two control points to give the curve a gentle S.
  const cp1X = (startX + destX) / 2 + (enterFromLeft ? 80 : -80);
  const cp1Y = startY + (Math.random() - 0.5) * 140;
  const cp2X = (destX + startX) / 2 + (enterFromLeft ? -40 : 40);
  const cp2Y = destY + (Math.random() - 0.5) * 80;
  // Sample the cubic Bezier at 8 t values for the keyframes (Framer Motion
  // interpolates linearly between keyframes; 8 samples is plenty for a
  // smooth-looking drift over ~6.5s).
  const samples = 8;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const u = 1 - t;
    const x =
      u * u * u * startX +
      3 * u * u * t * cp1X +
      3 * u * t * t * cp2X +
      t * t * t * destX;
    const y =
      u * u * u * startY +
      3 * u * u * t * cp1Y +
      3 * u * t * t * cp2Y +
      t * t * t * destY;
    xs.push(x);
    ys.push(y);
  }
  return { x: xs, y: ys };
}

export function PhantomFamiliar() {
  const manifestation = useFamiliarStore((s) => s.currentManifestation);
  const dismiss = useFamiliarStore((s) => s.dismiss);
  const reduceMotion = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);
  const lastIdRef = useRef<string | null>(null);

  // Годинник життя з'яви раніше запускала 3D-модель зі свого onLoaded.
  // Силует малюється одразу, тож заводимо його на появі — інакше привид
  // лишався на екрані назавжди.
  const manifestationId = manifestation?.id ?? null;
  useEffect(() => {
    if (!manifestationId) return;
    useFamiliarStore.getState().startTimer(manifestationId);
  }, [manifestationId]);

  // Recompute target rect on resize so a `pointing` manifestation
  // follows DOM-layout shifts (orientation change, panel toggle).
  useEffect(() => {
    if (!manifestation || manifestation.pose !== 'pointing') return;
    const onResize = () => setTick((t) => (t + 1) % 1_000_000);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [manifestation]);

  // When a fresh `pointing` manifestation appears, force one tick after a
  // microtask so getBoundingClientRect runs after React has flushed any
  // pending layout. Without this, the first frame can sit at HOME_ANCHOR
  // before the resize-based correction kicks in.
  useEffect(() => {
    if (!manifestation) {
      lastIdRef.current = null;
      return;
    }
    if (manifestation.id !== lastIdRef.current) {
      lastIdRef.current = manifestation.id;
      const id = window.requestAnimationFrame(() =>
        setTick((t) => (t + 1) % 1_000_000),
      );
      return () => window.cancelAnimationFrame(id);
    }
  }, [manifestation]);

  // `tick` тут «зайвий» лише на вигляд: лінтер бачить, що його не читає
  // тіло useMemo, і не бачить, що `anchorFor` НЕ чиста — вонаміряє живий
  // DOM через getBoundingClientRect. Саме `tick` (його штовхає ефект вище,
  // після rAF) і є єдиним способом сказати «переміряй». Прибрати його —
  // означає назавжди приморозити якір до першого кадру, коли елемент ще
  // стоїть у HOME_ANCHOR.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const anchor = useMemo(() => anchorFor(manifestation), [manifestation, tick]);

  const floatPath = useMemo(() => {
    if (!manifestation || manifestation.pose !== 'floating' || reduceMotion) {
      return null;
    }
    return buildFloatPath(anchor.x, anchor.y);
  }, [manifestation, anchor.x, anchor.y, reduceMotion]);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none', // ambient, never steals touch
        overflow: 'hidden',
        // Sit above content (z-overlay = 30) but below modals (z-modal = 40).
        zIndex: 35,
      }}
      data-testid="phantom-familiar-overlay"
    >
      <AnimatePresence>
        {manifestation && (
          <motion.div
            key={manifestation.id}
            data-testid="phantom-familiar"
            data-pose={manifestation.pose}
            data-trigger={manifestation.trigger}
            initial={
              reduceMotion
                ? { opacity: 0, x: anchor.x, y: anchor.y }
                : floatPath
                  ? { opacity: 0, x: floatPath.x[0], y: floatPath.y[0] }
                  : {
                      opacity: 0,
                      x: anchor.x,
                      y: anchor.y,
                      scale: 0.7,
                    }
            }
            animate={
              reduceMotion
                ? { opacity: 1, x: anchor.x, y: anchor.y }
                : floatPath
                  ? {
                      opacity: [0, 1, 1, 0.85],
                      x: floatPath.x,
                      y: floatPath.y,
                    }
                  : {
                      opacity: 1,
                      x: anchor.x,
                      y: anchor.y,
                      scale: 1,
                    }
            }
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.6, transition: { duration: 0.5 } }
            }
            transition={
              reduceMotion
                ? { duration: 0.3 }
                : floatPath
                  ? {
                      duration: manifestation.durationMs / 1000,
                      ease: 'easeInOut',
                    }
                  : { type: 'spring', stiffness: 110, damping: 16 }
            }
            onAnimationComplete={(definition) => {
              // For `vanishing`, fade-out is the lifecycle — clean up the
              // store as soon as the exit completes.
              if (
                manifestation.pose === 'vanishing' &&
                typeof definition === 'object' &&
                definition !== null &&
                'opacity' in definition &&
                (definition as { opacity?: number }).opacity === 0
              ) {
                dismiss();
              }
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: FAMILIAR_W,
              height: FAMILIAR_H,
              willChange: 'transform, opacity',
            }}
          >
            {/* Тут стояла 3D-модель темного чоловіка в плащі: непрозора,
                обрізана прямим краєм полотна і поставлена просто на картку.
                На 1024×600 вільного місця немає, тож привид завжди на чомусь
                стоїть — і мусить бути прозорим. Скляний силует із тієї ж
                бурштинової палітри, що й орб: одна присутність, не дві. */}
            <div
              style={{
                width: '100%',
                height: '100%',
                maskImage: 'linear-gradient(to bottom, #000 66%, transparent 98%)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 66%, transparent 98%)',
              }}
            >
              <FamiliarSVG
                pose={manifestation.pose}
                emotion={manifestation.emotion}
                pointAngle={anchor.pointAngle}
                pointLength={anchor.pointLength}
                reduceMotion={reduceMotion}
              />
            </div>
            {manifestation.message && (
              <div
                style={{
                  position: 'absolute',
                  left: FAMILIAR_W + 8,
                  top: 8,
                  maxWidth: 220,
                  padding: '6px 10px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.85)',
                  border: '1px solid rgba(244,175,37,0.40)',
                  boxShadow: '0 4px 14px rgba(120, 70, 10, 0.10)',
                  fontFamily: 'var(--font-display, Manrope, system-ui)',
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: 'var(--ink-primary, #1a1612)',
                  whiteSpace: 'normal',
                }}
              >
                {manifestation.message}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default PhantomFamiliar;
