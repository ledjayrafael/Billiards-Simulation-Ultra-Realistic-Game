import { loadAssets } from '../render/assets';
import { World, type Quality } from '../render/world';
import { Game } from './game';
import { loadSettings } from './settings';

document.body.style.cssText = 'margin:0;overflow:hidden;background:#000;font:13px system-ui,sans-serif;color:#dde';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100vw;height:100vh;display:block';
document.body.appendChild(canvas);

const settings = loadSettings();
const q = new URLSearchParams(location.search).get('q') as Quality | null;
if (q) settings.quality = q;
const assets = await loadAssets(() => {});
const world = new World(canvas, assets, settings.quality);
const game = new Game(world, settings);
world.resize(innerWidth, innerHeight);
await world.warmUp();
game.startMatch({});
game.rig.snap({ cueX: game.cueBall.x, cueY: game.cueBall.y, aimDir: game.aimDir, focusX: 0, focusY: 0 });

// ── panel debug sementara (M3) ──
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(10,12,16,.75);padding:8px 10px;border-radius:8px;display:grid;gap:4px;width:250px';
panel.innerHTML = `
<label>kecepatan <input id="d-speed" type="range" min="0.3" max="9" step="0.1" value="8.5"> </label>
<label>tip X <input id="d-tx" type="range" min="-0.6" max="0.6" step="0.01" value="0"></label>
<label>tip Y <input id="d-ty" type="range" min="-0.6" max="0.6" step="0.01" value="0"></label>
<label>elevasi <input id="d-el" type="range" min="0" max="80" step="1" value="0"></label>
<div><button id="d-shoot">Pukul (Enter)</button> <button id="d-top">Top (T)</button> <button id="d-replay">Replay (P)</button></div>
<div id="d-info"></div><div style="opacity:.6">←/→ bidik (Shift = halus), scroll = zoom</div>`;
document.body.appendChild(panel);
const val = (id: string): number => +(document.getElementById(id) as HTMLInputElement).value;
const shoot = (): void => {
  game.tipX = val('d-tx');
  game.tipY = val('d-ty');
  game.elevation = (val('d-el') * Math.PI) / 180;
  game.fire(val('d-speed'));
};
document.getElementById('d-shoot')!.onclick = shoot;
document.getElementById('d-top')!.onclick = () => game.rig.toggleTop();
document.getElementById('d-replay')!.onclick = () => game.startReplay(0.25);
const held = new Set<string>();
addEventListener('keydown', (e) => {
  held.add(e.code);
  if (e.code === 'Enter') shoot();
  if (e.code === 'KeyT') game.rig.toggleTop();
  if (e.code === 'KeyP') game.startReplay(0.25);
  if (e.code === 'KeyR') game.rig.reset();
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('wheel', (e) => game.rig.zoom(e.deltaY * 0.001), { passive: true });
addEventListener('resize', () => world.resize(innerWidth, innerHeight));

const info = document.getElementById('d-info')!;
let last = performance.now();
let frames = 0;
let acc = 0;
let fps = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const rate = held.has('ShiftLeft') || held.has('ShiftRight') ? 0.05 : 0.9;
  if (held.has('ArrowLeft')) game.aimBy(rate * dt);
  if (held.has('ArrowRight')) game.aimBy(-rate * dt);
  game.update(dt);
  world.render(dt);
  frames++;
  acc += dt;
  if (acc >= 0.5) {
    fps = frames / acc;
    frames = 0;
    acc = 0;
    info.textContent = `${fps.toFixed(0)} fps · ${game.mode} · sim ${game.lastSimMs.toFixed(1)} ms · ${world.renderer.info.render.triangles} tris`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
Object.assign(window, { __game: game, __world: world, __fps: () => fps });
