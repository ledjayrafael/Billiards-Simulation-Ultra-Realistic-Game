import { AIRBORNE, type Body } from '../ball';
import type { PhysicsParams } from '../constants';

/**
 * Tumbukan bola–cushion (model impuls gaya Han 2005): kontak di tinggi nose (di atas ekuator),
 * restitusi bergantung kecepatan, gesekan Coulomb (stick/slip) → english mengubah sudut pantul.
 * (nx, ny) = normal horizontal satuan dari bola menuju cushion. Mengembalikan kecepatan normal datang.
 */
export function collideCushion(b: Body, nx: number, ny: number, P: PhysicsParams): number {
  const vnH = b.vx * nx + b.vy * ny;
  if (vnH <= 0) return 0;
  const R = P.R;
  const sinT = Math.min(0.9, Math.max(0, (P.noseHeight - R) / R));
  const cosT = Math.sqrt(1 - sinT * sinT);
  const cx = nx * cosT;
  const cy = ny * cosT;
  const cz = sinT;
  const airborne = b.state === AIRBORNE;
  const vn = b.vx * cx + b.vy * cy + (airborne ? b.vz * cz : 0);
  if (vn <= 0) return 0;
  const e = Math.max(P.eCushionMin, Math.min(P.eCushion, P.eCushion - P.eCushionSpeedLoss * vnH));
  const pn = (1 + e) * vn;
  // kecepatan titik kontak: v + ω × (R ĉ)
  const kx = b.vx + R * (b.wy * cz - b.wz * cy);
  const ky = b.vy + R * (b.wz * cx - b.wx * cz);
  const kz = (airborne ? b.vz : 0) + R * (b.wx * cy - b.wy * cx);
  const kn = kx * cx + ky * cy + kz * cz;
  let tx = kx - kn * cx;
  let ty = ky - kn * cy;
  let tz = kz - kn * cz;
  const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
  let jt = 0;
  if (slip > 1e-12) {
    tx /= slip;
    ty /= slip;
    tz /= slip;
    jt = Math.min(P.muCushion * pn, (2 / 7) * slip);
  }
  const dx = -pn * cx - jt * tx;
  const dy = -pn * cy - jt * ty;
  const dz = -pn * cz - jt * tz;
  b.vx += dx;
  b.vy += dy;
  let vz = (airborne ? b.vz : 0) + dz;
  const k = 5 / (2 * R);
  b.wx += k * (cy * dz - cz * dy);
  b.wy += k * (cz * dx - cx * dz);
  b.wz += k * (cx * dy - cy * dx);
  // pastikan menjauh dari cushion
  const out = b.vx * nx + b.vy * ny;
  if (out > -1e-3) {
    b.vx -= (out + 1e-3) * nx;
    b.vy -= (out + 1e-3) * ny;
  }
  // komponen vertikal: terdorong ke slate → memantul sedikit (hop) bila cukup keras
  if (!airborne) {
    if (vz < 0) vz = -vz * P.eJump;
    b.vz = vz >= P.hopThreshold ? vz : 0;
  } else {
    b.vz = vz;
  }
  return vnH;
}
