import { describe, expect, it } from 'vitest';
import { BALL_RADIUS as R, FOOT_SPOT_X, HEAD_STRING_X, makeBall, simulate } from '@billiards/physics';
import type { BallState, GameState, SimEvent, TableState } from '@billiards/shared';
import {
  applyShot,
  createMatch,
  isValidCuePlacement,
  lowestBall,
  nextRack,
  placeCueBall,
  rackNineBall,
  resolvePushOut,
} from '../src';

const ev = (t: number, type: SimEvent['type'], ...ids: number[]): SimEvent => ({ t, type, ids, speed: 1, pos: [0, 0, R] });
const hit = (t: number, id: number): SimEvent => ev(t, 'ball-ball', 0, id);
const rail = (t: number, id: number): SimEvent => ev(t, 'cushion', id);
const pot = (t: number, id: number): SimEvent => ev(t, 'pocket', id);

/** State meja setelah pukulan: bola di `down` dianggap masuk. */
function after(state: GameState, down: number[] = [], off: number[] = []): TableState {
  return {
    balls: state.table.balls.map((b): BallState => {
      if (down.includes(b.id)) return { ...b, motion: 'pocketed', pocket: 0 };
      if (off.includes(b.id)) return { ...b, motion: 'off-table' };
      return b;
    }),
  };
}
/** Match yang sudah melewati break sah tanpa bola masuk → giliran pemain 2, fase play. */
function afterBreak(opts = {}): GameState {
  const s = createMatch(opts, 5);
  return applyShot(s, { events: [hit(0.1, 1), rail(0.3, 2), rail(0.3, 3), rail(0.4, 4), rail(0.5, 5)], finalState: after(s) });
}

describe('rack', () => {
  it('belah ketupat: 1 di apex pada foot spot, 9 di tengah, rapat, deterministik', () => {
    const { table } = rackNineBall(42);
    const b = (id: number): BallState => table.balls.find((q) => q.id === id)!;
    expect(b(1).pos[0]).toBeCloseTo(FOOT_SPOT_X, 9);
    expect(b(1).pos[1]).toBeCloseTo(0, 9);
    const d = 2 * R + 0.0001;
    expect(b(9).pos[0]).toBeCloseTo(FOOT_SPOT_X + d * Math.sqrt(3), 9);
    expect(b(9).pos[1]).toBeCloseTo(0, 9);
    expect(table.balls.length).toBe(10);
    for (const p of table.balls) for (const q of table.balls) {
      if (p.id < q.id) expect(Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1])).toBeGreaterThan(2 * R);
    }
    expect(JSON.stringify(rackNineBall(42))).toBe(JSON.stringify(rackNineBall(42)));
    expect(JSON.stringify(rackNineBall(42).table)).not.toBe(JSON.stringify(rackNineBall(43).table));
    expect(b(0).pos[0]).toBeLessThan(HEAD_STRING_X);
  });
});

describe('break', () => {
  it('break sah tanpa bola masuk → ganti giliran, push-out tersedia', () => {
    const s = afterBreak();
    expect(s.lastShot!.foul).toBeNull();
    expect(s.phase).toBe('play');
    expect(s.currentPlayer).toBe(1);
    expect(s.pushOutAvailable).toBe(true);
    expect(s.ballInHand).toBe('none');
  });
  it('break sah dengan bola masuk → breaker lanjut', () => {
    const s0 = createMatch({}, 5);
    const s = applyShot(s0, { events: [hit(0.1, 1), pot(0.5, 3)], finalState: after(s0, [3]) });
    expect(s.lastShot!.foul).toBeNull();
    expect(s.currentPlayer).toBe(0);
    expect(s.pushOutAvailable).toBe(true);
  });
  it('kurang dari 4 bola ke cushion dan tak ada yang masuk → foul', () => {
    const s0 = createMatch({}, 5);
    const s = applyShot(s0, { events: [hit(0.1, 1), rail(0.3, 2), rail(0.3, 3), rail(0.3, 0)], finalState: after(s0) });
    expect(s.lastShot!.foul).toBe('illegal-break');
    expect(s.currentPlayer).toBe(1);
    expect(s.ballInHand).toBe('anywhere');
  });
  it('bola 9 masuk saat break → menang rack', () => {
    const s0 = createMatch({ raceTo: 3 }, 5);
    const s = applyShot(s0, { events: [hit(0.1, 1), pot(0.5, 9)], finalState: after(s0, [9]) });
    expect(s.phase).toBe('rack-over');
    expect(s.rackWinner).toBe(0);
    expect(s.scores).toEqual([1, 0]);
  });
  it('cue ball harus di kitchen saat break', () => {
    const s = createMatch({}, 5);
    expect(s.ballInHand).toBe('kitchen');
    expect(isValidCuePlacement(s.table, HEAD_STRING_X - 0.05, 0.2, true)).toBe(true);
    expect(isValidCuePlacement(s.table, HEAD_STRING_X + 0.05, 0.2, true)).toBe(false);
    expect(placeCueBall(s, 0.3, 0)).toBe(s);
    expect(placeCueBall(s, -0.9, 0.3).table.balls[0].pos).toEqual([-0.9, 0.3, R]);
  });
});

