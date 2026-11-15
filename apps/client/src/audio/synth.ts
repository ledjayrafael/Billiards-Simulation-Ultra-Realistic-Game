/**
 * Sintesis suara biliar (fungsi murni → Float32Array), tanpa rekaman eksternal.
 * Model: jumlah mode teredam (resonansi bola/meja) + burst noise terfilter.
 */
export const SAMPLE_RATE = 44100;

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

interface Mode {
  f: number;
  tau: number; // detik
  a: number;
}

function addModes(out: Float32Array, at: number, modes: Mode[], gain: number, rand: () => number): void {
  const i0 = Math.floor(at * SAMPLE_RATE);
  for (const m of modes) {
    const ph = rand() * 6.283;
    const n = Math.min(out.length - i0, Math.ceil(m.tau * 7 * SAMPLE_RATE));
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const att = Math.min(1, t / 0.00015);
      out[i0 + i] += gain * m.a * att * Math.sin(6.283185 * m.f * t + ph) * Math.exp(-t / m.tau);
    }
  }
}

/** Burst noise dengan lowpass/highpass satu kutub. */
function addNoise(out: Float32Array, at: number, tau: number, gain: number, lp: number, hp: number, rand: () => number): void {
  const i0 = Math.floor(at * SAMPLE_RATE);
  const n = Math.min(out.length - i0, Math.ceil(tau * 7 * SAMPLE_RATE));
  const aL = 1 - Math.exp((-6.283185 * lp) / SAMPLE_RATE);
  const aH = 1 - Math.exp((-6.283185 * hp) / SAMPLE_RATE);
  let l = 0;
  let h = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    l += aL * (rand() * 2 - l);
    h += aH * (l - h);
    out[i0 + i] += gain * (l - h) * Math.exp(-t / tau) * Math.min(1, t / 0.0001);
  }
}

function normalize(buf: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  // fade-out pendek agar tidak ada klik di ujung
  const f = Math.min(buf.length, 220);
  for (let i = 0; i < f; i++) buf[buf.length - 1 - i] *= i / f;
  return buf;
}

const make = (sec: number): Float32Array => new Float32Array(Math.ceil(sec * SAMPLE_RATE));

/** Tumbukan bola–bola: "clack" resin fenolik yang tajam dan sangat pendek. */
export function ballClack(variant: number): Float32Array {
  const r = rng(100 + variant);
  const k = 1 + (variant - 1.5) * 0.04;
  const out = make(0.09);
  // banyak mode tak-harmonik yang rapat (2–12 kHz) dengan redaman makin cepat di frekuensi tinggi
  // → bunyi "klak" keras tanpa nada yang jelas
  const modes: Mode[] = [];
  let f = 2100 * k;
  for (let i = 0; i < 16; i++) {
    modes.push({ f, tau: 0.0032 * Math.pow(2100 / f, 0.85), a: (0.55 + (r() + 0.5) * 0.9) * Math.pow(2100 / f, 0.35) });
    f *= 1.085 + (r() + 0.5) * 0.09;
  }
  modes.push({ f: 1250 * k, tau: 0.0045, a: 0.32 }); // bobot bola
  modes.push({ f: 240, tau: 0.008, a: 0.07 }); // badan meja (halus)
  addModes(out, 0, modes, 1, r);
  addNoise(out, 0, 0.0011, 2.2, 11000, 2200, r);
  addNoise(out, 0, 0.004, 0.25, 6000, 1500, r);
  return normalize(out, 0.9);
}

/** Bola–cushion: "thud" karet yang tumpul. */
export function cushionThud(variant: number): Float32Array {
  const r = rng(200 + variant);
  const k = 1 + (variant - 1) * 0.07;
  const out = make(0.3);
  addModes(out, 0, [
    { f: 92 * k, tau: 0.042, a: 1.0 },
    { f: 183 * k, tau: 0.024, a: 0.55 },
    { f: 410 * k, tau: 0.009, a: 0.25 },
  ], 1, r);
  addNoise(out, 0, 0.011, 0.9, 950, 90, r);
  return normalize(out, 0.9);
}

