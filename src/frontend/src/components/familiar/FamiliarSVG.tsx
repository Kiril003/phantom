/**
 * FamiliarSVG — the SVG drawing of the wisp/spirit.
 *
 * One ~50px viewport (60×80 viewBox to leave room for the tendril +
 * tail). Renders a drop-shape body in translucent gradient (white core →
 * amber halo), two dot eyes, and a 3-particle tail. Each pose is one
 * `<g>` group; `AnimatePresence` cross-fades between them so changing
 * pose feels smooth instead of janky.
 *
 * Pure presentation. Animations:
 *   - blink: independent loop (eyes scale Y down briefly every ~3.6s)
 *   - tail trail: 3 motion.circles with stagger
 *   - per-pose: bob (idle), drift (floating handled in PhantomFamiliar),
 *     reach (pointing tendril), peek (clipped slide), sleep (zZz),
 *     wave (rotational sway), vanish (scale → 0 + opacity)
 *
 * `reduceMotion=true` flattens all of it to a static silhouette so the
 * Familiar doesn't fight a vestibular operator.
 */
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import type { FamiliarPose } from '@shared/types';

interface FamiliarSVGProps {
  pose: FamiliarPose;
  reduceMotion?: boolean;
  /** Tendril direction in radians, used by `pointing`. 0 = right. */
  pointAngle?: number;
  /** Tendril length in svg-px, used by `pointing`. */
  pointLength?: number;
}

const VB_W = 60;
const VB_H = 80;
const BODY_CX = 30;
const BODY_CY = 38;

const SPRING: Transition = { type: 'spring', stiffness: 120, damping: 14 };
const BREATH: Transition = {
  duration: 2.6,
  repeat: Infinity,
  repeatType: 'reverse',
  ease: 'easeInOut',
};

