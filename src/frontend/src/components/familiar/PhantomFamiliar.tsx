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
import { Familiar3D } from './Familiar3D';

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

/** Compute the anchor point for a manifestation. */
function getSafeAnchor(preferredX: number, desiredY: number): { x: number, y: number } {
  // Check if we overlap with any major UI panels. We keep it light:
  // query for [role="dialog"], .glass-panel.
  // The familiar bounds are FAMILIAR_W x FAMILIAR_H.
  const myW = 130;
  const myH = 182;
  let cx = preferredX;
  let cy = desiredY;
  
  if (typeof document === 'undefined') return { x: cx, y: cy };

  const obstacles = Array.from(document.querySelectorAll('[role="dialog"], .glass-panel, .shadow-panel'));
  
  for (const el of obstacles) {
    const rect = el.getBoundingClientRect();
    // basic AABB intersection check
    if (
      cx < rect.right &&
      cx + myW > rect.left &&
      cy < rect.bottom &&
      cy + myH > rect.top
    ) {
      // Collision detected. Push the familiar up or left
      if (rect.top > myH + 20) {
        cy = rect.top - myH - 20; // push up
      } else {
        cx = rect.left - myW - 20; // push left
      }
    }
  }

  // Ensure still within screen
  cx = Math.max(0, Math.min(1024 - myW, cx));
  cy = Math.max(0, Math.min(600 - myH, cy));
  
  return { x: cx, y: cy };
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

    default:
      return HOME_ANCHOR;
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
            <Familiar3D
              pose={manifestation.pose}
              emotion={manifestation.emotion}
              pointAngle={anchor.pointAngle}
              pointLength={anchor.pointLength}
              onLoaded={() => useFamiliarStore.getState().startTimer(manifestation.id)}
            />
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
