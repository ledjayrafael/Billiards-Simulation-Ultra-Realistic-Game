import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { BALL_RADIUS as R, TABLE_LENGTH, TABLE_WIDTH } from '@billiards/physics';
import type { SceneManifest } from '../render/assets';
import { toThree } from '../render/coords';

export type CamMode = 'aim' | 'top' | 'shot';

export interface RigContext {
  cueX: number;
  cueY: number;
  aimDir: number;
  /** titik fokus aksi (pusat bola yang bergerak), untuk shot cam */
  focusX: number;
  focusY: number;
}

const DEFAULT_PITCH = 0.27;
const DEFAULT_DIST = 1.45;
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_TOP = new THREE.Vector3(0, 0, -1);
const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const m4 = new THREE.Matrix4();

const damp = (k: number, dt: number): number => 1 - Math.exp(-k * dt);
function angleLerp(a: number, b: number, f: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
}

/** Kamera gameplay (aim / top / shot / orbit) dengan damping, plus pemutar kamera sinematik Blender. */
export class CameraRig {
  mode: CamMode = 'aim';
  pitch = DEFAULT_PITCH;
  dist = DEFAULT_DIST;
  /** offset orbit (klik kanan + drag) */
  orbitYaw = 0;
  orbiting = false;

  private yaw = 0;
  private pos = new THREE.Vector3(-2.75, 0.72, 0);
  private look = new THREE.Vector3(0.35, 0, 0);
  private up = new THREE.Vector3(0, 1, 0);
  private fov = 38;
  private stiff = 4;
  private shotYaw = 0;
  private shotAnchor: [number, number] = [0, 0];
  private shotBreak = false;
  private shotJump = false;
  /** arah pukulan (tanpa offset samping kamera jump) */
  private shotAim = 0;

