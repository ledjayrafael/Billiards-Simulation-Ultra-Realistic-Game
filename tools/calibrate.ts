/** Cetak angka-angka kalibrasi fisika (jalankan: npx tsx tools/calibrate.ts). */
import { simulate, makeBall, BALL_RADIUS as R, DEFAULT_PARAMS as P } from '@billiards/physics';
import { rackNineBall } from '@billiards/rules';
import type { ShotParams, ShotResult } from '@billiards/shared';

const DEG = Math.PI / 180;
const shot = (p: Partial<ShotParams>): ShotParams => ({ dir: 0, speed: 2, tipX: 0, tipY: 0, elevation: 0, ...p });
const final = (r: ShotResult, id: number) => r.finalState.balls.find((b) => b.id === id)!;

// break
let ms = 0, ev = 0, pocketed = 0, dur = 0, scratch = 0;
const N = 50;
for (let s = 0; s < N; s++) {
  const { table } = rackNineBall(s + 1);
  const t0 = performance.now();
  const res = simulate(table, shot({ speed: 8.5, dir: (s % 5 - 2) * 0.002 }));
  ms += performance.now() - t0;
  ev += res.events.length;
  dur += res.duration;
  pocketed += res.finalState.balls.filter((b) => b.id > 0 && b.motion === 'pocketed').length;
  scratch += final(res, 0).motion === 'pocketed' ? 1 : 0;
}
console.log(`break 8.5 m/s ×${N}: ${(ms / N).toFixed(2)} ms, ${(ev / N).toFixed(0)} events, durasi ${(dur / N).toFixed(1)} s, bola masuk rata-rata ${(pocketed / N).toFixed(2)}, scratch ${scratch}/${N}`);

// lag: pukulan pelan bolak-balik
for (const v of [1, 2, 3]) {
  const r = simulate({ balls: [makeBall(0, -0.6, 0.3, R)] }, shot({ speed: v }));
  const rails = r.events.filter((e) => e.type === 'cushion').length;
  console.log(`stik ${v} m/s center: ${rails} rail, berhenti setelah ${r.duration.toFixed(1)} s`);
}
// rail rebound
for (const a of [30, 45, 60]) for (const tip of [-0.4, 0, 0.4]) {
  const r = simulate({ balls: [makeBall(0, -1.0, -0.2, R)] }, shot({ dir: (90 - a) * DEG, speed: 1.6, tipX: tip }));
  const hit = r.events.find((e) => e.type === 'cushion')!;
  const tr = r.frames[0];
  const at = (t: number) => { let i = 0; while (i < tr.t.length - 2 && tr.t[i + 1] < t) i++; const f = (t - tr.t[i]) / (tr.t[i + 1] - tr.t[i]); return [tr.p[i*3] + (tr.p[i*3+3] - tr.p[i*3]) * f, tr.p[i*3+1] + (tr.p[i*3+4] - tr.p[i*3+1]) * f]; };
  const p0 = at(hit.t + 0.005), p1 = at(hit.t + 0.04);
  const out = 90 + Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / DEG;
  console.log(`rail masuk ${a}° english ${tip >= 0 ? '+' : ''}${tip}: keluar ${out.toFixed(1)}°`);
}
// draw distance
for (const tipY of [-0.5, -0.3, 0.3, 0.5]) {
  const r = simulate({ balls: [makeBall(0, -0.5, 0, R), makeBall(1, 0, 0.0, R)] }, shot({ speed: 3, tipY }));
  const hit = r.events.find((e) => e.type === 'ball-ball')!;
  console.log(`tipY ${tipY} @3 m/s jarak 0.5 m: cue ball berakhir di x=${final(r, 0).pos[0].toFixed(2)} (kontak x=${(-2 * R).toFixed(2)}), t=${hit.t.toFixed(2)}`);
}
console.log('μ_spin decel', ((5 * P.muSpin * P.g) / (2 * R)).toFixed(1), 'rad/s²');
{
  const { table } = rackNineBall(3);
  const res = simulate(table, shot({ speed: 8.5 }));
  console.log(res.events.filter((e) => e.t < 0.5).map((e) => `${e.t.toFixed(4)} ${e.type} ${e.ids.join('-')} v=${e.speed.toFixed(2)}`).join('\n'));
  console.log(res.finalState.balls.map((b) => `${b.id}:${b.motion} (${b.pos[0].toFixed(2)},${b.pos[1].toFixed(2)})`).join('  '));
}
