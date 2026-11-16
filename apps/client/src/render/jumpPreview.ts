import * as THREE from 'three';
import { BALL_RADIUS as R } from '@billiards/physics';
import type { ShotResult } from '@billiards/shared';
import { toThree } from './coords';

/** Hasil prediksi lompatan, untuk warna busur dan teks HUD. */
export type JumpVerdict =
  | { kind: 'target'; ball: number } // mengenai bola target lebih dulu
  | { kind: 'wrong'; ball: number } // bola lain yang tersentuh lebih dulu (tidak melompatinya)
  | { kind: 'off-table' }
  | { kind: 'miscue' }
  | { kind: 'no-hit' }; // tidak menyentuh bola apa pun sebelum berhenti / masuk / rail

const COLORS: Record<JumpVerdict['kind'], number> = {
  target: 0x8dffb0,
  wrong: 0xff5a4f,
  'off-table': 0xff5a4f,
  miscue: 0xff5a4f,
  'no-hit': 0xffffff,
};
/** panjang lintasan maksimum yang digambar (m) */
const MAX_PATH = 2.6;
const TUBE_R = 0.0022;

/**
 * Busur lintasan cue ball untuk jump shot: pusat bola di udara (tabung tipis), bayangan di kain,
 * cincin di titik mendarat, dan ghost ball di kontak pertama. Data dari simulasi penuh (worker).
 */
export class JumpPreview {
  readonly group = new THREE.Group();
  verdict: JumpVerdict | null = null;
  /** tinggi lompatan maksimum (m, sisi bawah bola di atas kain) */
  apex = 0;
  ready = false;
  private arcMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
  private markMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  private landGeo = new THREE.RingGeometry(R * 0.35, R * 0.55, 32).rotateX(-Math.PI / 2);
  private ghostGeo = new THREE.RingGeometry(R * 0.9, R, 48).rotateX(-Math.PI / 2);
  private items: THREE.Object3D[] = [];

  constructor() {
    this.group.renderOrder = 6;
    this.group.visible = false;
  }

  clear(): void {
    for (const o of this.items) {
      this.group.remove(o);
      if (o instanceof THREE.Mesh && o.geometry !== this.landGeo && o.geometry !== this.ghostGeo) o.geometry.dispose();
    }
    this.items = [];
    this.verdict = null;
    this.apex = 0;
    this.ready = false;
    this.group.visible = false;
  }

  show(res: ShotResult, target: number): void {
    this.clear();
    const track = res.frames.find((f) => f.id === 0);
    if (!track || track.t.length < 2) return;

    // potong di kontak pertama cue ball (bola, cushion, pocket, keluar meja)
    let tEnd = res.duration;
    let verdict: JumpVerdict = { kind: 'no-hit' };
    let contact: [number, number, number] | null = null;
    for (const e of res.events) {
      if (e.type === 'miscue') {
        verdict = { kind: 'miscue' };
        continue;
      }
      if (!e.ids.includes(0) || e.type === 'cue' || e.type === 'slate') continue;
      tEnd = e.t;
      if (e.type === 'ball-ball') {
        const other = e.ids[0] === 0 ? e.ids[1] : e.ids[0];
        if (verdict.kind !== 'miscue') verdict = other === target ? { kind: 'target', ball: other } : { kind: 'wrong', ball: other };
      } else if (e.type === 'off-table' && verdict.kind !== 'miscue') verdict = { kind: 'off-table' };
      break;
    }

    // titik lintasan sampai tEnd (interpolasi titik terakhir), dibatasi panjangnya
    const pts: THREE.Vector3[] = [];
    let len = 0;
    for (let i = 0; i < track.t.length; i++) {
      const t = track.t[i];
      let x = track.p[i * 3];
      let y = track.p[i * 3 + 1];
      let z = track.p[i * 3 + 2];
      if (t > tEnd && i > 0) {
        const t0 = track.t[i - 1];
        const f = (tEnd - t0) / Math.max(1e-9, t - t0);
        x = track.p[(i - 1) * 3] + (x - track.p[(i - 1) * 3]) * f;
        y = track.p[(i - 1) * 3 + 1] + (y - track.p[(i - 1) * 3 + 1]) * f;
        z = track.p[(i - 1) * 3 + 2] + (z - track.p[(i - 1) * 3 + 2]) * f;
      }
      const v = toThree(x, y, z, new THREE.Vector3());
      const prev = pts[pts.length - 1];
      if (prev) {
        const d = prev.distanceTo(v);
        if (d < 1e-4) {
          if (t > tEnd) break;
          continue;
        }
        if (len + d > MAX_PATH) {
          pts.push(prev.clone().lerp(v, (MAX_PATH - len) / d));
          break;
        }
        len += d;
      }
      pts.push(v);
      this.apex = Math.max(this.apex, z - R);
      if (t > tEnd) break;
    }
    if (verdict.kind === 'target' || verdict.kind === 'wrong') contact = [pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z];

    const color = COLORS[verdict.kind];
    this.arcMat.color.setHex(color);
    this.markMat.color.setHex(color);

    if (pts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const segs = Math.min(400, pts.length * 2);
      this.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, TUBE_R, 6, false), this.arcMat));
      // bayangan di kain: lintasan yang sama dipipihkan ke permukaan
      const flat = pts.map((p) => new THREE.Vector3(p.x, 0.0014, p.z));
      const shadow = new THREE.CatmullRomCurve3(flat, false, 'centripetal');
      this.add(new THREE.Mesh(new THREE.TubeGeometry(shadow, segs, TUBE_R * 0.8, 4, false), this.shadowMat));
    }
    // cincin di setiap titik mendarat sebelum kontak pertama
    for (const e of res.events) {
      if (e.t > tEnd) break;
      if (e.type !== 'slate' || e.ids[0] !== 0) continue;
      const ring = new THREE.Mesh(this.landGeo, this.markMat);
      toThree(e.pos[0], e.pos[1], 0.0018, ring.position);
      this.add(ring);
    }
    if (contact) {
      const ghost = new THREE.Mesh(this.ghostGeo, this.markMat);
      ghost.position.set(contact[0], 0.0018, contact[2]);
      this.add(ghost);
    }
    this.verdict = verdict;
    this.ready = true;
  }

  private add(o: THREE.Object3D): void {
    o.renderOrder = 6;
    this.items.push(o);
    this.group.add(o);
  }
}
