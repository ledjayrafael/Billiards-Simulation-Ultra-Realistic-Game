import * as THREE from 'three';
import { CUE_LENGTH } from '@billiards/physics';
import type { CueSpec } from '@billiards/shared';

/** Ukuran thumbnail dalam piksel CSS; dirender 2× untuk layar HiDPI. */
const W = 280;
const H = 44;
const DPR = 2;
/** Stik 50× lebih panjang dari tebalnya: penampang dibesarkan agar desain butt terbaca. */
const THICKEN = 2.4;

const cache = new Map<string, string>();

/**
 * Thumbnail stik (data URL PNG) dirender dari model cue.glb yang sudah dimuat.
 * Memakai renderer offscreen sementara agar state renderer utama tidak tersentuh;
 * hasil di-cache per id stik, jadi biaya hanya sekali per sesi.
 */
export function cueThumbnails(specs: readonly CueSpec[], models: Record<string, THREE.Object3D>): Map<string, string> {
  const todo = specs.filter((s) => !cache.has(s.id));
  if (!todo.length) return cache;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(0.3, 1, 1.2);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-0.4, -0.6, 0.8);
    scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.35));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);

    for (const spec of todo) {
      const src = models[spec.model] ?? Object.values(models)[0];
      if (!src) continue;
      // node glTF stik membawa transform dekuantisasi meshopt: bungkus, jangan timpa
      const holder = new THREE.Group();
      const model = src.clone();
      model.visible = true;
      holder.add(model);
      // seperti CuePivot: tip di origin, stik memanjang ke −X. Stik jump lebih pendek dari modelnya.
      holder.scale.set(spec.length / CUE_LENGTH, THICKEN, THICKEN);
      scene.add(holder);
      holder.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(holder);
      // bingkai tetap = panjang stik penuh, tip rata kanan: stik pendek (jump) tampak pendek
      const c = box.getCenter(new THREE.Vector3());
      c.x = box.max.x - CUE_LENGTH / 2;
      const halfW = (CUE_LENGTH / 2) * 1.03;
      const halfH = halfW * (H / W);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.position.set(c.x, c.y, c.z + 2);
      camera.up.set(0, 1, 0);
      camera.lookAt(c);
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
      cache.set(spec.id, canvas.toDataURL('image/png'));
      scene.remove(holder);
    }
  } catch (e) {
    console.warn('thumbnail stik gagal dirender', e);
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
  return cache;
}
