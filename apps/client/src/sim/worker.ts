import { simulate, type PhysicsParams } from '@billiards/physics';
import type { ShotParams, TableState } from '@billiards/shared';

export interface SimRequest {
  id: number;
  table: TableState;
  shot: ShotParams | null;
  params?: Partial<PhysicsParams>;
  recordFrames?: boolean;
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<SimRequest>) => void) | null;
  postMessage(msg: unknown): void;
};

ctx.onmessage = (ev) => {
  const { id, table, shot, params, recordFrames } = ev.data;
  const t0 = performance.now();
  const result = simulate(table, shot, { params, recordFrames });
  ctx.postMessage({ id, result, ms: performance.now() - t0 });
};
