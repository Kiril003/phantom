/**
 * FamiliarSVG — shadow-samurai silhouette of the PHANTOM Familiar.
 *
 * Phase-5 R1 audit-2026-04-30 redesign (operator: "як тіньовий
 * воїн/самурай його можна зробити? щоб дивим був і міг і руками і
 * ногами якісно керувати"). Replaces the previous teardrop-with-eyes
 * wisp with an articulated samurai silhouette: kabuto-helmet head
 * with amber oni eye-slits, torso plate, two segmented arms, two
 * segmented legs (hakama-style hem), katana. Every limb is its own
 * group rotating around its joint pivot so each pose can pose the
 * body honestly — pointing extends an arm + draws the katana,
 * waving lifts the offhand, sleeping crosses the legs, vanishing
 * dissolves into smoke ribbons.
 *
 * Geometry: 100×140 viewBox, displayed at 130×182 css px. Anchor at
 * (BODY_CX, BODY_CY) = (50, 70) — torso centre.
 *
 * Reduce-motion: collapses every animated transform to its rest pose.
 * Drop-shadow filter and the ambient halo stay; the silhouette is
 * legible even fully static.
 */
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import type { FamiliarPose } from '@shared/types';

interface FamiliarSVGProps {
  pose: FamiliarPose;
  reduceMotion?: boolean;
  pointAngle?: number;   // radians; 0 = right
  pointLength?: number;  // svg-px the katana tip travels from base
}

const VB_W = 100;
const VB_H = 140;
const BODY_CX = 50;
const BODY_CY = 70;

// Palette — PHANTOM is a *shadow* warrior so the silhouette is dark
// against the cream-warm sunrise UI. Amber accents for armour edge,
// eye-slit glow, and katana edge so he reads as PHANTOM-tinted, not
// generic ninja.
const SHADOW_DEEP = '#1a1612';   // darkest body fill (matches --ink-primary)
const SHADOW_MID = '#2a2520';    // mid silhouette layer
const ARMOUR_EDGE = '#f4af25';   // amber armour pin-light
const EYE_GLOW = '#ffd070';      // brighter amber for eye slits
const KATANA_EDGE = '#fde9b8';   // pale-amber blade edge highlight
const FABRIC = '#3a2611';        // hakama / sash fabric — warm-dark

const SPRING: Transition = { type: 'spring', stiffness: 130, damping: 16 };
const BREATH: Transition = {
  duration: 3.4,
  repeat: Infinity,
  repeatType: 'reverse',
  ease: 'easeInOut',
};

export function FamiliarSVG({
  pose,
  reduceMotion = false,
  pointAngle = 0,
  pointLength = 28,
}: FamiliarSVGProps) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={130}
      height={182}
      style={{
        overflow: 'visible',
        filter:
          'drop-shadow(0 8px 22px rgba(26,22,18,0.55)) drop-shadow(0 0 18px rgba(244,175,37,0.32))',
      }}
      aria-hidden
    >
      <defs>
        <radialGradient id="phantom-familiar-halo" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={ARMOUR_EDGE} stopOpacity="0.42" />
          <stop offset="100%" stopColor={ARMOUR_EDGE} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="phantom-familiar-armour" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SHADOW_MID} />
          <stop offset="100%" stopColor={SHADOW_DEEP} />
        </linearGradient>
        <linearGradient id="phantom-familiar-katana" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={KATANA_EDGE} />
          <stop offset="60%" stopColor="#f4d35e" />
          <stop offset="100%" stopColor={ARMOUR_EDGE} />
        </linearGradient>
      </defs>

      {/* Ambient halo so the silhouette doesn't drop into the cream BG. */}
      <motion.circle
        cx={BODY_CX}
        cy={BODY_CY}
        r={56}
        fill="url(#phantom-familiar-halo)"
        animate={
          reduceMotion
            ? { opacity: 0.5 }
            : { opacity: [0.32, 0.58, 0.32], scale: [0.95, 1.04, 0.95] }
        }
        transition={reduceMotion ? undefined : BREATH}
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
      />

      <CapeTrail reduceMotion={reduceMotion} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.g
          key={pose}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
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

