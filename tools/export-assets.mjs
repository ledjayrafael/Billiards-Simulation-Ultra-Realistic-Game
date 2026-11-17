// Bangun aset: Blender headless → GLB mentah → kompresi (Meshopt + WebP) → apps/client/public/assets
// lalu verifikasi dimensi terhadap blender/specs.json (toleransi 0.5 mm) dan ukuran total (≤ 40 MB).
//
//   npm run assets                 # build penuh (bake kualitas tinggi, beberapa menit)
//   npm run assets -- --fast       # bake cepat (sampel rendah)
//   npm run assets -- --skip-blender   # hanya kompresi + verifikasi dari blender/out/glb
//   npm run assets -- --only table,balls
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'blender/out/glb');
const outDir = join(root, 'apps/client/public/assets');
const args = process.argv.slice(2);
const specs = JSON.parse(readFileSync(join(root, 'blender/specs.json'), 'utf8'));

// .env
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

if (!args.includes('--skip-blender')) {
  const blender = process.env.BLENDER_BIN;
  if (!blender || !existsSync(blender)) {
    console.error('BLENDER_BIN belum diset / tidak ditemukan. Salin .env.example ke .env dan isi path Blender.');
    process.exit(1);
  }
  const extra = [];
  if (args.includes('--fast')) extra.push('--fast');
  const oi = args.indexOf('--only');
  if (oi >= 0) extra.push('--only', args[oi + 1]);
  console.log('▶ Blender build_all.py …');
  const r = spawnSync(
    blender,
    ['-b', '--factory-startup', '-P', join(root, 'blender/scripts/build_all.py'), '--', '--out', rawDir, ...extra],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  for (const line of r.stdout.split('\n')) if (/^\[|Error|Traceback/.test(line)) console.log('  ' + line);
  if (r.status !== 0 || !r.stdout.includes('[build_all] selesai')) {
    console.error('Blender gagal.');
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const MAX_TEX = { 'table.glb': 2048, 'room.glb': 2048, 'cue.glb': 2048, 'balls.glb': 4096 };
for (const name of ['table.glb', 'balls.glb', 'cue.glb', 'room.glb', 'cameras.glb']) {
  const src = join(rawDir, name);
  if (!existsSync(src)) continue;
  if (name === 'cameras.glb') {
    copyFileSync(src, join(outDir, name));
    continue;
  }
  const doc = await io.read(src);
  const size = MAX_TEX[name];
  await doc.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 90, effort: 80 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(join(outDir, name), doc);
}
if (existsSync(join(rawDir, 'room_lightmap.png'))) {
  await sharp(join(rawDir, 'room_lightmap.png')).webp({ quality: 94, effort: 5 }).toFile(join(outDir, 'room_lightmap.webp'));
  const manifest = JSON.parse(readFileSync(join(rawDir, 'scene.json'), 'utf8'));
  manifest.lightmap.file = 'room_lightmap.webp';
  writeFileSync(join(outDir, 'scene.json'), JSON.stringify(manifest, null, 2));
  for (const f of ['env_reflect.hdr', 'env_diffuse.hdr']) copyFileSync(join(rawDir, f), join(outDir, f));
}

// ── verifikasi dimensi (toleransi 0.5 mm) ──
const TOL = 0.0005;
let failed = false;
const check = (label, got, want) => {
  const ok = Math.abs(got - want) <= TOL;
  if (!ok) failed = true;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${got.toFixed(5)} (spesifikasi ${want.toFixed(5)})`);
};
const nodeBounds = async (file, nodeName) => {
  const doc = await io.read(join(outDir, file));
  const node = doc.getRoot().listNodes().find((n) => n.getName() === nodeName);
  if (!node) throw new Error(`${file}: node ${nodeName} tidak ada`);
  return getBounds(node); // sumbu glTF: x = panjang, y = atas, z = −lebar
};
console.log('▶ Verifikasi dimensi');
const T = specs.table;
{
  const b = await nodeBounds('table.glb', 'Table_Cloth');
  check('kain: panjang', b.max[0] - b.min[0], T.length + 2 * T.cushionWidth + 0.008);
  check('kain: lebar', b.max[2] - b.min[2], T.width + 2 * T.cushionWidth + 0.008);
  check('kain: permukaan y=0', b.max[1], 0);
  const c0 = await nodeBounds('table.glb', 'Cushion_0'); // rail +y kiri → z glTF negatif
  check('cushion 0: garis nose (|z| min)', Math.min(Math.abs(c0.min[2]), Math.abs(c0.max[2])), T.width / 2);
  check('cushion 0: tinggi atas', c0.max[1], T.cushionTopHeight);
  const c2 = await nodeBounds('table.glb', 'Cushion_2'); // rail kaki +x
  check('cushion 2: garis nose (x min)', c2.min[0], T.length / 2);
  const mouth = T.cornerMouth / Math.SQRT2;
  check('cushion 2: ujung nose (bukaan pocket sudut)', c2.max[2] > 0 ? T.width / 2 - mouth : 0, T.width / 2 - mouth);
  const rail = await nodeBounds('table.glb', 'Table_Rail');
  check('rail: panjang luar', rail.max[0] - rail.min[0], T.length + 2 * (T.cushionWidth + T.railWidth));
  check('rail: tinggi', rail.max[1], T.railHeight);
  const body = await nodeBounds('table.glb', 'Table_Body');
  check('meja: tinggi permukaan dari lantai', -body.min[1], T.surfaceHeight);
}
for (const id of [0, 5, 9]) {
  const b = await nodeBounds('balls.glb', `Ball_${id}`);
  check(`bola ${id}: diameter`, b.max[0] - b.min[0], 2 * specs.ball.radius);
  check(`bola ${id}: diameter (vertikal)`, b.max[1] - b.min[1], 2 * specs.ball.radius);
}
for (const model of new Set(specs.cues.map((c) => c.model))) {
  // model dipakai dengan panjang aslinya oleh stik play; jump cue = model yang diperpendek di client
  const len = specs.cues.find((c) => c.model === model && c.category === 'play')?.length ?? specs.cue.length;
  const b = await nodeBounds('cue.glb', model);
  check(`stik ${model}: panjang`, b.max[0] - b.min[0], len);
  check(`stik ${model}: tip di origin`, b.max[0], 0);
}

let total = 0;
console.log('▶ Ukuran aset');
for (const f of readdirSync(outDir)) {
  const st = statSync(join(outDir, f));
  if (!st.isFile()) continue;
  total += st.size;
  console.log(`  ${f.padEnd(22)} ${(st.size / 1048576).toFixed(2)} MB`);
}
console.log(`  TOTAL ${(total / 1048576).toFixed(2)} MB (target ≤ 40 MB)`);
if (total > 40 * 1048576) failed = true;
if (failed) {
  console.error('✗ Verifikasi aset GAGAL');
  process.exit(1);
}
console.log('✓ Aset OK');
