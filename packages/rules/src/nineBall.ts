/**
 * Aturan 9-ball (WPA, disederhanakan sesuai PLAN §6) sebagai state machine murni.
 * Tidak bergantung pada DOM/Three.js → bisa dijalankan di server sebagai wasit.
 */
import {
  BALL_RADIUS,
  FOOT_SPOT_X,
  HEAD_STRING_X,
  TABLE_LENGTH,
  TABLE_WIDTH,
  getGeometry,
  DEFAULT_PARAMS,
} from '@billiards/physics';
import type {
  BallState,
  FoulReason,
  GameState,
  MatchOptions,
  PlayerIndex,
  ShotSummary,
  SimEvent,
  TableState,
} from '@billiards/shared';
import { BREAK_CUE_POS, rackNineBall } from './rack';

const R = BALL_RADIUS;
const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);
const onTable = (b: BallState): boolean => b.motion !== 'pocketed' && b.motion !== 'off-table';

export const DEFAULT_OPTIONS: MatchOptions = {
  playerNames: ['Pemain 1', 'Pemain 2'],
  raceTo: 5,
  threeFoulRule: true,
  alternateBreak: false,
};

export function createMatch(options: Partial<MatchOptions> = {}, seed = 1): GameState {
  const opts: MatchOptions = { ...DEFAULT_OPTIONS, ...options };
  opts.raceTo = Math.max(1, Math.min(11, Math.round(opts.raceTo)));
  const rack = rackNineBall(seed);
  return {
    options: opts,
    seed: rack.seed,
    rackNumber: 1,
    scores: [0, 0],
    currentPlayer: 0,
    breaker: 0,
    phase: 'break',
    ballInHand: 'kitchen',
    pushOutAvailable: false,
    consecutiveFouls: [0, 0],
    table: rack.table,
    lastShot: null,
    rackWinner: null,
    matchWinner: null,
  };
}

/** Bola bernomor terendah yang masih di meja (0 bila tidak ada). */
export function lowestBall(table: TableState): number {
  let low = 0;
  for (const b of table.balls) if (b.id > 0 && onTable(b) && (low === 0 || b.id < low)) low = b.id;
  return low;
}

export function ballsOnTable(table: TableState): number[] {
  return table.balls
    .filter((b) => b.id > 0 && onTable(b))
    .map((b) => b.id)
    .sort((a, b) => a - b);
}

/** Apakah cue ball boleh diletakkan di (x, y)? */
export function isValidCuePlacement(
  table: TableState,
  x: number,
  y: number,
  kitchen: boolean,
): boolean {
  const hl = TABLE_LENGTH / 2 - R;
  const hw = TABLE_WIDTH / 2 - R;
  if (x < -hl || x > hl || y < -hw || y > hw) return false;
  if (kitchen && x > HEAD_STRING_X) return false;
  for (const b of table.balls) {
    if (b.id === 0 || !onTable(b)) continue;
    const dx = b.pos[0] - x;
    const dy = b.pos[1] - y;
    if (dx * dx + dy * dy < (2 * R + 0.0005) ** 2) return false;
  }
  for (const pk of getGeometry(DEFAULT_PARAMS).pockets) {
    if ((x - pk.cx) ** 2 + (y - pk.cy) ** 2 < (pk.r + 0.005) ** 2) return false;
  }
  return true;
}

/** Posisi valid terdekat dengan (x, y) untuk cue ball (pencarian spiral). */
export function nearestValidCuePlacement(
  table: TableState,
  x: number,
  y: number,
  kitchen: boolean,
): [number, number] {
  const hl = TABLE_LENGTH / 2 - R;
  const hw = TABLE_WIDTH / 2 - R;
  const cx = Math.max(-hl, Math.min(kitchen ? HEAD_STRING_X : hl, x));
  const cy = Math.max(-hw, Math.min(hw, y));
  if (isValidCuePlacement(table, cx, cy, kitchen)) return [cx, cy];
  for (let ring = 1; ring < 200; ring++) {
    const r = ring * 0.004;
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 0.004));
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      const px = cx + r * Math.cos(a);
      const py = cy + r * Math.sin(a);
      if (isValidCuePlacement(table, px, py, kitchen)) return [px, py];
    }
  }
  return [BREAK_CUE_POS[0], BREAK_CUE_POS[1]];
}

