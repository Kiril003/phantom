/** The body. Built from primitives in code rather than fetched — the Film runs
 *  on a machine that may have no internet, and a clean stylised figure beats a
 *  broken download. No third-party asset is involved. */

import {
  BufferGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';

export const FIGURE_HEIGHT = 1.62;

const SHELL = 0x0e141d;

let geo: {
  torso: BufferGeometry;
  head: BufferGeometry;
  limb: BufferGeometry;
  leg: BufferGeometry;
} | null = null;

function geometries(): NonNullable<typeof geo> {
  if (!geo) {
    geo = {
      torso: new CapsuleGeometry(0.21, 0.44, 3, 10),
      head: new SphereGeometry(0.165, 12, 9),
      limb: new CapsuleGeometry(0.062, 0.36, 2, 6),
      leg: new CapsuleGeometry(0.082, 0.44, 2, 6),
    };
  }
  return geo;
}

export function disposeFigureGeometries(): void {
  if (!geo) return;
  for (const g of Object.values(geo)) g.dispose();
  geo = null;
}

/** One character. Owns its own materials so a body can carry its own state
 *  colour; geometry is shared across the whole floor. */
export class Figure {
  readonly root = new Group();
  readonly torso: Mesh;
  readonly head: Mesh;
  readonly armL: Mesh;
  readonly armR: Mesh;
  readonly legL: Mesh;
  readonly legR: Mesh;

  private readonly accentMat: MeshStandardMaterial;
  private readonly shellMat: MeshStandardMaterial;

  constructor(accent: number) {
    const g = geometries();
    this.accentMat = new MeshStandardMaterial({
      color: accent,
      roughness: 0.55,
      metalness: 0.05,
      emissive: accent,
      emissiveIntensity: 0.14,
    });
    this.shellMat = new MeshStandardMaterial({ color: SHELL, roughness: 0.85 });

    this.legL = new Mesh(g.leg, this.shellMat);
    this.legR = new Mesh(g.leg, this.shellMat);
    this.legL.position.set(-0.11, 0.31, 0);
    this.legR.position.set(0.11, 0.31, 0);

    this.torso = new Mesh(g.torso, this.accentMat);
    this.torso.position.set(0, 0.95, 0);

    this.head = new Mesh(g.head, this.shellMat);
    this.head.position.set(0, 1.38, 0);

    this.armL = new Mesh(g.limb, this.shellMat);
    this.armR = new Mesh(g.limb, this.shellMat);
    this.armL.position.set(-0.29, 0.99, 0);
    this.armR.position.set(0.29, 0.99, 0);

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

  placeAt(x: number, z: number, facing: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = facing;
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
