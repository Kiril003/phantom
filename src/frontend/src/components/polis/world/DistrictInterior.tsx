/** Розріз будівлі району. Поверх = місія, стіл = вузол, лампа = статус.
 * Камера облітає; клік по поверху відкриває місію, клік по столу — вузол.
 * Нічого декоративного: якщо світиться — там працюють. */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useGLTF, Text, AdaptiveDpr, Billboard,
  RoundedBox, Environment, Lightformer, ContactShadows,
} from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { usePolisStore } from '../../../stores/polisStore';
import { themeColor, domainColor } from '../theme';
import {
  buildSpec, HALF_W, HALF_D, DESK_STATE_VAR, DESK_LIT,
  type BuildingSpec, type FloorSpec, type DeskSpec, type PlinthSpec,
} from './buildingSpec';
import { SkyDome } from './SkyDome';

// Робоче місце змодельоване у Blender (scripts/blender/polis_desk.py): тут
// камера близько, і геометрія нарешті окупається. Екран — окремий меш,
// щоб світитись статусом вузла, поки решта лишається темною.
const DESK_KIT = '/assets/polis-desk.glb';
const PERSON_KIT = '/assets/polis-person.glb';

// VISUAL_SYSTEM: display-шрифт для назв, моно ЛИШЕ для даних (числа, статуси).
// Space Grotesk не має кирилиці, тому назви місій ведe Manrope.
const DISPLAY = '/fonts/Manrope-Medium.ttf';
const MONO = '/fonts/JetBrainsMono-Regular.ttf';

function useHex(varName: string, fallback: string): string {
  return useMemo(() => themeColor(varName) || fallback, [varName, fallback]);
}

/* ── робоче місце: стіл, крісло, монітор; екран несе статус вузла ────── */
function Desk({ desk, y, onPick }: { desk: DeskSpec; y: number; onPick: (id: string) => void }) {
  const { nodes } = useGLTF(DESK_KIT) as unknown as { nodes: Record<string, THREE.Mesh> };
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const tint = themeColor(DESK_STATE_VAR[desk.state]) || '#8a7758';
  const lit = DESK_LIT[desk.state];

  useFrame(({ clock }) => {
    if (!screen.current) return;
    // пульс лише у роботі — решта станів горить рівно
    const pulse = desk.state === 'running'
      ? 0.7 + Math.abs(Math.sin(clock.elapsedTime * 2.2)) * 0.6
      : 1;
    screen.current.emissiveIntensity = lit * 2.4 * pulse;
  });

  if (!nodes?.desk) return null;

  return (
    <group position={[desk.x, y, desk.z]} rotation={[0, desk.ry, 0]}>
      <mesh
        geometry={nodes.desk.geometry}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(desk.nodeId); }}
      >
        <meshStandardMaterial color="#7a6a52" roughness={0.55} />
      </mesh>
      <mesh geometry={nodes.monitor.geometry} castShadow>
        <meshStandardMaterial color="#26282c" roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh geometry={nodes.screen.geometry}>
        <meshStandardMaterial
          ref={screen}
          color="#0d1013"
          emissive={tint}
          emissiveIntensity={lit * 2.4}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={nodes.chair.geometry} position={[0, 0, 0.78]} castShadow receiveShadow>
        <meshStandardMaterial color="#3a3d42" roughness={0.8} />
      </mesh>

      {/* стос на столі = файли, які цей вузол уже видав */}
      {Array.from({ length: Math.min(desk.artifacts, 8) }, (_, i) => (
        <mesh
          key={i}
          position={[0.6, 0.775 + i * 0.016, 0.12]}
          rotation={[0, ((i * 17) % 12) * 0.01, 0]}
          castShadow
        >
          <boxGeometry args={[0.24, 0.012, 0.32]} />
          <meshStandardMaterial color={i % 2 ? '#d8d2c4' : '#c7c0ae'} roughness={0.85} />
        </mesh>
      ))}
      {desk.citizenId && (
        <group position={[0, 0, 0.72]}>
          <Worker activity={desk.activity} tint={tint} />
        </group>
      )}
    </group>
  );
}

useGLTF.preload(DESK_KIT);

