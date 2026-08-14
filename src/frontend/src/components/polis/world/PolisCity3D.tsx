/** ПОЛІС — місто як об'єкт. Стилізоване 3D: фаски, насичений колір,
 * тепле ключове світло + холодний контровий, bloom на всьому, що світиться.
 * Геометрія міста та сама, що на 2D-мапі — оператор вчить її раз.
 * Кожна форма несе стан: висота = поступ, світло = робота, маяк = чекає тебе. */
import { useMemo, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  RoundedBox, Text, Billboard, Environment, Lightformer,
  ContactShadows, Float, AdaptiveDpr,
} from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { usePolisStore } from '../../../stores/polisStore';
import { themeColor, domainColor } from '../theme';
import { QUARTERS, towersFor, citizenTarget, type Quarter, type Tower } from './cityLayout';
import { SkyDome } from './SkyDome';
import type { PolisCitizen } from '@shared/types';

const DISPLAY = '/fonts/Manrope-Medium.ttf';
const MONO = '/fonts/JetBrainsMono-Regular.ttf';

/* Стилізована палітра: насичена, тепла, з холодним контровим. */
const GROUND = '#2b2118';
const PLATE = '#3d3024';
const PLATE_TOP = '#4d3d2c';

const hex = (v: string, fallback: string) => {
  const c = themeColor(v);
  return c && c.startsWith('#') ? c : fallback;
};

/* ── острів під містом ────────────────────────────────────────────────── */
function Island() {
  return (
    <group>
      <RoundedBox args={[76, 2.2, 44]} radius={0.9} smoothness={4}
        position={[0, -1.0, 0]} receiveShadow castShadow>
        <meshStandardMaterial color={GROUND} roughness={0.95} />
      </RoundedBox>
      {/* спідня фаска — острів читається як плита, а не як підлога */}
      <RoundedBox args={[70, 1.6, 39]} radius={0.7} smoothness={3} position={[0, -2.7, 0]}>
        <meshStandardMaterial color="#1b1410" roughness={1} />
      </RoundedBox>
      <ContactShadows position={[0, -0.16, 0]} scale={80} blur={2.2} opacity={0.6} far={16} />
    </group>
  );
}

