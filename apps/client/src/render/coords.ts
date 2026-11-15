import * as THREE from 'three';

/** Fisika (x panjang, y lebar, z atas) → three.js (x, y atas, z = −y fisika). */
export function toThree(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, z, -y);
}
export function quatToThree(
  qx: number,
  qy: number,
  qz: number,
  qw: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  return out.set(qx, qz, -qy, qw);
}
