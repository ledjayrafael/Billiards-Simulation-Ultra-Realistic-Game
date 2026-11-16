import type { PhysicsParams } from '@billiards/physics';
import type { ShotParams, ShotResult, TableState } from '@billiards/shared';

/** Pembungkus Promise untuk Web Worker fisika. */
export class SimClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, (r: { result: ShotResult; ms: number }) => void>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; result: ShotResult; ms: number }>) => {
      const cb = this.pending.get(ev.data.id);
      if (cb) {
        this.pending.delete(ev.data.id);
        cb(ev.data);
      }
    };
  }

  simulate(
    table: TableState,
    shot: ShotParams | null,
    opts: { params?: Partial<PhysicsParams>; recordFrames?: boolean; maxTime?: number } = {},
  ): Promise<{ result: ShotResult; ms: number }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, table, shot, ...opts });
    });
  }
}
