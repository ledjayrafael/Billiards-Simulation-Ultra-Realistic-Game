/**
 * Debug viewer 2D (route /debug): atur posisi bola & parameter pukulan, jalankan mesin fisika,
 * gambar lintasan + event, slider koefisien untuk kalibrasi live.
 */
import {
  BALL_RADIUS as R,
  DEFAULT_PARAMS,
  buildTable,
  makeBall,
  type PhysicsParams,
} from '@billiards/physics';
import { rackNineBall } from '@billiards/rules';
import type { ShotParams, ShotResult, TableState } from '@billiards/shared';
import { SimClient } from '../sim/client';

export const BALL_COLORS = [
  '#f4f1e6', '#e8b923', '#1d4fa8', '#c8261d', '#5b2a86', '#e2701c', '#1f7a45', '#7a1f1f', '#151515', '#e8b923',
];

const DEG = Math.PI / 180;
const sim = new SimClient();
let table: TableState = rackNineBall(1).table;
const shot: ShotParams = { dir: 0, speed: 8.5, tipX: 0, tipY: 0, elevation: 0 };
const params: Partial<PhysicsParams> = {};
let result: ShotResult | null = null;
let playT = 0;
let playing = false;
let seed = 1;

document.body.style.cssText = 'margin:0;background:#14171c;color:#d8dde6;font:13px/1.4 system-ui,sans-serif;display:flex;height:100vh;overflow:hidden';
const app = document.getElementById('app')!;
app.style.cssText = 'display:flex;flex:1;min-width:0';
app.innerHTML = `
<div style="flex:1;min-width:0;display:flex;flex-direction:column">
  <canvas id="cv" style="flex:1;min-height:0;cursor:crosshair"></canvas>
  <div style="padding:6px 10px;display:flex;gap:10px;align-items:center;background:#1b1f26">
    <button id="run">▶ Pukul (Enter)</button><button id="play">Putar ulang</button>
    <input id="time" type="range" min="0" max="1" step="0.001" value="0" style="flex:1">
    <span id="stat" style="min-width:360px;font-variant-numeric:tabular-nums"></span>
  </div>
</div>
<div id="side" style="width:300px;overflow:auto;padding:10px;background:#1b1f26;border-left:1px solid #2a303a">
  <b>Preset</b><div id="presets" style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 10px"></div>
  <b>Pukulan</b><div id="shot"></div>
  <b>Koefisien</b> <button id="reset" style="float:right">reset</button><div id="coef"></div>
  <p style="opacity:.6">Drag bola untuk memindahkan. Klik kanan / Shift+klik di meja = arahkan bidikan ke titik itu.</p>
  <pre id="log" style="white-space:pre-wrap;font-size:11px;opacity:.8"></pre>
</div>`;
const cv = document.getElementById('cv') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const $ = (id: string): HTMLElement => document.getElementById(id)!;

