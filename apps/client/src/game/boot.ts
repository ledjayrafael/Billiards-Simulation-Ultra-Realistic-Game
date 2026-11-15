import * as THREE from 'three';
import { rackNineBall } from '@billiards/rules';
import type { MatchOptions } from '@billiards/shared';
import { Controls } from '../input/controls';
import { loadAssets } from '../render/assets';
import { World, type Quality } from '../render/world';
import { createLoading, Hud } from '../ui/hud';
import '../ui/style.css';
import { Game } from './game';
import { loadSettings } from './settings';

const params = new URLSearchParams(location.search);
const loading = createLoading();
const canvas = document.createElement('canvas');
canvas.id = 'view';
document.body.appendChild(canvas);

const settings = loadSettings();
const q = params.get('q') as Quality | null;
if (q) settings.quality = q;

try {
  const assets = await loadAssets((f, label) => loading.set(f * 0.85, `memuat ${label}…`));
  loading.set(0.9, 'menyiapkan shader…');
  const world = new World(canvas, assets, settings.quality);
  const game = new Game(world, settings);
  world.resize(innerWidth, innerHeight);

  let appliedQuality = settings.quality;
  const showcase = (): void => {
    game.ballViews.setTable(rackNineBall(7).table);
    game.rig.playCinematic('Cam_Intro', { loop: true, timeScale: 0.6 });
  };
  const breakIntro = (): void => {
    game.rig.playCinematic('Cam_BreakPrep');
  };
  const hud: Hud = new Hud(game, settings, {
    startMatch(options: Partial<MatchOptions>) {
      game.rig.stopCinematic();
      game.startMatch(options);
      breakIntro();
    },
    applySettings() {
      if (settings.quality !== appliedQuality) {
        appliedQuality = settings.quality;
        world.setQuality(settings.quality);
      }
      game.guide.mode = settings.guide;
    },
    quitToMenu() {
      game.quitMatch();
      showcase();
      hud.showMenu();
    },
    resume() {},
    nextRack() {
      game.rig.stopCinematic();
      game.continueAfterRack();
      breakIntro();
    },
  });
  const controls = new Controls(canvas, game, hud, settings);
  game.on('rackOver', () => game.rig.playCinematic('Cam_RackWin', { loop: true }));

  showcase();
  game.rig.snap({ cueX: -0.75, cueY: 0, aimDir: 0, focusX: 0, focusY: 0 });
  await world.warmUp();
  loading.set(1, 'siap');
  hud.showMenu();
  loading.done();

  addEventListener('resize', () => world.resize(innerWidth, innerHeight));
  const showFps = params.has('fps');
  let last = performance.now();
  let frames = 0;
  let acc = 0;
  let fps = 0;
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    controls.update(dt);
    // __timeScale: percepatan untuk pengujian otomatis
    game.update(dt * ((window as unknown as { __timeScale?: number }).__timeScale ?? 1));
    world.setCinematicDof(game.rig.cinematic && hud.sheetOpen !== null && hud.sheetOpen !== 'pause', 2.6);
    hud.tick();
    world.render(dt);
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fps = frames / acc;
      frames = 0;
      acc = 0;
      if (showFps) hud.setFps(`${fps.toFixed(0)} fps · sim ${game.lastSimMs.toFixed(1)} ms`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(window, { __THREE: THREE, __game: game, __world: world, __hud: hud, __fps: () => fps });
} catch (err) {
  loading.set(0, `Gagal memuat: ${(err as Error).message}`);
  console.error(err);
}
