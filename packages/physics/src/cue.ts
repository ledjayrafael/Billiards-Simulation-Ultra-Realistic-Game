import type { ShotParams } from '@billiards/shared';
import type { Body } from './ball';
import type { PhysicsParams } from './constants';
import { dcos, dsin } from './dmath';

/** Sudut squirt (rad, CCW dari atas) untuk offset tip — english kanan → bola menyimpang ke kiri.
 *  0 bila miscue. Dipakai juga oleh garis bidik agar prediksi sama dengan hasil pukulan. */
export function squirtAngle(tipX: number, tipY: number, P: PhysicsParams): number {
  if (tipX === 0 || Math.sqrt(tipX * tipX + tipY * tipY) > P.miscueLimit + 1e-9) return 0;
  return P.squirtMax * (tipX / P.miscueLimit);
}

/**
 * Pukulan stik → kecepatan + spin awal cue ball.
 * Impuls F sepanjang arah stik d; restitusi tip e di titik kontak:
 *   F = (1+e) V m / (1 + m/M + 5(a²+b²)/(2R²))
 * Mengembalikan { miscue, speed } (speed = kecepatan bola setelah pukulan).
 */
export function applyCue(
  b: Body,
  shot: ShotParams,
  P: PhysicsParams,
): { miscue: boolean; speed: number } {
  const R = P.R;
  let a = shot.tipX;
  let bb = shot.tipY;
  const off = Math.sqrt(a * a + bb * bb);
  const miscue = off > P.miscueLimit + 1e-9;
  let V = shot.speed;
  let dir = shot.dir;
  if (miscue) {
    // tip tergelincir: sebagian kecil energi, arah melenceng (deterministik dari parameter)
    const h = dsin(shot.dir * 12.9898 + shot.speed * 78.233 + a * 37.719 + bb * 11.13) * 43758.5453;
    const frac = h - Math.floor(h);
    V *= 0.25 + 0.15 * frac;
    dir += (a >= 0 ? 1 : -1) * (0.12 + 0.2 * frac);
    const s = (0.3 * P.miscueLimit) / off;
    a *= s;
    bb *= s;
  }
  const cosE = dcos(shot.elevation);
  const sinE = dsin(shot.elevation);
  const ct = dcos(dir);
  const st = dsin(dir);
  // arah stik (menurun bila elevasi > 0)
  const dx = cosE * ct;
  const dy = cosE * st;
  const dz = -sinE;
  // kanan & "atas" tegak lurus stik
  const rx = st;
  const ry = -ct;
  const ux = sinE * ct;
  const uy = sinE * st;
  const uz = cosE;
  const c = Math.sqrt(Math.max(0, 1 - a * a - bb * bb));
  const px = R * (a * rx + bb * ux - c * dx);
  const py = R * (a * ry + bb * uy - c * dy);
  const pz = R * (bb * uz - c * dz);
  const F =
    ((1 + P.tipRestitution) * V) / (1 + P.m / P.cueMass + 2.5 * (a * a + bb * bb)); // per satuan massa
  let vx = F * dx;
  let vy = F * dy;
  let vz = F * dz;
  const k = 5 / (2 * R * R);
  b.wx = k * F * (py * dz - pz * dy);
  b.wy = k * F * (pz * dx - px * dz);
  b.wz = k * F * (px * dy - py * dx);
  // squirt: english kanan → bola menyimpang ke kiri (CCW dilihat dari atas)
  if (!miscue && a !== 0) {
    const sq = squirtAngle(a, bb, P);
    const cs = dcos(sq);
    const sn = dsin(sq);
    const nvx = vx * cs - vy * sn;
    const nvy = vx * sn + vy * cs;
    vx = nvx;
    vy = nvy;
  }
  // komponen ke bawah: slate memantulkan (jump) bila cukup besar
  if (vz < 0) {
    vz = -vz * P.eJump;
    if (vz < P.hopThreshold) vz = 0;
  }
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  return { miscue, speed: Math.sqrt(vx * vx + vy * vy + vz * vz) };
}