/* ── громадянин: модельована постать, а не капсула ────────────────────── */
function Worker({ activity, tint, standing = false }: {
  activity?: string;
  tint: string;
  standing?: boolean;
}) {
  const { nodes } = useGLTF(PERSON_KIT) as unknown as { nodes: Record<string, THREE.Mesh> };
  const g = useRef<THREE.Group>(null);
  const seed = useMemo(() => Math.random() * 6, []);

  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime + seed;
    // працює — дихає й трохи хитається; заблокований — завмер
    const amp = activity === 'working' ? 0.016 : activity === 'blocked' ? 0 : 0.007;
    g.current.position.y = Math.sin(t * 1.6) * amp;
    g.current.rotation.y = Math.sin(t * 0.5) * (activity === 'working' ? 0.05 : 0.015);
  });

  const body = standing ? nodes?.body_stand : nodes?.body_sit;
  const head = standing ? nodes?.head_stand : nodes?.head_sit;
  if (!body || !head) return null;

  const cloth = activity === 'blocked' ? '#5d5145' : tint;

  return (
    <group ref={g}>
      <mesh geometry={body.geometry} castShadow receiveShadow>
        <meshStandardMaterial color={cloth} roughness={0.82} />
      </mesh>
      <mesh geometry={head.geometry} castShadow>
        <meshStandardMaterial color="#e0b183" roughness={0.72} />
      </mesh>
    </group>
  );
}

useGLTF.preload(PERSON_KIT);

/* ── залежності між вузлами ───────────────────────────────────────────── */
function Links({ links, tint }: { links: FloorSpec['links']; tint: string }) {
  const accent = themeColor('--accent') || '#d9a441';
  const geom = useMemo(() => {
    const plain: number[] = [];
    const hot: number[] = [];
    for (const l of links) {
      const target = l.critical || l.live ? hot : plain;
      target.push(l.from[0], 0.06, l.from[1], l.to[0], 0.06, l.to[1]);
    }
    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return g;
    };
    return { plain: mk(plain), hot: mk(hot) };
  }, [links]);

  return (
    <group>
      <lineSegments geometry={geom.plain}>
        <lineBasicMaterial color={tint} transparent opacity={0.22} />
      </lineSegments>
      <lineSegments geometry={geom.hot}>
        <lineBasicMaterial color={accent} transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}

/* ── поверх ───────────────────────────────────────────────────────────── */
function Floor({
  floor, ink, onOpenMission, onPickNode,
}: {
  floor: FloorSpec;
  ink: string;
  onOpenMission: (id: string) => void;
  onPickNode: (id: string) => void;
}) {
  const tint = domainColor(floor.domain);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (beacon.current) {
      beacon.current.emissiveIntensity = 1.4 + Math.abs(Math.sin(clock.elapsedTime * 2)) * 3.2;
    }
  });

  return (
    <group position={[0, floor.y, 0]}>
      <RoundedBox args={[HALF_W * 2, 0.42, HALF_D * 2]} radius={0.12} smoothness={3}
        position={[0, -0.21, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#463b30" roughness={0.88} />
      </RoundedBox>

      {/* смуга поступу — довжина = progress, це і є «будівля росте» */}
      <mesh position={[-HALF_W + 0.4 + (floor.progress * (HALF_W * 2 - 0.8)) / 2, 0.02, HALF_D - 0.35]}>
        <boxGeometry args={[Math.max(0.05, floor.progress * (HALF_W * 2 - 0.8)), 0.04, 0.12]} />
        <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>

      {/* підпис завжди обернений до глядача — камера облітає будівлю */}
      <Billboard position={[-HALF_W - 1.6, 1.9, HALF_D - 1.5]}>
        <Text
          font={DISPLAY}
          fontSize={0.82}
          color={ink}
          anchorX="left"
          anchorY="bottom"
          maxWidth={13}
          outlineWidth={0.03}
          outlineColor="#120d06"
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            onOpenMission(floor.missionId);
          }}
        >
          {floor.title}
        </Text>
        <Text
          font={MONO}
          fontSize={0.54}
          color={tint}
          anchorX="left"
          anchorY="top"
          position={[0, -0.16, 0]}
          outlineWidth={0.025}
          outlineColor="#120d06"
        >
          {`${Math.round(floor.progress * 100)}%  ·  ${floor.status}`}
        </Text>
      </Billboard>

      <Links links={floor.links} tint={tint} />

      {floor.desks.map((d) => (
        <Desk key={d.nodeId} desk={d} y={0} onPick={onPickNode} />
      ))}

      {/* ворота — те, що чекає на тебе, видно здалеку */}
      {floor.awaitingGate && (
        <mesh position={[HALF_W - 1.2, 1.9, 0]}>
          <sphereGeometry args={[0.3, 14, 12]} />
          <meshStandardMaterial
            ref={beacon}
            color="#2a1206"
            emissive={themeColor('--primary') || '#d9a441'}
            emissiveIntensity={2}
          />
        </mesh>
      )}

      <pointLight
        position={[0, 2.6, 1]}
        color="#ffd7a0"
        intensity={floor.status === 'running' ? 16 : 8}
        distance={30}
        castShadow={false}
      />
    </group>
  );
}

