/**
 * Pencari akar polinom (derajat ≤ 4) yang robust dan deterministik.
 * Metode: isolasi akar lewat titik kritis (akar turunan) → interval monoton → bisection.
 * Tidak memakai rumus Ferrari/Cardano (tidak stabil secara numerik).
 */

function evalPoly(c: readonly number[], t: number): number {
  let r = 0;
  for (let i = c.length - 1; i >= 0; i--) r = r * t + c[i];
  return r;
}

function bisect(c: readonly number[], lo: number, hi: number, flo: number): number {
  // f(lo) dan f(hi) berlawanan tanda (atau f(hi) = 0).
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    const fm = evalPoly(c, mid);
    if (fm === 0) return mid;
    if (fm > 0 === flo > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Akar real polinom c (c[i] koefisien t^i) di interval terbuka (lo, hi), terurut naik. */
export function realRootsInInterval(c: readonly number[], lo: number, hi: number): number[] {
  let n = c.length - 1;
  while (n > 0 && c[n] === 0) n--;
  if (n <= 0) return [];
  if (n === 1) {
    const t = -c[0] / c[1];
    return t > lo && t < hi ? [t] : [];
  }
  if (n === 2) {
    const a = c[2];
    const b = c[1];
    const cc = c[0];
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return [];
    const sq = Math.sqrt(disc);
    const q = -0.5 * (b + (b >= 0 ? sq : -sq));
    const out: number[] = [];
    const t1 = q / a;
    const t2 = q !== 0 ? cc / q : t1;
    const a1 = Math.min(t1, t2);
    const a2 = Math.max(t1, t2);
    if (a1 > lo && a1 < hi) out.push(a1);
    if (a2 > lo && a2 < hi && a2 !== a1) out.push(a2);
    return out;
  }
  const d: number[] = [];
  for (let i = 1; i <= n; i++) d.push(i * c[i]);
  const crit = realRootsInInterval(d, lo, hi);
  const pts = [lo, ...crit, hi];
  const cc = c.slice(0, n + 1);
  const out: number[] = [];
  let fa = evalPoly(cc, pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const fb = evalPoly(cc, pts[i + 1]);
    if (fa === 0) {
      if (pts[i] > lo) out.push(pts[i]);
    } else if (fb !== 0 && fa > 0 !== fb > 0) {
      out.push(bisect(cc, pts[i], pts[i + 1], fa));
    }
    fa = fb;
  }
  return out;
}

/**
 * Waktu terkecil t ∈ [0, tMax] saat p(t) = c0 + c1 t + … + c4 t⁴ turun dari > 0 ke ≤ 0.
 * Bila p(0) ≤ 0 (bersentuhan/overlap) dan sedang turun → 0. Tidak ada → Infinity.
 * Hasil selalu di sisi p ≥ 0 (tidak menembus).
 */
export function firstDownCrossing(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  tMax: number,
): number {
  if (c0 <= 0) {
    if (c1 < 0 || (c1 === 0 && (c2 < 0 || (c2 === 0 && c3 < 0)))) return 0;
  }
  const c = [c0, c1, c2, c3, c4];
  const d = [c1, 2 * c2, 3 * c3, 4 * c4];
  const crit = realRootsInInterval(d, 0, tMax);
  let a = 0;
  let fa = c0;
  for (let i = 0; i <= crit.length; i++) {
    const b = i < crit.length ? crit[i] : tMax;
    const fb = evalPoly(c, b);
    if (fa > 0 && fb <= 0) {
      // bisection, simpan sisi positif
      let lo = a;
      let hi = b;
      for (let k = 0; k < 80; k++) {
        const mid = 0.5 * (lo + hi);
        if (mid === lo || mid === hi) break;
        if (evalPoly(c, mid) > 0) lo = mid;
        else hi = mid;
      }
      return lo;
    }
    a = b;
    fa = fb;
  }
  return Infinity;
}
