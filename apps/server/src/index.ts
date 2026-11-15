import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';

// muat .env sederhana dari root repo (tanpa dependensi)
const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const port = Number(process.env.PORT ?? 3000);
const app = await buildApp({ logger: process.env.NODE_ENV !== 'production' && !!process.env.LOG });
await app.listen({ port, host: '127.0.0.1' });
console.log(`9-Ball server: http://localhost:${port}`);