describe('pukulan sah & foul', () => {
  it('kena bola terendah + rail, tak ada yang masuk → ganti giliran tanpa foul', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 1), rail(0.4, 1)], finalState: after(s0) });
    expect(s.lastShot!.foul).toBeNull();
    expect(s.currentPlayer).toBe(0);
    expect(s.ballInHand).toBe('none');
    expect(s.pushOutAvailable).toBe(false);
  });
  it('memasukkan bola secara sah → lanjut menembak', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 1), pot(0.6, 1)], finalState: after(s0, [1]) });
    expect(s.currentPlayer).toBe(1);
    expect(lowestBall(s.table)).toBe(2);
  });
  it('scratch', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 1), pot(0.6, 0)], finalState: after(s0, [0]) });
    expect(s.lastShot!.foul).toBe('scratch');
    expect(s.currentPlayer).toBe(0);
    expect(s.ballInHand).toBe('anywhere');
    expect(s.table.balls[0].motion).toBe('stationary');
  });
  it('salah bola pertama', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 4), rail(0.4, 4)], finalState: after(s0) });
    expect(s.lastShot!.foul).toBe('wrong-ball-first');
  });
  it('tidak mengenai bola', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [rail(0.4, 0)], finalState: after(s0) });
    expect(s.lastShot!.foul).toBe('no-contact');
  });
  it('tidak ada cushion setelah kontak (rail sebelum kontak tidak dihitung)', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [rail(0.05, 0), hit(0.1, 1)], finalState: after(s0) });
    expect(s.lastShot!.foul).toBe('no-rail');
    const ok = applyShot(s0, { events: [hit(0.1, 1), rail(0.5, 0)], finalState: after(s0) });
    expect(ok.lastShot!.foul).toBeNull();
  });
  it('object ball keluar meja → foul, tidak dikembalikan', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 1), ev(0.5, 'off-table', 3)], finalState: after(s0, [], [3]) });
    expect(s.lastShot!.foul).toBe('ball-off-table');
    expect(s.table.balls.find((b) => b.id === 3)!.motion).toBe('off-table');
  });
  it('cue ball keluar meja', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 1), ev(0.5, 'off-table', 0)], finalState: after(s0, [], [0]) });
    expect(s.lastShot!.foul).toBe('cue-off-table');
    expect(s.table.balls[0].motion).toBe('stationary');
  });
});

describe('bola 9', () => {
  it('kombinasi sah memasukkan 9 → menang rack', () => {
    const s0 = afterBreak({ raceTo: 2 });
    const s = applyShot(s0, { events: [hit(0.1, 1), ev(0.2, 'ball-ball', 1, 9), pot(0.6, 9)], finalState: after(s0, [9]) });
    expect(s.rackWinner).toBe(1);
    expect(s.scores).toEqual([0, 1]);
    expect(s.phase).toBe('rack-over');
  });
  it('9 masuk saat foul → di-spot di foot spot, lawan ball in hand', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [hit(0.1, 5), pot(0.6, 9)], finalState: after(s0, [9]) });
    expect(s.lastShot!.foul).toBe('wrong-ball-first');
    expect(s.lastShot!.nineSpotted).toBe(true);
    const nine = s.table.balls.find((b) => b.id === 9)!;
    expect(nine.motion).toBe('stationary');
    expect(nine.pos[1]).toBe(0);
    expect(nine.pos[0]).toBeGreaterThanOrEqual(FOOT_SPOT_X);
    for (const b of s.table.balls) {
      if (b.id !== 9 && b.motion === 'stationary') {
        expect(Math.hypot(b.pos[0] - nine.pos[0], b.pos[1] - nine.pos[1])).toBeGreaterThanOrEqual(2 * R);
      }
    }
    expect(s.ballInHand).toBe('anywhere');
    expect(s.phase).toBe('play');
  });
  it('9 di-spot tepat di foot spot bila kosong', () => {
    const s0 = afterBreak();
    const cleared: GameState = { ...s0, table: { balls: [makeBall(0, -0.5, 0, R), makeBall(1, 0, 0.3, R), makeBall(9, 0.9, 0.3, R)] } };
    const s = applyShot(cleared, { events: [pot(0.6, 9)], finalState: after(cleared, [9]) });
    expect(s.table.balls.find((b) => b.id === 9)!.pos).toEqual([FOOT_SPOT_X, 0, R]);
  });
});

