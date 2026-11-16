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
  // stik
  cueMass: number;
  tipRestitution: number;
  miscueLimit: number;
  squirtMax: number; // rad pada offset = miscueLimit
  // jump cue: pendek, ringan, tip keras (phenolic)
  jumpCueMass: number;
  jumpTipRestitution: number;
  /** restitusi slate untuk pukulan jump cue (stik ringan lebih sedikit "menahan" bola ke slate) */
  eJumpCue: number;
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
  cueMass: specs.cue.mass,
  tipRestitution: specs.cue.tipRestitution,
  miscueLimit: specs.cue.miscueLimit,
  squirtMax: specs.cue.squirtMaxDeg * DEG,
  jumpCueMass: specs.cue.jumpMass,
  jumpTipRestitution: specs.cue.jumpTipRestitution,
  eJumpCue: specs.cue.jumpSlateRestitution,
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
export const JUMP_CUE_LENGTH = specs.cue.jumpLength;
/** Foot spot: tengah lebar, 1/4 panjang dari rail kaki (+x). */
export const FOOT_SPOT_X = specs.table.length / 4;
/** Head string: 1/4 panjang dari rail kepala (−x). Kitchen = x <= HEAD_STRING_X. */
export const HEAD_STRING_X = -specs.table.length / 4;
export const RACK_GAP = specs.rack.gap;