/* ── Cape trail (replaces the old 3-dot blob tail) ────────────────────────── */

function CapeTrail({ reduceMotion }: { reduceMotion: boolean }) {
  // Two thin amber-edged ribbons trailing from the kabuto crest, drifting
  // back as if the warrior just stopped moving. Pure ambient — never
  // touched by pose logic, so a still samurai still feels alive.
  const ribbons = [
    { x: BODY_CX - 6, y0: BODY_CY - 26, hue: 0.30 },
    { x: BODY_CX + 6, y0: BODY_CY - 26, hue: 0.20 },
  ];
  return (
    <g>
      {ribbons.map((r, i) => (
        <motion.path
          key={i}
          d={`M ${r.x} ${r.y0} Q ${r.x + (i === 0 ? -3 : 3)} ${r.y0 - 12} ${r.x + (i === 0 ? -8 : 8)} ${r.y0 - 28}`}
          stroke={ARMOUR_EDGE}
          strokeWidth={1.4}
          strokeLinecap="round"
          fill="none"
          opacity={r.hue}
          animate={
            reduceMotion
              ? { opacity: r.hue }
              : {
                  opacity: [r.hue * 0.6, r.hue, r.hue * 0.6],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: 2.6,
                  delay: i * 0.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }
          }
        />
      ))}
    </g>
  );
}

/* ── Pose dispatch ────────────────────────────────────────────────────────── */

interface PoseGroupProps {
  pose: FamiliarPose;
  reduceMotion: boolean;
  pointAngle: number;
  pointLength: number;
}

function PoseGroup({ pose, reduceMotion, pointAngle, pointLength }: PoseGroupProps) {
  switch (pose) {
    case 'idle':
      return <PoseIdle reduceMotion={reduceMotion} />;
    case 'floating':
      return <PoseFloating reduceMotion={reduceMotion} />;
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
      const _exhaustive: never = pose;
      void _exhaustive;
      return null;
    }
  }
}

/* ── Anatomy primitives ──────────────────────────────────────────────────── */

const HEAD_R = 11;
const HEAD_CY = BODY_CY - 22;
const SHOULDER_Y = BODY_CY - 4;
const HIP_Y = BODY_CY + 18;
const SHOULDER_DX = 11;
const HIP_DX = 8;

/** Kabuto-helmeted head with two horn-crest peaks on top + amber eye-slits.
 *  Eye-slits glow steady (no blink — they're light slots, not eyelids). */
function Head({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <g>
      {/* Helmet crown — slightly flattened oval. */}
      <ellipse
        cx={BODY_CX}
        cy={HEAD_CY}
        rx={HEAD_R}
        ry={HEAD_R + 1.2}
        fill="url(#phantom-familiar-armour)"
        stroke={ARMOUR_EDGE}
        strokeWidth={0.8}
      />
      {/* Front-shield rim — a darker arc above the eyes. */}
      <path
        d={`M ${BODY_CX - HEAD_R + 1} ${HEAD_CY - 1}
            Q ${BODY_CX} ${HEAD_CY - HEAD_R - 0.5}
              ${BODY_CX + HEAD_R - 1} ${HEAD_CY - 1}`}
        fill="none"
        stroke={ARMOUR_EDGE}
        strokeWidth={0.8}
        opacity={0.65}
      />
      {/* Two horn-crest tips. */}
      <path
        d={`M ${BODY_CX - 5} ${HEAD_CY - HEAD_R - 0.5}
            L ${BODY_CX - 8} ${HEAD_CY - HEAD_R - 6}
            L ${BODY_CX - 3} ${HEAD_CY - HEAD_R - 1.5}`}
        fill={SHADOW_DEEP}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <path
        d={`M ${BODY_CX + 5} ${HEAD_CY - HEAD_R - 0.5}
            L ${BODY_CX + 8} ${HEAD_CY - HEAD_R - 6}
            L ${BODY_CX + 3} ${HEAD_CY - HEAD_R - 1.5}`}
        fill={SHADOW_DEEP}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      {/* Mempo (face mask) — lower-half darker plate w/ subtle grin notch. */}
      <path
        d={`M ${BODY_CX - HEAD_R + 1} ${HEAD_CY + 2}
            Q ${BODY_CX - HEAD_R - 1} ${HEAD_CY + HEAD_R - 1}
              ${BODY_CX} ${HEAD_CY + HEAD_R + 1}
            Q ${BODY_CX + HEAD_R + 1} ${HEAD_CY + HEAD_R - 1}
              ${BODY_CX + HEAD_R - 1} ${HEAD_CY + 2} Z`}
        fill={SHADOW_DEEP}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.5}
      />
      {/* Mempo lip-line. */}
      <path
        d={`M ${BODY_CX - 3.5} ${HEAD_CY + 6}
            L ${BODY_CX + 3.5} ${HEAD_CY + 6}`}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.6}
        strokeLinecap="round"
        opacity={0.7}
      />
      {/* Amber eye-slits — primary character feature. */}
      <EyeSlit cx={BODY_CX - 4.5} cy={HEAD_CY - 1} reduceMotion={reduceMotion} />
      <EyeSlit cx={BODY_CX + 4.5} cy={HEAD_CY - 1} reduceMotion={reduceMotion} />
    </g>
  );
}

