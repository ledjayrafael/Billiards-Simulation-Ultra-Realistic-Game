import type {
  BallTrack,
  ShotParams,
  ShotResult,
  SimEvent,
  SimEventType,
  TableState,
} from '@billiards/shared';
import {
  AIRBORNE,
  OFF_TABLE,
  POCKETED,
  SLIDING,
  STATIONARY,
  fromBody,
  isActive,
  isTranslating,
  toBody,
  type Body,
} from './ball';
import { makeContact, solveContacts, type Contact } from './collide/ballBall';
import { collideCushion } from './collide/cushion';
import { DEFAULT_PARAMS, type PhysicsParams } from './constants';
import { applyCue } from './cue';
import { advance, classify, nextTransition, resolveTransition } from './motion';
import { firstDownCrossing } from './poly';
import { buildTable, type TableGeometry } from './table';

export interface SimOptions {
  params?: Partial<PhysicsParams>;
  /** Frekuensi sampling keyframe (Hz). */
  sampleRate?: number;
  maxTime?: number;
  maxEvents?: number;
  /** false → tidak merekam frames (lebih cepat; untuk prediksi/garis bidik). */
  recordFrames?: boolean;
}

/** Dua bola dianggap bersentuhan serentak bila celahnya ≤ 1 µm. */
const CONTACT_TOL = 1e-6;
const K_TRANS = 0;
const K_BALL = 1;
const K_SEG = 2;
const K_ARC = 3;
const K_POCKET = 4;

let geoCache: { key: string; geo: TableGeometry } | null = null;
export function getGeometry(P: PhysicsParams): TableGeometry {
  const key = [
    P.L,
    P.W,
    P.cushionWidth,
    P.cornerMouth,
    P.sideMouth,
    P.cornerJawAngle,
    P.sideJawAngle,
    P.cornerShelf,
    P.sideShelf,
    P.cornerPocketRadius,
    P.sidePocketRadius,
    P.jawTipRadius,
  ].join(',');
  if (!geoCache || geoCache.key !== key) geoCache = { key, geo: buildTable(P) };
  return geoCache.geo;
}

/**
 * Simulasi event-based satu pukulan sampai semua bola diam.
 * Deterministik: tanpa Math.random / Date; urutan iterasi berdasarkan id.
 * shot = null → hanya evolusi state awal (bola boleh punya kecepatan awal).
 */
