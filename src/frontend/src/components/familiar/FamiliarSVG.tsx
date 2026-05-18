/**
 * FamiliarSVG — Glass Humanoid silhouette of the PHANTOM Familiar.
 *
 * Replaces the previous shadow samurai with an articulated glassmorphism
 * humanoid. Employs Inverse Kinematics (IK) for the arm to allow precise
 * pointing and procedural animation loops for organic movement.
 *
 * Geometry: 100×140 viewBox, displayed at 130×182 css px. Anchor at
 * (BODY_CX, BODY_CY) = (50, 70) — torso centre.
 *
 * Reduce-motion: collapses every animated transform to its rest pose.
 */
import { motion, AnimatePresence, type Transition } from "framer-motion";
import type { FamiliarPose } from '@shared/types';
export type ExtendedFamiliarPose = FamiliarPose | 'running' | 'jumping';
export type FamiliarEmotion = 'neutral' | 'alert' | 'happy' | 'sleepy';

interface FamiliarSVGProps {
  pose: FamiliarPose;
  reduceMotion?: boolean;
  pointAngle?: number; // radians; 0 = right
  pointLength?: number; // Distance to point target
  emotion?: FamiliarEmotion;
}

const VB_W = 100;
const VB_H = 140;
const BODY_CX = 50;
const BODY_CY = 70;

const SPRING: Transition = { type: "spring", stiffness: 130, damping: 16 };
const BREATH: Transition = {
  duration: 3.4,
  repeat: Infinity,
  repeatType: "reverse",
  ease: "easeInOut",
};

const EMOTION_STYLES: Record<FamiliarEmotion, { glow: string, duration: number }> = {
  neutral: { glow: "#f4af25", duration: 3.4 },
  alert:   { glow: "#f4af25", duration: 1.8 }, // faster breath
  happy:   { glow: "#f4af25", duration: 2.8 },
  sleepy:  { glow: "#f4af25", duration: 5.5 }, // slow breath
};

