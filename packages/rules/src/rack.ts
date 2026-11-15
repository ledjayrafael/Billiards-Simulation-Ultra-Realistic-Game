import { BALL_RADIUS, FOOT_SPOT_X, HEAD_STRING_X, RACK_GAP, makeBall } from '@billiards/physics';
import type { TableState } from '@billiards/shared';

/** PRNG deterministik. Mengembalikan [nilai 0..1, state berikutnya]. */
export function mulberry32(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Posisi default cue ball untuk break (di belakang head string). */
export const BREAK_CUE_POS: [number, number] = [HEAD_STRING_X - 0.12, 0];

/**
 * Rack 9-ball: belah ketupat 1-2-3-2-1, bola 1 di apex (foot spot), 9 di tengah, sisanya acak.
 * Mengembalikan state meja + seed berikutnya.
 */
export function rackNineBall(seed: number): { table: TableState; seed: number } {
  const R = BALL_RADIUS;
  const d = 2 * R + RACK_GAP;
  const rowDx = (d * Math.sqrt(3)) / 2;
  const rows = [1, 2, 3, 2, 1];
  const slots: [number, number][] = [];
  rows.forEach((count, r) => {
    for (let k = 0; k < count; k++) {
      slots.push([FOOT_SPOT_X + r * rowDx, (k - (count - 1) / 2) * d]);
    }
  });
  // slot 0 = apex (bola 1), slot 4 = tengah (bola 9)
  const others = [2, 3, 4, 5, 6, 7, 8];
  let s = seed;
  for (let i = others.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = mulberry32(s);
    const j = Math.floor(r * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const ids: number[] = [];
  let oi = 0;
  for (let i = 0; i < slots.length; i++) ids.push(i === 0 ? 1 : i === 4 ? 9 : others[oi++]);
  const balls = [makeBall(0, BREAK_CUE_POS[0], BREAK_CUE_POS[1], R)];
  slots.forEach(([x, y], i) => balls.push(makeBall(ids[i], x, y, R)));
  balls.sort((a, b) => a.id - b.id);
  return { table: { balls }, seed: s };
}