export function placeCueBall(state: GameState, x: number, y: number): GameState {
  if (state.ballInHand === 'none') return state;
  if (!isValidCuePlacement(state.table, x, y, state.ballInHand === 'kitchen')) return state;
  return {
    ...state,
    table: {
      balls: state.table.balls.map((b) => (b.id === 0 ? restBall(b, x, y) : b)),
    },
  };
}

function restBall(b: BallState, x: number, y: number): BallState {
  return {
    id: b.id,
    pos: [x, y, R],
    vel: [0, 0, 0],
    angVel: [0, 0, 0],
    quat: b.quat,
    motion: 'stationary',
  };
}

function spotFree(balls: BallState[], x: number, y: number, ignoreId: number): boolean {
  for (const b of balls) {
    if (b.id === ignoreId || !onTable(b)) continue;
    const dx = b.pos[0] - x;
    const dy = b.pos[1] - y;
    if (dx * dx + dy * dy < (2 * R + 0.0002) ** 2) return false;
  }
  return true;
}

/** Spot bola di foot spot, atau sedekat mungkin di belakangnya (ke arah rail kaki) pada long string. */
function spotBall(balls: BallState[], id: number): void {
  const b = balls.find((q) => q.id === id)!;
  const maxX = TABLE_LENGTH / 2 - R;
  let x = FOOT_SPOT_X;
  let found = false;
  for (; x <= maxX; x += 0.001) {
    if (spotFree(balls, x, 0, id)) {
      found = true;
      break;
    }
  }
  if (!found) {
    for (x = FOOT_SPOT_X; x >= -maxX; x -= 0.001) if (spotFree(balls, x, 0, id)) break;
  }
  Object.assign(b, restBall(b, x, 0));
  delete b.pocket;
}

export interface ShotInput {
  events: SimEvent[];
  finalState: TableState;
}

export interface ShotAnalysis {
  firstHit: number | null;
  pocketed: number[];
  cuePocketed: boolean;
  cueOffTable: boolean;
  offTable: number[];
  railAfterContact: boolean;
  /** jumlah object ball berbeda yang menyentuh cushion */
  objectBallsToRail: number;
}

export function analyzeShot(events: SimEvent[]): ShotAnalysis {
  let firstHit: number | null = null;
  let tContact = Infinity;
  for (const e of events) {
    if (e.type === 'ball-ball' && e.ids.includes(0)) {
      firstHit = e.ids[0] === 0 ? e.ids[1] : e.ids[0];
      tContact = e.t;
      break;
    }
  }
  const pocketed: number[] = [];
  const offTable: number[] = [];
  let cuePocketed = false;
  let cueOffTable = false;
  let railAfterContact = false;
  const railBalls = new Set<number>();
  for (const e of events) {
    if (e.type === 'pocket') {
      if (e.ids[0] === 0) cuePocketed = true;
      else pocketed.push(e.ids[0]);
    } else if (e.type === 'off-table') {
      if (e.ids[0] === 0) cueOffTable = true;
      else offTable.push(e.ids[0]);
    } else if (e.type === 'cushion' || e.type === 'jaw') {
      if (e.t >= tContact) railAfterContact = true;
      if (e.ids[0] !== 0) railBalls.add(e.ids[0]);
    }
  }
  return {
    firstHit,
    pocketed,
    cuePocketed,
    cueOffTable,
    offTable,
    railAfterContact,
    objectBallsToRail: railBalls.size,
  };
}

/**
 * Terapkan hasil satu pukulan. pushOut = pemain menyatakan push-out (hanya sah bila
 * state.pushOutAvailable).
 */
