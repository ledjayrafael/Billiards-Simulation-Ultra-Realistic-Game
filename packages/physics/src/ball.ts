import type { BallMotion, BallState, Quat } from '@billiards/shared';

export const STATIONARY = 0;
export const SPINNING = 1;
export const ROLLING = 2;
export const SLIDING = 3;
export const AIRBORNE = 4;
export const POCKETED = 5;
export const OFF_TABLE = 6;

const NAMES: BallMotion[] = [
  'stationary',
  'spinning',
  'rolling',
  'sliding',
  'airborne',
  'pocketed',
  'off-table',
];

/** State bola internal (mutable, tanpa alokasi di loop). */
export interface Body {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  q: Quat;
  state: number;
  pocket: number;
  /** percepatan segmen saat ini */
  ax: number;
  ay: number;
  az: number;
  /** arah slip satuan (hanya SLIDING) */
  ux: number;
  uy: number;
}

export function toBody(b: BallState): Body {
  const st = NAMES.indexOf(b.motion);
  return {
    id: b.id,
    x: b.pos[0],
    y: b.pos[1],
    z: b.pos[2],
    vx: b.vel[0],
    vy: b.vel[1],
    vz: b.vel[2],
    wx: b.angVel[0],
    wy: b.angVel[1],
    wz: b.angVel[2],
    q: [b.quat[0], b.quat[1], b.quat[2], b.quat[3]],
    state: st < 0 ? STATIONARY : st,
    pocket: b.pocket ?? -1,
    ax: 0,
    ay: 0,
    az: 0,
    ux: 0,
    uy: 0,
  };
}

export function fromBody(b: Body): BallState {
  const s: BallState = {
    id: b.id,
    pos: [b.x, b.y, b.z],
    vel: [b.vx, b.vy, b.vz],
    angVel: [b.wx, b.wy, b.wz],
    quat: [b.q[0], b.q[1], b.q[2], b.q[3]],
    motion: NAMES[b.state],
  };
  if (b.state === POCKETED) s.pocket = b.pocket;
  return s;
}

export function makeBall(id: number, x: number, y: number, R: number): BallState {
  return {
    id,
    pos: [x, y, R],
    vel: [0, 0, 0],
    angVel: [0, 0, 0],
    quat: [0, 0, 0, 1],
    motion: 'stationary',
  };
}

export const isActive = (s: number): boolean => s >= SPINNING && s <= AIRBORNE;
export const isTranslating = (s: number): boolean => s >= ROLLING && s <= AIRBORNE;
export const onTableState = (s: number): boolean => s <= AIRBORNE;