// ── Inverse Kinematics (IK) Solver ──────────────────────────────────────
function solveIK2D(
  targetX: number,
  targetY: number,
  l1: number,
  l2: number,
): { angle1: number; angle2: number } {
  // target relative to origin (shoulder)
  const distSq = targetX * targetX + targetY * targetY;
  const dist = Math.sqrt(distSq);

  // If target is unreachable, point towards it in a straight line
  if (dist >= l1 + l2) {
    const angle = Math.atan2(targetY, targetX);
    return { angle1: angle, angle2: 0 };
  }
  // If target is too close, point straight down (or handle differently)
  if (dist <= Math.abs(l1 - l2)) {
    return { angle1: Math.PI / 2, angle2: Math.PI };
  }

  // Law of Cosines to find the interior angle of the elbow
  const cosAngle2 = (distSq - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  const angle2 = Math.acos(Math.max(-1, Math.min(1, cosAngle2)));

  // Law of Cosines to find the angle between the upper arm and the target vector
  const k1 = l1 + l2 * Math.cos(angle2);
  const k2 = l2 * Math.sin(angle2);

  const angleTarget = Math.atan2(targetY, targetX);
  // Optional: choose positive or negative angle2 for "elbow up" or "elbow down"
  const angle1 = angleTarget - Math.atan2(k2, k1);

  return { angle1, angle2 };
}

export function FamiliarSVG({
  pose,
  reduceMotion = false,
  pointAngle = 0,
  pointLength = 28,
  emotion = 'neutral',
}: FamiliarSVGProps) {
  const style = EMOTION_STYLES[emotion] || EMOTION_STYLES.neutral;
  const breathTrans = { ...BREATH, duration: style.duration };

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={130}
      height={182}
      style={{
        overflow: "visible",
        filter:
          `drop-shadow(0 8px 22px ${style.glow}26) drop-shadow(0 0 18px ${style.glow}38)`,
      }}
      aria-hidden
    >
      <defs>
        <radialGradient id="phantom-glass-glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor={style.glow} stopOpacity="0.45" />
          <stop offset="100%" stopColor={style.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="phantom-glass-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.15)" />
        </linearGradient>
        <linearGradient id="phantom-assassin-hood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(15, 23, 42, 0.8)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.2)" />
        </linearGradient>
      </defs>

      {/* Ambient glow */}
      <motion.circle
        cx={BODY_CX}
        cy={BODY_CY - 10}
        r={50}
        fill="url(#phantom-glass-glow)"
        animate={
          reduceMotion
            ? { opacity: 0.5 }
            : { opacity: [0.35, 0.65, 0.35], scale: [0.95, 1.05, 0.95] }
        }
        transition={reduceMotion ? undefined : breathTrans}
        style={{ transformOrigin: `${BODY_CX}px ${BODY_CY}px` }}
      />

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
            emotion={emotion}
          />
        </motion.g>
      </AnimatePresence>
    </svg>
  );
}

/* ── Pose dispatch ────────────────────────────────────────────────────────── */

interface PoseGroupProps {
  pose: ExtendedFamiliarPose;
  reduceMotion: boolean;
  pointAngle: number;
  pointLength: number;
  emotion: FamiliarEmotion;
}

function PoseGroup({
  pose,
  reduceMotion,
  pointAngle,
  pointLength,
  emotion,
}: PoseGroupProps) {
  switch (pose) {
    case "idle":
      return <PoseIdle reduceMotion={reduceMotion} emotion={emotion} />;
    case "floating":
      return <PoseFloating reduceMotion={reduceMotion} emotion={emotion} />;
    case "running":
      return <PoseRunning reduceMotion={reduceMotion} emotion="alert" />;
    case "jumping":
      return <PoseJumping reduceMotion={reduceMotion} emotion="alert" />;
    case "pointing":
      return (
        <PosePointing
          reduceMotion={reduceMotion}
          pointAngle={pointAngle}
          pointLength={pointLength}
          emotion="alert"
        />
      );
    case "peeking":
      return <PosePeeking reduceMotion={reduceMotion} emotion="alert" />;
    case "sleeping":
      return <PoseSleeping reduceMotion={reduceMotion} emotion='sleepy' />;
    case "waving":
      return <PoseWaving reduceMotion={reduceMotion} emotion="happy" />;
    case "vanishing":
      return <PoseVanishing reduceMotion={reduceMotion} emotion='neutral' />;
    default:
      return <PoseIdle reduceMotion={reduceMotion} emotion={emotion} />;
  }
}

/* ── Anatomy primitives ──────────────────────────────────────────────────── */


const HEAD_CY = BODY_CY - 24;
const SHOULDER_Y = BODY_CY - 8;
const HIP_Y = BODY_CY + 14;
const SHOULDER_DX = 12;
const HIP_DX = 7;

function AssassinTorso({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.g
      animate={reduceMotion ? undefined : { y: [0, -2, 0] }}
      transition={reduceMotion ? undefined : BREATH}
    >
      {/* Cloak / Jacket silhouette */}
      <path
        d={`M ${BODY_CX - SHOULDER_DX - 4} ${SHOULDER_Y + 4}
            Q ${BODY_CX} ${SHOULDER_Y - 8} ${BODY_CX + SHOULDER_DX + 4} ${SHOULDER_Y + 4}
            L ${BODY_CX + HIP_DX + 2} ${HIP_Y + 8}
            Q ${BODY_CX} ${HIP_Y - 4} ${BODY_CX - HIP_DX - 2} ${HIP_Y + 8} Z`}
        fill="url(#phantom-glass-body)"
        stroke="rgba(255, 255, 255, 0.4)"
        strokeWidth={1}
      />
      {/* Inner tech suit */}
      <path
        d={`M ${BODY_CX - SHOULDER_DX + 2} ${SHOULDER_Y + 2}
            L ${BODY_CX + SHOULDER_DX - 2} ${SHOULDER_Y + 2}
            L ${BODY_CX + HIP_DX} ${HIP_Y}
            L ${BODY_CX - HIP_DX} ${HIP_Y} Z`}
        fill="rgba(15, 23, 42, 0.4)"
      />
      {/* Core crystal — the power source */}
      <motion.polygon
        points={`${BODY_CX},${BODY_CY - 6} ${BODY_CX + 4},${BODY_CY} ${BODY_CX},${BODY_CY + 6} ${BODY_CX - 4},${BODY_CY}`}
        fill="#f4af25"
        animate={reduceMotion ? undefined : { opacity: [0.6, 1, 0.6], scale: [0.9, 1.1, 0.9] }}
        transition={reduceMotion ? undefined : BREATH}
      />
    </motion.g>
  );
}

function EmotiveEyes({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  // Blinking loop: 90% open, 10% blink
  const blinkAnim = reduceMotion ? undefined : {
    scaleY: [1, 1, 0.1, 1, 1],
    transition: { duration: 4, times: [0, 0.45, 0.48, 0.5, 1], repeat: Infinity, ease: 'easeInOut' }
  };

  let rotation = 0;
  let height = 3;
  let width = 4;
  let yOffset = 0;

  if (emotion === 'alert') {
    rotation = 15; // Slanted angry/alert eyes
    height = 2;
  } else if (emotion === 'happy') {
    rotation = -10; // Upward curve vibe
    height = 2;
    yOffset = -1;
  } else if (emotion === 'sleepy') {
    height = 0.5;
    yOffset = 2;
  }

  return (
    <motion.g animate={blinkAnim}>
      {/* Left Eye */}
      <motion.ellipse
        cx={BODY_CX - 4}
        cy={HEAD_CY + yOffset}
        rx={width}
        ry={height}
        fill="#f4af25"
        style={{ transformOrigin: `${BODY_CX - 4}px ${HEAD_CY + yOffset}px` }}
        animate={{ rotate: rotation }}
      />
      {/* Right Eye */}
      <motion.ellipse
        cx={BODY_CX + 4}
        cy={HEAD_CY + yOffset}
        rx={width}
        ry={height}
        fill="#f4af25"
        style={{ transformOrigin: `${BODY_CX + 4}px ${HEAD_CY + yOffset}px` }}
        animate={{ rotate: -rotation }}
      />
    </motion.g>
  );
}

function AssassinHead({ reduceMotion, rotate = 0, emotion = 'neutral' }: { reduceMotion: boolean, rotate?: number, emotion?: FamiliarEmotion }) {
  return (
    <motion.g
      animate={reduceMotion ? undefined : { rotate: [rotate - 2, rotate + 2, rotate - 2], y: [0, -1, 0] }}
      transition={reduceMotion ? undefined : BREATH}
      style={{ transformOrigin: `${BODY_CX}px ${HEAD_CY + 8}px` }}
    >
      {/* Pointed stealth hood */}
      <path
        d={`M ${BODY_CX} ${HEAD_CY - 16}
            Q ${BODY_CX + 12} ${HEAD_CY - 8} ${BODY_CX + 10} ${HEAD_CY + 8}
            Q ${BODY_CX} ${HEAD_CY + 14} ${BODY_CX - 10} ${HEAD_CY + 8}
            Q ${BODY_CX - 12} ${HEAD_CY - 8} ${BODY_CX} ${HEAD_CY - 16} Z`}
        fill="url(#phantom-assassin-hood)"
        stroke="rgba(255, 255, 255, 0.4)"
        strokeWidth={1}
      />
      {/* Mask / Lower face cover */}
      <path
        d={`M ${BODY_CX - 9} ${HEAD_CY + 4}
            Q ${BODY_CX} ${HEAD_CY + 8} ${BODY_CX + 9} ${HEAD_CY + 4}
            L ${BODY_CX + 7} ${HEAD_CY + 10}
            Q ${BODY_CX} ${HEAD_CY + 13} ${BODY_CX - 7} ${HEAD_CY + 10} Z`}
        fill="rgba(15, 23, 42, 0.6)"
      />
      <EmotiveEyes reduceMotion={reduceMotion} emotion={emotion} />
    </motion.g>
  );
}

function GlassLimb({
  pivotX,
  pivotY,
  shoulderAngle, // radians
  elbowAngle, // radians
  upperLen,
  lowerLen,
  hand = true,
  reduceMotion,
  animate,
}: {
  pivotX: number;
  pivotY: number;
  shoulderAngle: number;
  elbowAngle: number;
  upperLen: number;
  lowerLen: number;
  hand?: boolean;
  reduceMotion: boolean;
  animate?: {
    shoulderAngle?: number | number[];
    elbowAngle?: number | number[];
    transition?: Transition;
  };
}) {
  // Instead of animating via SVG rotate transforms, we calculate end points directly
  // or animate the SVG transform of the whole upper arm, and nested lower arm.
  // Using nested Framer Motion groups is cleaner for FK/IK combination.

  const shoulderDeg = (shoulderAngle * 180) / Math.PI;
  const elbowDeg = (elbowAngle * 180) / Math.PI;

  const animUpper =
    animate?.shoulderAngle !== undefined && !reduceMotion
      ? {
          rotate: Array.isArray(animate.shoulderAngle)
            ? animate.shoulderAngle.map((a) => (a * 180) / Math.PI)
            : (animate.shoulderAngle * 180) / Math.PI,
        }
      : undefined;

  const animLower =
    animate?.elbowAngle !== undefined && !reduceMotion
      ? {
          rotate: Array.isArray(animate.elbowAngle)
            ? animate.elbowAngle.map((a) => (a * 180) / Math.PI)
            : (animate.elbowAngle * 180) / Math.PI,
        }
      : undefined;

  return (
    <motion.g
      initial={{ rotate: shoulderDeg }}
      animate={animUpper || { rotate: shoulderDeg }}
      transition={animate?.transition || SPRING}
      style={{ transformOrigin: `${pivotX}px ${pivotY}px` }}
    >
      {/* Upper limb */}
      <line
        x1={pivotX}
        y1={pivotY}
        x2={pivotX}
        y2={pivotY + upperLen}
        stroke="url(#phantom-glass-body)"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <line
        x1={pivotX}
        y1={pivotY}
        x2={pivotX}
        y2={pivotY + upperLen}
        stroke="rgba(255, 255, 255, 0.4)"
        strokeWidth={1}
      />

      {/* Elbow joint */}
      <circle
        cx={pivotX}
        cy={pivotY + upperLen}
        r={1.5}
        fill="#f4af25"
        opacity={0.6}
      />

      {/* Lower limb */}
      <motion.g
        initial={{ rotate: elbowDeg }}
        animate={animLower || { rotate: elbowDeg }}
        transition={animate?.transition || SPRING}
        style={{ transformOrigin: `${pivotX}px ${pivotY + upperLen}px` }}
      >
        <line
          x1={pivotX}
          y1={pivotY + upperLen}
          x2={pivotX}
          y2={pivotY + upperLen + lowerLen}
          stroke="url(#phantom-glass-body)"
          strokeWidth={4.5}
          strokeLinecap="round"
        />
        <line
          x1={pivotX}
          y1={pivotY + upperLen}
          x2={pivotX}
          y2={pivotY + upperLen + lowerLen}
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth={1}
        />
        {hand && (
          <circle
            cx={pivotX}
            cy={pivotY + upperLen + lowerLen}
            r={2.5}
            fill="rgba(255, 255, 255, 0.8)"
          />
        )}
      </motion.g>
    </motion.g>
  );
}

/* ── Pose implementations ────────────────────────────────────────────────── */

const rad = (deg: number) => (deg * Math.PI) / 180;

function PoseIdle({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <g>
      <AssassinHead reduceMotion={reduceMotion} emotion={emotion} />
      <AssassinTorso reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(15)} elbowAngle={rad(10)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-15)} elbowAngle={rad(-10)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-5)} elbowAngle={rad(5)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(5)} elbowAngle={rad(-5)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
    </g>
  );
}

