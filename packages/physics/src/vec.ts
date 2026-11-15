import type { Quat } from '@billiards/shared';
import { dsincos } from './dmath';

const sc: [number, number] = [0, 0];

/** Kalikan quaternion q dengan rotasi dunia (wx,wy,wz)*dt: q' = dq ⊗ q. In-place pada array out. */
export function rotateQuat(q: Quat, wx: number, wy: number, wz: number, dt: number): void {
  const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const ang = w * dt;
  if (ang < 1e-12) return;
  dsincos(ang / 2, sc);
  const s = sc[0] / w;
  const dx = wx * s;
  const dy = wy * s;
  const dz = wz * s;
  const dw = sc[1];
  const [qx, qy, qz, qw] = q;
  let x = dw * qx + dx * qw + dy * qz - dz * qy;
  let y = dw * qy - dx * qz + dy * qw + dz * qx;
  let z = dw * qz + dx * qy - dy * qx + dz * qw;
  let ww = dw * qw - dx * qx - dy * qy - dz * qz;
  const n = Math.sqrt(x * x + y * y + z * z + ww * ww);
  x /= n;
  y /= n;
  z /= n;
  ww /= n;
  q[0] = x;
  q[1] = y;
  q[2] = z;
  q[3] = ww;
}

export const hypot2 = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const hypot3 = (x: number, y: number, z: number): number =>
  Math.sqrt(x * x + y * y + z * z);
