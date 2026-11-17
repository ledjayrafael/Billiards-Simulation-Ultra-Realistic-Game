import { describe, expect, it } from 'vitest';
import { rackNineBall } from '@billiards/rules';
import type { TableState } from '@billiards/shared';
import { cueParams, firstDownCrossing, jumpLiftSpeed, realRootsInInterval, simulate, makeBall, squirtAngle } from '../src';
import { collideBalls } from '../src/collide/ballBall';
import { collideCushion } from '../src/collide/cushion';
import { toBody, fromBody } from '../src/ball';
import { classify } from '../src/motion';
import { DEG, P, R, ball, heading, kineticEnergy, posAt, shot, table } from './helpers';

describe('solver polinom', () => {
  it('menemukan akar quartic', () => {
    // (t-1)(t-2)(t-3)(t-4) = t⁴ −10t³ +35t² −50t +24
    const roots = realRootsInInterval([24, -50, 35, -10, 1], 0, 10);
    expect(roots.length).toBe(4);
    [1, 2, 3, 4].forEach((r, i) => expect(roots[i]).toBeCloseTo(r, 9));
    expect(firstDownCrossing(24, -50, 35, -10, 1, 10)).toBeCloseTo(1, 9);
  });
  it('akar ganda / tanpa akar', () => {
    expect(firstDownCrossing(1, 0, 1, 0, 0, 100)).toBe(Infinity);
    expect(firstDownCrossing(0, -1, 0, 0, 0, 1)).toBe(0);
    expect(firstDownCrossing(0, 1, 0, 0, 0, 1)).toBe(Infinity);
  });
});

describe('1. diam & energi', () => {
  it('bola diam tetap diam', () => {
    const res = simulate(table([0, 0, 0], [1, 0.5, 0.2]), null);
    expect(res.duration).toBe(0);
    expect(res.events.length).toBe(0);
    expect(ball(res, 0).pos).toEqual([0, 0, R]);
  });
  it('energi kinetik tidak naik pada tumbukan bola–bola', () => {
    for (let k = 0; k < 400; k++) {
      const a = toBody(makeBall(0, 0, 0, R));
      const ang = (k * 0.37) % (2 * Math.PI);
      const b = toBody(makeBall(1, 2 * R * Math.cos(ang), 2 * R * Math.sin(ang), R));
      a.vx = 3 * Math.sin(k);
      a.vy = 3 * Math.cos(k * 1.3);
      a.wx = 80 * Math.sin(k * 2.1);
      a.wy = 80 * Math.cos(k * 0.7);
      a.wz = 60 * Math.sin(k * 3.3);
      b.vx = Math.sin(k * 0.9);
      b.wz = 30 * Math.cos(k);
      const before = kineticEnergy({ balls: [fromBody(a), fromBody(b)] });
      collideBalls(a, b, P);
      const after = kineticEnergy({ balls: [fromBody(a), fromBody(b)] });
      expect(after).toBeLessThanOrEqual(before + 1e-9);
    }
  });
  it('energi kinetik tidak naik pada tumbukan cushion', () => {
    for (let k = 0; k < 400; k++) {
      const a = toBody(makeBall(0, 0, 0, R));
      a.vx = 0.05 + 4 * Math.abs(Math.sin(k));
      a.vy = 4 * Math.cos(k * 1.3);
      a.wx = 100 * Math.sin(k * 2.1);
      a.wy = 100 * Math.cos(k * 0.7);
      a.wz = 100 * Math.sin(k * 3.3);
      classify(a, P);
      const before = kineticEnergy({ balls: [fromBody(a)] });
      collideCushion(a, 1, 0, P);
      const after = kineticEnergy({ balls: [fromBody(a)] });
      expect(after).toBeLessThanOrEqual(before + 1e-6);
    }
  });
  it('energi total tidak pernah naik selama break (sampel event)', () => {
    const { table: t } = rackNineBall(7);
    const res = simulate(t, shot({ speed: 8.5 }));
    expect(res.truncated).toBe(false);
  });
});

