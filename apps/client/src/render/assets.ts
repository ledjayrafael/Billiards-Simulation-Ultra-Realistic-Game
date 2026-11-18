import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ArenaDef } from './arenas';

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

/** Aset yang berbeda per arena: ruangan, meja, panorama IBL, lightmap & data lampu. */
export interface ArenaAssets {
  def: ArenaDef;
  table: THREE.Group;
  room: THREE.Group;
  envReflect: THREE.DataTexture;
  envDiffuse: THREE.DataTexture;
  lightmap: THREE.Texture;
  manifest: SceneManifest;
}

export interface Assets {
  balls: THREE.Mesh[];
  /** model stik per nama objek di cue.glb (Cue_local, Cue_ikon45, …) */
  cues: Record<string, THREE.Object3D>;
  cameras: GLTF;
}

type Progress = (fraction: number, label: string) => void;

const BASE = '/assets/';
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const hdr = new HDRLoader();
const tex = new THREE.TextureLoader();

function tracker(total: number, onProgress: Progress) {
  let done = 0;
  return <T>(label: string, p: Promise<T>): Promise<T> =>
    p.then((v) => {
      done++;
      onProgress(done / total, label);
      return v;
    });
}

export async function loadAssets(onProgress: Progress): Promise<Assets> {
  const track = tracker(3, onProgress);
  const [balls, cue, cameras] = await Promise.all([
    track('bola', gltf.loadAsync(BASE + 'balls.glb')),
    track('stik', gltf.loadAsync(BASE + 'cue.glb')),
    track('kamera', gltf.loadAsync(BASE + 'cameras.glb')),
  ]);
  const ballMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const m = balls.scene.getObjectByName(`Ball_${i}`) as THREE.Mesh | undefined;
    if (!m) throw new Error(`Ball_${i} tidak ada di balls.glb`);
    ballMeshes.push(m);
  }
  return {
    balls: ballMeshes,
    cues: Object.fromEntries(cue.scene.children.filter((o) => o.name.startsWith('Cue_')).map((o) => [o.name, o])),
    cameras,
  };
}

const arenaCache = new Map<string, Promise<ArenaAssets>>();
const tableCache = new Map<string, Promise<THREE.Group>>();

/** Muat aset arena (di-cache: berpindah kembali ke arena yang sudah dimuat tidak mengunduh ulang). */
export function loadArena(def: ArenaDef, onProgress: Progress = () => {}): Promise<ArenaAssets> {
  let p = arenaCache.get(def.id);
  if (!p) {
    p = loadArenaUncached(def, onProgress);
    p.catch(() => arenaCache.delete(def.id));
    arenaCache.set(def.id, p);
  }
  return p;
}

async function loadArenaUncached(def: ArenaDef, onProgress: Progress): Promise<ArenaAssets> {
  const track = tracker(6, onProgress);
  const manifest = (await track(
    'scene',
    fetch(BASE + def.scene).then((r) => {
      if (!r.ok) throw new Error(`${def.scene} tidak ditemukan — jalankan \`npm run assets\``);
      return r.json();
    }),
  )) as SceneManifest;
  let table = tableCache.get(def.table);
  if (!table) {
    table = gltf.loadAsync(BASE + def.table).then((g) => g.scene);
    tableCache.set(def.table, table);
  }
  const [tbl, room, envReflect, envDiffuse, lightmap] = await Promise.all([
    track('meja', table),
    track('ruangan', gltf.loadAsync(BASE + def.room)),
    track('refleksi', hdr.loadAsync(BASE + manifest.env.reflect)),
    track('cahaya', hdr.loadAsync(BASE + manifest.env.diffuse)),
    track('lightmap', tex.loadAsync(BASE + manifest.lightmap.file)),
  ]);
  lightmap.flipY = false;
  lightmap.channel = 1;
  lightmap.colorSpace = THREE.SRGBColorSpace;
  envReflect.mapping = THREE.EquirectangularReflectionMapping;
  envDiffuse.mapping = THREE.EquirectangularReflectionMapping;
  return { def, table: tbl, room: room.scene, envReflect, envDiffuse, lightmap, manifest };
}