function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): () => void {
  const row = document.createElement('label');
  row.style.cssText = 'display:grid;grid-template-columns:96px 1fr 52px;gap:6px;align-items:center;margin:3px 0';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span style="text-align:right;font-variant-numeric:tabular-nums"></span>`;
  const input = row.children[1] as HTMLInputElement;
  const val = row.children[2] as HTMLElement;
  const sync = (): void => {
    input.value = String(get());
    val.textContent = String(+get().toFixed(4));
  };
  input.oninput = () => {
    set(+input.value);
    sync();
    void run(false);
  };
  parent.appendChild(row);
  sync();
  return sync;
}
const syncs: (() => void)[] = [];
syncs.push(slider($('shot'), 'arah (°)', -180, 180, 0.05, () => shot.dir / DEG, (v) => (shot.dir = v * DEG)));
syncs.push(slider($('shot'), 'kecepatan stik', 0.3, 9, 0.05, () => shot.speed, (v) => (shot.speed = v)));
syncs.push(slider($('shot'), 'tip X (kanan)', -0.6, 0.6, 0.01, () => shot.tipX, (v) => (shot.tipX = v)));
syncs.push(slider($('shot'), 'tip Y (atas)', -0.6, 0.6, 0.01, () => shot.tipY, (v) => (shot.tipY = v)));
syncs.push(slider($('shot'), 'elevasi (°)', 0, 80, 0.5, () => shot.elevation / DEG, (v) => (shot.elevation = v * DEG)));
const coefDefs: [keyof PhysicsParams, number, number, number][] = [
  ['muSlide', 0.05, 0.4, 0.005], ['muRoll', 0.003, 0.03, 0.0005], ['muSpin', 0.002, 0.06, 0.0005],
  ['eBall', 0.7, 1, 0.005], ['eCushion', 0.5, 1, 0.005], ['eCushionSpeedLoss', 0, 0.08, 0.002],
  ['muCushion', 0, 0.8, 0.01], ['tipRestitution', 0.4, 1, 0.01], ['squirtMax', 0, 0.08, 0.001],
  ['ballFrictionB', 0, 0.3, 0.005], ['eSlate', 0, 0.9, 0.01], ['eJump', 0, 0.6, 0.01],
];
for (const [k, min, max, step] of coefDefs) {
  syncs.push(slider($('coef'), k, min, max, step, () => (params[k] ?? DEFAULT_PARAMS[k]) as number, (v) => (params[k] = v)));
}
$('reset').onclick = () => {
  for (const k of Object.keys(params)) delete params[k as keyof PhysicsParams];
  syncs.forEach((s) => s());
  void run(false);
};

const presets: Record<string, () => void> = {
  'Break': () => { table = rackNineBall(seed++).table; Object.assign(shot, { dir: 0, speed: 8.5, tipX: 0, tipY: 0, elevation: 0 }); },
  'Stop shot': () => { table = { balls: [makeBall(0, -0.5, 0, R), makeBall(1, -0.38, 0, R)] }; Object.assign(shot, { dir: 0, speed: 1.5, tipX: 0, tipY: -0.031, elevation: 0 }); },
  'Aturan 90°': () => { table = { balls: [makeBall(0, -0.5, 0, R), makeBall(1, -0.35 + 2 * R * Math.cos(30 * DEG), 2 * R * Math.sin(30 * DEG), R)] }; Object.assign(shot, { dir: 0, speed: 4, tipX: 0, tipY: -0.055, elevation: 0 }); },
  'Aturan 30°': () => { table = { balls: [makeBall(0, -0.9, 0, R), makeBall(1, 0.4 + 2 * R * Math.cos(30 * DEG), 2 * R * Math.sin(30 * DEG), R)] }; Object.assign(shot, { dir: 0, speed: 1.6, tipX: 0, tipY: 0, elevation: 0 }); },
  'Draw': () => { table = { balls: [makeBall(0, -0.5, 0, R), makeBall(1, -0.1, 0, R)] }; Object.assign(shot, { dir: 0, speed: 3, tipX: 0, tipY: -0.45, elevation: 0 }); },
  'Follow': () => { table = { balls: [makeBall(0, -0.5, 0, R), makeBall(1, -0.1, 0, R)] }; Object.assign(shot, { dir: 0, speed: 2, tipX: 0, tipY: 0.4, elevation: 0 }); },
  'English rail': () => { table = { balls: [makeBall(0, -1, -0.2, R)] }; Object.assign(shot, { dir: 45 * DEG, speed: 1.6, tipX: 0.4, tipY: 0, elevation: 0 }); },
  'Massé': () => { table = { balls: [makeBall(0, -0.8, 0, R), makeBall(1, -0.4, 0, R), makeBall(2, 0.1, -0.1, R)] }; Object.assign(shot, { dir: 8 * DEG, speed: 3.5, tipX: -0.4, tipY: 0, elevation: 55 * DEG }); },
  'Jump': () => { table = { balls: [makeBall(0, -0.6, 0, R), makeBall(1, 0, 0, R), makeBall(2, 0.9, 0, R)] }; Object.assign(shot, { dir: 0, speed: 5.5, tipX: 0, tipY: 0, elevation: 40 * DEG }); },
};
for (const [name, fn] of Object.entries(presets)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { fn(); syncs.forEach((s) => s()); void run(true); };
  $('presets').appendChild(b);
}

// ── transformasi layar ──
let scale = 1, ox = 0, oy = 0;
function resize(): void {
  const dpr = devicePixelRatio;
  cv.width = cv.clientWidth * dpr;
  cv.height = cv.clientHeight * dpr;
  scale = Math.min(cv.width / (DEFAULT_PARAMS.L + 0.5), cv.height / (DEFAULT_PARAMS.W + 0.5));
  ox = cv.width / 2;
  oy = cv.height / 2;
  draw();
}
const sx = (x: number): number => ox + x * scale;
const sy = (y: number): number => oy - y * scale;
const toWorld = (ev: MouseEvent): [number, number] => {
  const r = cv.getBoundingClientRect();
  return [((ev.clientX - r.left) * devicePixelRatio - ox) / scale, -((ev.clientY - r.top) * devicePixelRatio - oy) / scale];
};

function posAt(res: ShotResult, id: number, t: number): [number, number, number] | null {
  const tr = res.frames.find((f) => f.id === id);
  if (!tr || tr.t.length === 0) return null;
  let lo = 0, hi = tr.t.length - 1;
  if (t >= tr.t[hi]) return [tr.p[hi * 3], tr.p[hi * 3 + 1], tr.p[hi * 3 + 2]];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= t) lo = m; else hi = m; }
  const f = (t - tr.t[lo]) / (tr.t[hi] - tr.t[lo] || 1);
  return [0, 1, 2].map((k) => tr.p[lo * 3 + k] + (tr.p[hi * 3 + k] - tr.p[lo * 3 + k]) * f) as [number, number, number];
}

function draw(): void {
  const P = { ...DEFAULT_PARAMS, ...params };
  const geo = buildTable(P);
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, cv.width, cv.height);
  // rail + kain
  ctx.fillStyle = '#3b2a1c';
  ctx.fillRect(sx(-P.L / 2 - 0.16), sy(P.W / 2 + 0.16), (P.L + 0.32) * scale, (P.W + 0.32) * scale);
  ctx.fillStyle = '#1f5d86';
  ctx.fillRect(sx(-P.L / 2 - P.cushionWidth), sy(P.W / 2 + P.cushionWidth), (P.L + 2 * P.cushionWidth) * scale, (P.W + 2 * P.cushionWidth) * scale);
  // pocket
  for (const pk of geo.pockets) {
    ctx.beginPath(); ctx.arc(sx(pk.cx), sy(pk.cy), pk.r * scale, 0, 7); ctx.fillStyle = '#07080a'; ctx.fill();
  }
  // cushion
  ctx.fillStyle = '#17486a';
  for (const o of geo.outlines) {
    ctx.beginPath();
    o.pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#9fd0ee'; ctx.lineWidth = 1;
  for (const s of geo.segments) { ctx.beginPath(); ctx.moveTo(sx(s.ax), sy(s.ay)); ctx.lineTo(sx(s.bx), sy(s.by)); ctx.stroke(); }
  for (const a of geo.arcs) { ctx.beginPath(); ctx.arc(sx(a.cx), sy(a.cy), Math.max(1, a.r * scale), 0, 7); ctx.stroke(); }
  // head string & foot spot
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.beginPath(); ctx.moveTo(sx(-P.L / 4), sy(-P.W / 2)); ctx.lineTo(sx(-P.L / 4), sy(P.W / 2)); ctx.stroke();
  ctx.beginPath(); ctx.arc(sx(P.L / 4), sy(0), 2, 0, 7); ctx.stroke();

  // lintasan
  if (result) {
    for (const tr of result.frames) {
      if (tr.t.length < 2) continue;
      ctx.strokeStyle = BALL_COLORS[tr.id]; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < tr.t.length; i++) {
        const x = sx(tr.p[i * 3]), y = sy(tr.p[i * 3 + 1]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const e of result.events) {
      ctx.fillStyle = e.type === 'ball-ball' ? '#fff' : e.type === 'pocket' ? '#ff4d4d' : e.type === 'slate' ? '#a0f' : '#ffd24d';
      ctx.fillRect(sx(e.pos[0]) - 2, sy(e.pos[1]) - 2, 4, 4);
    }
  }
  // bola
  const balls = table.balls;
  for (const b of balls) {
    let p: [number, number, number] | null = [b.pos[0], b.pos[1], b.pos[2]];
    if (result && (playing || playT > 0)) p = posAt(result, b.id, playT);
    if (!p || p[2] < 0) continue;
    const r = R * scale * (1 + (p[2] - R) * 3);
    ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), r, 0, 7);
    ctx.fillStyle = BALL_COLORS[b.id]; ctx.fill();
    if (b.id === 9) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx(p[0]), sy(p[1]), r * 0.55, 0, 7); ctx.fill(); }
    ctx.fillStyle = b.id === 0 || b.id === 9 || b.id === 1 ? '#000' : '#fff';
    ctx.font = `${Math.round(r * 1.1)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (b.id) ctx.fillText(String(b.id), sx(p[0]), sy(p[1]) + 1);
  }
  // garis bidik
  const cue = balls.find((b) => b.id === 0);
  if (cue && !playing && playT === 0) {
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(sx(cue.pos[0]), sy(cue.pos[1]));
    ctx.lineTo(sx(cue.pos[0] + Math.cos(shot.dir) * 3), sy(cue.pos[1] + Math.sin(shot.dir) * 3)); ctx.stroke(); ctx.setLineDash([]);
  }
}