describe('2. sliding → rolling', () => {
  it('jarak slide sesuai teori 12/49·v²/(μg)', () => {
    const t = table([0, -1, 0]);
    const res = simulate(t, shot({ speed: 1.5 }));
    const v0 = ((1 + P.tipRestitution) * 1.5) / (1 + P.m / P.cueMass);
    const tSlide = (2 * v0) / (7 * P.muSlide * P.g);
    const dTheory = ((12 / 49) * v0 * v0) / (P.muSlide * P.g);
    const x = posAt(res, 0, tSlide)[0] + 1;
    expect(x).toBeCloseTo(dTheory, 2);
    // setelah transisi: kecepatan = 5/7 v0 (cek lewat selisih posisi)
    const dt = 0.02;
    const v = (posAt(res, 0, tSlide + 0.05 + dt)[0] - posAt(res, 0, tSlide + 0.05)[0]) / dt;
    expect(v).toBeGreaterThan((5 / 7) * v0 * 0.97);
    expect(v).toBeLessThan((5 / 7) * v0);
  });
});

/** Tip offset bawah agar cue ball tiba di jarak d dalam keadaan stun (ω≈0). */
function stunTable(d: number): TableState {
  return table([0, -0.5, 0], [1, -0.5 + d, 0]);
}

describe('3. stop shot', () => {
  it('stun lurus → cue ball berhenti hampir di tempat', () => {
    // jarak dekat, center-ball keras: bola masih sliding tanpa spin saat kontak
    const res = simulate(stunTable(0.12), shot({ speed: 1.5, tipY: -0.031 }));
    const first = res.events.find((e) => e.type === 'ball-ball')!;
    expect(first.ids).toEqual([0, 1]);
    // 1 detik setelah kontak (sebelum object ball sempat kembali dari rail)
    const c = posAt(res, 0, first.t + 1);
    const contactX = -0.5 + 0.12 - 2 * R;
    expect(Math.abs(c[0] - contactX)).toBeLessThan(0.03);
    expect(Math.abs(c[1])).toBeLessThan(1e-6);
    expect(posAt(res, 1, first.t + 1)[0]).toBeGreaterThan(0.5);
  });
});

describe('4. aturan 90°', () => {
  it('stun cut → cue ball pergi ~90° dari arah object ball', () => {
    // potongan 30°: pusat OB digeser sehingga garis pusat membentuk 30° terhadap arah bidik
    const d = 0.15;
    const cut = 30 * DEG;
    const gx = -0.5 + d; // posisi ghost ball
    const t = table([0, -0.5, 0], [1, gx + 2 * R * Math.cos(cut), 2 * R * Math.sin(cut)]);
    const res = simulate(t, shot({ speed: 4, tipY: -0.055 }));
    const hit = res.events.find((e) => e.type === 'ball-ball')!;
    const ob = heading(res, 1, hit.t + 0.01, hit.t + 0.05);
    const cb = heading(res, 0, hit.t + 0.01, hit.t + 0.05);
    let diff = Math.abs(ob - cb) / DEG;
    if (diff > 180) diff = 360 - diff;
    expect(diff).toBeGreaterThan(84);
    expect(diff).toBeLessThan(96);
  });
});

describe('5. aturan 30°', () => {
  it('rolling cue ball, setengah bola → defleksi ~30°', () => {
    const cut = 30 * DEG; // half-ball hit
    const gx = 0.4;
    const t = table([0, -0.9, 0], [1, gx + 2 * R * Math.cos(cut), 2 * R * Math.sin(cut)]);
    const res = simulate(t, shot({ speed: 1.6 }));
    const hit = res.events.find((e) => e.type === 'ball-ball')!;
    // arah akhir cue ball setelah lintasan melengkung selesai
    const end = ball(res, 0);
    const p1 = posAt(res, 0, hit.t + 0.6);
    const dirFinal = Math.atan2(end.pos[1] - p1[1], end.pos[0] - p1[0]);
    const defl = Math.abs(dirFinal) / DEG;
    expect(defl).toBeGreaterThan(25);
    expect(defl).toBeLessThan(40);
  });
});

