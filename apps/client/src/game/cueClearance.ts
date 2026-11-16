import { BALL_RADIUS as R, SPECS, TABLE_LENGTH, TABLE_WIDTH } from '@billiards/physics';

/**
 * Celah stik di atas cushion & rail.
 *
 * Saat cue ball dekat rail, poros stik harus melewati cushion/rail di belakang bola. Pada jarak
 * horizontal x di belakang pusat bola, tinggi poros stik (elevasi θ, titik pukul vertikal b·R):
 *
 *     z(x) = R + x·tanθ + b·R / cosθ
 *
 * dan sisi bawah batang = z − r(d)/cosθ, dengan r(d) radius batang pada jarak d dari tip
 * (taper sama dengan blender/scripts/build_cue.py). Batang harus berada di atas permukaan
 * cushion/rail H(x). Karena itu stik bisa makin datar hanya bila titik pukul dinaikkan (follow):
 * persis kompromi yang dipakai pemain saat bridge di atas rail.
 *
 * Bola lain di belakang/samping garis stik diperlakukan sama: jarak 3D poros stik ke pusat bola
 * harus ≥ R + r(d) + celah di sepanjang seluruh batang (termasuk saat stik ditarik mundur),
 * sehingga stik terangkat sendiri di atas bola yang menghalangi.
 */

const T = SPECS.table;
const HL = TABLE_LENGTH / 2;
const HW = TABLE_WIDTH / 2;
const CW = T.cushionWidth;
const RAIL_END = T.cushionWidth + T.railWidth;
const L = SPECS.cue.length;
const RT = SPECS.cue.tipDiameter / 2;
const R_JOINT = 0.0105;
const R_BUTT = 0.0148;
/** celah batang–rail (m): rail bridge terbuka, stik meluncur tepat di atas rail */
export const RAIL_GAP = 0.0015;
/** elevasi minimum umum (rad): butt stik selalu sedikit lebih tinggi dari tangan bridge */
export const MIN_ELEV = 0.035;
/** celah batang–bola lain (m) */
export const BALL_GAP = 0.002;
/** tarikan stik maksimum (m): batang yang mundur juga tidak boleh menembus bola */
const PULL_RANGE = 0.3;
/** batas atas elevasi yang dicari otomatis (rad) */
const MAX_AUTO_ELEV = (60 * Math.PI) / 180;

/** Radius batang pada jarak d dari ujung tip. */
export function shaftRadius(d: number): number {
  if (d <= 0.3) return RT + 0.0001 * Math.max(0, d);
  if (d <= 0.737) return RT + (R_JOINT - RT) * ((d - 0.3) / 0.437) ** 1.15;
  return Math.min(R_BUTT, R_JOINT + ((R_BUTT - R_JOINT) * (d - 0.737)) / (L - 0.737 - 0.02));
}

/** Tinggi permukaan cushion (dari nose ke belakang) lalu rail, d = jarak di belakang garis nose. */
export function railSurface(d: number): number {
  const h = T.cushionNoseHeight;
  if (d < 0.0015) return h + 0.0012 + d; // (0, h+1,2 mm) → (1,5 mm, h+2,7 mm)
  if (d < 0.007) return h + 0.0027 + ((d - 0.0015) / 0.0055) * 0.0009;
  if (d < CW) return h + 0.0036 + ((d - 0.007) / (CW - 0.007)) * (T.cushionTopHeight - h - 0.0036);
  return T.railHeight;
}

export interface Obstacle {
  /** jarak horizontal di belakang pusat bola */
  x: number;
  /** tinggi permukaan */
  h: number;
}

export interface BallObstacle {
  /** jarak horizontal di belakang pusat cue ball (searah −dir) */
  x: number;
  /** jarak lateral ke kanan garis bidik */
  y: number;
}

export interface Obstacles {
  rail: Obstacle[];
  balls: BallObstacle[];
}

/**
 * Rintangan stik: titik-titik cushion/rail di bawah garis stik dan bola lain di dekat batang.
 * `others` = posisi (x, y) bola lain yang masih di meja.
 */
export function obstaclesBehind(
  bx: number,
  by: number,
  dir: number,
  tipX: number,
  others: ReadonlyArray<readonly [number, number]> = [],
): Obstacles {
  const balls: BallObstacle[] = [];
  const ct = Math.cos(dir);
  const st = Math.sin(dir);
  for (const [px, py] of others) {
    const x = -(px - bx) * ct - (py - by) * st;
    const y = (px - bx) * st - (py - by) * ct;
    // bola jauh di depan atau jauh di samping batang tak mungkin tersentuh
    if (x < -2 * R || Math.abs(y) > 2.6 * R + R_BUTT + BALL_GAP) continue;
    balls.push({ x, y });
  }
  return { rail: railBehind(bx, by, dir, tipX), balls };
}

/**
 * Titik-titik cushion/rail di bawah garis stik (proyeksi horizontal), di belakang cue ball.
 * Kosong bila rail terlalu jauh untuk dilewati stik.
 */
