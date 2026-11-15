import * as THREE from 'three';
import { BALL_RADIUS as R } from '@billiards/physics';
import { toThree } from './coords';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const dir3 = new THREE.Vector3();

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
  constructor(private obj: THREE.Object3D) {
    obj.visible = false;
  }

  set visible(v: boolean) {
    this.obj.visible = v;
  }
  get visible(): boolean {
    return this.obj.visible;
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
    const c = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    const back = c * R + p.gap;
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