/* ── вестибюль: хто без роботи ────────────────────────────────────────── */
function Lobby({ people, ink }: { people: BuildingSpec['lobby']; ink: string }) {
  if (people.length === 0) return null;
  return (
    <group position={[0, 0, 0]}>
      <RoundedBox args={[HALF_W * 2, 0.42, HALF_D * 2]} radius={0.12} smoothness={3}
        position={[0, -0.21, 0]} receiveShadow castShadow>
        <meshStandardMaterial color="#544736" roughness={0.86} />
      </RoundedBox>
      <Billboard position={[-HALF_W - 1.6, 1.2, HALF_D - 1.5]}>
        <Text
          font={DISPLAY}
          fontSize={0.56}
          color={ink}
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.025}
          outlineColor="#120d06"
        >
          {`вестибюль · ${people.length} вільних`}
        </Text>
      </Billboard>
      {people.slice(0, 40).map((p, i) => (
        <group
          key={p.id}
          position={[-8 + (i % 10) * 1.8, 0, 3.2 + Math.floor(i / 10) * 1.5]}
          rotation={[0, ((i * 37) % 360) * (Math.PI / 180), 0]}
        >
          <Worker activity={p.activity} tint="#6b6459" standing />
        </group>
      ))}
    </group>
  );
}

/* ── ратуша: постамент із тим, що піднесли особисто тобі ──────────────── */
function Plinth({ p, ink, onOpen }: {
  p: PlinthSpec;
  ink: string;
  onOpen: (id: string) => void;
}) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const waiting = p.kind === 'gate';
  const tint = waiting
    ? themeColor('--primary') || '#d9a441'
    : themeColor('--signal-ok') || '#5fa192';

  useFrame(({ clock }) => {
    if (!glow.current) return;
    // те, що чекає рішення, дихає; здане — горить рівно
    glow.current.emissiveIntensity = waiting
      ? 1.6 + Math.abs(Math.sin(clock.elapsedTime * 1.7)) * 2.4
      : 0.8;
  });

  return (
    <group position={[p.x, 0, p.z]}>
      <mesh position={[0, 0.46, 0]} castShadow receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onOpen(p.id); }}>
        <boxGeometry args={[1.05, 0.92, 1.05]} />
        <meshStandardMaterial color="#5a5348" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.94, 0]}>
        <boxGeometry args={[1.16, 0.03, 1.16]} />
        <meshStandardMaterial color="#6e4f2e" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow>
        {waiting
          ? <octahedronGeometry args={[0.32, 0]} />
          : <boxGeometry args={[0.46, 0.42, 0.46]} />}
        <meshStandardMaterial
          ref={glow}
          color={waiting ? '#2a1206' : '#1c2a25'}
          emissive={tint}
          emissiveIntensity={waiting ? 2 : 0.8}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>
      <Billboard position={[0, 2.1, 0]}>
        <Text font={DISPLAY} fontSize={0.3} color={ink} anchorX="center" anchorY="bottom"
          maxWidth={5} outlineWidth={0.02} outlineColor="#120d06">
          {p.title}
        </Text>
        <Text font={DISPLAY} fontSize={0.22} color={tint} anchorX="center" anchorY="top"
          position={[0, -0.1, 0]} maxWidth={5} outlineWidth={0.018} outlineColor="#120d06">
          {p.kind === 'gate' ? p.detail : 'готово'}
        </Text>
      </Billboard>
    </group>
  );
}

