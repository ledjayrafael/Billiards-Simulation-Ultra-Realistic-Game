import type { CueSpec } from '@billiards/shared';
import specs from '../../../blender/specs.json';

/** Semua parameter fisik; nilai default berasal dari blender/specs.json. */
export interface PhysicsParams {
  // meja
  L: number;
  W: number;
  noseHeight: number;
  cushionWidth: number;
  cushionTopHeight: number;
  cornerMouth: number;
  sideMouth: number;
  cornerJawAngle: number; // rad
  sideJawAngle: number; // rad
  cornerShelf: number;
  sideShelf: number;
  cornerPocketRadius: number;
  sidePocketRadius: number;
  jawTipRadius: number;
  // bola
  R: number;
  m: number;
  // stik default ('local'); stik lain memakai nilai katalog CUES (lihat cueParams di cue.ts)
  cueMass: number;
  tipRestitution: number;
  miscueLimit: number;
  squirtMax: number; // rad pada offset = miscueLimit
  cuePower: number; // pengali kecepatan ayunan (1 = stik lokal)
  cueSpin: number; // pengali spin yang ditransfer tip (1 = stik lokal)
  // koefisien
  g: number;
  muSlide: number;
  muRoll: number;
  muSpin: number;
  eBall: number;
  ballFrictionA: number;
  ballFrictionB: number;
  ballFrictionC: number;
  eCushion: number;
  eCushionSpeedLoss: number;
  eCushionMin: number;
  muCushion: number;
  eSlate: number;
  eJump: number;
  hopThreshold: number;
}

const DEG = Math.PI / 180;

export const SPECS = specs;

/** Katalog stik (urutan = urutan di menu). */
export const CUES: readonly CueSpec[] = Object.freeze(specs.cues.map((c) => Object.freeze({ ...c }) as CueSpec));
export const DEFAULT_CUE_ID = 'local';
export const JUMP_CUE_ID = 'jump';
/** Id stik dari ShotParams.cue (termasuk nilai lama 'standard') → spesifikasi; fallback 'local'. */
export function cueSpec(id: string | undefined): CueSpec {
  const key = id === undefined || id === 'standard' ? DEFAULT_CUE_ID : id;
  return CUES.find((c) => c.id === key) ?? CUES.find((c) => c.id === DEFAULT_CUE_ID)!;
}
const clampRating = (r: number): number => Math.min(10, Math.max(1, r));
/** Sudut squirt maksimum (deg, pada offset = miscueLimit) dari rating DEFLECTION 1..10. */
export function squirtMaxDeg(deflection: number): number {
  return 3.0 - 0.25 * clampRating(deflection);
}
const LOCAL = cueSpec(DEFAULT_CUE_ID);
/** Pengali kecepatan ayunan dari rating POWER 1..10; stik lokal = 1 (≈ +2,5% per poin di atasnya). */
export function cuePowerFactor(power: number): number {
  return 1 + 0.025 * (clampRating(power) - LOCAL.power);
}
/** Pengali spin dari rating SPIN 1..10; stik lokal = 1 (≈ +4% per poin di atasnya). */
export function cueSpinFactor(spin: number): number {
  return 1 + 0.04 * (clampRating(spin) - LOCAL.spin);
}

export const DEFAULT_PARAMS: Readonly<PhysicsParams> = Object.freeze({
  L: specs.table.length,
  W: specs.table.width,
  noseHeight: specs.table.cushionNoseHeight,
  cushionWidth: specs.table.cushionWidth,
  cushionTopHeight: specs.table.cushionTopHeight,
  cornerMouth: specs.table.cornerMouth,
  sideMouth: specs.table.sideMouth,
  cornerJawAngle: specs.table.cornerJawAngleDeg * DEG,
  sideJawAngle: specs.table.sideJawAngleDeg * DEG,
  cornerShelf: specs.table.cornerShelf,
  sideShelf: specs.table.sideShelf,
  cornerPocketRadius: specs.table.cornerPocketRadius,
  sidePocketRadius: specs.table.sidePocketRadius,
  jawTipRadius: specs.table.jawTipRadius,
  R: specs.ball.radius,
  m: specs.ball.mass,
  cueMass: LOCAL.mass,
  tipRestitution: LOCAL.tipRestitution,
  miscueLimit: LOCAL.miscueLimit,
  squirtMax: squirtMaxDeg(LOCAL.deflection) * DEG,
  cuePower: cuePowerFactor(LOCAL.power),
  cueSpin: cueSpinFactor(LOCAL.spin),
  g: specs.physics.gravity,
  muSlide: specs.physics.muSlide,
  muRoll: specs.physics.muRoll,
  muSpin: specs.physics.muSpin,
  eBall: specs.physics.ballRestitution,
  ballFrictionA: specs.physics.ballFrictionA,
  ballFrictionB: specs.physics.ballFrictionB,
  ballFrictionC: specs.physics.ballFrictionC,
  eCushion: specs.physics.cushionRestitution,
  eCushionSpeedLoss: specs.physics.cushionRestitutionSpeedLoss,
  eCushionMin: specs.physics.cushionRestitutionMin,
  muCushion: specs.physics.muCushion,
  eSlate: specs.physics.slateRestitution,
  eJump: specs.physics.jumpRestitution,
  hopThreshold: specs.physics.hopThreshold,
});

export const BALL_RADIUS = specs.ball.radius;
export const TABLE_LENGTH = specs.table.length;
export const TABLE_WIDTH = specs.table.width;
export const CUE_MIN_SPEED = specs.cue.minSpeed;
export const CUE_MAX_SPEED = specs.cue.maxSpeed;
export const CUE_LENGTH = specs.cue.length;
/** Foot spot: tengah lebar, 1/4 panjang dari rail kaki (+x). */
export const FOOT_SPOT_X = specs.table.length / 4;
/** Head string: 1/4 panjang dari rail kepala (−x). Kitchen = x <= HEAD_STRING_X. */
export const HEAD_STRING_X = -specs.table.length / 4;
export const RACK_GAP = specs.rack.gap;
