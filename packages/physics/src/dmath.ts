/**
 * Fungsi transenden deterministik: hanya memakai + − × ÷ dan sqrt (IEEE-754 eksak),
 * sehingga hasil identik bit-per-bit di semua mesin JS (browser ↔ Node).
 * Math.sin/cos/exp bawaan tidak dijamin identik antar-implementasi.
 */

const TWO_PI = 6.283185307179586;

/** sin & cos sekaligus. Ditulis ke out[0], out[1]. */
export function dsincos(x: number, out: [number, number]): void {
  // reduksi ke [−π, π]
  x -= TWO_PI * Math.round(x / TWO_PI);
  // perkecil argumen: a = x / 2^k dengan |a| ≤ ~0.2
  let k = 0;
  let a = x;
  while (a > 0.2 || a < -0.2) {
    a *= 0.5;
    k++;
  }
  const a2 = a * a;
  // Taylor (cukup untuk |a| ≤ 0.2: galat < 1e-18)
  let s =
    a *
    (1 -
      (a2 / 6) *
        (1 - (a2 / 20) * (1 - (a2 / 42) * (1 - (a2 / 72) * (1 - (a2 / 110) * (1 - a2 / 156))))));
  let c =
    1 -
    (a2 / 2) *
      (1 - (a2 / 12) * (1 - (a2 / 30) * (1 - (a2 / 56) * (1 - (a2 / 90) * (1 - a2 / 132)))));
  // sudut ganda k kali
  for (let i = 0; i < k; i++) {
    const ns = 2 * s * c;
    c = c * c - s * s;
    s = ns;
  }
  out[0] = s;
  out[1] = c;
}

const tmp: [number, number] = [0, 0];
export function dsin(x: number): number {
  dsincos(x, tmp);
  return tmp[0];
}
export function dcos(x: number): number {
  dsincos(x, tmp);
  return tmp[1];
}
export function dtan(x: number): number {
  dsincos(x, tmp);
  return tmp[0] / tmp[1];
}

/** exp(x) deterministik. */
export function dexp(x: number): number {
  if (x < -700) return 0;
  let k = 0;
  let a = x;
  while (a > 0.25 || a < -0.25) {
    a *= 0.5;
    k++;
  }
  let r =
    1 +
    a *
      (1 +
        (a / 2) *
          (1 +
            (a / 3) *
              (1 + (a / 4) * (1 + (a / 5) * (1 + (a / 6) * (1 + (a / 7) * (1 + (a / 8) * (1 + a / 9))))))));
  for (let i = 0; i < k; i++) r *= r;
  return r;
}