/* ── дороги: те, чим ходять громадяни ─────────────────────────────────── */
function Roads() {
  const plaza = QUARTERS.find((q) => q.kind === 'plaza')!;
  const spokes = useMemo(
    () => QUARTERS.filter((q) => q.kind !== 'plaza').map((q) => {
      const dx = q.x - plaza.x;
      const dz = q.z - plaza.z;
      const len = Math.hypot(dx, dz);
      return {
        id: q.id,
        len,
        angle: Math.atan2(dx, dz),
        mid: [plaza.x + dx / 2, plaza.z + dz / 2] as [number, number],
      };
    }),
    [plaza],
  );

  return (
    <group>
      {spokes.map((s) => (
        <mesh key={s.id} position={[s.mid[0], 0.13, s.mid[1]]} rotation={[0, s.angle, 0]} receiveShadow>
          <boxGeometry args={[1.5, 0.06, s.len]} />
          <meshStandardMaterial color="#54432f" roughness={0.88} />
        </mesh>
      ))}
      {/* площа — вузол, з якого все розходиться */}
      <mesh position={[plaza.x, 0.14, plaza.z]} receiveShadow>
        <cylinderGeometry args={[3.2, 3.2, 0.08, 32]} />
        <meshStandardMaterial color="#5e4b34" roughness={0.85} />
      </mesh>
      <mesh position={[plaza.x, 0.2, plaza.z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[3.2, 0.05, 8, 40]} />
        <meshStandardMaterial
          color="#2a1e12"
          emissive={hex('--accent', '#d9a441')}
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ── квартал ──────────────────────────────────────────────────────────── */
function QuarterPlate({ q, hot, onEnter }: {
  q: Quarter;
  hot: boolean;
  onEnter: (id: string) => void;
}) {
  const tint = q.kind === 'domain' ? domainColor(q.id) : hex('--ink-muted', '#8a7758');
  const [hover, setHover] = useState(false);

  return (
    <group position={[q.x, 0, q.z]}>
      <RoundedBox
        args={[q.w, q.lift, q.d]}
        radius={Math.min(0.28, q.lift * 0.4)}
        smoothness={4}
        position={[0, q.lift / 2 - 0.1, 0]}
        castShadow
        receiveShadow
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onEnter(q.id); }}
      >
        <meshStandardMaterial
          color={hover ? PLATE_TOP : PLATE}
          roughness={0.7}
          emissive={tint}
          emissiveIntensity={hover ? 0.5 : hot ? 0.3 : 0.16}
        />
      </RoundedBox>

      {/* кант кварталу кольором домену — так район упізнається здалеку */}
      <mesh position={[0, q.lift - 0.08, q.d / 2 - 0.06]}>
        <boxGeometry args={[q.w * 0.82, 0.06, 0.12]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>

      <Billboard position={[0, q.lift + 1.5, q.d / 2 - 0.2]}>
        <Text font={DISPLAY} fontSize={0.86} color={hex('--ink-primary', '#efe7d8')}
          anchorX="center" anchorY="middle" outlineWidth={0.05} outlineColor="#140e08">
          {q.label}
        </Text>
      </Billboard>
    </group>
  );
}

/* ── дах за фахом району: будинок має бути впізнаваним, а не кубом ────── */
function RoofCap({ t, tint, live }: { t: Tower; tint: string; live: boolean }) {
  const w = t.w;
  const y = t.h + 0.14;
  const brass = '#8a7758';

  switch (t.domain) {
    case 'research': // БІБЛІОТЕКА — купол і ліхтар
      return (
        <group position={[0, y, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[w * 0.46, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#6a563c" roughness={0.6} metalness={0.25} />
          </mesh>
          <mesh position={[0, w * 0.52, 0]}>
            <sphereGeometry args={[0.09, 10, 8]} />
            <meshStandardMaterial color="#2a1206" emissive={tint}
              emissiveIntensity={live ? 3 : 1} toneMapped={false} />
          </mesh>
        </group>
      );

    case 'analytics': // ОБСЕРВАТОРІЯ — купол зі щілиною й труба
      return (
        <group position={[0, y, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[w * 0.44, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#5f5340" roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, w * 0.28, 0]} rotation={[-0.5, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.1, w * 0.9, 8]} />
            <meshStandardMaterial color={brass} roughness={0.35} metalness={0.8} />
          </mesh>
        </group>
      );

    case 'dev': // КУЗНЯ — комини, і вони димлять коли кують
      return (
        <group position={[0, y, 0]}>
          {[-1, 1].map((sx) => (
            <group key={sx} position={[sx * w * 0.26, 0, -w * 0.2]}>
              <mesh castShadow>
                <cylinderGeometry args={[w * 0.09, w * 0.11, w * 0.62, 8]} />
                <meshStandardMaterial color="#3d3126" roughness={0.9} />
              </mesh>
              {live && (
                <mesh position={[0, w * 0.4, 0]}>
                  <sphereGeometry args={[w * 0.1, 8, 6]} />
                  <meshStandardMaterial color={tint} emissive={tint}
                    emissiveIntensity={1.8} transparent opacity={0.5} toneMapped={false} />
                </mesh>
              )}
            </group>
          ))}
        </group>
      );

    case 'game': // СТУДІЯ — пилчастий дах майстерні
      return (
        <group position={[0, y, 0]}>
          {[-0.3, 0.1, 0.5].map((o, i) => (
            <mesh key={i} position={[0, 0.1, w * o * 0.7]} rotation={[0.62, 0, 0]} castShadow>
              <boxGeometry args={[w * 0.92, w * 0.3, 0.07]} />
              <meshStandardMaterial color={i % 2 ? '#584734' : '#2c2318'}
                roughness={0.55} emissive={i % 2 ? tint : '#000'}
                emissiveIntensity={i % 2 && live ? 0.9 : 0} toneMapped={false} />
            </mesh>
          ))}
        </group>
      );

    case 'document': // СКРИПТОРІЙ — двосхилий дах
      return (
        <mesh position={[0, y + w * 0.22, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[w * 0.78, w * 0.55, 4]} />
          <meshStandardMaterial color="#5a4630" roughness={0.75} />
        </mesh>
      );

    default: // МАЙСТЕРНІ — плаский дах із вентиляцією
      return (
        <group position={[0, y, 0]}>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * w * 0.24, w * 0.1, 0]} castShadow>
              <boxGeometry args={[w * 0.26, w * 0.2, w * 0.5]} />
              <meshStandardMaterial color="#4a3f31" roughness={0.85} />
            </mesh>
          ))}
        </group>
      );
  }
}

/* ── будинок = місія ──────────────────────────────────────────────────── */
function MissionTower({ t, onOpen }: { t: Tower; onOpen: (id: string) => void }) {
  const tint = domainColor(t.domain);
  const win = useRef<THREE.MeshStandardMaterial>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const [hover, setHover] = useState(false);
  const live = t.status === 'running';

  useFrame(({ clock }) => {
    const s = clock.elapsedTime;
    if (win.current) {
      // вікна дихають лише коли всередині працюють
      win.current.emissiveIntensity = live ? 1.5 + Math.sin(s * 2.1) * 0.55 : 0.5;
    }
    if (beacon.current) {
      beacon.current.emissiveIntensity = 2.5 + Math.abs(Math.sin(s * 2.4)) * 5.5;
    }
  });

  const bands = useMemo(
    () => Array.from({ length: t.floors }, (_, i) => (i + 0.5) * (t.h / t.floors)),
    [t.floors, t.h],
  );

  return (
    <group position={[t.x, t.base, t.z]}>
      <RoundedBox
        args={[t.w, t.h, t.w]}
        radius={Math.min(0.14, t.w * 0.16)}
        smoothness={4}
        position={[0, t.h / 2, 0]}
        castShadow
        receiveShadow
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); }}
        onPointerOut={() => setHover(false)}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onOpen(t.id); }}
      >
        <meshStandardMaterial color={hover ? '#6b563e' : '#514231'} roughness={0.72} metalness={0.05} />
      </RoundedBox>

      {/* світлові пояси = поверхи; їх стільки, скільки зроблено */}
      {bands.map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[t.w * 1.02, 0.07, t.w * 1.02]} />
          <meshStandardMaterial
            ref={i === 0 ? win : undefined}
            color="#120d08"
            emissive={tint}
            emissiveIntensity={live ? 1.5 : 0.5}
            toneMapped={false}
          />
        </mesh>
      ))}

      <RoundedBox args={[t.w * 1.14, 0.16, t.w * 1.14]} radius={0.05} smoothness={3}
        position={[0, t.h + 0.06, 0]} castShadow>
        <meshStandardMaterial color="#241b13" roughness={0.9} />
      </RoundedBox>

      {t.style === 1 && t.h > 3 && (
        <RoundedBox args={[t.w * 0.62, t.h * 0.26, t.w * 0.62]} radius={0.08} smoothness={3}
          position={[0, t.h + 0.14 + t.h * 0.13, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#5b4a35" roughness={0.7} />
        </RoundedBox>
      )}
      <RoofCap t={t} tint={tint} live={live} />

      {/* маяк — місія чекає твого рішення */}
      {t.awaiting && (
        <Float speed={2.4} floatIntensity={0.5} rotationIntensity={0.5}>
          <mesh position={[0, t.h + 1.1, 0]} castShadow>
            <octahedronGeometry args={[0.28, 0]} />
            <meshStandardMaterial
              ref={beacon}
              color="#2a1206"
              emissive={hex('--primary', '#e0a94a')}
              emissiveIntensity={3}
              toneMapped={false}
            />
          </mesh>
        </Float>
      )}

      {hover && (
        <Billboard position={[0, t.h + 1.7, 0]}>
          <Text font={DISPLAY} fontSize={0.4} color={hex('--ink-primary', '#efe7d8')}
            anchorX="center" anchorY="bottom" maxWidth={9}
            outlineWidth={0.028} outlineColor="#140e08">
            {t.title}
          </Text>
          <Text font={MONO} fontSize={0.3} color={tint} anchorX="center" anchorY="top"
            position={[0, -0.12, 0]} outlineWidth={0.022} outlineColor="#140e08">
            {`${Math.round(t.progress * 100)}%`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

/* ── ратуша ───────────────────────────────────────────────────────────── */
function TownHall({ q, gates, onEnter }: {
  q: Quarter;
  gates: number;
  onEnter: (id: string) => void;
}) {
  const bell = useRef<THREE.Group>(null);
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const gold = hex('--primary', '#e0a94a');

  useFrame(({ clock }) => {
    const s = clock.elapsedTime;
    // дзвін гойдається лише коли тебе чекають
    if (bell.current) bell.current.rotation.z = gates > 0 ? Math.sin(s * 3.1) * 0.32 : 0;
    if (glow.current) {
      glow.current.emissiveIntensity = gates > 0 ? 2.2 + Math.abs(Math.sin(s * 2.2)) * 4 : 0.7;
    }
  });

  return (
    <group position={[q.x, q.lift - 0.1, q.z]}>
      <RoundedBox args={[3.4, 2.2, 3.0]} radius={0.16} smoothness={4}
        position={[0, 1.1, 0]} castShadow receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onEnter('townhall'); }}>
        <meshStandardMaterial color="#5b4732" roughness={0.68} />
      </RoundedBox>
      <RoundedBox args={[3.9, 0.22, 3.5]} radius={0.08} smoothness={3} position={[0, 2.3, 0]} castShadow>
        <meshStandardMaterial color={gold} roughness={0.3} metalness={0.9} />
      </RoundedBox>
      {/* вежа з дзвоном */}
      <RoundedBox args={[1.1, 1.9, 1.1]} radius={0.1} smoothness={4} position={[0, 3.3, 0]} castShadow>
        <meshStandardMaterial color="#6b5238" roughness={0.6} />
      </RoundedBox>
      <group ref={bell} position={[0, 3.9, 0]}>
        <mesh castShadow>
          <coneGeometry args={[0.3, 0.5, 12]} />
          <meshStandardMaterial
            ref={glow}
            color="#3a2410"
            emissive={gold}
            emissiveIntensity={1}
            metalness={0.85}
            roughness={0.25}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh position={[0, 4.45, 0]}>
        <coneGeometry args={[0.8, 0.9, 4]} />
        <meshStandardMaterial color={gold} metalness={0.9} roughness={0.28} />
      </mesh>
      <Billboard position={[0, 5.4, 0]}>
        <Text font={DISPLAY} fontSize={0.46} color={hex('--ink-primary', '#efe7d8')}
          anchorX="center" anchorY="middle" outlineWidth={0.03} outlineColor="#140e08">
          {gates > 0 ? `РАТУША · ${gates} чекає` : 'РАТУША'}
        </Text>
      </Billboard>
    </group>
  );
}

/* ── електростанція: ключі як реактори ────────────────────────────────── */
function PowerPlant({ q }: { q: Quarter }) {
  const keys = usePolisStore((s) => s.keys);
  const ok = hex('--signal-ok', '#5fa192');
  const warn = hex('--signal-warn', '#d2a04a');
  const dead = hex('--ink-faint', '#6f6a5f');

  return (
    <group position={[q.x, q.lift - 0.1, q.z]}>
      {keys.slice(0, 6).map((k, i) => {
        const tint = k.state === 'active' ? ok : k.state === 'cooling' ? warn : dead;
        const h = 0.7 + (k.state === 'active' ? 0.9 : 0.35);
        return (
          <group key={k.id} position={[-2.2 + (i % 3) * 2.2, 0, i < 3 ? -0.9 : 0.9]}>
            <RoundedBox args={[0.7, h, 0.7]} radius={0.1} smoothness={4}
              position={[0, h / 2, 0]} castShadow receiveShadow>
              <meshStandardMaterial color="#4a4038" roughness={0.7} />
            </RoundedBox>
            <mesh position={[0, h + 0.16, 0]}>
              <sphereGeometry args={[0.19, 14, 12]} />
              <meshStandardMaterial color="#101418" emissive={tint}
                emissiveIntensity={k.state === 'active' ? 2.6 : 1} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
      <Billboard position={[0, 2.6, 0]}>
        <Text font={DISPLAY} fontSize={0.4} color={hex('--ink-secondary', '#c9bda8')}
          anchorX="center" anchorY="middle" outlineWidth={0.026} outlineColor="#140e08">
          {q.label}
        </Text>
      </Billboard>
    </group>
  );
}

/* ── громадяни ────────────────────────────────────────────────────────── */
interface Walker { x: number; z: number; tx: number; tz: number; ph: number; }

function Citizens({ citizens }: { citizens: PolisCitizen[] }) {
  const state = useRef<Map<string, Walker>>(new Map());
  const inst = useRef<any>(null);
  const head = useRef<any>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const plaza = QUARTERS.find((q) => q.kind === 'plaza')!;

  useFrame((_, dt) => {
    const m = state.current;
    for (const id of [...m.keys()]) if (!citizens.some((c) => c.id === id)) m.delete(id);

    citizens.forEach((c, i) => {
      let w = m.get(c.id);
      if (!w) {
        w = { x: plaza.x, z: plaza.z, tx: plaza.x, tz: plaza.z, ph: Math.random() * 6 };
        m.set(c.id, w);
      }
      const [tx, tz] = citizenTarget(c, i, citizens.length);
      w.tx = tx; w.tz = tz;
      const dx = w.tx - w.x, dz = w.tz - w.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const v = Math.min(d, dt * 2.2);
        w.x += (dx / d) * v;
        w.z += (dz / d) * v;
      }
    });

    if (!inst.current || !head.current) return;
    let n = 0;
    const t = performance.now() / 1000;
    for (const c of citizens) {
      const w = state.current.get(c.id);
      if (!w) continue;
      const q = QUARTERS.find((qq) => qq.id === c.district) ?? plaza;
      const moving = Math.hypot(w.tx - w.x, w.tz - w.z) > 0.1;
      const bob = moving ? Math.abs(Math.sin(t * 7 + w.ph)) * 0.07 : Math.sin(t * 1.6 + w.ph) * 0.02;
      const lean = moving ? Math.sin(t * 7 + w.ph) * 0.13 : 0;
      const ry = Math.atan2(w.tx - w.x, w.tz - w.z);
      const ground = q.lift - 0.1;

      dummy.position.set(w.x, ground + 0.2 + bob, w.z);
      dummy.rotation.set(lean, ry, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      inst.current.setMatrixAt(n, dummy.matrix);

      // велика голова — стилізована пропорція, що читається здалеку
      dummy.position.set(w.x, ground + 0.52 + bob, w.z);
      dummy.rotation.set(0, ry, 0);
      dummy.updateMatrix();
      head.current.setMatrixAt(n, dummy.matrix);
      n++;
    }
    inst.current.count = n;
    head.current.count = n;
    inst.current.instanceMatrix.needsUpdate = true;
    head.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={inst} args={[undefined as any, undefined as any, 256]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[0.15, 0.22, 4, 8]} />
        <meshStandardMaterial color="#8a6a44" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined as any, undefined as any, 256]} castShadow frustumCulled={false}>
        <sphereGeometry args={[0.155, 12, 10]} />
        <meshStandardMaterial color="#e0b183" roughness={0.72} />
      </instancedMesh>
    </group>
  );
}

/* ── світло: тепле ключове + холодний контровий ───────────────────────── */
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.72} color="#7e8ca6" />
      <hemisphereLight intensity={0.7} color="#b9d0e6" groundColor="#5a4028" />
      <directionalLight
        position={[24, 30, 16]}
        intensity={3.5}
        color="#ffdcaa"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      {/* контровий — дає силует, головний прийом стилізованого 3D */}
      <directionalLight position={[-20, 14, -26]} intensity={1.5} color="#7fb3ff" />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.4} color="#ffdcae" scale={[24, 10, 1]} position={[16, 14, 10]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.5} color="#8fb8ff" scale={[20, 10, 1]} position={[-18, 10, -14]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1.1} color="#ffb877" scale={12} position={[0, 18, 0]} target={[0, 0, 0]} />
      </Environment>
    </>
  );
}

/* ── камера ───────────────────────────────────────────────────────────── */
function Rig({ paused }: { paused: boolean }) {
  const yaw = useRef(0.62);
  const elev = useRef(0.72);
  const zoom = useRef(1);
  const drag = useRef({ on: false, x: 0, y: 0 });
  const gl = useThree((s) => s.gl);

  useFrame(({ camera }, dt) => {
    if (!paused && !drag.current.on) yaw.current += dt * 0.035;
    const r = 58 * zoom.current;
    camera.position.set(
      Math.sin(yaw.current) * r,
      r * Math.tan(elev.current),
      Math.cos(yaw.current) * r,
    );
    camera.lookAt(0, 2.2, 0);
  });

  useMemo(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { drag.current = { on: true, x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!drag.current.on) return;
      yaw.current -= (e.clientX - drag.current.x) * 0.005;
      elev.current = Math.min(1.25, Math.max(0.34, elev.current + (e.clientY - drag.current.y) * 0.0035));
      drag.current.x = e.clientX; drag.current.y = e.clientY;
    };
    const up = () => { drag.current.on = false; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = Math.min(1.6, Math.max(0.42, zoom.current * (1 + Math.sign(e.deltaY) * 0.1)));
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  return null;
}

/* ── сцена ────────────────────────────────────────────────────────────── */
function Scene({ paused, onEnter }: { paused: boolean; onEnter: (id: string) => void }) {
  const missions = usePolisStore((s) => s.missions);
  const citizens = usePolisStore((s) => s.citizens);
  const gates = usePolisStore((s) => s.gates);
  const selectMission = usePolisStore((s) => s.selectMission);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);

  const openMission = useCallback((id: string) => {
    selectMission(id);
    setRoomTab('work');
  }, [selectMission, setRoomTab]);

  const towers = useMemo(
    () => QUARTERS.filter((q) => q.kind === 'domain').flatMap((q) => towersFor(q, missions, gates)),
    [missions, gates],
  );
  const hotQuarters = useMemo(() => {
    const s = new Set<string>();
    for (const g of gates) {
      const m = missions.find((mm) => mm.id === g.mission_id);
      if (m) s.add(m.domain);
    }
    return s;
  }, [gates, missions]);

  const townhall = QUARTERS.find((q) => q.kind === 'townhall')!;
  const power = QUARTERS.find((q) => q.kind === 'power')!;

  return (
    <>
      <SkyDome />
      <fog attach="fog" args={['#3a2418', 80, 260]} />
      <Lighting />
      <Island />
      <Roads />
      {QUARTERS.map((q) => (
        <QuarterPlate key={q.id} q={q} hot={hotQuarters.has(q.id)} onEnter={onEnter} />
      ))}
      {towers.map((t) => (
        <MissionTower key={t.id} t={t} onOpen={openMission} />
      ))}
      <TownHall q={townhall} gates={gates.length} onEnter={onEnter} />
      <PowerPlant q={power} />
      <Citizens citizens={citizens} />
      <Rig paused={paused} />
      <AdaptiveDpr pixelated />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={2.4} intensity={2.2} distanceFalloff={0.8} quality="medium" />
        <Bloom intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.24} darkness={0.72} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

export function PolisCity3D({ onEnterDistrict }: { onEnterDistrict: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const gates = usePolisStore((s) => s.gates);
  const missions = usePolisStore((s) => s.missions);

  return (
    <div className="relative w-full h-full" data-testid="polis-city-3d">
      <Canvas
        shadows
        dpr={[1, 1.8]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 34, near: 0.5, far: 400 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.3;
        }}
      >
        <Suspense fallback={null}>
          <Scene paused={paused} onEnter={onEnterDistrict} />
        </Suspense>
      </Canvas>

      <div className="glass-panel absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-2"
        style={{ borderRadius: 0, borderBottom: '1px solid var(--glass-border)' }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)',
          letterSpacing: 'var(--tracking-wide)', color: 'var(--ink-primary)',
        }}>
          ПОЛІС
        </span>
        <span className="font-mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
          {missions.length} місій{gates.length > 0 ? ` · ${gates.length} чекає тебе` : ''}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setPaused((p) => !p)}
          className="active:scale-[0.97]"
          style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xs)',
            color: 'var(--ink-secondary)', border: '1px solid var(--glass-border)',
            borderRadius: 10, padding: '6px 14px', minHeight: 44, minWidth: 44,
          }}
        >
          {paused ? 'обліт' : 'стоп'}
        </button>
      </div>
    </div>
  );
}