function EyeSlit({
  cx,
  cy,
  reduceMotion,
}: {
  cx: number;
  cy: number;
  reduceMotion: boolean;
}) {
  return (
    <g>
      {/* Soft glow halo. */}
      <motion.circle
        cx={cx}
        cy={cy}
        r={2.6}
        fill={EYE_GLOW}
        opacity={0.35}
        animate={
          reduceMotion
            ? { opacity: 0.35 }
            : { opacity: [0.25, 0.55, 0.25] }
        }
        transition={
          reduceMotion
            ? undefined
            : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
        }
      />
      {/* The slit itself — a tight horizontal lozenge. */}
      <ellipse cx={cx} cy={cy} rx={2.4} ry={1.0} fill={EYE_GLOW} />
      <ellipse cx={cx} cy={cy} rx={1.4} ry={0.5} fill="#ffffff" opacity={0.85} />
    </g>
  );
}

/** Torso plate — keyhole-shaped chestpiece with a centre amber clasp. */
function Torso({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.g
      animate={reduceMotion ? undefined : { y: [0, -1.5, 0] }}
      transition={reduceMotion ? undefined : BREATH}
    >
      {/* Shoulders → waist trapezoid. */}
      <path
        d={`M ${BODY_CX - SHOULDER_DX - 2} ${SHOULDER_Y}
            Q ${BODY_CX - SHOULDER_DX} ${SHOULDER_Y - 3}
              ${BODY_CX - SHOULDER_DX + 2} ${SHOULDER_Y - 3}
            L ${BODY_CX + SHOULDER_DX - 2} ${SHOULDER_Y - 3}
            Q ${BODY_CX + SHOULDER_DX} ${SHOULDER_Y - 3}
              ${BODY_CX + SHOULDER_DX + 2} ${SHOULDER_Y}
            L ${BODY_CX + HIP_DX + 1} ${HIP_Y}
            L ${BODY_CX - HIP_DX - 1} ${HIP_Y} Z`}
        fill="url(#phantom-familiar-armour)"
        stroke={ARMOUR_EDGE}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {/* Centre clasp — small amber square. */}
      <rect
        x={BODY_CX - 1.6}
        y={SHOULDER_Y + 6}
        width={3.2}
        height={3.2}
        fill={ARMOUR_EDGE}
        rx={0.6}
      />
      {/* Sash (obi) — across the waist. */}
      <rect
        x={BODY_CX - HIP_DX - 1}
        y={HIP_Y - 4}
        width={(HIP_DX + 1) * 2}
        height={4}
        fill={FABRIC}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.4}
      />
    </motion.g>
  );
}

/** Two-segment limb. `pivot` is the shoulder/hip; angles in degrees,
 *  measured CW from straight-down. Length controls reach. */