export function FamiliarSVG({
  pose,
  reduceMotion = false,
  pointAngle = 0,
  pointLength = 18,
}: FamiliarSVGProps) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={50}
      height={66}
      style={{
        overflow: 'visible',
        filter:
          'drop-shadow(0 4px 10px rgba(244, 175, 37, 0.45)) drop-shadow(0 0 14px rgba(244, 175, 37, 0.30))',
      }}
      aria-hidden
    >
      <defs>
        <radialGradient
          id="phantom-familiar-body"
          cx="50%"
          cy="40%"
          r="60%"
          fx="45%"
          fy="35%"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#fde9b8" stopOpacity="0.78" />
          <stop offset="100%" stopColor="#f4af25" stopOpacity="0.30" />
        </radialGradient>
        <radialGradient id="phantom-familiar-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f4af25" stopOpacity="0.50" />
          <stop offset="100%" stopColor="#f4af25" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer halo — always present so the creature reads on cream too. */}
      <motion.circle
        cx={BODY_CX}
        cy={BODY_CY}
        r={28}
        fill="url(#phantom-familiar-halo)"
        animate={
          reduceMotion
            ? { opacity: 0.6 }
            : { opacity: [0.40, 0.70, 0.40], scale: [0.95, 1.04, 0.95] }
        }
        transition={reduceMotion ? undefined : BREATH}
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
      />

      {/* Tail trail — 3 little circles trailing below the body. */}
      <Tail reduceMotion={reduceMotion} />

      {/* Body + per-pose decoration cross-fade. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.g
          key={pose}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
          transition={SPRING}
          style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
        >
          <PoseGroup
            pose={pose}
            reduceMotion={reduceMotion}
            pointAngle={pointAngle}
            pointLength={pointLength}
          />
        </motion.g>
      </AnimatePresence>
    </svg>
  );
}

/* ── Tail ────────────────────────────────────────────────────────────────── */

function Tail({ reduceMotion }: { reduceMotion: boolean }) {
  const dots = [
    { cx: BODY_CX, cy: BODY_CY + 20, r: 2.6, delay: 0 },
    { cx: BODY_CX - 1.5, cy: BODY_CY + 26, r: 1.8, delay: 0.18 },
    { cx: BODY_CX + 1.5, cy: BODY_CY + 31, r: 1.2, delay: 0.36 },
  ];
  return (
    <g>
      {dots.map((d, i) => (
        <motion.circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={d.r}
          fill="#f4af25"
          opacity={0.6}
          animate={
            reduceMotion
              ? { opacity: 0.5 }
              : {
                  opacity: [0.30, 0.75, 0.30],
                  cy: [d.cy, d.cy + 2, d.cy],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: 1.8,
                  delay: d.delay,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }
          }
        />
      ))}
    </g>
  );
}

/* ── Pose groups ─────────────────────────────────────────────────────────── */

interface PoseGroupProps {
  pose: FamiliarPose;
  reduceMotion: boolean;
  pointAngle: number;
  pointLength: number;
}

function PoseGroup({
  pose,
  reduceMotion,
  pointAngle,
  pointLength,
}: PoseGroupProps) {
  switch (pose) {
    case 'idle':
      return <PoseIdle reduceMotion={reduceMotion} />;
    case 'floating':
      return <PoseIdle reduceMotion={reduceMotion} />;
    case 'pointing':
      return (
        <PosePointing
          reduceMotion={reduceMotion}
          pointAngle={pointAngle}
          pointLength={pointLength}
        />
      );
    case 'peeking':
      return <PosePeeking reduceMotion={reduceMotion} />;
    case 'sleeping':
      return <PoseSleeping reduceMotion={reduceMotion} />;
    case 'waving':
      return <PoseWaving reduceMotion={reduceMotion} />;
    case 'vanishing':
      return <PoseVanishing reduceMotion={reduceMotion} />;
    default: {
      // Exhaustive — adding a new pose must add a case here.
      const _exhaustive: never = pose;
      void _exhaustive;
      return null;
    }
  }
}

/** Drop-shape teardrop body path, anchor at (BODY_CX,BODY_CY). */
const BODY_D = `
  M ${BODY_CX} ${BODY_CY - 18}
  C ${BODY_CX + 14} ${BODY_CY - 18}, ${BODY_CX + 16} ${BODY_CY + 8}, ${BODY_CX} ${BODY_CY + 16}
  C ${BODY_CX - 16} ${BODY_CY + 8}, ${BODY_CX - 14} ${BODY_CY - 18}, ${BODY_CX} ${BODY_CY - 18}
  Z
`;

function Body({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.path
      d={BODY_D}
      fill="url(#phantom-familiar-body)"
      stroke="rgba(255,255,255,0.85)"
      strokeWidth={0.6}
      animate={reduceMotion ? undefined : { y: [0, -1.5, 0] }}
      transition={reduceMotion ? undefined : BREATH}
    />
  );
}

function Eyes({
  reduceMotion,
  closed = false,
  rightOnly = false,
}: {
  reduceMotion: boolean;
  closed?: boolean;
  rightOnly?: boolean;
}) {
  const blink = reduceMotion
    ? { scaleY: 1 }
    : closed
      ? { scaleY: 0.05 }
      : { scaleY: [1, 1, 0.1, 1] };
  const tx: Transition = reduceMotion
    ? { duration: 0 }
    : closed
      ? { duration: 0.4, ease: 'easeInOut' }
      : {
          duration: 3.6,
          repeat: Infinity,
          times: [0, 0.93, 0.97, 1],
          ease: 'linear',
        };
  return (
    <g>
      {!rightOnly && (
        <motion.circle
          cx={BODY_CX - 4}
          cy={BODY_CY - 2}
          r={1.6}
          fill="#1a1612"
          animate={blink}
          transition={tx}
          style={{ transformOrigin: `${BODY_CX - 4}px ${BODY_CY - 2}px` }}
        />
      )}
      <motion.circle
        cx={BODY_CX + 4}
        cy={BODY_CY - 2}
        r={1.6}
        fill="#1a1612"
        animate={blink}
        transition={tx}
        style={{ transformOrigin: `${BODY_CX + 4}px ${BODY_CY - 2}px` }}
      />
    </g>
  );
}

function PoseIdle({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <g>
      <Body reduceMotion={reduceMotion} />
      <Eyes reduceMotion={reduceMotion} />
    </g>
  );
}

function PosePointing({
  reduceMotion,
  pointAngle,
  pointLength,
}: {
  reduceMotion: boolean;
  pointAngle: number;
  pointLength: number;
}) {
  const tx = Math.cos(pointAngle) * pointLength;
  const ty = Math.sin(pointAngle) * pointLength;
  return (
    <g>
      <Body reduceMotion={reduceMotion} />
      <Eyes reduceMotion={reduceMotion} />
      {/* Tendril: a curve from body edge in `pointAngle` direction. */}
      <motion.path
        d={`M ${BODY_CX} ${BODY_CY + 4} Q ${BODY_CX + tx * 0.55} ${
          BODY_CY + ty * 0.55 + 2
        } ${BODY_CX + tx} ${BODY_CY + ty}`}
        stroke="#f4af25"
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
        initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.45, ease: 'easeOut' }
        }
      />
      <motion.circle
        cx={BODY_CX + tx}
        cy={BODY_CY + ty}
        r={2.2}
        fill="#fb923c"
        animate={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: [0.6, 1, 0.6], scale: [0.9, 1.2, 0.9] }
        }
        transition={
          reduceMotion
            ? undefined
            : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
        }
        style={{ transformOrigin: `${BODY_CX + tx}px ${BODY_CY + ty}px` }}
      />
    </g>
  );
}

