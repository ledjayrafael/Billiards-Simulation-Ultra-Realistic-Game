import {
  AIRBORNE,
  ROLLING,
  SLIDING,
  SPINNING,
  STATIONARY,
  type Body,
  POCKETED,
  OFF_TABLE,
} from './ball';
import type { PhysicsParams } from './constants';
import { rotateQuat } from './vec';

const V_EPS = 1e-7;
const U_EPS = 1e-7;
const W_EPS = 1e-6;

/** Tentukan motion state + percepatan segmen dari v, ω saat ini. */
export function classify(b: Body, P: PhysicsParams): void {
  if (b.state === POCKETED || b.state === OFF_TABLE) return;
  b.ax = b.ay = b.az = 0;
  if (b.z > P.R + 1e-9 || b.vz > 0) {
    b.state = AIRBORNE;
    b.az = -P.g;
    return;
  }
  b.z = P.R;
  b.vz = 0;
  const ux = b.vx - P.R * b.wy;
  const uy = b.vy + P.R * b.wx;
  const u = Math.sqrt(ux * ux + uy * uy);
  const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (u > U_EPS) {
    b.state = SLIDING;
    b.ux = ux / u;
    b.uy = uy / u;
    b.ax = -P.muSlide * P.g * b.ux;
    b.ay = -P.muSlide * P.g * b.uy;
  } else if (v > V_EPS) {
    b.state = ROLLING;
    b.wx = -b.vy / P.R;
    b.wy = b.vx / P.R;
    b.ax = (-P.muRoll * P.g * b.vx) / v;
    b.ay = (-P.muRoll * P.g * b.vy) / v;
  } else {
    b.vx = b.vy = 0;
    b.wx = b.wy = 0;
    if (Math.abs(b.wz) > W_EPS) b.state = SPINNING;
    else {
      b.wz = 0;
      b.state = STATIONARY;
    }
  }
}

/** Waktu sampai transisi motion state berikutnya. */
export function nextTransition(b: Body, P: PhysicsParams): number {
  switch (b.state) {
    case SLIDING: {
      const ux = b.vx - P.R * b.wy;
      const uy = b.vy + P.R * b.wx;
      return (2 * Math.sqrt(ux * ux + uy * uy)) / (7 * P.muSlide * P.g);
    }
    case ROLLING:
      return Math.sqrt(b.vx * b.vx + b.vy * b.vy) / (P.muRoll * P.g);
    case SPINNING:
      return Math.abs(b.wz) / spinDecel(P);
    case AIRBORNE: {
      const h = b.z - P.R;
      return (b.vz + Math.sqrt(Math.max(0, b.vz * b.vz + 2 * P.g * h))) / P.g;
    }
    default:
      return Infinity;
  }
}

export const spinDecel = (P: PhysicsParams): number => (5 * P.muSpin * P.g) / (2 * P.R);

/** Majukan bola secara analitik sejauh dt di dalam segmen saat ini. */
export function advance(b: Body, dt: number, P: PhysicsParams): void {
  if (dt <= 0) return;
  const s = b.state;
  if (s < SPINNING || s > AIRBORNE) return;
  const w0x = b.wx;
  const w0y = b.wy;
  const w0z = b.wz;
  if (s === SLIDING || s === ROLLING || s === AIRBORNE) {
    b.x += b.vx * dt + 0.5 * b.ax * dt * dt;
    b.y += b.vy * dt + 0.5 * b.ay * dt * dt;
    b.vx += b.ax * dt;
    b.vy += b.ay * dt;
    if (s === AIRBORNE) {
      b.z += b.vz * dt + 0.5 * b.az * dt * dt;
      b.vz += b.az * dt;
    } else if (s === SLIDING) {
      const k = ((5 * P.muSlide * P.g) / (2 * P.R)) * dt;
      b.wx += -b.uy * k;
      b.wy += b.ux * k;
    } else {
      b.wx = -b.vy / P.R;
      b.wy = b.vx / P.R;
    }
  }
  if (s !== AIRBORNE && b.wz !== 0) {
    const d = spinDecel(P) * dt;
    b.wz = b.wz > 0 ? Math.max(0, b.wz - d) : Math.min(0, b.wz + d);
  }
  rotateQuat(b.q, 0.5 * (w0x + b.wx), 0.5 * (w0y + b.wy), 0.5 * (w0z + b.wz), dt);
}

/** Selesaikan transisi (akhir sliding / rolling / spinning). Landing AIRBORNE ditangani simulate. */
export function resolveTransition(b: Body, P: PhysicsParams): void {
  if (b.state === SLIDING) {
    // slip habis → kunci ke rolling
    b.wx = -b.vy / P.R;
    b.wy = b.vx / P.R;
  } else if (b.state === ROLLING) {
    b.vx = b.vy = 0;
    b.wx = b.wy = 0;
  } else if (b.state === SPINNING) {
    b.wz = 0;
  }
  classify(b, P);
}