function Limb({
  pivotX,
  pivotY,
  shoulderAngle,
  elbowAngle,
  upperLen,
  lowerLen,
  hand = true,
  reduceMotion,
  animate,
}: {
  pivotX: number;
  pivotY: number;
  shoulderAngle: number;     // degrees, 0 = straight down
  elbowAngle: number;        // degrees, 0 = continuing straight
  upperLen: number;
  lowerLen: number;
  hand?: boolean;
  reduceMotion: boolean;
  animate?: { rotate?: number[]; transition?: Transition };
}) {
  // Compute elbow + wrist positions in svg space.
  const sa = (shoulderAngle * Math.PI) / 180;
  const ex = pivotX + Math.sin(sa) * upperLen;
  const ey = pivotY + Math.cos(sa) * upperLen;
  const ea = sa + (elbowAngle * Math.PI) / 180;
  const wx = ex + Math.sin(ea) * lowerLen;
  const wy = ey + Math.cos(ea) * lowerLen;
  const animProps = animate && !reduceMotion
    ? { animate: animate.rotate ? { rotate: animate.rotate } : undefined, transition: animate.transition }
    : {};
  return (
    <motion.g
      style={{ transformOrigin: `${pivotX}px ${pivotY}px` }}
      animate={animProps.animate}
      transition={animProps.transition}
    >
      <line
        x1={pivotX}
        y1={pivotY}
        x2={ex}
        y2={ey}
        stroke={SHADOW_DEEP}
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={ex}
        y1={ey}
        x2={wx}
        y2={wy}
        stroke={SHADOW_DEEP}
        strokeWidth={4}
        strokeLinecap="round"
      />
      {/* Joint pin — small amber dot at elbow. */}
      <circle cx={ex} cy={ey} r={1.2} fill={ARMOUR_EDGE} />
      {hand && (
        <circle
          cx={wx}
          cy={wy}
          r={2.1}
          fill={SHADOW_MID}
          stroke={ARMOUR_EDGE}
          strokeWidth={0.5}
        />
      )}
    </motion.g>
  );
}

/** Katana drawn FROM `gripX,gripY` along `angleDeg`, length `len`. */
function Katana({
  gripX,
  gripY,
  angleDeg,
  len,
  reduceMotion,
  animate,
}: {
  gripX: number;
  gripY: number;
  angleDeg: number;
  len: number;
  reduceMotion: boolean;
  animate?: { rotate?: number[]; pathLength?: number; transition?: Transition };
}) {
  const animProps = animate && !reduceMotion
    ? {
        animate: {
          ...(animate.rotate ? { rotate: animate.rotate } : {}),
          ...(animate.pathLength !== undefined ? { pathLength: animate.pathLength } : {}),
        },
        transition: animate.transition,
      }
    : {};
  return (
    <motion.g
      style={{ transformOrigin: `${gripX}px ${gripY}px`, rotate: `${angleDeg}deg` }}
      animate={animProps.animate}
      transition={animProps.transition}
    >
      {/* Handle wrap (tsuka). */}
      <rect
        x={gripX - 1.2}
        y={gripY - 1}
        width={2.4}
        height={6}
        fill={FABRIC}
        rx={0.4}
      />
      {/* Tsuba (guard) — small disk. */}
      <circle cx={gripX} cy={gripY + 6} r={1.6} fill={ARMOUR_EDGE} />
      {/* Blade itself — thin gradient bar pointing along positive Y of the rotated group. */}
      <rect
        x={gripX - 0.7}
        y={gripY + 6}
        width={1.4}
        height={len}
        fill="url(#phantom-familiar-katana)"
        stroke={ARMOUR_EDGE}
        strokeWidth={0.3}
      />
      {/* Blade tip — small triangle. */}
      <path
        d={`M ${gripX - 0.7} ${gripY + 6 + len}
            L ${gripX} ${gripY + 6 + len + 3}
            L ${gripX + 0.7} ${gripY + 6 + len} Z`}
        fill={KATANA_EDGE}
      />
    </motion.g>
  );
}

/* ── Pose implementations ────────────────────────────────────────────────── */