function PosePeeking({ reduceMotion }: { reduceMotion: boolean }) {
  // Half-emerged: clip the bottom half of the body so it looks like the
  // creature is climbing out from somewhere.
  return (
    <g>
      <defs>
        <clipPath id="phantom-familiar-peek-clip">
          <rect x={0} y={BODY_CY - 22} width={VB_W} height={20} />
        </clipPath>
      </defs>
      <g clipPath="url(#phantom-familiar-peek-clip)">
        <Body reduceMotion={reduceMotion} />
      </g>
      {/* Only the right eye visible — nudges "shy peek" reading. */}
      <motion.g
        animate={reduceMotion ? undefined : { y: [0, -2, 0] }}
        transition={
          reduceMotion
            ? undefined
            : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
        }
      >
        <Eyes reduceMotion={reduceMotion} rightOnly />
      </motion.g>
    </g>
  );
}

function PoseSleeping({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <g>
      <Body reduceMotion={reduceMotion} />
      {/* Closed-eye lids: short horizontal strokes. */}
      <line
        x1={BODY_CX - 6}
        x2={BODY_CX - 2}
        y1={BODY_CY - 2}
        y2={BODY_CY - 2}
        stroke="#1a1612"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <line
        x1={BODY_CX + 2}
        x2={BODY_CX + 6}
        y1={BODY_CY - 2}
        y2={BODY_CY - 2}
        stroke="#1a1612"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {/* Tiny zZz drifting up. */}
      {!reduceMotion &&
        ['z', 'z', 'z'].map((c, i) => (
          <motion.text
            key={i}
            x={BODY_CX + 12 + i * 2}
            y={BODY_CY - 18}
            fontSize={5 + i * 1.5}
            fontFamily="Manrope, system-ui"
            fontWeight={700}
            fill="#b07a10"
            initial={{ opacity: 0, y: BODY_CY - 12 }}
            animate={{ opacity: [0, 0.9, 0], y: BODY_CY - 22 - i * 6 }}
            transition={{
              duration: 2.4,
              delay: i * 0.5,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          >
            {c}
          </motion.text>
        ))}
    </g>
  );
}

function PoseWaving({ reduceMotion }: { reduceMotion: boolean }) {
  // Body sways side-to-side, tendril extends to the right and waves.
  return (
    <motion.g
      animate={reduceMotion ? undefined : { rotate: [-6, 6, -6] }}
      transition={
        reduceMotion
          ? undefined
          : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
      }
      style={{ transformOrigin: `${BODY_CX}px ${BODY_CY + 16}px` }}
    >
      <Body reduceMotion={reduceMotion} />
      <Eyes reduceMotion={reduceMotion} />
      <motion.path
        d={`M ${BODY_CX + 10} ${BODY_CY + 2} Q ${BODY_CX + 18} ${
          BODY_CY - 6
        } ${BODY_CX + 22} ${BODY_CY - 14}`}
        stroke="#f4af25"
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />
      <circle
        cx={BODY_CX + 22}
        cy={BODY_CY - 14}
        r={1.8}
        fill="#fb923c"
        opacity={0.9}
      />
    </motion.g>
  );
}

function PoseVanishing({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.g
      initial={{ opacity: 1, scale: 1 }}
      animate={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
      transition={
        reduceMotion ? { duration: 0.4 } : { duration: 1.0, ease: 'easeIn' }
      }
      style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
    >
      <Body reduceMotion={reduceMotion} />
      <Eyes reduceMotion={reduceMotion} />
      {/* Mist particles spreading outward. */}
      {!reduceMotion &&
        Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          const dx = Math.cos(a) * 18;
          const dy = Math.sin(a) * 18;
          return (
            <motion.circle
              key={i}
              cx={BODY_CX}
              cy={BODY_CY}
              r={1.6}
              fill="#f4af25"
              initial={{ opacity: 0.8, x: 0, y: 0 }}
              animate={{ opacity: 0, x: dx, y: dy }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          );
        })}
    </motion.g>
  );
}