function Hall({ spec, ink }: { spec: BuildingSpec; ink: string }) {
  const selectMission = usePolisStore((s) => s.selectMission);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);

  const open = useCallback((id: string) => {
    const gate = spec.gates.find((g) => g.id === id);
    selectMission(gate ? gate.mission_id : id);
    setRoomTab('work');
  }, [spec.gates, selectMission, setRoomTab]);

  return (
    <group>
      <mesh position={[0, -0.21, 2]} receiveShadow>
        <boxGeometry args={[HALF_W * 2, 0.42, HALF_D * 2]} />
        <meshStandardMaterial color="#584c3c" roughness={0.92} />
      </mesh>
      {/* стіл оператора — місце, куди все несуть */}
      <mesh position={[0, 0.74, -4.2]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 0.12, 1.9]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.37, -4.2]} castShadow>
        <boxGeometry args={[4.0, 0.74, 1.5]} />
        <meshStandardMaterial color="#2f2823" roughness={0.6} />
      </mesh>
      <Billboard position={[0, 1.7, -4.2]}>
        <Text font={DISPLAY} fontSize={0.34} color={ink} anchorX="center" anchorY="middle"
          outlineWidth={0.02} outlineColor="#120d06">
          твій стіл
        </Text>
      </Billboard>
      {spec.plinths.map((p) => (
        <Plinth key={p.id} p={p} ink={ink} onOpen={open} />
      ))}
      <pointLight position={[0, 3.2, 1]} color="#ffcf94" intensity={18} distance={34} />
    </group>
  );
}

/* ── каркас будівлі ───────────────────────────────────────────────────── */
function Structure({ height }: { height: number }) {
  const bronze = '#6e4f2e';
  return (
    <group>
      {[-HALF_W - 0.4, HALF_W + 0.4].map((x) => (
        <mesh key={x} position={[x, height / 2, -HALF_D - 0.4]} castShadow>
          <boxGeometry args={[0.4, height, 0.4]} />
          <meshStandardMaterial color={bronze} roughness={0.35} metalness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, height / 2, -HALF_D - 0.5]} receiveShadow>
        <boxGeometry args={[HALF_W * 2 + 1, height, 0.2]} />
        <meshStandardMaterial color="#3a3730" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[HALF_W * 2 + 5, 0.6, HALF_D * 2 + 5]} />
        <meshStandardMaterial color="#1a1710" roughness={0.98} />
      </mesh>
    </group>
  );
}

