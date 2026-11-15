import * as THREE from 'three';
import type { ShotResult, TableState } from '@billiards/shared';
import { quatToThree, toThree } from './coords';

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Menggerakkan mesh bola dari state meja atau dari keyframe hasil simulasi. */
export class BallViews {
  private cursor = new Int32Array(16);

  constructor(private meshes: THREE.Mesh[]) {}

  setTable(table: TableState): void {
    for (const m of this.meshes) m.visible = false;
    for (const b of table.balls) {
      const m = this.meshes[b.id];
      if (!m) continue;
      const on = b.motion !== 'pocketed' && b.motion !== 'off-table';
      m.visible = on;
      if (!on) continue;
      toThree(b.pos[0], b.pos[1], b.pos[2], m.position);
      quatToThree(b.quat[0], b.quat[1], b.quat[2], b.quat[3], m.quaternion);
    }
  }

  setBallPosition(id: number, x: number, y: number, z: number): void {
    toThree(x, y, z, this.meshes[id].position);
  }

  resetPlayback(): void {
    this.cursor.fill(0);
  }

  /** Posisikan semua bola pada waktu t (detik) dari hasil simulasi. */
  sample(res: ShotResult, t: number): void {
    for (const tr of res.frames) {
      const m = this.meshes[tr.id];
      const n = tr.t.length;
      if (!m || n === 0) continue;
      let i = this.cursor[tr.id];
      if (i >= n || tr.t[i] > t) i = 0;
      while (i < n - 2 && tr.t[i + 1] <= t) i++;
      this.cursor[tr.id] = i;
      const j = Math.min(i + 1, n - 1);
      const t0 = tr.t[i];
      const t1 = tr.t[j];
      const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : t >= t1 ? 1 : 0;
      const p = tr.p;
      toThree(
        p[i * 3] + (p[j * 3] - p[i * 3]) * f,
        p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * f,
        p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * f,
        m.position,
      );
      const q = tr.q;
      quatToThree(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3], qa);
      quatToThree(q[j * 4], q[j * 4 + 1], q[j * 4 + 2], q[j * 4 + 3], qb);
      m.quaternion.slerpQuaternions(qa, qb, f);
      // bola yang sudah masuk/keluar disembunyikan setelah ekor animasinya selesai
      const fin = res.finalState.balls.find((b) => b.id === tr.id);
      const gone = !!fin && (fin.motion === 'pocketed' || fin.motion === 'off-table');
      m.visible = !(gone && t >= tr.t[n - 1]);
    }
  }
}