function PoseFloating({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <motion.g animate={reduceMotion ? undefined : { y: [0, -4, 0] }} transition={reduceMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}>
      <AssassinHead reduceMotion={reduceMotion} emotion={emotion} />
      <AssassinTorso reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(25)} elbowAngle={rad(15)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-25)} elbowAngle={rad(-15)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      {/* Legs swept back slightly */}
      <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-15)} elbowAngle={rad(10)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-10)} elbowAngle={rad(5)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
    </motion.g>
  );
}

function PoseRunning({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  // A rapid ninja-run cycle: leaning forward, arms swept back, legs cycling.
  const runTrans = { duration: 0.6, repeat: Infinity, ease: 'linear' as const };
  return (
    <g transform="translate(0, 4) rotate(-15 50 70)">
      <AssassinHead reduceMotion={reduceMotion} emotion={emotion} rotate={15} />
      <AssassinTorso reduceMotion={reduceMotion} />
      {/* Arms swept back like Naruto run */}
      <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-70)} elbowAngle={rad(20)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-80)} elbowAngle={rad(30)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      
      {/* Legs cycling */}
      <GlassLimb 
        pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} 
        shoulderAngle={rad(30)} elbowAngle={rad(0)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion}
        animate={{
          shoulderAngle: [rad(40), rad(-50), rad(-10), rad(40)],
          elbowAngle: [rad(10), rad(80), rad(20), rad(10)],
          transition: runTrans
        }}
      />
      <GlassLimb 
        pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} 
        shoulderAngle={rad(-50)} elbowAngle={rad(80)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion}
        animate={{
          shoulderAngle: [rad(-50), rad(-10), rad(40), rad(-50)],
          elbowAngle: [rad(80), rad(20), rad(10), rad(80)],
          transition: runTrans
        }}
      />
    </g>
  );
}

