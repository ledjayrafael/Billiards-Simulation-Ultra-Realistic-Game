import { AIRBORNE, type Body } from '../ball';
import type { PhysicsParams } from '../constants';
import { dexp } from '../dmath';

export interface Contact {
  a: Body;
  b: Body;
  nx: number;
  ny: number;
  nz: number;
  /** kecepatan normal mendekat sebelum tumbukan */
  vn0: number;
  /** impuls normal terakumulasi (per satuan massa) */
  jn: number;
}

/** Buat kontak bila a dan b bersentuhan (≤ 2R + tol) dan saling mendekat; selain itu null. */
export function makeContact(a: Body, b: Body, P: PhysicsParams, tol: number): Contact | null {
  let nx = b.x - a.x;
  let ny = b.y - a.y;
  let nz = b.z - a.z;
  const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (d === 0 || d > 2 * P.R + tol) return null;
  nx /= d;
  ny /= d;
  nz /= d;
  const vn0 = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
  if (vn0 <= 0) return null;
  return { a, b, nx, ny, nz, vn0, jn: 0 };
}

/**
 * Selesaikan sekumpulan kontak bola–bola yang terjadi serentak.
 * Impuls normal: projected Gauss–Seidel (LCP) dengan restitusi → hasil simetris untuk
 * konfigurasi simetris (rack saat break). Lalu gesekan Coulomb per kontak (throw, transfer spin);
 * μ bergantung kecepatan slip (Alciatore TP A-14).
 */
export function solveContacts(cs: Contact[], P: PhysicsParams): void {
  const e = P.eBall;
  const R = P.R;
  // koreksi overlap
  for (const c of cs) {
    const { a, b } = c;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const overlap = 2 * R - d;
    if (overlap > 0) {
      const h = 0.5 * overlap;
      a.x -= c.nx * h;
      a.y -= c.ny * h;
      b.x += c.nx * h;
      b.y += c.ny * h;
    }
  }
  const iters = cs.length === 1 ? 1 : 60;
  for (let it = 0; it < iters; it++) {
    let maxD = 0;
    for (const c of cs) {
      const { a, b } = c;
      const vn = (a.vx - b.vx) * c.nx + (a.vy - b.vy) * c.ny + (a.vz - b.vz) * c.nz;
      let dj = 0.5 * (vn + e * c.vn0);
      const nj = Math.max(0, c.jn + dj);
      dj = nj - c.jn;
      c.jn = nj;
      a.vx -= dj * c.nx;
      a.vy -= dj * c.ny;
      a.vz -= dj * c.nz;
      b.vx += dj * c.nx;
      b.vy += dj * c.ny;
      b.vz += dj * c.nz;
      if (Math.abs(dj) > maxD) maxD = Math.abs(dj);
    }
    if (maxD < 1e-12) break;
  }
  // gesekan
  const k = 5 / (2 * R);
  for (const c of cs) {
    if (c.jn <= 0) continue;
    const { a, b, nx, ny, nz } = c;
    const sx = a.wx + b.wx;
    const sy = a.wy + b.wy;
    const sz = a.wz + b.wz;
    // kecepatan relatif titik kontak: va − vb + R (ωa + ωb) × n
    const rx = a.vx - b.vx + R * (sy * nz - sz * ny);
    const ry = a.vy - b.vy + R * (sz * nx - sx * nz);
    const rz = a.vz - b.vz + R * (sx * ny - sy * nx);
    const rn = rx * nx + ry * ny + rz * nz;
    let tx = rx - rn * nx;
    let ty = ry - rn * ny;
    let tz = rz - rn * nz;
    const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (slip < 1e-12) continue;
    tx /= slip;
    ty /= slip;
    tz /= slip;
    const mu = P.ballFrictionA + P.ballFrictionB * dexp(-P.ballFrictionC * slip);
    const jt = Math.min(mu * c.jn, slip / 7);
    const dx = -jt * tx;
    const dy = -jt * ty;
    const dz = -jt * tz;
    a.vx += dx;
    a.vy += dy;
    a.vz += dz;
    b.vx -= dx;
    b.vy -= dy;
    b.vz -= dz;
    const cx = k * (ny * dz - nz * dy);
    const cy = k * (nz * dx - nx * dz);
    const cz = k * (nx * dy - ny * dx);
    a.wx += cx;
    a.wy += cy;
    a.wz += cz;
    b.wx += cx;
    b.wy += cy;
    b.wz += cz;
  }
  // bola di atas meja: slate menyerap komponen vertikal ke bawah; ke atas hanya bila ada bola airborne
  const anyAir = cs.some((c) => c.a.state === AIRBORNE || c.b.state === AIRBORNE);
  for (const c of cs) {
    for (const q of [c.a, c.b]) {
      if (q.state === AIRBORNE) continue;
      if (!anyAir || q.vz < 0) q.vz = 0;
    }
  }
}

/** Tumbukan satu pasang. Mengembalikan kecepatan normal mendekat (0 = tidak ada). */
export function collideBalls(a: Body, b: Body, P: PhysicsParams): number {
  const c = makeContact(a, b, P, Infinity);
  if (!c) return 0;
  solveContacts([c], P);
  return c.vn0;
}
