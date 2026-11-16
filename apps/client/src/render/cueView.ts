import * as THREE from 'three';
import { BALL_RADIUS as R, CUE_LENGTH, JUMP_CUE_LENGTH } from '@billiards/physics';
import { toThree } from './coords';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const dir3 = new THREE.Vector3();

/** Profil ujung stik [jarak dari tip, radius] — sama dengan blender/scripts/build_cue.py
 *  (tip + ferrule), dirapatkan dengan interpolasi. */
const TIP_R = 0.01275 / 2;
const TIP_PROFILE: [number, number][] = (() => {
  const key: [number, number][] = [[0, 0.55], [0.0012, 0.86], [0.0035, 0.99], [0.008, 1], [0.033, 1]];
  const out: [number, number][] = [];
  for (let i = 0; i < key.length - 1; i++) {
    for (let k = 0; k < 6; k++) {
      const f = k / 6;
      out.push([key[i][0] + (key[i + 1][0] - key[i][0]) * f, TIP_R * (key[i][1] + (key[i + 1][1] - key[i][1]) * f)]);
    }
  }
  out.push([0.033, TIP_R]);
  return out;
})();

/** Jarak mundur tip (sepanjang sumbu stik, dari titik terdekat ke pusat bola) agar seluruh
 *  penampang tip/ferrule berada di luar bola. `off` = jarak sumbu stik dari pusat bola. */
function tipClearance(off: number): number {
  let back = 0;
  for (const [d, r] of TIP_PROFILE) {
    const e = Math.max(0, off - r);
    if (e < R) back = Math.max(back, Math.sqrt(R * R - e * e) - d);
  }
  return back;
}

export interface CuePose {
  /** posisi cue ball (fisika) */
  x: number;
  y: number;
  dir: number;
  elevation: number;
  tipX: number;
  tipY: number;
  /** jarak tip dari permukaan bola (m): celah + tarikan */
  gap: number;
}

/** Stik 3D: tip di origin model, memanjang ke −X. */
export class CueView {
  /** Pivot di ujung tip. Node glTF stik sendiri tidak disentuh: kuantisasi meshopt
   *  menyimpan offset/skala dekuantisasi di transform node itu, jadi menimpanya menggeser stik. */
  private obj: THREE.Object3D;

  constructor(model: THREE.Object3D) {
    this.obj = new THREE.Group();
    this.obj.name = 'CuePivot';
    model.parent?.add(this.obj);
    this.obj.add(model);
    this.obj.visible = false;
  }

  set visible(v: boolean) {
    this.obj.visible = v;
  }
  get visible(): boolean {
    return this.obj.visible;
  }

  /** Jump cue: stik yang sama dipendekkan dari arah butt (pivot di tip, model memanjang ke −X). */
  setJump(on: boolean): void {
    this.obj.scale.x = on ? JUMP_CUE_LENGTH / CUE_LENGTH : 1;
  }

  /** Jarak titik (Three) ke ujung tip. */
  tipDistance(p: THREE.Vector3): number {
    return this.obj.position.distanceTo(p);
  }

  setPose(p: CuePose): void {
    const ce = Math.cos(p.elevation);
    const se = Math.sin(p.elevation);
    const ct = Math.cos(p.dir);
    const st = Math.sin(p.dir);
    // arah stik (menuju bola), kanan, dan "atas" tegak lurus stik
    const dx = ce * ct;
    const dy = ce * st;
    const dz = -se;
    const rx = st;
    const ry = -ct;
    const ux = se * ct;
    const uy = se * st;
    const uz = ce;
    const a = p.tipX;
    const b = p.tipY;
    // tip berukuran nyata: dengan efek besar, tepi tip menyentuh bola sebelum titik tengahnya
    const back = tipClearance(R * Math.hypot(a, b)) + p.gap;
    toThree(
      p.x + R * (a * rx + b * ux) - dx * back,
      p.y + R * (a * ry + b * uy) - dy * back,
      R + R * b * uz - dz * back,
      this.obj.position,
    );
    toThree(dx, dy, dz, dir3);
    this.obj.quaternion.setFromUnitVectors(X_AXIS, dir3);
  }
}
