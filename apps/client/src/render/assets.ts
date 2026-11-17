import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface SceneManifest {
  lightmap: { file: string; intensity: number; objects: string[] };
  env: { reflect: string; diffuse: string; probe: [number, number, number] };
  spots: {
    pos: [number, number, number];
    intensity: number;
    angle: number;
    penumbra: number;
    color: [number, number, number];
  }[];
  room: { halfX: number; halfY: number; floorZ: number; ceilingZ: number };
}

export interface Assets {
  table: THREE.Group;
  balls: THREE.Mesh[];
  /** model stik per nama objek di cue.glb (Cue_local, Cue_ikon45, …) */
  cues: Record<string, THREE.Object3D>;
  room: THREE.Group;
  cameras: GLTF;
  envReflect: THREE.DataTexture;
  envDiffuse: THREE.DataTexture;
  lightmap: THREE.Texture;
  manifest: SceneManifest;
}

const BASE = '/assets/';

export async function loadAssets(onProgress: (fraction: number, label: string) => void): Promise<Assets> {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const hdr = new HDRLoader();
  const tex = new THREE.TextureLoader();
  let done = 0;
  const total = 9;
  const track = <T>(label: string, p: Promise<T>): Promise<T> =>
    p.then((v) => {
      done++;
      onProgress(done / total, label);
      return v;
    });

  const manifest = (await track(
    'scene',
    fetch(BASE + 'scene.json').then((r) => {
      if (!r.ok) throw new Error('scene.json tidak ditemukan — jalankan `npm run assets`');
      return r.json();
    }),
  )) as SceneManifest;

  const [table, balls, cue, room, cameras, envReflect, envDiffuse, lightmap] = await Promise.all([
    track('meja', gltf.loadAsync(BASE + 'table.glb')),
    track('bola', gltf.loadAsync(BASE + 'balls.glb')),
    track('stik', gltf.loadAsync(BASE + 'cue.glb')),
    track('ruangan', gltf.loadAsync(BASE + 'room.glb')),
    track('kamera', gltf.loadAsync(BASE + 'cameras.glb')),
    track('refleksi', hdr.loadAsync(BASE + manifest.env.reflect)),
    track('cahaya', hdr.loadAsync(BASE + manifest.env.diffuse)),
    track('lightmap', tex.loadAsync(BASE + manifest.lightmap.file)),
  ]);

  const ballMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const m = balls.scene.getObjectByName(`Ball_${i}`) as THREE.Mesh | undefined;
    if (!m) throw new Error(`Ball_${i} tidak ada di balls.glb`);
    ballMeshes.push(m);
  }
  lightmap.flipY = false;
  lightmap.channel = 1;
  lightmap.colorSpace = THREE.SRGBColorSpace;
  return {
    table: table.scene,
    balls: ballMeshes,
    cues: Object.fromEntries(cue.scene.children.filter((o) => o.name.startsWith('Cue_')).map((o) => [o.name, o])),
    room: room.scene,
    cameras,
    envReflect,
    envDiffuse,
    lightmap,
    manifest,
  };
}
