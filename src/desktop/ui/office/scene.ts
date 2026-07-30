/** The Office — the three.js surface the floor is drawn on.
 *
 *  It owns the renderer, the camera and the static set (floor, zones, desks);
 *  it owns no notion of what an agent is. Everything that moves is handed to it
 *  from outside, so the honest-empty state is the default state of this class.
 *
 *  Render policy: the loop runs only while something is actually moving. An
 *  empty office costs one frame and then nothing at all — this membrane sits on
 *  top of a desktop the operator is trying to use. */

import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';

import { DeskSlot, FLOOR, ZONES, Zone, allSlots } from './layout';

const MIN_FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;
const DESK_H = 0.42;

export interface OfficeSceneHooks {
  /** Advance whatever is moving. Seconds. Called before every rendered frame. */
  tick?: (dt: number) => void;
}

function labelTexture(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffffff';
  g.font = '600 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = '8px';
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new CanvasTexture(c);
  tex.anisotropy = 1;
  return tex;
}

export class OfficeScene {
  readonly available: boolean;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** Everything that moves is parented here, so the static set stays sorted. */
  readonly stage = new Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer | null;
  private readonly disposables: { dispose: () => void }[] = [];
  private readonly deskLights = new Map<string, Mesh>();

  private raf = 0;
  private last = 0;
  private animating = false;
  private dirty = true;
  private shown = true;
  private docVisible = true;
  private disposed = false;

  constructor(root: HTMLElement, private readonly hooks: OfficeSceneHooks = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'office';
    root.appendChild(this.canvas);

    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.setClearAlpha(0);
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
    this.available = renderer !== null;

    this.camera = new PerspectiveCamera(40, 16 / 9, 0.5, 200);
    this.camera.position.set(0, 17.5, 24);
    this.camera.lookAt(0, 0, -1.5);

    this.scene.add(this.stage);
    if (this.available) {
      this.build();
      this.resize();
      window.addEventListener('resize', this.resize);
      document.addEventListener('visibilitychange', this.onDocVisibility);
      this.request();
    }
  }

  /** Populated floors are lit and present; an idle one is a low ember. */
  setPopulated(populated: boolean): void {
    this.canvas.classList.toggle('populated', populated);
  }

  setShown(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    this.canvas.classList.toggle('hidden', !shown);
    if (shown) {
      this.dirty = true;
      this.request();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** True while characters are in motion — the only reason to run a loop. */
  setAnimating(animating: boolean): void {
    if (this.animating === animating) return;
    this.animating = animating;
    if (animating) {
      this.last = performance.now();
      this.request();
    }
  }

  markDirty(): void {
    this.dirty = true;
    this.request();
  }

  lightDesk(slot: DeskSlot, lit: boolean): void {
    const mesh = this.deskLights.get(`${slot.zone}:${slot.index}`);
    if (!mesh) return;
    const mat = mesh.material as MeshBasicMaterial;
    const next = lit ? 0.5 : 0.06;
    if (mat.opacity === next) return;
    mat.opacity = next;
    this.markDirty();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onDocVisibility);
    for (const d of this.disposables) d.dispose();
    this.renderer?.dispose();
    this.canvas.remove();
  }

  private build(): void {
    const floorGeo = new PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0);
    const floorMat = new MeshStandardMaterial({
      color: 0x0d1219,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
    });
    const floor = new Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.disposables.push(floorGeo, floorMat);

    const deskGeo = new BoxGeometry(1.5, DESK_H, 0.85);
    const deskMat = new MeshStandardMaterial({
      color: 0x1b2431,
      roughness: 0.8,
      transparent: true,
      opacity: 0.88,
    });
    const lightGeo = new PlaneGeometry(1.5, 0.85);
    this.disposables.push(deskGeo, deskMat, lightGeo);

    for (const z of ZONES) this.buildZone(z);

    for (const slot of allSlots()) {
      const desk = new Mesh(deskGeo, deskMat);
      desk.position.set(slot.desk.x, DESK_H / 2, slot.desk.z);
      this.scene.add(desk);

      const glowMat = new MeshBasicMaterial({
        color: 0xf4af25,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      });
      const glow = new Mesh(lightGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(slot.desk.x, DESK_H + 0.01, slot.desk.z);
      this.scene.add(glow);
      this.deskLights.set(`${slot.zone}:${slot.index}`, glow);
      this.disposables.push(glowMat);
    }

    const hemi = new HemisphereLight(0xfde9b8, 0x0a0e14, 0.55);
    const key = new DirectionalLight(0xfff3d6, 0.75);
    key.position.set(6, 14, 10);
    this.scene.add(hemi, key, new AmbientLight(0x223044, 0.6));
  }

  private buildZone(z: Zone): void {
    const w = z.x1 - z.x0;
    const d = z.z1 - z.z0;
    const cx = (z.x0 + z.x1) / 2;
    const cz = (z.z0 + z.z1) / 2;

    const padGeo = new PlaneGeometry(w, d);
    const padMat = new MeshBasicMaterial({
      color: z.accent,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
    });
    const pad = new Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(cx, 0.012, cz);
    this.scene.add(pad);

    const edgeGeo = new EdgesGeometry(padGeo);
    const edgeMat = new LineBasicMaterial({ color: z.accent, transparent: true, opacity: 0.3 });
    const edges = new LineSegments(edgeGeo, edgeMat);
    edges.rotation.x = -Math.PI / 2;
    edges.position.set(cx, 0.02, cz);
    this.scene.add(edges);

    const tex = labelTexture(z.label);
    const labelMat = new MeshBasicMaterial({
      map: tex,
      color: z.accent,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const labelGeo = new PlaneGeometry(Math.min(w * 0.86, 5), Math.min(w * 0.86, 5) * (96 / 512));
    const label = new Mesh(labelGeo, labelMat);
    label.rotation.x = -Math.PI / 2;
    label.position.set(cx, 0.03, z.id === 'lobby' ? z.z1 - 0.7 : z.z0 + 0.7);
    this.scene.add(label);

    this.disposables.push(padGeo, padMat, edgeGeo, edgeMat, labelGeo, labelMat, tex);
  }

  private request(): void {
    if (this.raf || this.disposed || !this.renderer) return;
    if (!this.shown || !this.docVisible) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (!this.renderer || !this.shown || !this.docVisible) return;
    const elapsed = now - this.last;
    if (this.animating && elapsed < MIN_FRAME_MS) {
      this.request();
      return;
    }
    this.last = now;
    this.hooks.tick?.(Math.min(elapsed, 100) / 1000);
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    if (this.animating || this.dirty) this.request();
  };

  private readonly onDocVisibility = (): void => {
    this.docVisible = document.visibilityState === 'visible';
    if (this.docVisible) {
      this.last = performance.now();
      this.dirty = true;
      this.request();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  };

  private readonly resize = (): void => {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.markDirty();
  };
}
