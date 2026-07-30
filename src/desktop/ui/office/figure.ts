/** The body. Built from primitives in code rather than fetched — the Film runs
 *  on a machine that may have no internet, and a clean stylised figure beats a
 *  broken download. No third-party asset is involved.
 *
 *  Limbs hang off pivot groups at the hip and shoulder, so the walk cycle is
 *  four rotations and no geometry work per frame. */

import {
  BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';

export const FIGURE_HEIGHT = 1.74;

const HIP_Y = 0.72;
const SHOULDER_Y = 1.34;
const TORSO_Y = 1.08;
const HEAD_Y = 1.58;
const SHELL = 0x0e141d;

let geo: {
  torso: BufferGeometry;
  head: BufferGeometry;
  arm: BufferGeometry;
  leg: BufferGeometry;
} | null = null;

function geometries(): NonNullable<typeof geo> {
  if (!geo) {
    geo = {
      torso: new CapsuleGeometry(0.2, 0.32, 3, 10),
      head: new SphereGeometry(0.155, 12, 9),
      arm: new CapsuleGeometry(0.055, 0.42, 2, 6),
      leg: new CapsuleGeometry(0.08, 0.56, 2, 6),
    };
  }
  return geo;
}

export function disposeFigureGeometries(): void {
  if (!geo) return;
  for (const g of Object.values(geo)) g.dispose();
  geo = null;
}

function pivot(x: number, y: number, mesh: Mesh, drop: number): Group {
  const g = new Group();
  g.position.set(x, y, 0);
  mesh.position.set(0, -drop, 0);
  g.add(mesh);
  return g;
}

/** One character. Owns its own materials so a body can carry its own state
 *  colour; geometry is shared across the whole floor. */
export class Figure {
  readonly root = new Group();
  private readonly torso: Mesh;
  private readonly head: Mesh;
  private readonly armL: Group;
  private readonly armR: Group;
  private readonly legL: Group;
  private readonly legR: Group;

  private readonly accentMat: MeshStandardMaterial;
  private readonly shellMat: MeshStandardMaterial;

  constructor(accent: number) {
    const g = geometries();
    this.accentMat = new MeshStandardMaterial({
      color: accent,
      roughness: 0.55,
      metalness: 0.05,
      emissive: accent,
      emissiveIntensity: 0.16,
    });
    this.shellMat = new MeshStandardMaterial({ color: SHELL, roughness: 0.85 });

    this.legL = pivot(-0.11, HIP_Y, new Mesh(g.leg, this.shellMat), 0.36);
    this.legR = pivot(0.11, HIP_Y, new Mesh(g.leg, this.shellMat), 0.36);
    this.armL = pivot(-0.26, SHOULDER_Y, new Mesh(g.arm, this.shellMat), 0.265);
    this.armR = pivot(0.26, SHOULDER_Y, new Mesh(g.arm, this.shellMat), 0.265);

    this.torso = new Mesh(g.torso, this.accentMat);
    this.torso.position.set(0, TORSO_Y, 0);
    this.head = new Mesh(g.head, this.shellMat);
    this.head.position.set(0, HEAD_Y, 0);

    this.root.add(this.legL, this.legR, this.torso, this.head, this.armL, this.armR);
  }

  setAccent(color: number): void {
    this.accentMat.color.setHex(color);
    this.accentMat.emissive.setHex(color);
  }

  /** How hard the body reads against the floor — state, not decoration. */
  setGlow(intensity: number): void {
    this.accentMat.emissiveIntensity = intensity;
  }

  setOpacity(opacity: number): void {
    const transparent = opacity < 1;
    for (const m of [this.accentMat, this.shellMat]) {
      m.transparent = transparent;
      m.opacity = opacity;
    }
  }

  place(x: number, z: number, facing: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = facing;
  }

  /** `gait` scales the swing: 1 walking, 0 standing. */
  stride(phase: number, gait: number): void {
    const s = Math.sin(phase) * gait;
    this.legL.rotation.x = s * 0.62;
    this.legR.rotation.x = -s * 0.62;
    this.armL.rotation.x = -s * 0.46;
    this.armR.rotation.x = s * 0.46;
    const bob = Math.abs(s) * 0.03;
    this.torso.position.y = TORSO_Y + bob;
    this.head.position.y = HEAD_Y + bob;
  }

  /** Head pitch, radians. Down is a body bent to its work. */
  setHeadPitch(pitch: number): void {
    this.head.rotation.x = pitch;
    this.torso.rotation.x = pitch * 0.35;
  }

  addTo(parent: Object3D): void {
    parent.add(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.accentMat.dispose();
    this.shellMat.dispose();
  }
}
