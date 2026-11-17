import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { CUES, simulate } from '@billiards/physics';
import type { ShotParams, TableState } from '@billiards/shared';

const here = dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIST = join(here, '../../client/dist');

interface SimulateBody {
  table: TableState;
  shot: ShotParams | null;
  recordFrames?: boolean;
}

function validShot(s: unknown): s is ShotParams {
  if (typeof s !== 'object' || s === null) return false;
  const o = s as Record<string, unknown>;
  if (o.cue !== undefined && !(typeof o.cue === 'string' && (o.cue === 'standard' || CUES.some((c) => c.id === o.cue)))) return false;
  return ['dir', 'speed', 'tipX', 'tipY', 'elevation'].every(
    (k) => typeof o[k] === 'number' && Number.isFinite(o[k]),
  );
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });

  app.get('/api/health', async () => ({ ok: true, name: 'open-billiard', version: '0.1.0' }));

  // Menjalankan mesin fisika yang sama di Node (dipakai untuk parity client↔server;
  // nanti menjadi dasar server authoritative).
  app.post<{ Body: SimulateBody }>('/api/simulate', async (req, reply) => {
    const body = req.body;
    if (
      !body ||
      !Array.isArray(body.table?.balls) ||
      body.table.balls.length > 16 ||
      (body.shot !== null && !validShot(body.shot))
    ) {
      return reply.code(400).send({ error: 'bad request' });
    }
    return simulate(body.table, body.shot, { recordFrames: body.recordFrames ?? true });
  });

  if (existsSync(CLIENT_DIST)) {
    await app.register(fastifyStatic, { root: CLIENT_DIST, cacheControl: true, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async () => 'Client belum di-build. Jalankan `npm run build` atau `npm run dev`.');
  }
  return app;
}
