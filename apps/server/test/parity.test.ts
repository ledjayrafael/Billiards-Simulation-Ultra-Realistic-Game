import { describe, expect, it } from 'vitest';
import { simulate } from '@billiards/physics';
import { rackNineBall } from '@billiards/rules';
import type { ShotParams, ShotResult } from '@billiards/shared';
import { buildApp } from '../src/app';

describe('12. parity server ↔ client', () => {
  it('POST /api/simulate menghasilkan hasil identik dengan simulate() lokal', async () => {
    const app = await buildApp();
    const { table } = rackNineBall(2024);
    const shot: ShotParams = { dir: 0.003, speed: 8.5, tipX: 0.05, tipY: -0.1, elevation: 0.05 };
    const res = await app.inject({ method: 'POST', url: '/api/simulate', payload: { table, shot } });
    expect(res.statusCode).toBe(200);
    const remote = res.json() as ShotResult;
    // lokal: lewat JSON round-trip yang sama seperti postMessage/HTTP
    const local = JSON.parse(JSON.stringify(simulate(table, shot))) as ShotResult;
    expect(JSON.stringify(remote.finalState)).toBe(JSON.stringify(local.finalState));
    expect(JSON.stringify(remote.events)).toBe(JSON.stringify(local.events));
    expect(remote.frames.length).toBe(local.frames.length);
    await app.close();
  });
  it('health & validasi', async () => {
    const app = await buildApp();
    expect((await app.inject({ url: '/api/health' })).json()).toMatchObject({ ok: true });
    const bad = await app.inject({ method: 'POST', url: '/api/simulate', payload: { table: {} } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
