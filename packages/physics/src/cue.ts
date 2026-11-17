import type { ShotParams } from '@billiards/shared';
import type { Body } from './ball';
import { DEFAULT_CUE_ID, cuePowerFactor, cueSpec, cueSpinFactor, squirtMaxDeg, type PhysicsParams } from './constants';
import { dcos, dsin } from './dmath';

/** Parameter fisik efektif satu stik. Stik default ('local') memakai P (agar bisa disetel di panel debug). */
export interface CueParams {
  M: number;
  eTip: number;
  miscueLimit: number;
  /** rad pada offset = miscueLimit */
  squirtMax: number;
  /** restitusi slate untuk komponen ke bawah */
  eSlate: number;
  /** pengali kecepatan ayunan (rating POWER) */
  power: number;
  /** pengali spin yang ditransfer (rating SPIN) */
  spin: number;
}

export function cueParams(id: string | undefined, P: PhysicsParams): CueParams {
  const c = cueSpec(id);
  if (c.id === DEFAULT_CUE_ID) {
    return {
      M: P.cueMass,
      eTip: P.tipRestitution,
      miscueLimit: P.miscueLimit,
      squirtMax: P.squirtMax,
      eSlate: P.eJump,
      power: P.cuePower,
      spin: P.cueSpin,
    };
  }
  return {
    M: c.mass,
    eTip: c.tipRestitution,
    miscueLimit: c.miscueLimit,
    squirtMax: (squirtMaxDeg(c.deflection) * Math.PI) / 180,
    eSlate: c.slateRestitution ?? P.eJump,
    power: cuePowerFactor(c.power),
    spin: cueSpinFactor(c.spin),
  };
}

/** Sudut squirt (rad, CCW dari atas) untuk offset tip — english kanan → bola menyimpang ke kiri.
 *  0 bila miscue. Dipakai juga oleh garis bidik agar prediksi sama dengan hasil pukulan. */
export function squirtAngle(tipX: number, tipY: number, P: PhysicsParams, cue?: string): number {
  const C = cueParams(cue, P);
  if (tipX === 0 || Math.sqrt(tipX * tipX + tipY * tipY) > C.miscueLimit + 1e-9) return 0;
  return C.squirtMax * (tipX / C.miscueLimit);
}

/**
 * Kecepatan stik minimum (m/s) agar cue ball terangkat dari slate (vz ≥ hopThreshold) dengan stik `cue`.
 * Kebalikan dari rumus impuls di applyCue: vz = F·sinθ·eSlate (F memuat pengali POWER). Infinity bila elevasi ≤ 0.
 */
export function jumpLiftSpeed(elevation: number, tipX: number, tipY: number, P: PhysicsParams, cue = 'jump'): number {
  const s = Math.sin(elevation);
  if (s <= 1e-6) return Infinity;
  const C = cueParams(cue, P);
  const denom = 1 + P.m / C.M + 2.5 * (tipX * tipX + tipY * tipY);
  return (P.hopThreshold * denom) / ((1 + C.eTip) * C.power * s * C.eSlate);
}

/**
 * Pukulan stik → kecepatan + spin awal cue ball.
 * Impuls F sepanjang arah stik d; restitusi tip e di titik kontak:
 *   F = (1+e) V m / (1 + m/M + 5(a²+b²)/(2R²)),  V = kecepatan ayunan × pengali POWER stik
 * Spin hasil impuls dikalikan pengali SPIN stik.
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
  const C = cueParams(shot.cue, P);
  const off = Math.sqrt(a * a + bb * bb);
  const miscue = off > C.miscueLimit + 1e-9;
  let V = shot.speed * C.power;
  let dir = shot.dir;
  if (miscue) {
    // tip tergelincir: sebagian kecil energi, arah melenceng (deterministik dari parameter)
    const h = dsin(shot.dir * 12.9898 + shot.speed * 78.233 + a * 37.719 + bb * 11.13) * 43758.5453;
    const frac = h - Math.floor(h);
    V *= 0.25 + 0.15 * frac;
    dir += (a >= 0 ? 1 : -1) * (0.12 + 0.2 * frac);
    const s = (0.3 * C.miscueLimit) / off;
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
  const F = ((1 + C.eTip) * V) / (1 + P.m / C.M + 2.5 * (a * a + bb * bb)); // per satuan massa
  let vx = F * dx;
  let vy = F * dy;
  let vz = F * dz;
  const k = (5 / (2 * R * R)) * C.spin;
  b.wx = k * F * (py * dz - pz * dy);
  b.wy = k * F * (pz * dx - px * dz);
  b.wz = k * F * (px * dy - py * dx);
  // squirt: english kanan → bola menyimpang ke kiri (CCW dilihat dari atas)
  if (!miscue && a !== 0) {
    const sq = squirtAngle(a, bb, P, shot.cue);
    const cs = dcos(sq);
    const sn = dsin(sq);
    const nvx = vx * cs - vy * sn;
    const nvy = vx * sn + vy * cs;
    vx = nvx;
    vy = nvy;
  }
  // komponen ke bawah: slate memantulkan (jump) bila cukup besar
  if (vz < 0) {
    vz = -vz * C.eSlate;
    if (vz < P.hopThreshold) vz = 0;
  }
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  return { miscue, speed: Math.sqrt(vx * vx + vy * vy + vz * vz) };
}