/* ── орбітальна камера ────────────────────────────────────────────────── */
function Rig({ height, paused }: { height: number; paused: boolean }) {
  const yaw = useRef(0.5);
  const elev = useRef(0.46);
  const zoom = useRef(1);
  const drag = useRef<{ on: boolean; x: number; y: number }>({ on: false, x: 0, y: 0 });

  useFrame(({ camera, size }, dt) => {
    if (!paused && !drag.current.on) yaw.current += dt * 0.06;
    // кадр має вмістити і ширину поверху, і висоту будівлі — інакше низька
    // будівля тоне у порожнечі, а висока не влазить
    const cam = camera as THREE.PerspectiveCamera;
    const vFov = (cam.fov * Math.PI) / 180;
    const aspect = Math.max(0.6, size.width / Math.max(1, size.height));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const needW = (HALF_W + 2.5) / Math.tan(hFov / 2);
    const needH = (height / 2 + 2.5) / Math.tan(vFov / 2);
    // піднімаємо камеру — інакше поверхи видно з торця, як лінійки
    const r = Math.max(needW, needH) * 1.18 * zoom.current;
    const focus = height * 0.42;
    camera.position.set(
      Math.sin(yaw.current) * r,
      focus + r * Math.tan(elev.current),
      Math.cos(yaw.current) * r,
    );
    camera.lookAt(0, focus, 0);
  });

  const gl = useThree((s) => s.gl);
  React.useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { drag.current = { on: true, x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!drag.current.on) return;
      yaw.current -= (e.clientX - drag.current.x) * 0.006;
      elev.current = Math.min(1.15, Math.max(0.06, elev.current + (e.clientY - drag.current.y) * 0.004));
      drag.current.x = e.clientX;
      drag.current.y = e.clientY;
    };
    const up = () => { drag.current.on = false; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = Math.min(1.7, Math.max(0.32, zoom.current * (1 + Math.sign(e.deltaY) * 0.12)));
    };
    // слухаємо саме полотно, щоб кліки по чату збоку не крутили будівлю
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
function Scene({ spec, paused }: { spec: BuildingSpec; paused: boolean }) {
  const ink = useHex('--ink-primary', '#e8e3d6');
  const selectMission = usePolisStore((s) => s.selectMission);
  const setRoomTab = usePolisStore((s) => s.setRoomTab);
  const openInspector = usePolisStore((s) => s.openInspector);

  const openMission = useCallback((id: string) => {
    selectMission(id);
    setRoomTab('work');
  }, [selectMission, setRoomTab]);

  const pickNode = useCallback((id: string) => {
    openInspector(id);
    setRoomTab('work');
  }, [openInspector, setRoomTab]);

  return (
    <>
      <SkyDome radius={160} />
      <fog attach="fog" args={['#3a2418', 55, 190]} />
      <ambientLight intensity={0.55} color="#6f7d96" />
      <hemisphereLight intensity={0.7} color="#b9d0e6" groundColor="#5a4028" />
      <directionalLight
        position={[26, 44, 22]}
        intensity={3.2}
        color="#ffdcaa"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={60}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      {/* контрове — силует поверхів, головний прийом стилізованого 3D */}
      <directionalLight position={[-24, 16, -22]} intensity={1.6} color="#7fb3ff" />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.2} color="#ffdcae" scale={[20, 10, 1]} position={[14, 12, 10]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.4} color="#8fb8ff" scale={[18, 10, 1]} position={[-16, 9, -12]} target={[0, 0, 0]} />
      </Environment>
      <ContactShadows position={[-0.02, 0, 0]} scale={60} blur={2.4} opacity={0.5} far={20} />
      <Structure height={spec.height} />
      {spec.isHall ? (
        <Hall spec={spec} ink={ink} />
      ) : (
        <>
          <Lobby people={spec.lobby} ink={ink} />
          {spec.floors.map((f) => (
            <Floor
              key={f.missionId}
              floor={f}
              ink={ink}
              onOpenMission={openMission}
              onPickNode={pickNode}
            />
          ))}
        </>
      )}
      <Rig height={spec.height} paused={paused} />
      <AdaptiveDpr pixelated />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={1.6} intensity={2.4} distanceFalloff={0.7} quality="medium" />
        <Bloom intensity={0.8} luminanceThreshold={0.6} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.26} darkness={0.7} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

/* ── публічний компонент ──────────────────────────────────────────────── */
export function DistrictInterior({
  districtId, label, onExit,
}: {
  districtId: string;
  label: string;
  onExit: () => void;
}) {
  const missions = usePolisStore((s) => s.missions);
  const citizens = usePolisStore((s) => s.citizens);
  const gates = usePolisStore((s) => s.gates);
  const [paused, setPaused] = useState(false);

  const spec = useMemo(
    () => buildSpec(districtId, label, missions, citizens, gates),
    [districtId, label, missions, citizens, gates],
  );

  const empty = spec.isHall
    ? spec.plinths.length === 0
    : spec.floors.length === 0 && spec.lobby.length === 0;

  return (
    <div className="relative w-full h-full" data-testid="polis-district-interior">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 42, near: 0.1, far: 600 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
        }}
      >
        <Scene spec={spec} paused={paused} />
      </Canvas>

      <div className="glass-panel absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-2"
        style={{ borderRadius: 0, borderBottom: '1px solid var(--glass-border)' }}>
        <button
          onClick={onExit}
          className="active:scale-[0.97]"
          style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xs)',
            color: 'var(--ink-secondary)', border: '1px solid var(--glass-border)',
            borderRadius: 10, padding: '6px 14px', minHeight: 44, minWidth: 44,
            whiteSpace: 'nowrap', flex: 'none',
          }}
          data-testid="district-exit"
        >
          ← до міста
        </button>
        <span style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)',
          letterSpacing: 'var(--tracking-wide)', color: 'var(--ink-primary)',
          whiteSpace: 'nowrap', flex: 'none',
        }}>
          {label}
        </span>
        <span className="font-mono" style={{
          fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {spec.isHall
            ? `${spec.gates.length} чекає тебе · ${spec.plinths.length - spec.gates.length} здано`
            : `${spec.floors.length} місій · ${spec.lobby.length} вільних` +
              (spec.gates.length > 0 ? ` · ${spec.gates.length} чекає тебе` : '')}
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

      {empty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-sm)', color: 'var(--ink-muted)' }}>
            У цьому районі поки порожньо
          </span>
        </div>
      )}
    </div>
  );
}