export function simulate(
  table: TableState,
  shot: ShotParams | null,
  opts: SimOptions = {},
): ShotResult {
  const P: PhysicsParams = opts.params ? { ...DEFAULT_PARAMS, ...opts.params } : DEFAULT_PARAMS;
  const geo = getGeometry(P);
  const sampleDt = 1 / (opts.sampleRate ?? 120);
  const maxTime = opts.maxTime ?? 60;
  const maxEvents = opts.maxEvents ?? 20000;
  const record = opts.recordFrames ?? true;
  const R = P.R;
  const hl = P.L / 2;
  const hw = P.W / 2;

  const bodies: Body[] = table.balls.map(toBody).sort((a, b) => a.id - b.id);
  const n = bodies.length;
  const tracks: BallTrack[] = bodies.map((b) => ({ id: b.id, t: [], p: [], q: [] }));
  const events: SimEvent[] = [];
  let T = 0;
  let endTime = 0;

  const key = (i: number, t: number): void => {
    if (!record) return;
    const tr = tracks[i];
    const b = bodies[i];
    const len = tr.t.length;
    if (len > 0 && tr.t[len - 1] >= t) {
      if (tr.t[len - 1] === t) {
        // timpa keyframe dengan waktu sama (state setelah event)
        const o = (len - 1) * 3;
        tr.p[o] = b.x;
        tr.p[o + 1] = b.y;
        tr.p[o + 2] = b.z;
      }
      return;
    }
    tr.t.push(t);
    tr.p.push(b.x, b.y, b.z);
    tr.q.push(b.q[0], b.q[1], b.q[2], b.q[3]);
  };
  const emit = (type: SimEventType, ids: number[], speed: number, b: Body, index?: number): void => {
    const e: SimEvent = { t: T, type, ids, speed, pos: [b.x, b.y, b.z] };
    if (index !== undefined) e.index = index;
    events.push(e);
  };

  for (let i = 0; i < n; i++) key(i, 0);

  if (shot) {
    const ci = bodies.findIndex((b) => b.id === 0);
    if (ci >= 0 && bodies[ci].state <= AIRBORNE) {
      const res = applyCue(bodies[ci], shot, P);
      emit(res.miscue ? 'miscue' : 'cue', [0], shot.speed, bodies[ci]);
    }
  }
  for (const b of bodies) classify(b, P);

  const pocketBall = (i: number, pi: number): void => {
    const b = bodies[i];
    const pk = geo.pockets[pi];
    emit('pocket', [b.id], Math.sqrt(b.vx * b.vx + b.vy * b.vy), b, pi);
    key(i, T);
    // ekor visual: bola jatuh ke dalam kantong
    const x0 = b.x;
    const y0 = b.y;
    const z0 = b.z;
    const steps = 6;
    const dur = 0.3;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      b.x = x0 + (pk.cx - x0) * Math.min(1, f * 1.6);
      b.y = y0 + (pk.cy - y0) * Math.min(1, f * 1.6);
      b.z = z0 - 0.11 * f * f;
      key(i, T + dur * f);
    }
    endTime = Math.max(endTime, T + dur);
    b.vx = b.vy = b.vz = 0;
    b.wx = b.wy = b.wz = 0;
    b.ax = b.ay = b.az = 0;
    b.state = POCKETED;
    b.pocket = pi;
  };

  const inPocket = (b: Body): number => {
    for (let p = 0; p < geo.pockets.length; p++) {
      const pk = geo.pockets[p];
      const dx = b.x - pk.cx;
      const dy = b.y - pk.cy;
      if (dx * dx + dy * dy <= pk.r * pk.r) return p;
    }
    return -1;
  };

  const land = (i: number): void => {
    const b = bodies[i];
    b.z = R;
    const p = inPocket(b);
    if (p >= 0) {
      pocketBall(i, p);
      return;
    }
    if (Math.abs(b.x) > hl || Math.abs(b.y) > hw) {
      emit('off-table', [b.id], Math.abs(b.vz), b);
      key(i, T);
      // ekor visual: lanjut balistik sebentar
      const dur = 0.35;
      for (let s = 1; s <= 5; s++) {
        const t = (dur * s) / 5;
        b.x += b.vx * (dur / 5);
        b.y += b.vy * (dur / 5);
        b.z = R + b.vz * t - 0.5 * P.g * t * t;
        key(i, T + t);
      }
      endTime = Math.max(endTime, T + dur);
      b.vx = b.vy = b.vz = 0;
      b.wx = b.wy = b.wz = 0;
      b.state = OFF_TABLE;
      return;
    }
    const vIn = -b.vz;
    let vOut = vIn * P.eSlate;
    if (vOut < P.hopThreshold) vOut = 0;
    // gesekan slate saat mendarat
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const u = Math.sqrt(ux * ux + uy * uy);
    if (u > 1e-9) {
      const j = Math.min(P.muSlide * (vIn + vOut), (2 / 7) * u);
      const jx = (-j * ux) / u;
      const jy = (-j * uy) / u;
      b.vx += jx;
      b.vy += jy;
      // Δω = (−R ẑ × J) / I → (5/(2R)) (jy, −jx)
      const k = 5 / (2 * R);
      b.wx += k * jy;
      b.wy -= k * jx;
    }
    b.vz = vOut;
    if (vIn > 0.2) emit('slate', [b.id], vIn, b);
    b.state = SLIDING; // bukan AIRBORNE lagi; classify menentukan ulang
    classify(b, P);
    key(i, T);
  };

  let nextSample = 1;
  let nEvents = 0;
  let truncated = false;

  while (true) {
    // ── cari event terdekat ──
    let bestDt = Infinity;
    let bestKind = -1;
    let bi = -1;
    let bj = -1;
    let anyActive = false;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!isActive(b.state)) continue;
      anyActive = true;
      const dt = nextTransition(b, P);
      if (dt < bestDt) {
        bestDt = dt;
        bestKind = K_TRANS;
        bi = i;
      }
    }
    if (!anyActive) break;
    if (T >= maxTime || nEvents >= maxEvents) {
      truncated = true;
      break;
    }

    // bola–bola
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (a.state > AIRBORNE) continue;
      const ta = isTranslating(a.state);
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (b.state > AIRBORNE) continue;
        if (!ta && !isTranslating(b.state)) continue;
        const rx = b.x - a.x;
        const ry = b.y - a.y;
        const rz = b.z - a.z;
        const vx = b.vx - a.vx;
        const vy = b.vy - a.vy;
        const vz = b.vz - a.vz;
        const ax = b.ax - a.ax;
        const ay = b.ay - a.ay;
        const az = b.az - a.az;
        const c0 = rx * rx + ry * ry + rz * rz - 4 * R * R;
        // tolak cepat: jarak tempuh relatif maksimum < celah
        const dist = Math.sqrt(c0 + 4 * R * R);
        const vrel = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const arel = Math.sqrt(ax * ax + ay * ay + az * az);
        if (vrel * bestDt + 0.5 * arel * bestDt * bestDt < dist - 2 * R) continue;
        const dt = firstDownCrossing(
          c0,
          2 * (rx * vx + ry * vy + rz * vz),
          vx * vx + vy * vy + vz * vz + rx * ax + ry * ay + rz * az,
          vx * ax + vy * ay + vz * az,
          0.25 * (ax * ax + ay * ay + az * az),
          bestDt,
        );
        if (dt < bestDt) {
          bestDt = dt;
          bestKind = K_BALL;
          bi = i;
          bj = j;
        }
      }
    }

    // bola–cushion / jaw / pocket
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!isTranslating(b.state)) continue;
      const travel =
        Math.sqrt(b.vx * b.vx + b.vy * b.vy) * bestDt +
        0.5 * Math.sqrt(b.ax * b.ax + b.ay * b.ay) * bestDt * bestDt;
      if (Math.abs(b.x) + travel < hl - R - 1e-6 && Math.abs(b.y) + travel < hw - R - 1e-6) continue;
      const air = b.state === AIRBORNE;
      for (let s = 0; s < geo.segments.length; s++) {
        const sg = geo.segments[s];
        const dt = firstDownCrossing(
          (b.x - sg.ax) * sg.mx + (b.y - sg.ay) * sg.my - R,
          b.vx * sg.mx + b.vy * sg.my,
          0.5 * (b.ax * sg.mx + b.ay * sg.my),
          0,
          0,
          bestDt,
        );
        if (dt >= bestDt) continue;
        // posisi saat kontak harus di dalam rentang segmen
        const px = b.x + b.vx * dt + 0.5 * b.ax * dt * dt;
        const py = b.y + b.vy * dt + 0.5 * b.ay * dt * dt;
        const proj = (px - sg.ax) * sg.dx + (py - sg.ay) * sg.dy;
        if (proj < 0 || proj > sg.len) continue;
        if (air) {
          const pz = b.z + b.vz * dt + 0.5 * b.az * dt * dt;
          if (pz > P.cushionTopHeight + 0.5 * R) continue; // melewati atas cushion
        }
        bestDt = dt;
        bestKind = K_SEG;
        bi = i;
        bj = s;
      }
      for (let s = 0; s < geo.arcs.length; s++) {
        const ar = geo.arcs[s];
        const rx = b.x - ar.cx;
        const ry = b.y - ar.cy;
        const rr = R + ar.r;
        const dt = firstDownCrossing(
          rx * rx + ry * ry - rr * rr,
          2 * (rx * b.vx + ry * b.vy),
          b.vx * b.vx + b.vy * b.vy + rx * b.ax + ry * b.ay,
          b.vx * b.ax + b.vy * b.ay,
          0.25 * (b.ax * b.ax + b.ay * b.ay),
          bestDt,
        );
        if (dt >= bestDt) continue;
        if (air) {
          const pz = b.z + b.vz * dt + 0.5 * b.az * dt * dt;
          if (pz > P.cushionTopHeight + 0.5 * R) continue;
        }
        bestDt = dt;
        bestKind = K_ARC;
        bi = i;
        bj = s;
      }
      if (!air) {
        for (let s = 0; s < geo.pockets.length; s++) {
          const pk = geo.pockets[s];
          const rx = b.x - pk.cx;
          const ry = b.y - pk.cy;
          const c0 = rx * rx + ry * ry - pk.r * pk.r;
          const dt =
            c0 <= 0
              ? 0
              : firstDownCrossing(
                  c0,
                  2 * (rx * b.vx + ry * b.vy),
                  b.vx * b.vx + b.vy * b.vy + rx * b.ax + ry * b.ay,
                  b.vx * b.ax + b.vy * b.ay,
                  0.25 * (b.ax * b.ax + b.ay * b.ay),
                  bestDt,
                );
          if (dt < bestDt || (dt === 0 && c0 <= 0)) {
            bestDt = dt;
            bestKind = K_POCKET;
            bi = i;
            bj = s;
          }
        }
      }
    }

    // ── majukan semua bola ke waktu event, sambil sampling ──
    const tEvent = T + bestDt;
    let tCur = T;
    while (nextSample * sampleDt <= tEvent) {
      const ts = nextSample * sampleDt;
      const d = ts - tCur;
      for (let i = 0; i < n; i++) {
        const b = bodies[i];
        if (!isActive(b.state)) continue;
        advance(b, d, P);
        key(i, ts);
      }
      tCur = ts;
      nextSample++;
    }
    {
      const d = tEvent - tCur;
      if (d > 0) for (let i = 0; i < n; i++) advance(bodies[i], d, P);
    }
    T = tEvent;
    nEvents++;

    // ── selesaikan event ──
    const b = bodies[bi];
    if (bestKind === K_TRANS) {
      if (b.state === AIRBORNE) land(bi);
      else {
        resolveTransition(b, P);
        if (b.state === STATIONARY) key(bi, T);
      }
    } else if (bestKind === K_BALL) {
      // kumpulkan semua kontak serentak yang terhubung dengan pasangan utama
      const group: Contact[] = [];
      const inGroup = new Uint8Array(n);
      const first = makeContact(b, bodies[bj], P, Infinity);
      if (first) {
        group.push(first);
        inGroup[bi] = inGroup[bj] = 1;
        const used = new Set<number>([bi * n + bj]);
        let grew = true;
        while (grew) {
          grew = false;
          for (let i = 0; i < n; i++) {
            if (bodies[i].state > AIRBORNE) continue;
            for (let j = i + 1; j < n; j++) {
              if (bodies[j].state > AIRBORNE) continue;
              if (!inGroup[i] && !inGroup[j]) continue;
              if (used.has(i * n + j)) continue;
              const c = makeContact(bodies[i], bodies[j], P, CONTACT_TOL);
              if (!c) continue;
              used.add(i * n + j);
              group.push(c);
              inGroup[i] = inGroup[j] = 1;
              grew = true;
            }
          }
        }
        for (let i = 0; i < n; i++) if (inGroup[i]) key(i, T);
        solveContacts(group, P);
        for (const c of group) if (c.jn > 0) emit('ball-ball', [c.a.id, c.b.id], c.vn0, c.a);
        for (let i = 0; i < n; i++) {
          if (!inGroup[i]) continue;
          const q = bodies[i];
          if (q.state !== AIRBORNE && q.vz > 0 && q.vz < P.hopThreshold) q.vz = 0;
          classify(q, P);
        }
      }
    } else if (bestKind === K_SEG) {
      const sg = geo.segments[bj];
      // koreksi penetrasi kecil
      const dist = (b.x - sg.ax) * sg.mx + (b.y - sg.ay) * sg.my;
      if (dist < R) {
        b.x += sg.mx * (R - dist);
        b.y += sg.my * (R - dist);
      }
      key(bi, T);
      const vn = collideCushion(b, -sg.mx, -sg.my, P);
      if (vn > 0) emit(sg.jaw ? 'jaw' : 'cushion', [b.id], vn, b, sg.cushion);
      classify(b, P);
    } else if (bestKind === K_ARC) {
      const ar = geo.arcs[bj];
      let nx = ar.cx - b.x;
      let ny = ar.cy - b.y;
      const d = Math.sqrt(nx * nx + ny * ny);
      nx /= d;
      ny /= d;
      if (d < R + ar.r) {
        b.x -= nx * (R + ar.r - d);
        b.y -= ny * (R + ar.r - d);
      }
      key(bi, T);
      const vn = collideCushion(b, nx, ny, P);
      if (vn > 0) emit('jaw', [b.id], vn, b, ar.cushion);
      classify(b, P);
    } else if (bestKind === K_POCKET) {
      pocketBall(bi, bj);
    }
  }

  endTime = Math.max(endTime, T);
  for (let i = 0; i < n; i++) {
    const b = bodies[i];
    if (truncated && isActive(b.state)) {
      b.vx = b.vy = b.vz = 0;
      b.wx = b.wy = b.wz = 0;
      b.z = R;
      b.state = STATIONARY;
    }
    if (b.state <= AIRBORNE) key(i, endTime);
  }
  return {
    events,
    frames: tracks,
    finalState: { balls: bodies.map(fromBody) },
    duration: endTime,
    truncated,
  };
}