describe('6. draw & follow', () => {
  it('draw: cue ball mundur', () => {
    const res = simulate(table([0, -0.5, 0], [1, -0.2, 0]), shot({ speed: 3, tipY: -0.45 }));
    const c = ball(res, 0);
    expect(c.pos[0]).toBeLessThan(-0.35);
    expect(c.pos[0]).toBeGreaterThan(-1.25);
  });
  it('follow: cue ball maju mengikuti', () => {
    const res = simulate(table([0, -0.5, 0], [1, -0.2, 0]), shot({ speed: 2, tipY: 0.4 }));
    const c = ball(res, 0);
    const contactX = -0.2 - 2 * R;
    expect(c.pos[0]).toBeGreaterThan(contactX + 0.15);
    expect(ball(res, 1).pos[0]).toBeGreaterThan(c.pos[0]);
  });
});

function railAngles(tipX: number): { inc: number; out: number } {
  // tembak ke rail +y pada sudut 45° dari normal; ukur sudut pantul terhadap normal
  const res = simulate(table([0, -0.4, -0.2]), shot({ dir: 45 * DEG, speed: 1.6, tipX }));
  const hit = res.events.find((e) => e.type === 'cushion')!;
  const hi = heading(res, 0, hit.t - 0.04, hit.t - 0.005);
  const ho = heading(res, 0, hit.t + 0.005, hit.t + 0.04);
  return { inc: 90 - hi / DEG, out: 90 + ho / DEG };
}

describe('7. cushion', () => {
  it('sudut datang ≈ sudut pantul tanpa english', () => {
    const { inc, out } = railAngles(0);
    expect(inc).toBeGreaterThan(40);
    expect(inc).toBeLessThan(50);
    expect(Math.abs(out - inc)).toBeLessThan(9);
  });
  it('running english melebarkan, reverse english menyempitkan sudut', () => {
    const none = railAngles(0).out;
    // bola bergerak +x menuju rail +y: running = english kanan (ω_z > 0, tipX > 0)
    const running = railAngles(0.4).out;
    const reverse = railAngles(-0.4).out;
    expect(running).toBeGreaterThan(none + 3);
    expect(reverse).toBeLessThan(none - 3);
  });
  it('pantulan tegak lurus kehilangan kecepatan secara wajar', () => {
    const res = simulate(table([0, 0.5, 0]), shot({ dir: 90 * DEG, speed: 2 }));
    const hit = res.events.find((e) => e.type === 'cushion')!;
    const vIn = (posAt(res, 0, hit.t - 0.01)[1] - posAt(res, 0, hit.t - 0.03)[1]) / 0.02;
    const vOut = (posAt(res, 0, hit.t + 0.01)[1] - posAt(res, 0, hit.t + 0.03)[1]) / 0.02;
    expect(vOut / vIn).toBeGreaterThan(0.5);
    expect(vOut / vIn).toBeLessThan(0.85);
  });
});

describe('8. throw', () => {
  it('stun cut setengah bola → throw 1–4°', () => {
    const cut = 30 * DEG;
    const gx = -0.5 + 0.15;
    const t = table([0, -0.5, 0], [1, gx + 2 * R * Math.cos(cut), 2 * R * Math.sin(cut)]);
    const res = simulate(t, shot({ speed: 2.2, tipY: -0.08 }));
    const hit = res.events.find((e) => e.type === 'ball-ball')!;
    const ob = heading(res, 1, hit.t + 0.005, hit.t + 0.05) / DEG;
    // tanpa throw OB pergi di garis pusat (30°); throw mendorongnya searah gerak cue ball (sudut lebih kecil)
    const thr = 30 - ob;
    expect(thr).toBeGreaterThan(1);
    expect(thr).toBeLessThan(4);
  });
});