describe('push-out', () => {
  it('push-out tidak wajib kena bola/rail; lawan memilih', () => {
    const s0 = afterBreak();
    expect(s0.pushOutAvailable).toBe(true);
    const s = applyShot(s0, { events: [], finalState: after(s0) }, true);
    expect(s.lastShot!.foul).toBeNull();
    expect(s.lastShot!.wasPushOut).toBe(true);
    expect(s.phase).toBe('pushout-decision');
    expect(s.currentPlayer).toBe(0);
    const play = resolvePushOut(s, true);
    expect(play.phase).toBe('play');
    expect(play.currentPlayer).toBe(0);
    const back = resolvePushOut(s, false);
    expect(back.currentPlayer).toBe(1);
    expect(back.pushOutAvailable).toBe(false);
  });
  it('scratch saat push-out tetap foul; 9 yang masuk di-spot', () => {
    const s0 = afterBreak();
    const s = applyShot(s0, { events: [pot(0.5, 0)], finalState: after(s0, [0]) }, true);
    expect(s.lastShot!.foul).toBe('scratch');
    const s2 = applyShot(s0, { events: [hit(0.1, 9), pot(0.5, 9)], finalState: after(s0, [9]) }, true);
    expect(s2.lastShot!.foul).toBeNull();
    expect(s2.lastShot!.nineSpotted).toBe(true);
    expect(s2.rackWinner).toBeNull();
  });
  it('push-out hanya berlaku tepat setelah break', () => {
    const s0 = afterBreak();
    const s1 = applyShot(s0, { events: [hit(0.1, 1), rail(0.4, 1)], finalState: after(s0) });
    const s2 = applyShot(s1, { events: [], finalState: after(s1) }, true);
    expect(s2.lastShot!.wasPushOut).toBe(false);
    expect(s2.lastShot!.foul).toBe('no-contact');
  });
});

describe('3 foul & race', () => {
  it('3 foul berturut-turut → kalah rack', () => {
    let s = afterBreak(); // giliran pemain 1 (index 1)
    const foulShot = (st: GameState): GameState => applyShot(st, { events: [], finalState: after(st) });
    const legal = (st: GameState): GameState => applyShot(st, { events: [hit(0.1, lowestBall(st.table)), rail(0.4, 0)], finalState: after(st) });
    s = foulShot(s); // p1 foul 1
    expect(s.consecutiveFouls).toEqual([0, 1]);
    s = legal(s); // p0 sah
    s = foulShot(s); // p1 foul 2
    expect(s.consecutiveFouls[1]).toBe(2);
    s = legal(s);
    s = foulShot(s); // p1 foul 3
    expect(s.lastShot!.threeFoulLoss).toBe(true);
    expect(s.rackWinner).toBe(0);
    expect(s.scores).toEqual([1, 0]);
  });
  it('pukulan sah mereset hitungan foul; aturan bisa dimatikan', () => {
    let s = afterBreak();
    s = applyShot(s, { events: [], finalState: after(s) });
    s = applyShot(s, { events: [hit(0.1, 1), rail(0.4, 0)], finalState: after(s) });
    s = applyShot(s, { events: [hit(0.1, 1), rail(0.4, 0)], finalState: after(s) });
    expect(s.consecutiveFouls).toEqual([0, 0]);
    let n = afterBreak({ threeFoulRule: false });
    for (let i = 0; i < 6; i++) n = applyShot({ ...n, currentPlayer: 1 }, { events: [], finalState: after(n) });
    expect(n.rackWinner).toBeNull();
  });
  it('race to N: pemenang rack break berikutnya; match selesai', () => {
    let s = createMatch({ raceTo: 2 }, 9);
    const win = (st: GameState): GameState => applyShot(st, { events: [hit(0.1, 1), pot(0.5, 9)], finalState: after(st, [9]) });
    s = win(s);
    expect(s.phase).toBe('rack-over');
    s = nextRack(s);
    expect(s.phase).toBe('break');
    expect(s.breaker).toBe(0);
    expect(s.rackNumber).toBe(2);
    expect(s.ballInHand).toBe('kitchen');
    expect(s.table.balls.filter((b) => b.motion === 'stationary').length).toBe(10);
    s = win(s);
    expect(s.phase).toBe('match-over');
    expect(s.matchWinner).toBe(0);
    expect(s.scores).toEqual([2, 0]);
    expect(applyShot(s, { events: [], finalState: s.table })).toBe(s);
  });
  it('opsi break bergantian', () => {
    let s = createMatch({ raceTo: 3, alternateBreak: true }, 9);
    s = applyShot(s, { events: [hit(0.1, 1), pot(0.5, 9)], finalState: after(s, [9]) });
    s = nextRack(s);
    expect(s.breaker).toBe(1);
    expect(s.currentPlayer).toBe(1);
  });
});

describe('integrasi dengan mesin fisika', () => {
  it('break nyata → state konsisten', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s0 = createMatch({}, seed);
      const res = simulate(s0.table, { dir: 0, speed: 8.5, tipX: 0, tipY: 0, elevation: 0 });
      const s = applyShot(s0, res);
      expect(s.lastShot!.firstHit).toBe(1);
      expect(['play', 'rack-over', 'match-over']).toContain(s.phase);
      for (const b of s.table.balls) {
        if (b.motion === 'stationary') expect(b.vel).toEqual([0, 0, 0]);
      }
      expect(s.table.balls.find((b) => b.id === 0)!.motion).toBe('stationary');
    }
  });
});