function PoseJumping({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  // Airborne ninja pose: tucked in, arms crossed or dynamic
  return (
    <motion.g animate={reduceMotion ? undefined : { y: [-5, -15, -5] }} transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' as const }}>
      <AssassinHead reduceMotion={reduceMotion} emotion={emotion} rotate={10} />
      <AssassinTorso reduceMotion={reduceMotion} />
      {/* Arms braced for impact/balance */}
      <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(80)} elbowAngle={rad(-90)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-60)} elbowAngle={rad(90)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      {/* Legs tucked up */}
      <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(60)} elbowAngle={rad(-100)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(20)} elbowAngle={rad(-40)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
    </motion.g>
  );
}

function PosePointing({
  reduceMotion,
  pointAngle,
  pointLength,
  emotion,
}: {
  reduceMotion: boolean;
  pointAngle: number;
  pointLength: number;
  emotion: FamiliarEmotion;
}) {
  const armLen1 = 14;
  const armLen2 = 13;
  const targetDist = Math.min(
    armLen1 + armLen2 - 1,
    Math.max(armLen1, pointLength)
  );

  const targetX = Math.cos(pointAngle) * targetDist;
  const targetY = Math.sin(pointAngle) * targetDist;

  const useRightArm = targetX >= 0;

  const localTargetX = targetX;
  const localTargetY = targetY;

  const { angle1: ikAng1, angle2: ikAng2 } = solveIK2D(
    localTargetY,
    -localTargetX,
    armLen1,
    armLen2
  );

  return (
    <g>
      <AssassinHead reduceMotion={reduceMotion} rotate={useRightArm ? 10 : -10} emotion={emotion} />
      <AssassinTorso reduceMotion={reduceMotion} />

      {/* Left Arm */}
      <GlassLimb
        pivotX={BODY_CX - SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={useRightArm ? rad(20) : ikAng1}
        elbowAngle={useRightArm ? rad(30) : ikAng2}
        upperLen={armLen1}
        lowerLen={armLen2}
        reduceMotion={reduceMotion}
        animate={
          !useRightArm
            ? { shoulderAngle: ikAng1, elbowAngle: ikAng2 }
            : undefined
        }
      />

      {/* Right Arm */}
      <GlassLimb
        pivotX={BODY_CX + SHOULDER_DX}
        pivotY={SHOULDER_Y}
        shoulderAngle={useRightArm ? ikAng1 : rad(-20)}
        elbowAngle={useRightArm ? ikAng2 : rad(-30)}
        upperLen={armLen1}
        lowerLen={armLen2}
        reduceMotion={reduceMotion}
        animate={
          useRightArm
            ? { shoulderAngle: ikAng1, elbowAngle: ikAng2 }
            : undefined
        }
      />

      {/* Pointing beam from the hand */}
      {!reduceMotion && (
        <motion.line
          x1={useRightArm ? BODY_CX + SHOULDER_DX : BODY_CX - SHOULDER_DX}
          y1={SHOULDER_Y}
          x2={
            (useRightArm
              ? BODY_CX + SHOULDER_DX
              : BODY_CX - SHOULDER_DX) +
            targetX * 1.5
          }
          y2={SHOULDER_Y + targetY * 1.5}
          stroke="#f4af25"
          strokeWidth={1}
          opacity={0.5}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: [0, 1, 0.5] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            repeatType: "reverse" as const,
          }}
          style={{ transformOrigin: "0 0" }}
        />
      )}

      {/* Legs braced */}
      <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-15)} elbowAngle={rad(10)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(15)} elbowAngle={rad(-10)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
    </g>
  );
}

