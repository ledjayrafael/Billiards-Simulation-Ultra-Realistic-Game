import type { BallState, ShotParams, ShotResult, TableState } from '@billiards/shared';
import { BALL_RADIUS, DEFAULT_PARAMS, makeBall } from '../src';

export const R = BALL_RADIUS;
export const P = DEFAULT_PARAMS;
export const DEG = Math.PI / 180;

export function table(...balls: [number, number, number][]): TableState {
  return { balls: balls.map(([id, x, y]) => makeBall(id, x, y, R)) };
}
export function shot(p: Partial<ShotParams>): ShotParams {
  return { dir: 0, speed: 2, tipX: 0, tipY: 0, elevation: 0, ...p };
}
export function ball(res: ShotResult | TableState, id: number): BallState {
  const balls = 'finalState' in res ? res.finalState.balls : res.balls;
  return balls.find((b) => b.id === id)!;
}
/** Posisi bola pada waktu t dari track (interpolasi linear). */
export function posAt(res: ShotResult, id: number, t: number): [number, number, number] {
  const tr = res.frames.find((f) => f.id === id)!;
  let i = 0;
  while (i < tr.t.length - 1 && tr.t[i + 1] < t) i++;
  const j = Math.min(i + 1, tr.t.length - 1);
  const f = tr.t[j] > tr.t[i] ? Math.min(1, Math.max(0, (t - tr.t[i]) / (tr.t[j] - tr.t[i]))) : 0;
  return [0, 1, 2].map((k) => tr.p[i * 3 + k] + (tr.p[j * 3 + k] - tr.p[i * 3 + k]) * f) as [
    number,
    number,
    number,
  ];
}
/** Arah gerak (rad) bola antara t0 dan t1. */
export function heading(res: ShotResult, id: number, t0: number, t1: number): number {
  const a = posAt(res, id, t0);
  const b = posAt(res, id, t1);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
export function kineticEnergy(s: TableState): number {
  let e = 0;
  const I = 0.4 * P.m * R * R;
  for (const b of s.balls) {
    e += 0.5 * P.m * (b.vel[0] ** 2 + b.vel[1] ** 2 + b.vel[2] ** 2);
    e += 0.5 * I * (b.angVel[0] ** 2 + b.angVel[1] ** 2 + b.angVel[2] ** 2);
  }
  return e;
}
