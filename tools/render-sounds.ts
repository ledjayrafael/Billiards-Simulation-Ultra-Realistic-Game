/** Render suara sintetis ke WAV (untuk diperiksa di luar browser): npx tsx tools/render-sounds.ts <dir> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as synth from '../apps/client/src/audio/synth';

const dir = process.argv[2] ?? 'blender/out/wav';
mkdirSync(dir, { recursive: true });
function wav(name: string, data: Float32Array): void {
  const buf = Buffer.alloc(44 + data.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(synth.SAMPLE_RATE, 24); buf.writeUInt32LE(synth.SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  writeFileSync(join(dir, name + '.wav'), buf);
}
wav('clack', synth.ballClack(1));
wav('cushion', synth.cushionThud(1));
wav('cue', synth.cueHit(false));
wav('break', synth.cueHit(true));
wav('miscue', synth.miscue());
wav('pocket', synth.pocketDrop(1));
wav('slate', synth.slateThump());
console.log('ok', dir);
