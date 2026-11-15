// Unduh tekstur CC0 dari Poly Haven ke blender/textures/ (idempoten).
// Jalankan: node tools/fetch-textures.mjs
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'blender/textures');
mkdirSync(outDir, { recursive: true });

// [asset id Poly Haven, resolusi]
const ASSETS = [
  ['walnut_veneer_02', '2k'],
  ['herringbone_parquet', '2k'],
  ['plastered_wall_04', '1k'],
  ['brown_leather', '1k'],
  ['white_maple_veneer', '1k'],
];
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
const headers = { 'User-Agent': 'asset-fetch/1.0' };

for (const [id, res] of ASSETS) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers })).json();
  for (const [map, short] of Object.entries(MAPS)) {
    const url = files[map]?.[res]?.jpg?.url;
    if (!url) {
      console.warn(`! ${id}: map ${map} ${res} tidak ada`);
      continue;
    }
    const dest = join(outDir, `${id}_${short}.jpg`);
    if (existsSync(dest)) continue;
    const buf = Buffer.from(await (await fetch(url, { headers })).arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`✓ ${id}_${short}.jpg (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}