function PosePeeking({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <g transform="translate(-12, 10) rotate(-15 50 70)">
      <defs>
        <clipPath id="phantom-familiar-peek-clip">
          <rect x={0} y={0} width={VB_W} height={BODY_CY + 4} />
        </clipPath>
      </defs>
      <g clipPath="url(#phantom-familiar-peek-clip)">
        <AssassinHead reduceMotion={reduceMotion} emotion={emotion} />
        <AssassinTorso reduceMotion={reduceMotion} />
        {/* Hands gripping the edge */}
        <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(70)} elbowAngle={rad(110)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
        <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-70)} elbowAngle={rad(-110)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      </g>
    </g>
  );
}

function PoseSleeping({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <g>
      <motion.g
        animate={reduceMotion ? undefined : { y: [0, 1, 0] }}
        transition={reduceMotion ? undefined : BREATH}
      >
        <AssassinHead reduceMotion={reduceMotion} rotate={15} emotion={emotion} />
        <AssassinTorso reduceMotion={reduceMotion} />
        {/* Legs crossed, seated */}
        <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(80)} elbowAngle={rad(-120)} upperLen={16} lowerLen={16} hand={false} reduceMotion={reduceMotion} />
        <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-80)} elbowAngle={rad(120)} upperLen={16} lowerLen={16} hand={false} reduceMotion={reduceMotion} />
        {/* Hands on lap */}
        <GlassLimb pivotX={BODY_CX - SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(35)} elbowAngle={rad(45)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
        <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-35)} elbowAngle={rad(-45)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      </motion.g>
      {/* Drifting "z"s */}
      {!reduceMotion &&
        ["z", "z", "z"].map((c, i) => (
          <motion.text
            key={i}
            x={BODY_CX + 16 + i * 2}
            y={HEAD_CY - 4}
            fontSize={5 + i * 1.5}
            fill="#f4af25"
            fontFamily="serif"
            style={{ fontStyle: "italic" }}
            initial={{ opacity: 0, y: HEAD_CY - 4 }}
            animate={{ opacity: [0, 0.85, 0], y: HEAD_CY - 22 - i * 6 }}
            transition={{
              duration: 3.6,
              delay: i * 0.6,
              repeat: Infinity,
              ease: "easeInOut" as const,
            }}
          >
            {c}
          </motion.text>
        ))}
    </g>
  );
}