async function run(play: boolean): Promise<void> {
  const { result: res, ms } = await sim.simulate(table, shot, { params });
  result = res;
  const pocketed = res.finalState.balls.filter((b) => b.motion === 'pocketed').map((b) => b.id);
  $('stat').textContent = `${ms.toFixed(1)} ms · ${res.events.length} event · ${res.duration.toFixed(2)} s · masuk: ${pocketed.join(',') || '–'}${res.truncated ? ' · TERPOTONG' : ''}`;
  $('log').textContent = res.events.slice(0, 40).map((e) => `${e.t.toFixed(3)}  ${e.type.padEnd(9)} ${e.ids.join('-').padEnd(4)} v=${e.speed.toFixed(2)}`).join('\n');
  (window as unknown as { __debug: unknown }).__debug = { result: res, ms };
  if (play) { playT = 0; playing = true; last = performance.now(); }
  else { playT = 0; playing = false; }
  draw();
}

let last = performance.now();
function tick(now: number): void {
  if (playing && result) {
    playT += (now - last) / 1000;
    if (playT >= result.duration) { playT = result.duration; playing = false; }
    ($('time') as HTMLInputElement).value = String(playT / (result.duration || 1));
    draw();
  }
  last = now;
  requestAnimationFrame(tick);
}
($('time') as HTMLInputElement).oninput = (e) => {
  if (!result) return;
  playing = false;
  playT = +(e.target as HTMLInputElement).value * result.duration;
  draw();
};
$('run').onclick = () => void run(true);
$('play').onclick = () => { if (result) { playT = 0; playing = true; } };
addEventListener('keydown', (e) => { if (e.key === 'Enter') void run(true); });

let dragId = -1;
cv.oncontextmenu = (e) => e.preventDefault();
cv.onmousedown = (e) => {
  const [x, y] = toWorld(e);
  playT = 0; playing = false;
  if (e.button === 2 || e.shiftKey) {
    const cue = table.balls.find((b) => b.id === 0);
    if (cue) { shot.dir = Math.atan2(y - cue.pos[1], x - cue.pos[0]); syncs.forEach((s) => s()); void run(false); }
    return;
  }
  const hit = table.balls.find((b) => Math.hypot(b.pos[0] - x, b.pos[1] - y) < R * 1.5);
  dragId = hit ? hit.id : -1;
};
cv.onmousemove = (e) => {
  if (dragId < 0) return;
  const [x, y] = toWorld(e);
  const b = table.balls.find((q) => q.id === dragId)!;
  b.pos[0] = x; b.pos[1] = y;
  void run(false);
};
addEventListener('mouseup', () => (dragId = -1));
addEventListener('resize', resize);
resize();
void run(false);
requestAnimationFrame(tick);