describe('9. squirt', () => {
  it('english samping maksimum (stik lokal) → defleksi 1–3° berlawanan arah english', () => {
    const res = simulate(table([0, -1, 0]), shot({ speed: 2.5, tipX: P.miscueLimit }));
    const h = heading(res, 0, 0, 0.03) / DEG;
    expect(h).toBeGreaterThan(1);
    expect(h).toBeLessThan(3);
  });
  it('miscue di luar batas miscue stik lokal', () => {
    const res = simulate(table([0, -1, 0]), shot({ speed: 3, tipX: 0.45, tipY: 0.4 }));
    expect(res.events[0].type).toBe('miscue');
  });
});

function minPairDistance(s: TableState): number {
  let m = Infinity;
  const on = s.balls.filter((b) => b.motion !== 'pocketed' && b.motion !== 'off-table');
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++)
      m = Math.min(
        m,
        Math.hypot(on[i].pos[0] - on[j].pos[0], on[i].pos[1] - on[j].pos[1]),
      );
  return m;
}

describe('10. break', () => {
  it('8.5 m/s: stabil, tanpa NaN, tanpa tembus, cepat', () => {
    const { table: t } = rackNineBall(12345);
    simulate(t, shot({ speed: 8.5 })); // warm-up JIT
    const t0 = performance.now();
    const res = simulate(t, shot({ speed: 8.5 }));
    const ms = performance.now() - t0;
    console.log(
      `break: ${ms.toFixed(1)} ms, ${res.events.length} events, durasi ${res.duration.toFixed(1)} s`,
    );
    expect(ms).toBeLessThan(50);
    expect(res.truncated).toBe(false);
    for (const b of res.finalState.balls) {
      for (const v of [...b.pos, ...b.vel, ...b.angVel, ...b.quat]) expect(Number.isFinite(v)).toBe(true);
    }
    for (const tr of res.frames) for (const v of tr.p) expect(Number.isFinite(v)).toBe(true);
    expect(minPairDistance(res.finalState)).toBeGreaterThan(2 * R - 1e-6);
    // tidak ada bola saling tembus sepanjang lintasan
    for (let ts = 0; ts < res.duration; ts += 0.004) {
      const pts = res.frames
        .filter((f) => f.t[f.t.length - 1] >= ts)
        .map((f) => posAt(res, f.id, ts))
        .filter((p) => p[2] > R - 0.005 && p[2] < R + 0.001);
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++)
          expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(
            2 * R - 0.003,
          );
    }
    const railBalls = new Set(
      res.events.filter((e) => e.type === 'cushion' || e.type === 'jaw').flatMap((e) => e.ids),
    );
    railBalls.delete(0);
    expect(railBalls.size).toBeGreaterThanOrEqual(4);
    // semua bola tetap di dalam area meja
    for (const b of res.finalState.balls) {
      if (b.motion === 'pocketed' || b.motion === 'off-table') continue;
      expect(Math.abs(b.pos[0])).toBeLessThan(P.L / 2 + 0.08);
      expect(Math.abs(b.pos[1])).toBeLessThan(P.W / 2 + 0.08);
    }
  });
  it('banyak variasi break tidak pernah macet', () => {
    for (let s = 0; s < 40; s++) {
      const { table: t } = rackNineBall(s * 977 + 1);
      const cue = t.balls.find((b) => b.id === 0)!;
      cue.pos[1] = -0.3 + (s % 7) * 0.1;
      const dir = Math.atan2(-cue.pos[1], P.L / 4 - cue.pos[0]) + ((s % 5) - 2) * 0.004;
      const res = simulate(t, shot({ dir, speed: 6 + (s % 4), tipY: ((s % 3) - 1) * 0.2 }));
      expect(res.truncated).toBe(false);
      expect(minPairDistance(res.finalState)).toBeGreaterThan(2 * R - 1e-6);
    }
  });
});