  // sinematik
  private mixer: THREE.AnimationMixer;
  private cineCam: THREE.PerspectiveCamera | null = null;
  private cineAction: THREE.AnimationAction | null = null;
  private cineWeight = 0;
  private cineActive = false;
  private cineOnEnd: (() => void) | null = null;
  private cinePos = new THREE.Vector3();
  private cineQuat = new THREE.Quaternion();
  private cineFov = 38;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private gltf: GLTF,
    private manifest: SceneManifest,
  ) {
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.mixer.addEventListener('finished', () => {
      const cb = this.cineOnEnd;
      this.cineOnEnd = null;
      this.cineActive = false;
      cb?.();
    });
  }

  get cinematic(): boolean {
    return this.cineActive;
  }
  /** Tinggi kamera di atas kain (m) — untuk menyembunyikan lampu/plafon. */
  get height(): number {
    return this.camera.position.y;
  }

  reset(): void {
    this.pitch = DEFAULT_PITCH;
    this.dist = DEFAULT_DIST;
    this.orbitYaw = 0;
  }

  zoom(delta: number): void {
    this.dist = Math.min(2.6, Math.max(0.55, this.dist * Math.exp(delta)));
  }
  tilt(delta: number): void {
    this.pitch = Math.min(1.2, Math.max(0.09, this.pitch + delta));
  }
  orbit(dyaw: number, dpitch: number): void {
    this.orbitYaw += dyaw;
    this.tilt(dpitch);
  }

  /** jump = kamera lebih rendah & menyamping sedikit agar lengkungan lompatan terbaca. */
  startShot(ctx: RigContext, isBreak: boolean, jump = false): void {
    if (this.mode === 'top') return;
    this.mode = 'shot';
    this.shotYaw = ctx.aimDir + this.orbitYaw;
    this.shotAim = this.shotYaw;
    this.shotAnchor = [ctx.cueX, ctx.cueY];
    this.shotBreak = isBreak;
    this.shotJump = jump && !isBreak;
    if (this.shotJump) this.shotYaw += 0.5;
    this.stiff = 1.2;
  }
  endShot(): void {
    if (this.mode === 'shot') {
      this.mode = 'aim';
      this.stiff = 2.2;
    }
  }
  toggleTop(): void {
    this.mode = this.mode === 'top' ? 'aim' : 'top';
    this.stiff = 3;
  }

  /** Putar animasi kamera dari cameras.glb. */
  playCinematic(name: string, opts: { loop?: boolean; onEnd?: () => void; timeScale?: number } = {}): boolean {
    const clip = this.gltf.animations.find((a) => a.name === name);
    const node = this.gltf.scene.getObjectByName(name);
    let cam: THREE.PerspectiveCamera | null = null;
    node?.traverse((o) => {
      if ((o as THREE.PerspectiveCamera).isPerspectiveCamera) cam = o as THREE.PerspectiveCamera;
    });
    if (!clip || !cam) return false;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(opts.loop ? THREE.LoopPingPong : THREE.LoopOnce, opts.loop ? Infinity : 1);
    action.clampWhenFinished = true;
    action.timeScale = opts.timeScale ?? 1;
    action.play();
    this.cineAction = action;
    this.cineCam = cam;
    this.cineActive = true;
    this.cineOnEnd = opts.onEnd ?? null;
    return true;
  }
  stopCinematic(): void {
    if (!this.cineActive) return;
    this.cineActive = false;
    const cb = this.cineOnEnd;
    this.cineOnEnd = null;
    cb?.();
  }

  private clampRoom(p: THREE.Vector3): void {
    const r = this.manifest.room;
    p.x = Math.min(r.halfX - 0.3, Math.max(-r.halfX + 0.3, p.x));
    p.z = Math.min(r.halfY - 0.3, Math.max(-r.halfY + 0.3, p.z));
    if (this.mode !== 'top') p.y = Math.min(r.ceilingZ - 0.2, p.y);
  }

  update(dt: number, ctx: RigContext): void {
    dt = Math.min(dt, 0.05);
    let targetFov = 38;
    let targetStiff = 14;
    let up = UP_Y;
    if (!this.orbiting && this.mode === 'aim') this.orbitYaw = angleLerp(this.orbitYaw, 0, damp(3, dt));

    if (this.mode === 'top') {
      targetFov = 30;
      targetStiff = 5;
      up = UP_TOP;
      const t = Math.tan((targetFov * Math.PI) / 360);
      const h = Math.max(TABLE_WIDTH / 2 + 0.34, (TABLE_LENGTH / 2 + 0.34) / this.camera.aspect) / t;
      toThree(0, 0.0001, h, tmpPos);
      toThree(0, 0, 0, tmpLook);
    } else if (this.mode === 'shot') {
      targetStiff = 2.6;
      if (this.shotBreak) {
        toThree(-2.5, 0, 1.22, tmpPos);
        toThree(0.3, 0, 0, tmpLook);
      } else {
        const d = this.dist * 1.12 + 0.28;
        const p = this.shotJump ? 0.2 : Math.max(this.pitch + 0.1, 0.42);
        const cy = Math.cos(this.shotYaw);
        const sy = Math.sin(this.shotYaw);
        const [ax, ay] = this.shotAnchor;
        toThree(ax - cy * d * Math.cos(p), ay - sy * d * Math.cos(p), R + d * Math.sin(p) + 0.05, tmpPos);
        const lx = ax + Math.cos(this.shotAim) * 0.4;
        const ly = ay + Math.sin(this.shotAim) * 0.4;
        toThree(lx + (ctx.focusX - lx) * 0.6, ly + (ctx.focusY - ly) * 0.6, R, tmpLook);
      }
    } else {
      this.yaw = ctx.aimDir + this.orbitYaw;
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      const d = this.dist;
      const p = this.pitch;
      toThree(ctx.cueX - cy * d * Math.cos(p), ctx.cueY - sy * d * Math.cos(p), R + d * Math.sin(p) + 0.05, tmpPos);
      const ahead = 0.22 * d;
      toThree(ctx.cueX + Math.cos(ctx.aimDir) * ahead, ctx.cueY + Math.sin(ctx.aimDir) * ahead, R, tmpLook);
    }
    this.clampRoom(tmpPos);

    this.stiff += (targetStiff - this.stiff) * damp(1.6, dt);
    const f = damp(this.stiff, dt);
    this.pos.lerp(tmpPos, f);
    this.look.lerp(tmpLook, f);
    this.up.lerp(up, damp(4, dt)).normalize();
    this.fov += (targetFov - this.fov) * damp(4, dt);

    m4.lookAt(this.pos, this.look, this.up);
    tmpQ.setFromRotationMatrix(m4);

    // ── sinematik: blend halus ke/dari kamera Blender ──
    this.cineWeight += ((this.cineActive ? 1 : 0) - this.cineWeight) * damp(this.cineActive ? 3.2 : 2.4, dt);
    if (this.cineWeight < 0.002 && !this.cineActive) this.cineWeight = 0;
    let fov = this.fov;
    this.camera.position.copy(this.pos);
    this.camera.quaternion.copy(tmpQ);
    if (this.cineWeight > 0 && this.cineCam) {
      if (this.cineActive) {
        this.mixer.update(dt);
        this.gltf.scene.updateMatrixWorld(true);
        this.cineCam.getWorldPosition(this.cinePos);
        this.cineCam.getWorldQuaternion(this.cineQuat);
        this.cineFov = this.cineCam.fov;
      }
      const w = this.cineWeight * this.cineWeight * (3 - 2 * this.cineWeight);
      this.camera.position.lerp(this.cinePos, w);
      this.camera.quaternion.slerp(this.cineQuat, w);
      fov += (this.cineFov - fov) * w;
    }
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Lompat langsung ke pose target (tanpa damping) — dipakai saat awal. */
  snap(ctx: RigContext): void {
    const s = this.stiff;
    this.stiff = 1e6;
    this.update(0.05, ctx);
    this.stiff = s;
  }
}
