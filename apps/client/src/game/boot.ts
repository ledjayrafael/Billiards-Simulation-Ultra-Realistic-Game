import { rackNineBall } from '@billiards/rules';
import { loadAssets } from '../render/assets';
import { toThree } from '../render/coords';
import { World } from '../render/world';

document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100vw;height:100vh;display:block';
document.body.appendChild(canvas);
const assets = await loadAssets(() => {});
const world = new World(canvas, assets, (new URLSearchParams(location.search).get('q') as never) ?? 'high');
const { table } = rackNineBall(1);
for (const b of table.balls) toThree(b.pos[0], b.pos[1], b.pos[2], world.balls[b.id].position);
world.cue.visible = false;
world.camera.position.set(-2.75, 0.72, 0);
world.camera.lookAt(0.35, 0, 0);
(window as never as { __world: World }).__world = world;
function frame(): void {
  world.resize(innerWidth, innerHeight);
  world.render(0.016);
  requestAnimationFrame(frame);
}
frame();