export function applyShot(state: GameState, shot: ShotInput, pushOut = false): GameState {
  if (state.phase !== 'break' && state.phase !== 'play') return state;
  const shooter = state.currentPlayer;
  const opp = other(shooter);
  const wasBreak = state.phase === 'break';
  const wasPushOut = pushOut && state.pushOutAvailable && !wasBreak;
  const target = lowestBall(state.table);
  const a = analyzeShot(shot.events);
  const anyPocketed = a.pocketed.length > 0;

  // ── foul ──
  let foul: FoulReason | null = null;
  if (a.cuePocketed) foul = 'scratch';
  else if (a.cueOffTable) foul = 'cue-off-table';
  else if (!wasPushOut && a.firstHit === null) foul = 'no-contact';
  else if (!wasPushOut && a.firstHit !== target) foul = 'wrong-ball-first';
  else if (a.offTable.length > 0) foul = 'ball-off-table';
  else if (!wasPushOut && wasBreak && !anyPocketed && a.objectBallsToRail < 4) foul = 'illegal-break';
  else if (!wasPushOut && !anyPocketed && !a.railAfterContact) foul = 'no-rail';

  // ── state meja baru ──
  const balls: BallState[] = shot.finalState.balls.map((b) => {
    if (onTable(b)) return restBall(b, b.pos[0], b.pos[1]);
    return { ...b, vel: [0, 0, 0], angVel: [0, 0, 0] };
  });
  const nine = balls.find((b) => b.id === 9);
  const nineDown = !!nine && !onTable(nine);
  const ninePocketed = a.pocketed.includes(9);

  const summary: ShotSummary = {
    shooter,
    foul,
    pocketed: a.pocketed,
    firstHit: a.firstHit,
    wasBreak,
    wasPushOut,
    nineSpotted: false,
    threeFoulLoss: false,
  };
  const next: GameState = {
    ...state,
    table: { balls },
    lastShot: summary,
    pushOutAvailable: false,
    consecutiveFouls: [state.consecutiveFouls[0], state.consecutiveFouls[1]],
  };

  const winRack = (winner: PlayerIndex): GameState => {
    next.rackWinner = winner;
    next.scores = [state.scores[0], state.scores[1]];
    next.scores[winner]++;
    next.ballInHand = 'none';
    if (next.scores[winner] >= state.options.raceTo) {
      next.matchWinner = winner;
      next.phase = 'match-over';
    } else {
      next.phase = 'rack-over';
    }
    return next;
  };

  // bola 9 masuk secara sah → menang rack
  if (ninePocketed && !foul && !wasPushOut) return winRack(shooter);

  // bola 9 turun secara tidak sah (foul / push-out / keluar meja) → di-spot
  if (nineDown) {
    spotBall(balls, 9);
    summary.nineSpotted = true;
  }
  // cue ball masuk/keluar → kembali ke meja (lawan ball in hand)
  const cue = balls.find((b) => b.id === 0);
  if (cue && !onTable(cue)) {
    const [x, y] = nearestValidCuePlacement({ balls }, BREAK_CUE_POS[0], BREAK_CUE_POS[1], false);
    Object.assign(cue, restBall(cue, x, y));
    delete cue.pocket;
  }

  if (foul) {
    next.consecutiveFouls[shooter]++;
    if (state.options.threeFoulRule && next.consecutiveFouls[shooter] >= 3) {
      summary.threeFoulLoss = true;
      return winRack(opp);
    }
    next.phase = 'play';
    next.currentPlayer = opp;
    next.ballInHand = 'anywhere';
    return next;
  }

  next.consecutiveFouls[shooter] = 0;
  next.ballInHand = 'none';
  if (wasPushOut) {
    next.phase = 'pushout-decision';
    next.currentPlayer = opp;
    return next;
  }
  next.phase = 'play';
  next.currentPlayer = anyPocketed ? shooter : opp;
  if (wasBreak) next.pushOutAvailable = true;
  return next;
}

/** Setelah push-out: lawan memilih main dari posisi itu (accept) atau mengembalikan giliran. */
export function resolvePushOut(state: GameState, accept: boolean): GameState {
  if (state.phase !== 'pushout-decision') return state;
  return {
    ...state,
    phase: 'play',
    currentPlayer: accept ? state.currentPlayer : other(state.currentPlayer),
  };
}

/** Mulai rack berikutnya setelah 'rack-over'. */
export function nextRack(state: GameState): GameState {
  if (state.phase !== 'rack-over' || state.rackWinner === null) return state;
  const rack = rackNineBall(state.seed);
  const breaker = state.options.alternateBreak ? other(state.breaker) : state.rackWinner;
  return {
    ...state,
    seed: rack.seed,
    rackNumber: state.rackNumber + 1,
    table: rack.table,
    breaker,
    currentPlayer: breaker,
    phase: 'break',
    ballInHand: 'kitchen',
    pushOutAvailable: false,
    consecutiveFouls: [0, 0],
    lastShot: null,
    rackWinner: null,
  };
}

export const FOUL_TEXT: Record<FoulReason, string> = {
  scratch: 'Scratch — cue ball masuk pocket',
  'cue-off-table': 'Cue ball keluar meja',
  'no-contact': 'Tidak mengenai bola',
  'wrong-ball-first': 'Salah bola pertama',
  'no-rail': 'Tidak ada bola yang menyentuh cushion',
  'ball-off-table': 'Bola keluar meja',
  'illegal-break': 'Break tidak sah',
};