function PoseIdle({ reduceMotion }: { reduceMotion: boolean }) {
  // Standing easy, both hands relaxed at sides. Right hand resting on
  // katana hilt at the hip. Slight breath bob via Torso wrapper.
  return (
    <g>
      <Head reduceMotion={reduceMotion} />
      <Torso reduceMotion={reduceMotion} />
      {/* Left arm — relaxed. */}
      <Limb
        pivotX={BODY_CX - SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={5}
        elbowAngle={10}
        upperLen={11}
        lowerLen={10}
        reduceMotion={reduceMotion}
      />
      {/* Right arm — bent across to rest on katana hilt. */}
      <Limb
        pivotX={BODY_CX + SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={-30}
        elbowAngle={70}
        upperLen={11}
        lowerLen={9}
        reduceMotion={reduceMotion}
      />
      {/* Two legs — slight stance. */}
      <Limb
        pivotX={BODY_CX - HIP_DX}
        pivotY={HIP_Y}
        shoulderAngle={-6}
        elbowAngle={6}
        upperLen={14}
        lowerLen={14}
        hand={false}
        reduceMotion={reduceMotion}
      />
      <Limb
        pivotX={BODY_CX + HIP_DX}
        pivotY={HIP_Y}
        shoulderAngle={6}
        elbowAngle={-6}
        upperLen={14}
        lowerLen={14}
        hand={false}
        reduceMotion={reduceMotion}
      />
      {/* Sheathed katana — angled at the left hip. */}
      <Katana
        gripX={BODY_CX - 4}
        gripY={HIP_Y - 1}
        angleDeg={12}
        len={26}
        reduceMotion={reduceMotion}
      />
    </g>
  );
}

function PoseFloating({ reduceMotion }: { reduceMotion: boolean }) {
  // Same as idle, with a slow drift bob handled at the PhantomFamiliar
  // wrapper level. Adds a faint trailing motion-line in front of the
  // legs (spirit-walking, not running).
  return (
    <motion.g
      animate={reduceMotion ? undefined : { y: [0, -3, 0] }}
      transition={reduceMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      <PoseIdle reduceMotion={reduceMotion} />
      {/* Motion line at the heel — short trailing wisp. */}
      <motion.path
        d={`M ${BODY_CX - 8} ${HIP_Y + 32} Q ${BODY_CX - 14} ${HIP_Y + 30} ${BODY_CX - 18} ${HIP_Y + 26}`}
        stroke={ARMOUR_EDGE}
        strokeWidth={0.6}
        fill="none"
        opacity={0.4}
        animate={reduceMotion ? undefined : { opacity: [0.2, 0.55, 0.2] }}
        transition={reduceMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.g>
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
  // Katana drawn and extended toward the target. Arm follows the
  // katana line; offhand braced at the hip for balance.
  // pointAngle radians → svg degrees; svg-y points down so we negate
  // and rotate so 0° in svg space points down (matches Katana baseline).
  const swordDeg = (pointAngle * 180) / Math.PI - 90;
  const swordLen = Math.max(20, Math.min(34, pointLength));
  return (
    <g>
      <Head reduceMotion={reduceMotion} />
      <Torso reduceMotion={reduceMotion} />
      {/* Left arm — grip-supporting the blade. Reaches across the chest. */}
      <Limb
        pivotX={BODY_CX - SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={50 + swordDeg * 0.3}
        elbowAngle={20}
        upperLen={11}
        lowerLen={10}
        reduceMotion={reduceMotion}
      />
      {/* Right arm — main hand on the katana, pointing along swordDeg. */}
      <Limb
        pivotX={BODY_CX + SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={Math.min(85, Math.max(20, 65 + swordDeg * 0.4))}
        elbowAngle={5}
        upperLen={11}
        lowerLen={11}
        reduceMotion={reduceMotion}
      />
      {/* Legs — split stance, weight slightly forward on the right. */}
      <Limb
        pivotX={BODY_CX - HIP_DX}
        pivotY={HIP_Y}
        shoulderAngle={-12}
        elbowAngle={4}
        upperLen={14}
        lowerLen={14}
        hand={false}
        reduceMotion={reduceMotion}
      />
      <Limb
        pivotX={BODY_CX + HIP_DX}
        pivotY={HIP_Y}
        shoulderAngle={14}
        elbowAngle={-2}
        upperLen={14}
        lowerLen={14}
        hand={false}
        reduceMotion={reduceMotion}
      />
      {/* Drawn katana — anchor at the right hand, rotated to swordDeg. */}
      <Katana
        gripX={BODY_CX + 18}
        gripY={SHOULDER_Y + 14}
        angleDeg={swordDeg}
        len={swordLen}
        reduceMotion={reduceMotion}
        animate={{
          pathLength: 1,
          rotate: [swordDeg - 6, swordDeg, swordDeg - 1],
          transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
        }}
      />
    </g>
  );
}

function PosePeeking({ reduceMotion }: { reduceMotion: boolean }) {
  // Shadow leaning out from the right edge — only head + right shoulder
  // visible, body tilted. We achieve this by clipping everything below
  // BODY_CY + 2 and shifting the whole group right slightly.
  return (
    <g transform="translate(-12, 4) rotate(-8 50 70)">
      <defs>
        <clipPath id="phantom-familiar-peek-clip">
          <rect x={0} y={0} width={VB_W} height={BODY_CY + 4} />
        </clipPath>
      </defs>
      <g clipPath="url(#phantom-familiar-peek-clip)">
        <Head reduceMotion={reduceMotion} />
        <Torso reduceMotion={reduceMotion} />
        {/* Just the right arm peeking, gripping a katana edge. */}
        <Limb
          pivotX={BODY_CX + SHOULDER_DX}
          pivotY={SHOULDER_Y}
          shoulderAngle={-25}
          elbowAngle={50}
          upperLen={11}
          lowerLen={9}
          reduceMotion={reduceMotion}
        />
      </g>
    </g>
  );
}

function PoseSleeping({ reduceMotion }: { reduceMotion: boolean }) {
  // Cross-legged seiza on the floor. Head bowed (rotated forward),
  // hands resting on knees. Three drifting "z" particles.
  return (
    <g>
      <motion.g
        animate={reduceMotion ? undefined : { y: [0, -1, 0] }}
        transition={reduceMotion ? undefined : BREATH}
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
      >
        {/* Head bowed forward. */}
        <g transform={`rotate(8 ${BODY_CX} ${HEAD_CY})`}>
          <Head reduceMotion={reduceMotion} />
        </g>
        <Torso reduceMotion={reduceMotion} />
        {/* Crossed legs — left bent right, right bent left. */}
        <Limb
          pivotX={BODY_CX - HIP_DX}
          pivotY={HIP_Y}
          shoulderAngle={70}
          elbowAngle={-100}
          upperLen={12}
          lowerLen={12}
          hand={false}
          reduceMotion={reduceMotion}
        />
        <Limb
          pivotX={BODY_CX + HIP_DX}
          pivotY={HIP_Y}
          shoulderAngle={-70}
          elbowAngle={100}
          upperLen={12}
          lowerLen={12}
          hand={false}
          reduceMotion={reduceMotion}
        />
        {/* Hands resting on knees. */}
        <Limb
          pivotX={BODY_CX - SHOULDER_DX}
          pivotY={SHOULDER_Y}
          shoulderAngle={35}
          elbowAngle={45}
          upperLen={10}
          lowerLen={8}
          reduceMotion={reduceMotion}
        />
        <Limb
          pivotX={BODY_CX + SHOULDER_DX}
          pivotY={SHOULDER_Y}
          shoulderAngle={-35}
          elbowAngle={-45}
          upperLen={10}
          lowerLen={8}
          reduceMotion={reduceMotion}
        />
        {/* Sheathed katana on the right side. */}
        <Katana
          gripX={BODY_CX + 18}
          gripY={HIP_Y - 4}
          angleDeg={70}
          len={22}
          reduceMotion={reduceMotion}
        />
      </motion.g>
      {/* Drifting "z"s. */}
      {!reduceMotion &&
        ['z', 'z', 'z'].map((c, i) => (
          <motion.text
            key={i}
            x={BODY_CX + 16 + i * 2}
            y={HEAD_CY - 4}
            fontSize={5 + i * 1.5}
            fill={ARMOUR_EDGE}
            fontFamily="serif"
            style={{ fontStyle: 'italic' }}
            initial={{ opacity: 0, y: HEAD_CY - 4 }}
            animate={{ opacity: [0, 0.85, 0], y: HEAD_CY - 22 - i * 6 }}
            transition={{
              duration: 3.6,
              delay: i * 0.6,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {c}
          </motion.text>
        ))}
    </g>
  );
}

function PoseWaving({ reduceMotion }: { reduceMotion: boolean }) {
  // Calm samurai bow — torso forward, right hand to chest, left arm
  // gestures up-and-back like a wave. Not anime-cheerful, dignified.
  return (
    <g>
      <motion.g
        animate={reduceMotion ? undefined : { rotate: [0, 4, 0] }}
        transition={reduceMotion ? undefined : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY + 18}px` }}
      >
        <Head reduceMotion={reduceMotion} />
        <Torso reduceMotion={reduceMotion} />
        {/* Right hand to chest. */}
        <Limb
          pivotX={BODY_CX + SHOULDER_DX}
          pivotY={SHOULDER_Y}
          shoulderAngle={-50}
          elbowAngle={80}
          upperLen={11}
          lowerLen={9}
          reduceMotion={reduceMotion}
        />
        {/* Left arm waving — animated rotation around the shoulder. */}
        <Limb
          pivotX={BODY_CX - SHOULDER_DX}
          pivotY={SHOULDER_Y}
          shoulderAngle={-90}
          elbowAngle={-30}
          upperLen={11}
          lowerLen={11}
          reduceMotion={reduceMotion}
          animate={{
            rotate: [-15, 15, -15],
            transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
        {/* Legs — close together, slight forward bow. */}
        <Limb
          pivotX={BODY_CX - HIP_DX}
          pivotY={HIP_Y}
          shoulderAngle={-2}
          elbowAngle={4}
          upperLen={14}
          lowerLen={14}
          hand={false}
          reduceMotion={reduceMotion}
        />
        <Limb
          pivotX={BODY_CX + HIP_DX}
          pivotY={HIP_Y}
          shoulderAngle={2}
          elbowAngle={-4}
          upperLen={14}
          lowerLen={14}
          hand={false}
          reduceMotion={reduceMotion}
        />
        {/* Sheathed katana, low. */}
        <Katana
          gripX={BODY_CX - 4}
          gripY={HIP_Y - 1}
          angleDeg={12}
          len={26}
          reduceMotion={reduceMotion}
        />
      </motion.g>
    </g>
  );
}

function PoseVanishing({ reduceMotion }: { reduceMotion: boolean }) {
  // Standard idle silhouette dissolving into upward-drifting smoke
  // ribbons. Body opacity drops to 0; ribbons replace it.
  return (
    <g>
      <motion.g
        initial={{ opacity: 1, scale: 1 }}
        animate={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: -6 }}
        transition={
          reduceMotion ? { duration: 0.6 } : { duration: 1.4, ease: 'easeInOut' }
        }
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
      >
        <PoseIdle reduceMotion={reduceMotion} />
      </motion.g>
      {!reduceMotion && (
        <g>
          {[-12, -4, 4, 12].map((dx, i) => (
            <motion.path
              key={i}
              d={`M ${BODY_CX + dx} ${BODY_CY + 10} Q ${BODY_CX + dx + (i % 2 === 0 ? -3 : 3)} ${BODY_CY - 6} ${BODY_CX + dx} ${BODY_CY - 24}`}
              stroke={ARMOUR_EDGE}
              strokeWidth={1.2}
              strokeLinecap="round"
              fill="none"
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{
                opacity: [0, 0.6, 0],
                pathLength: [0, 1, 1],
              }}
              transition={{
                duration: 1.6,
                delay: 0.05 * i,
                ease: 'easeOut',
              }}
            />
          ))}
        </g>
      )}
    </g>
  );
}
