import * as THREE from 'three';
import { BALL_RADIUS as R, TABLE_LENGTH, TABLE_WIDTH } from '@billiards/physics';
import type { TableState } from '@billiards/shared';

export type GuideMode = 'on' | 'short' | 'off';

export interface AimHit {
  kind: 'ball' | 'rail';
  /** pusat cue ball saat kontak (ghost ball) */
  gx: number;
  gy: number;
  dist: number;
  ballId: number;
  bx: number;
  by: number;
}

/** Kontak pertama cue ball sepanjang arah bidik (geometri murni, tanpa prediksi spin/throw). */
export function firstAimHit(table: TableState, dir: number): AimHit | null {
  const cue = table.balls.find((b) => b.id === 0);
  if (!cue) return null;
  const ox = cue.pos[0];
  const oy = cue.pos[1];
  const dx = Math.cos(dir);
  const dy = Math.sin(dir);
  let best: AimHit | null = null;
  for (const b of table.balls) {
    if (b.id === 0 || b.motion === 'pocketed' || b.motion === 'off-table') continue;
    const rx = b.pos[0] - ox;
    const ry = b.pos[1] - oy;
    const along = rx * dx + ry * dy;
    if (along <= 0) continue;
    const perp2 = rx * rx + ry * ry - along * along;
    const rr = 4 * R * R;
    if (perp2 >= rr) continue;
    const t = along - Math.sqrt(rr - perp2);
    if (t >= 0 && (!best || t < best.dist)) {
      best = { kind: 'ball', gx: ox + dx * t, gy: oy + dy * t, dist: t, ballId: b.id, bx: b.pos[0], by: b.pos[1] };
    }
  }
  // rail: persegi area main yang diperkecil R
  const hl = TABLE_LENGTH / 2 - R;
  const hw = TABLE_WIDTH / 2 - R;
  let tr = Infinity;
  if (dx > 1e-9) tr = Math.min(tr, (hl - ox) / dx);
  if (dx < -1e-9) tr = Math.min(tr, (-hl - ox) / dx);
  if (dy > 1e-9) tr = Math.min(tr, (hw - oy) / dy);
  if (dy < -1e-9) tr = Math.min(tr, (-hw - oy) / dy);
  if (Number.isFinite(tr) && tr >= 0 && (!best || tr < best.dist)) {
    best = { kind: 'rail', gx: ox + dx * tr, gy: oy + dy * tr, dist: tr, ballId: -1, bx: 0, by: 0 };
  }
  return best;
}

/** Garis bidik + ghost ball di atas kain. */
export class AimGuide {
  readonly group = new THREE.Group();
  private line: THREE.Mesh;
  private ghost: THREE.Mesh;
  private objLine: THREE.Mesh;
  private cueLine: THREE.Mesh;
  mode: GuideMode = 'short';

  constructor() {
    const mat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, toneMapped: false });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.line = new THREE.Mesh(plane, mat(0.5));
    this.objLine = new THREE.Mesh(plane, mat(0.42));
    this.cueLine = new THREE.Mesh(plane, mat(0.25));
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 48).rotateX(-Math.PI / 2), mat(0.6));
    this.group.add(this.line, this.objLine, this.cueLine, this.ghost);
    this.group.renderOrder = 5;
    this.group.visible = false;
  }

  private place(m: THREE.Mesh, x: number, y: number, ang: number, len: number, width: number): void {
    m.position.set(x, 0.0016, -y);
    m.rotation.set(0, ang, 0);
    m.scale.set(Math.max(1e-4, len), 1, width);
  }

  update(table: TableState, dir: number, visible: boolean): AimHit | null {
    const hit = firstAimHit(table, dir);
    const cue = table.balls.find((b) => b.id === 0);
    this.group.visible = visible && this.mode !== 'off' && !!hit && !!cue;
    if (!hit || !cue || !this.group.visible) return hit;
    const start = R * 1.25;
    this.place(this.line, cue.pos[0] + Math.cos(dir) * start, cue.pos[1] + Math.sin(dir) * start, dir, Math.max(0, hit.dist - start - (hit.kind === 'ball' ? R : 0)), 0.0032);
    this.ghost.position.set(hit.gx, 0.0018, -hit.gy);
    this.ghost.visible = hit.kind === 'ball';
    const full = this.mode === 'on' && hit.kind === 'ball';
    this.objLine.visible = full;
    this.cueLine.visible = full;
    if (full) {
      const oa = Math.atan2(hit.by - hit.gy, hit.bx - hit.gx);
      this.place(this.objLine, hit.bx + Math.cos(oa) * R, hit.by + Math.sin(oa) * R, oa, 0.38, 0.0032);
      // garis singgung (arah cue ball untuk stun): tegak lurus garis pusat, ke sisi arah datang
      let ta = oa + Math.PI / 2;
      if (Math.cos(ta - dir) < 0) ta -= Math.PI;
      const cut = Math.abs(Math.sin(oa - dir));
      this.place(this.cueLine, hit.gx + Math.cos(ta) * R, hit.gy + Math.sin(ta) * R, ta, 0.3 * cut, 0.0032);
    }
    return hit;
  }
}
