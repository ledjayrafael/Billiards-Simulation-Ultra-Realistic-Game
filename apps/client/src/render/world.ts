import * as THREE from 'three';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { ArenaAssets, Assets, SceneManifest } from './assets';
import { toThree } from './coords';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

interface QualityPreset {
  pixelRatio: number;
  shadowSize: number;
  shadowLights: number;
  ao: 'off' | 'half' | 'full';
  aoSamples: number;
  bloom: boolean;
  smaa: boolean;
  dof: boolean;
  anisotropy: number;
}

const PRESETS: Record<Quality, QualityPreset> = {
  low: { pixelRatio: 1, shadowSize: 1024, shadowLights: 1, ao: 'off', aoSamples: 0, bloom: false, smaa: false, dof: false, anisotropy: 2 },
  medium: { pixelRatio: 1.25, shadowSize: 1024, shadowLights: 3, ao: 'half', aoSamples: 8, bloom: true, smaa: true, dof: false, anisotropy: 4 },
  high: { pixelRatio: 1.5, shadowSize: 2048, shadowLights: 3, ao: 'full', aoSamples: 12, bloom: true, smaa: true, dof: true, anisotropy: 8 },
  ultra: { pixelRatio: 2, shadowSize: 4096, shadowLights: 3, ao: 'full', aoSamples: 24, bloom: true, smaa: true, dof: true, anisotropy: 16 },
};