function railBehind(bx: number, by: number, dir: number, tipX: number): Obstacle[] {
  const wx = -Math.cos(dir);
  const wy = -Math.sin(dir);
  // garis poros bergeser ke samping sebesar tipX·R (english)
  const ox = bx + R * tipX * Math.sin(dir);
  const oy = by - R * tipX * Math.cos(dir);
  let s = Infinity;
  if (wx > 1e-9) s = Math.min(s, (HL - ox) / wx);
  if (wx < -1e-9) s = Math.min(s, (-HL - ox) / wx);
  if (wy > 1e-9) s = Math.min(s, (HW - oy) / wy);
  if (wy < -1e-9) s = Math.min(s, (-HW - oy) / wy);
  const out: Obstacle[] = [];
  if (!Number.isFinite(s) || s > L + 0.4) return out;
  s = Math.max(0, s);
  const depth = (x: number): number => Math.max(Math.abs(ox + wx * x) - HL, Math.abs(oy + wy * x) - HW);
  // rapat di dekat nose (profil cushion berubah cepat), lalu tiap 1 cm sampai tepi luar rail
  const steps = [0, 0.0015, 0.004, 0.007, 0.012, 0.02, 0.03, 0.04, CW];
  for (const k of steps) {
    const x = s + k;
    const d = depth(x);
    if (d > RAIL_END) break;
    out.push({ x, h: railSurface(Math.max(0, d)) });
  }
  for (let x = s + CW + 0.01; ; x += 0.01) {
    const d = depth(x);
    if (d > RAIL_END || x > s + 1) break;
    out.push({ x, h: railSurface(Math.max(0, d)) });
  }
  return out;
}

/** Celah minimum (m) antara batang dan cushion/rail atau bola lain; negatif = menabrak. */
export function clearance(obs: Obstacles, tipX: number, tipY: number, elev: number): number {
  const c = Math.cos(elev);
  const tn = Math.tan(elev);
  const sn = Math.sin(elev);
  const t0 = R * Math.sqrt(Math.max(0, 1 - tipX * tipX - tipY * tipY));
  let rail = Infinity;
  for (const o of obs.rail) {
    const t = (o.x + R * tipY * sn) / c; // jarak sepanjang poros dari titik tengah penampang bola
    const r = shaftRadius(t - t0);
    const bottom = R + o.x * tn + (R * tipY - r) / c;
    rail = Math.min(rail, bottom - o.h);
  }
  // Kerangka lokal: x = mundur horizontal, y = kanan, z = atas. Poros melalui
  // P0 = (−R·b·sinθ, R·a, R + R·b·cosθ) dengan arah mundur (cosθ, 0, sinθ).
  let ball = Infinity;
  const p0x = -R * tipY * sn;
  const p0y = R * tipX;
  const p0z = R + R * tipY * c;
  for (const o of obs.balls) {
    const t = Math.min(t0 + L + PULL_RANGE, Math.max(t0, o.x * c));
    const dx = o.x - (p0x + t * c);
    const dy = o.y - p0y;
    const dz = R - (p0z + t * sn);
    const r = shaftRadius(Math.min(L, t - t0));
    ball = Math.min(ball, Math.hypot(dx, dy, dz) - R - r);
  }
  return Math.min(rail - RAIL_GAP, ball - BALL_GAP);
}

/** Titik pukul vertikal terendah (tipY) yang lolos pada elevasi `elev`; Infinity bila > `maxY`. */
export function minTipY(obs: Obstacles, tipX: number, elev: number, maxY: number): number {
  if (clearance(obs, tipX, -1, elev) >= 0) return -Infinity;
  if (clearance(obs, tipX, maxY, elev) < 0) return Infinity;
  let lo = -1;
  let hi = maxY;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (clearance(obs, tipX, m, elev) >= 0) hi = m;
    else lo = m;
  }
  return hi;
}

/** Elevasi terendah (≥ MIN_ELEV) yang lolos untuk titik pukul (tipX, tipY). */
export function minElevation(obs: Obstacles, tipX: number, tipY: number): number {
  if (clearance(obs, tipX, tipY, MIN_ELEV) >= 0) return MIN_ELEV;
  let lo = MIN_ELEV;
  let hi = MAX_AUTO_ELEV;
  if (clearance(obs, tipX, tipY, hi) < 0) return hi;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (clearance(obs, tipX, tipY, m) >= 0) hi = m;
    else lo = m;
  }
  return hi;
}

export interface Stroke {
  tipX: number;
  tipY: number;
  elevation: number;
  /** elevasi dinaikkan oleh rail atau bola lain */
  railElev: boolean;
  /** titik pukul dinaikkan oleh rail (follow paksa) */
  railFollow: boolean;
}

/**
 * Selesaikan elevasi & titik pukul yang mungkin secara fisik.
 *  - priority 'tip'  : titik pukul pemain dipertahankan, elevasi naik secukupnya.
 *  - priority 'elev' : elevasi pemain dipertahankan (mis. stik didatarkan); titik pukul naik
 *                      secukupnya (follow), hingga `autoMax`; lewat dari itu elevasi ikut naik.
 */
export function resolveStroke(
  bx: number,
  by: number,
  dir: number,
  tipX: number,
  tipY: number,
  elev: number,
  priority: 'tip' | 'elev',
  autoMax: number,
  others: ReadonlyArray<readonly [number, number]> = [],
): Stroke {
  const obs = obstaclesBehind(bx, by, dir, tipX, others);
  const e0 = Math.max(MIN_ELEV, elev);
  if (priority === 'tip') {
    const e = Math.max(e0, minElevation(obs, tipX, tipY));
    return { tipX, tipY, elevation: e, railElev: e > e0 + 1e-6, railFollow: false };
  }
  const cap = Math.max(tipY, Math.sqrt(Math.max(0, autoMax * autoMax - tipX * tipX)));
  const need = minTipY(obs, tipX, e0, cap);
  if (need <= tipY) return { tipX, tipY, elevation: e0, railElev: false, railFollow: false };
  if (Number.isFinite(need)) return { tipX, tipY: need, elevation: e0, railElev: false, railFollow: true };
  // follow maksimum pun belum cukup: naikkan elevasi seperlunya
  const e = Math.max(e0, minElevation(obs, tipX, cap));
  return { tipX, tipY: cap, elevation: e, railElev: e > e0 + 1e-6, railFollow: cap > tipY + 1e-6 };
}