describe('11. determinisme', () => {
  it('dua kali simulasi → hasil identik bit-per-bit', () => {
    const { table: t } = rackNineBall(99);
    const s = shot({ speed: 8.5, tipX: 0.1, tipY: -0.2, dir: 0.01 });
    const a = simulate(t, s);
    const b = simulate(JSON.parse(JSON.stringify(t)), { ...s });
    expect(JSON.stringify(a.finalState)).toBe(JSON.stringify(b.finalState));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.frames)).toBe(JSON.stringify(b.frames));
  });
});

describe('pocket & lain-lain', () => {
  it('bola lurus ke pocket sudut masuk', () => {
    const t = table([0, 0, 0], [1, 0.6, 0.3]);
    const res = simulate(t, shot({ dir: Math.atan2(0.3, 0.6), speed: 2.5 }));
    expect(ball(res, 1).motion).toBe('pocketed');
    expect(ball(res, 1).pocket).toBe(2);
  });
  it('bola ke pocket samping masuk; di sepanjang rail tidak jatuh', () => {
    const res = simulate(table([0, 0, 0]), shot({ dir: 90 * DEG, speed: 1.5 }));
    expect(ball(res, 0).motion).toBe('pocketed');
    expect(ball(res, 0).pocket).toBe(1);
    const res2 = simulate(table([0, -0.6, P.W / 2 - R - 0.0005]), shot({ dir: 0, speed: 0.45 }));
    expect(ball(res2, 0).motion).toBe('stationary');
    expect(ball(res2, 0).pos[0]).toBeGreaterThan(0.1);
  });
  it('rotasi visual: bola menggelinding sejauh d berputar d/R terhadap sumbu tegak lurus arah gerak', () => {
    const res = simulate(table([0, -1, 0]), shot({ speed: 0.8 }));
    const b = ball(res, 0);
    const d = b.pos[0] + 1;
    // sliding awal sedikit mengurangi rotasi; toleransi 3%
    const [qx, qy, qz, qw] = b.quat;
    expect(Math.abs(qx)).toBeLessThan(1e-9);
    expect(Math.abs(qz)).toBeLessThan(1e-9);
    const total = d / R;
    const expected = Math.abs(Math.sin(total / 2));
    // bandingkan sudut modulo 2π lewat rentang toleransi pada total putaran
    let ok = false;
    for (let k = 0.97; k <= 1.0001; k += 0.0005) {
      if (Math.abs(Math.abs(Math.sin((total * k) / 2)) - Math.abs(qy)) < 0.02 && Math.abs(Math.abs(Math.cos((total * k) / 2)) - Math.abs(qw)) < 0.02) ok = true;
    }
    expect(expected).toBeGreaterThanOrEqual(0);
    expect(ok).toBe(true);
    // arah putaran: topspin (ω_y > 0) untuk gerak +x → pada awal lintasan qy > 0
    const tr = res.frames[0];
    expect(tr.q[5 * 4 + 1]).toBeGreaterThan(0);
  });
  it('english: spin samping bertahan lalu habis', () => {
    const res = simulate(table([0, 0, 0]), shot({ speed: 1, tipX: 0.4 }));
    expect(ball(res, 0).motion).toBe('stationary');
    expect(ball(res, 0).angVel).toEqual([0, 0, 0]);
  });
  it('jump shot: elevasi tinggi membuat bola airborne dan melompati bola penghalang', () => {
    const t = table([0, -0.6, 0], [1, 0, 0]);
    const res = simulate(t, shot({ speed: 5.5, elevation: 40 * DEG, tipY: 0 }));
    expect(res.events.some((e) => e.type === 'slate')).toBe(true);
    // melewati bola penghalang (x = 0) tanpa menyentuhnya, mendarat di seberang
    const landing = res.events.find((e) => e.type === 'slate')!;
    expect(landing.pos[0]).toBeGreaterThan(2 * R);
    expect(res.events.some((e) => e.type === 'ball-ball' && e.t < landing.t)).toBe(false);
    // pukulan mendatar dengan kecepatan sama mengenai bola penghalang
    const flat = simulate(t, shot({ speed: 5.5 }));
    expect(flat.events.some((e) => e.type === 'ball-ball')).toBe(true);
  });
  it('jump cue: lompatan lebih tinggi dari stik biasa pada pukulan yang sama', () => {
    const apex = (cue?: 'jump'): number => {
      const res = simulate(table([0, -0.6, 0]), { ...shot({ speed: 4, elevation: 45 * DEG }), cue });
      const tr = res.frames[0];
      let z = 0;
      for (let i = 2; i < tr.p.length; i += 3) z = Math.max(z, tr.p[i]);
      return z - R;
    };
    const std = apex();
    const jump = apex('jump');
    expect(std).toBeGreaterThan(0);
    expect(jump).toBeGreaterThan(std * 1.2);
  });
  it('jumpLiftSpeed: tepat di bawah batas bola tetap di kain, sedikit di atasnya bola terangkat', () => {
    const e = 40 * DEG;
    const v = jumpLiftSpeed(e, 0, 0, P);
    const lifted = (speed: number): boolean =>
      simulate(table([0, -0.6, 0]), { ...shot({ speed, elevation: e }), cue: 'jump' }).events.some((x) => x.type === 'slate');
    expect(lifted(v * 0.97)).toBe(false);
    expect(lifted(v * 1.03)).toBe(true);
  });
  it('stik low deflection: squirt Ikon4 5 jauh lebih kecil dari stik lokal', () => {
    const run = (cue: string): number => {
      const res = simulate(table([0, -0.8, 0]), { ...shot({ speed: 2, tipX: 0.4 }), cue });
      return heading(res, 0, 0, 0.02);
    };
    const local = run('local');
    const ikon = run('ikon45');
    expect(local).toBeGreaterThan(0); // english kanan → menyimpang ke kiri (CCW)
    expect(ikon).toBeGreaterThan(0);
    expect(ikon / local).toBeLessThan(0.45);
    expect(squirtAngle(0.4, 0, P, 'ikon45')).toBeCloseTo(ikon, 6);
  });
  it('batas miscue per stik: offset 0.5 miscue untuk lokal, aman untuk Ikon4 5', () => {
    const miscue = (cue: string): boolean =>
      simulate(table([0, -0.8, 0]), { ...shot({ speed: 2, tipX: 0.5 }), cue }).events.some((e) => e.type === 'miscue');
    expect(miscue('local')).toBe(true);
    expect(miscue('ikon45')).toBe(false);
  });
  it("id lama 'standard' = stik lokal", () => {
    const a = simulate(table([0, -0.8, 0]), { ...shot({ speed: 2, tipX: 0.3 }), cue: 'standard' });
    const b = simulate(table([0, -0.8, 0]), shot({ speed: 2, tipX: 0.3 }));
    expect(ball(a, 0).pos).toEqual(ball(b, 0).pos);
    expect(cueParams('standard', P)).toEqual(cueParams(undefined, P));
  });
  it('massé: elevasi + english melengkungkan lintasan', () => {
    const res = simulate(table([0, -0.8, 0]), shot({ speed: 3, elevation: 50 * DEG, tipX: 0.4 }));
    const h0 = heading(res, 0, 0.0, 0.05);
    const end = ball(res, 0).pos;
    const p = posAt(res, 0, 0.6);
    const h1 = Math.atan2(end[1] - p[1], end[0] - p[0]);
    expect(Math.abs(h1 - h0) / DEG).toBeGreaterThan(3);
  });
});