function PoseWaving({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <g>
      <AssassinHead reduceMotion={reduceMotion} emotion={emotion} />
      <AssassinTorso reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + SHOULDER_DX} pivotY={SHOULDER_Y} shoulderAngle={rad(-15)} elbowAngle={rad(-10)} upperLen={14} lowerLen={13} reduceMotion={reduceMotion} />
      <GlassLimb 
        pivotX={BODY_CX - SHOULDER_DX} 
        pivotY={SHOULDER_Y} 
        shoulderAngle={rad(-130)} 
        elbowAngle={rad(20)} 
        upperLen={14} 
        lowerLen={13} 
        reduceMotion={reduceMotion}
        animate={{
          shoulderAngle: [rad(-120), rad(-140), rad(-120)],
          transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' as const }
        }}
      />
      <GlassLimb pivotX={BODY_CX - HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(-5)} elbowAngle={rad(5)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
      <GlassLimb pivotX={BODY_CX + HIP_DX} pivotY={HIP_Y} shoulderAngle={rad(5)} elbowAngle={rad(-5)} upperLen={18} lowerLen={17} hand={false} reduceMotion={reduceMotion} />
    </g>
  );
}

function PoseVanishing({ reduceMotion, emotion }: { reduceMotion: boolean, emotion: FamiliarEmotion }) {
  return (
    <g>
      <motion.g
        initial={{ opacity: 1, scale: 1 }}
        animate={
          reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -10 }
        }
        transition={
          reduceMotion
            ? { duration: 0.6 }
            : { duration: 1.4, ease: "easeInOut" as const }
        }
        style={{ transformOrigin: "50px 70px" }}
      >
        <PoseIdle reduceMotion={reduceMotion} emotion={emotion} />
      </motion.g>
      {!reduceMotion && (
        <g>
          {[-12, -4, 4, 12].map((dx, i) => (
            <motion.path
              key={i}
              d={"M " + (BODY_CX + dx) + " " + (BODY_CY + 10) + " Q " + (BODY_CX + dx + (i % 2 === 0 ? -4 : 4)) + " " + (BODY_CY - 10) + " " + (BODY_CX + dx) + " " + (BODY_CY - 30)}
              stroke="#f4af25"
              strokeWidth={1.5}
              strokeLinecap="round"
              fill="none"
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{ opacity: [0, 0.7, 0], pathLength: [0, 1, 1] }}
              transition={{ duration: 1.6, delay: 0.05 * i, ease: "easeOut" as const }}
            />
          ))}
        </g>
      )}
    </g>
  );
}