/** Tip stik mengenai cue ball. hard = break. */
export function cueHit(hard: boolean): Float32Array {
  const r = rng(hard ? 301 : 300);
  const out = make(0.2);
  addModes(out, 0, [
    { f: 540, tau: 0.009, a: 0.75 },
    { f: 1180, tau: 0.006, a: 0.65 },
    { f: 2450, tau: 0.003, a: hard ? 0.7 : 0.35 },
    { f: 165, tau: 0.022, a: 0.45 },
  ], 1, r);
  addNoise(out, 0, 0.0016, hard ? 1.0 : 0.45, 7000, 700, r);
  if (hard) {
    addModes(out, 0.0004, [{ f: 3600, tau: 0.0028, a: 0.6 }, { f: 5200, tau: 0.002, a: 0.4 }], 1, r);
  }
  return normalize(out, 0.9);
}

/** Miscue: tip tergelincir. */
export function miscue(): Float32Array {
  const r = rng(400);
  const out = make(0.16);
  addNoise(out, 0, 0.03, 1, 6500, 2300, r);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] *= 0.55 + 0.45 * Math.sin(6.283 * 210 * t) * Math.sin(6.283 * 37 * t);
  }
  addModes(out, 0, [{ f: 700, tau: 0.006, a: 0.5 }], 1, r);
  return normalize(out, 0.8);
}

/** Bola jatuh ke pocket lalu menggelinding di rail pengembali. */
export function pocketDrop(variant: number): Float32Array {
  const r = rng(500 + variant);
  const out = make(2.0);
  // jatuh ke kantong
  addModes(out, 0, [{ f: 118, tau: 0.04, a: 1 }, { f: 236, tau: 0.02, a: 0.4 }], 1, r);
  addNoise(out, 0, 0.014, 0.8, 1500, 120, r);
  // memantul di dalam kantong
  const knocks = [0.085, 0.15 + variant * 0.01, 0.2 + variant * 0.012];
  knocks.forEach((t, i) => {
    addModes(out, t, [{ f: 300 + 25 * variant, tau: 0.012, a: 0.5 }, { f: 655, tau: 0.006, a: 0.25 }], 0.5 / (i + 1), r);
    addNoise(out, t, 0.009, 0.9 / (i + 1), 1800, 180, r);
  });
  // gemuruh menggelinding di rail pengembali
  const i0 = Math.floor(0.3 * SAMPLE_RATE);
  const n = Math.floor(1.25 * SAMPLE_RATE);
  let l = 0;
  let l2 = 0;
  let wob = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    l += 0.05 * (r() * 2 - l);
    l2 += 0.22 * (l - l2);
    wob += 0.0009 * (r() * 2 - wob); // fluktuasi lambat tak periodik
    const env = Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.8;
    out[i0 + i] += 2.2 * l2 * env * (0.7 + 14 * wob);
  }
  // berhenti: mengenai bola lain di ujung rail
  const clack = ballClack(variant);
  const c0 = Math.floor(1.56 * SAMPLE_RATE);
  for (let i = 0; i < clack.length && c0 + i < out.length; i++) out[c0 + i] += clack[i] * 0.32;
  return normalize(out, 0.9);
}

/** Bola mendarat di slate (setelah lompat). */
export function slateThump(): Float32Array {
  const r = rng(600);
  const out = make(0.2);
  addModes(out, 0, [{ f: 150, tau: 0.03, a: 1 }, { f: 320, tau: 0.012, a: 0.4 }, { f: 2900, tau: 0.002, a: 0.25 }], 1, r);
  addNoise(out, 0, 0.004, 0.5, 2200, 150, r);
  return normalize(out, 0.9);
}

/** Room tone pelan (loop mulus). */
export function roomTone(): Float32Array {
  const r = rng(700);
  const sec = 6;
  const n = sec * SAMPLE_RATE;
  const raw = new Float32Array(n * 2);
  let b = 0;
  let l = 0;
  for (let i = 0; i < raw.length; i++) {
    b = 0.985 * b + 0.15 * r();
    l += 0.03 * (b - l);
    const t = i / SAMPLE_RATE;
    raw[i] = l + 0.012 * Math.sin(6.283 * 100 * t) + 0.006 * Math.sin(6.283 * 200 * t);
  }
  // crossfade paruh kedua ke paruh pertama → loop tanpa sambungan
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / n;
    out[i] = raw[i] * f + raw[i + n] * (1 - f);
  }
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.5 / m;
  return out;
}