// ── Patch shader global: iradiansi difus IBL diambil dari panorama TANPA lampu (envMapDiffuse),
//    refleksi spekular dari panorama lengkap. Cahaya langsung lampu ditangani SpotLight (dengan
//    bayangan), sehingga tidak terhitung dua kali. iblDiffuseScale = 0 untuk objek ber-lightmap.
{
  const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
  const patched = chunk
    .replace('#ifdef USE_ENVMAP', '#ifdef USE_ENVMAP\n\tuniform samplerCube envMapDiffuse;\n\tuniform float iblDiffuseScale;')
    .replace(
      /vec4 envMapColor = textureLod\( envMap, envMapRotation \* worldNormal, ENVMAP_MAX_LOD \);\s*return PI \* envMapColor\.rgb \* envMapIntensity;/,
      'vec4 envMapColor = textureLod( envMapDiffuse, envMapRotation * worldNormal, ENVMAP_MAX_LOD );\n\t\t\treturn PI * envMapColor.rgb * envMapIntensity * iblDiffuseScale;',
    );
  if (!patched.includes('* iblDiffuseScale;')) {
    console.warn('Patch IBL difus tidak cocok dengan versi three.js ini — memakai IBL bawaan.');
  } else {
    THREE.ShaderChunk.envmap_physical_pars_fragment = patched;
  }
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.03, 40);
  readonly balls: THREE.Mesh[];
  readonly cues: Record<string, THREE.Object3D>;
  spots: THREE.SpotLight[] = [];
  /** arena aktif (ruangan, meja, IBL, lightmap) */
  arena!: ArenaAssets;
  /** Objek yang disembunyikan saat kamera berada di atasnya. */
  private lampObjs: THREE.Object3D[] = [];
  private ceilingObj: THREE.Object3D | null = null;
  private composer!: EffectComposer;
  private dof: DepthOfFieldEffect | null = null;
  private dofPass: EffectPass | null = null;
  private quality: Quality = 'high';
  /** dibagi oleh semua material ter-patch → ganti arena cukup mengubah .value */
  private envDiffuseUniform: { value: THREE.Texture | null } = { value: null };
  private envReflectTex: THREE.Texture | null = null;
  private patched = new Set<THREE.MeshStandardMaterial>();
  private pmrem: THREE.PMREMGenerator;
  private width = 1;
  private height = 1;

  constructor(
    canvas: HTMLCanvasElement,
    readonly assets: Assets,
    arena: ArenaAssets,
    quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.background = new THREE.Color(0x020203);

    this.balls = assets.balls;
    for (const b of this.balls) {
      b.castShadow = true;
      b.receiveShadow = true;
      b.matrixAutoUpdate = true;
      for (const m of materialsOf(b)) {
        // resin dari GLB terlalu mengilap (roughness 0.07 + clearcoat penuh 0.025) → highlight silau;
        // redam agar tetap mengilap tapi tidak menyilaukan
        const pm = m as THREE.MeshPhysicalMaterial;
        pm.roughness = Math.max(pm.roughness, 0.26);
        if (pm.isMeshPhysicalMaterial) {
          pm.clearcoat = Math.min(pm.clearcoat, 0.2);
          pm.clearcoatRoughness = Math.max(pm.clearcoatRoughness, 0.18);
        }
        pm.envMapIntensity = 0.45;
        this.patchMaterial(m, 1);
      }
      this.scene.add(b);
    }
    this.cues = assets.cues;
    for (const cue of Object.values(this.cues)) {
      cue.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        for (const m of materialsOf(mesh)) this.patchMaterial(m, 1);
      });
      this.scene.add(cue);
    }
    this.applyArena(arena);
    this.setQuality(quality);
  }

  get manifest(): SceneManifest {
    return this.arena.manifest;
  }

  /** Ganti arena (ruangan, meja, IBL, lampu). Panggil warmUp() sesudahnya untuk kompilasi shader. */
  setArena(arena: ArenaAssets): void {
    if (arena === this.arena) return;
    this.applyArena(arena);
    this.setQuality(this.quality);
  }

  private applyArena(arena: ArenaAssets): void {
    const prev = this.arena;
    if (prev) {
      this.scene.remove(prev.room, prev.table);
      for (const l of this.spots) {
        this.scene.remove(l, l.target);
        l.dispose();
      }
      this.spots = [];
      this.envReflectTex?.dispose();
      this.envDiffuseUniform.value?.dispose();
    }
    this.arena = arena;

    // environment (PMREM)
    this.envReflectTex = this.pmrem.fromEquirectangular(arena.envReflect).texture;
    this.envDiffuseUniform.value = this.pmrem.fromEquirectangular(arena.envDiffuse).texture;
    this.scene.environment = this.envReflectTex;
    for (const m of this.patched) m.envMap = this.envReflectTex;

    // ── objek ──
    const { table, room, manifest } = arena;
    this.scene.add(room, table);
    const lightmapped = new Set<THREE.Object3D>();
    for (const name of manifest.lightmap.objects) {
      const o = room.getObjectByName(name);
      o?.traverse((c) => lightmapped.add(c));
    }
    const roomEnv = arena.def.roomEnv ?? 1;
    room.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      const isLm = lightmapped.has(mesh) && !!mesh.geometry.attributes.uv1;
      for (const m of materialsOf(mesh)) {
        if (isLm) {
          m.lightMap = arena.lightmap;
          m.lightMapIntensity = manifest.lightmap.intensity;
          m.envMapIntensity = 0.35;
        }
        if (roomEnv !== 1 && m.metalness < 0.5) m.envMapIntensity = (isLm ? 0.35 : 1) * roomEnv;
        this.patchMaterial(m, isLm ? 0 : 1);
      }
    });
    this.lampObjs = [];
    for (const n of ['Lamp', 'Lamp_Glow']) {
      const o = room.getObjectByName(n);
      if (o) this.lampObjs.push(o);
    }
    this.ceilingObj = room.getObjectByName('Room_Ceiling') ?? null;
    room.getObjectByName('Chalk')?.traverse((o) => {
      o.castShadow = true;
    });
    const cloth = arena.def.cloth;
    const tableEnv = arena.def.tableEnv ?? 1;
    table.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = !/Diamonds|Pocket_Cups/.test(mesh.name) && !/Diamonds|Pocket_Cups/.test(mesh.parent?.name ?? '');
      mesh.receiveShadow = true;
      for (const m of materialsOf(mesh)) {
        // sheen bawaan eksportir (putih, penuh) membuat kain tampak pucat → redam & warnai
        const pm = m as THREE.MeshPhysicalMaterial;
        // kantong pocket: probe refleksi (di tengah meja) tidak berlaku di dalam lubang
        if (m.name === 'Cloth') {
          // meja pro: kain netral diwarnai sesuai arena (meja dipakai bersama → set ulang tiap ganti)
          if (cloth) m.color.setRGB(cloth[0], cloth[1], cloth[2]);
          if (pm.isMeshPhysicalMaterial) {
            pm.sheen = 0.18;
            if (cloth) pm.sheenColor.setRGB(cloth[0] * 0.6, cloth[1] * 0.6, cloth[2] * 0.6);
            else pm.sheenColor.setRGB(0.25, 0.45, 0.7);
            pm.sheenRoughness = 0.6;
          }
        }
        // bodi di bawah meja: probe (di atas kain) tidak mewakili pencahayaan di sana
        const under = m.name.startsWith('BodyLacquer');
        m.envMapIntensity = (under ? 0.12 : m.name.startsWith('PocketDark') ? 0 : m.name.startsWith('PocketLeather') ? 0.25 : 1) * tableEnv;
        this.patchMaterial(m, under ? 0.25 : 1);
      }
    });

    // ── lampu meja (cahaya langsung real-time) ──
    for (const s of manifest.spots) {
      const light = new THREE.SpotLight(
        new THREE.Color().setRGB(s.color[0], s.color[1], s.color[2]),
        s.intensity,
        0,
        s.angle,
        s.penumbra,
        2,
      );
      toThree(s.pos[0], s.pos[1], s.pos[2], light.position);
      toThree(s.pos[0], s.pos[1], 0, light.target.position);
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = Math.max(3.2, s.pos[2] + 2.4);
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.0025;
      light.shadow.radius = 3.5;
      this.scene.add(light, light.target);
      this.spots.push(light);
    }
  }

  private patchMaterial(m: THREE.Material, iblDiffuseScale: number): void {
    const uni = this.envDiffuseUniform;
    // envMap eksplisit: material.envMapIntensity hanya berlaku bila envMap diset per material
    // (untuk scene.environment three.js memakai scene.environmentIntensity).
    const std = m as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial) {
      std.envMap = this.envReflectTex;
      this.patched.add(std);
    }
    m.onBeforeCompile = (shader) => {
      shader.uniforms.envMapDiffuse = uni;
      shader.uniforms.iblDiffuseScale = { value: iblDiffuseScale };
    };
    m.customProgramCacheKey = () => 'ibl-split';
    m.needsUpdate = true;
  }

  /** Daftarkan material tambahan (dibuat di luar World) agar memakai IBL terpisah. */
  registerMaterial(m: THREE.Material): void {
    this.patchMaterial(m, 1);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const p = PRESETS[q];
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    this.spots.forEach((light, i) => {
      // pada preset rendah hanya lampu tengah yang berbayangan
      const cast = p.shadowLights >= 3 || i === 1;
      light.castShadow = cast;
      if (light.shadow.mapSize.x !== p.shadowSize) {
        light.shadow.mapSize.set(p.shadowSize, p.shadowSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    });
    const maxAniso = r.capabilities.getMaxAnisotropy();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of materialsOf(mesh)) {
        for (const t of [m.map, m.normalMap, m.roughnessMap]) {
          if (t) {
            t.anisotropy = Math.min(maxAniso, p.anisotropy);
            t.needsUpdate = true;
          }
        }
      }
    });

    // ── postprocessing ──
    this.composer?.dispose();
    const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (p.ao !== 'off') {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.configuration.aoRadius = 0.09;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.2;
      ao.configuration.aoSamples = p.aoSamples;
      ao.configuration.denoiseSamples = 6;
      ao.configuration.denoiseRadius = 8;
      ao.configuration.halfRes = p.ao === 'half';
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new THREE.Color(0, 0, 0);
      composer.addPass(ao);
    }
    this.dof = null;
    this.dofPass = null;
    if (p.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, {
        worldFocusDistance: 2.5,
        worldFocusRange: 1.6,
        bokehScale: 3.2,
        resolutionScale: 0.5,
      });
      this.dofPass = new EffectPass(this.camera, this.dof);
      this.dofPass.enabled = false;
      composer.addPass(this.dofPass);
    }
    const effects = [];
    if (p.bloom) {
      effects.push(new BloomEffect({ intensity: 0.55, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 }));
    }
    effects.push(new VignetteEffect({ darkness: 0.42, offset: 0.32 }));
    const tm = new URLSearchParams(location.search).get('tm');
    const mode = tm === 'agx' ? ToneMappingMode.AGX : tm === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.ACES_FILMIC;
    effects.push(new ToneMappingEffect({ mode }));
    composer.addPass(new EffectPass(this.camera, ...effects));
    if (p.smaa) composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;
    this.resize(this.width, this.height);
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** Depth of field (hanya kamera sinematik, preset High/Ultra). */
  setCinematicDof(enabled: boolean, focusDistance = 2.5): void {
    if (!this.dofPass || !this.dof) return;
    this.dofPass.enabled = enabled;
    this.dof.cocMaterial.worldFocusDistance = focusDistance;
  }

  setOverheadHidden(lampHidden: boolean, ceilingHidden: boolean): void {
    for (const o of this.lampObjs) o.visible = !lampHidden;
    if (this.ceilingObj) this.ceilingObj.visible = !ceilingHidden;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.renderer.info.reset();
    this.composer.render(dt);
  }

  /** Kompilasi shader & render beberapa frame agar tidak ada stutter pada pukulan pertama. */
  async warmUp(): Promise<void> {
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    for (let i = 0; i < 3; i++) this.render(0.016);
  }
}

function materialsOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial[] {
  const m = mesh.material;
  return (Array.isArray(m) ? m : [m]) as THREE.MeshStandardMaterial[];
}
