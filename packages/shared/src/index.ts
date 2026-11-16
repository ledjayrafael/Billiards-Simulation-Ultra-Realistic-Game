/**
 * Tipe bersama (JSON murni, serializable) untuk physics, rules, client dan server.
 * Sistem sumbu: x = panjang meja, y = lebar meja, z = atas. Origin = tengah permukaan kain.
 */
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

/** Parameter satu pukulan stik. */
export interface ShotParams {
  /** Arah bidik horizontal (rad), diukur dari +x ke +y. */
  dir: number;
  /** Kecepatan stik saat kontak (m/s). */
  speed: number;
  /** Offset tip dari pusat bola, pecahan R. +x = kanan (dari sudut pandang penembak). */
  tipX: number;
  /** Offset tip vertikal, pecahan R. +y = atas (follow), − = bawah (draw). */
  tipY: number;
  /** Elevasi stik (rad), 0 = mendatar. */
  elevation: number;
  /** Jenis stik; default 'standard'. Jump cue: lebih ringan, tip keras → bola lebih mudah melompat. */
  cue?: CueType;
}

export type CueType = 'standard' | 'jump';

export type BallMotion =
  | 'stationary'
  | 'spinning'
  | 'rolling'
  | 'sliding'
  | 'airborne'
  | 'pocketed'
  | 'off-table';

export interface BallState {
  /** 0 = cue ball, 1..9 = object ball. */
  id: number;
  pos: Vec3;
  vel: Vec3;
  angVel: Vec3;
  quat: Quat;
  motion: BallMotion;
  /** Index pocket bila motion = 'pocketed'. */
  pocket?: number;
}

export interface TableState {
  balls: BallState[];
}

export type SimEventType =
  | 'cue'
  | 'miscue'
  | 'ball-ball'
  | 'cushion'
  | 'jaw'
  | 'pocket'
  | 'slate'
  | 'off-table';

export interface SimEvent {
  t: number;
  type: SimEventType;
  /** Bola yang terlibat (1 atau 2 id). */
  ids: number[];
  /** Kecepatan relatif/tumbukan (m/s), untuk volume suara. */
  speed: number;
  pos: Vec3;
  /** Index cushion (0..5) untuk 'cushion'/'jaw', index pocket (0..5) untuk 'pocket'. */
  index?: number;
}

/** Keyframe satu bola. t naik; p = xyz flat; q = xyzw flat. */
export interface BallTrack {
  id: number;
  t: number[];
  p: number[];
  q: number[];
}

export interface ShotResult {
  events: SimEvent[];
  frames: BallTrack[];
  finalState: TableState;
  duration: number;
  /** true bila simulasi dihentikan oleh batas aman. */
  truncated: boolean;
}

// ───────────────────────── Aturan 9-ball ─────────────────────────

export type PlayerIndex = 0 | 1;

export interface MatchOptions {
  playerNames: [string, string];
  raceTo: number;
  threeFoulRule: boolean;
  alternateBreak: boolean;
}

export type FoulReason =
  | 'scratch'
  | 'cue-off-table'
  | 'no-contact'
  | 'wrong-ball-first'
  | 'no-rail'
  | 'ball-off-table'
  | 'illegal-break';

export type GamePhase =
  /** Menunggu break (cue ball in hand di kitchen). */
  | 'break'
  /** Permainan biasa. */
  | 'play'
  /** Lawan memilih: main dari posisi push-out atau kembalikan giliran. */
  | 'pushout-decision'
  | 'rack-over'
  | 'match-over';

export interface ShotSummary {
  shooter: PlayerIndex;
  foul: FoulReason | null;
  pocketed: number[];
  firstHit: number | null;
  wasBreak: boolean;
  wasPushOut: boolean;
  nineSpotted: boolean;
  threeFoulLoss: boolean;
}

export interface GameState {
  options: MatchOptions;
  /** State PRNG (mulberry32) — diperbarui tiap rack. */
  seed: number;
  rackNumber: number;
  scores: [number, number];
  currentPlayer: PlayerIndex;
  breaker: PlayerIndex;
  phase: GamePhase;
  ballInHand: 'none' | 'kitchen' | 'anywhere';
  /** Pemain saat ini boleh menyatakan push-out (tepat setelah break sah). */
  pushOutAvailable: boolean;
  consecutiveFouls: [number, number];
  table: TableState;
  lastShot: ShotSummary | null;
  rackWinner: PlayerIndex | null;
  matchWinner: PlayerIndex | null;
}
