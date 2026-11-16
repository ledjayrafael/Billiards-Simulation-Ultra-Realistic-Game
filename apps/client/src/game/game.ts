import * as THREE from 'three';
import {
  BALL_RADIUS as R,
  CUE_MAX_SPEED,
  CUE_MIN_SPEED,
  DEFAULT_PARAMS,
  TABLE_LENGTH,
  jumpLiftSpeed,
  squirtAngle,
} from '@billiards/physics';
import {
  applyShot,
  createMatch,
  lowestBall,
  nearestValidCuePlacement,
  nextRack,
  placeCueBall,
  resolvePushOut,
} from '@billiards/rules';
import type {
  CueType,
  GameState,
  MatchOptions,
  ShotParams,
  ShotResult,
  SimEvent,
  TableState,
} from '@billiards/shared';
import { CameraRig, type RigContext } from '../camera/rig';
import { AimGuide } from '../render/aimGuide';
import { JumpPreview } from '../render/jumpPreview';
import { MIN_ELEV, resolveStroke, type Stroke } from './cueClearance';
import { BallViews } from '../render/ballViews';
import { CueView } from '../render/cueView';
import type { World } from '../render/world';
import { SimClient } from '../sim/client';
import { POWER_MAX, POWER_MIN, POWER_STEP, powerSpeed } from './power';
import type { Settings } from './settings';

export type GameMode =
  | 'idle' // menu / belum ada pertandingan
  | 'aim'
  | 'stroke' // animasi stik maju + menunggu hasil simulasi
  | 'play' // bola bergerak
  | 'replay'
  | 'decision' // lawan memutuskan push-out
  | 'over'; // rack / match selesai

export interface GameEvents {
  change: void;
  simEvent: { event: SimEvent; replay: boolean };
  shot: { isBreak: boolean; speed: number; miscue: boolean };
  turn: { player: number; reason: string; changed: boolean };
  toast: { text: string; kind: 'info' | 'foul' | 'good' };
  rackOver: { winner: number; matchOver: boolean };
  /** kartu judul sebelum replay mulai diputar */
  replayTitle: { shooter: number; isBreak: boolean; duration: number };
}

type Handler<T> = (payload: T) => void;

const MAX_PULL = 0.3;
const roundLevel = (v: number): number => Math.round(Math.min(POWER_MAX, Math.max(POWER_MIN, v)) * 10) / 10;
const TIP_LIMIT = 0.6;
/** durasi kartu judul replay (detik, waktu nyata) */
const REPLAY_TITLE_DUR = 1.6;
const MAX_ELEV = (80 * Math.PI) / 180;
/** elevasi awal saat jump cue dipilih (rad) — tipikal jump shot pendek */
const JUMP_ELEV = (50 * Math.PI) / 180;
/** rentang elevasi jump cue (rad): di bawah ~25° bola nyaris tidak terangkat */
export const JUMP_MIN_ELEV = (25 * Math.PI) / 180;
export const JUMP_MAX_ELEV = MAX_ELEV;
/** batas titik pukul jump cue (pecahan R): english besar pada elevasi tinggi = miscue */
export const JUMP_TIP_LIMIT = 0.3;
/** jeda sebelum prediksi lompatan dihitung ulang setelah input berubah (detik) */
const PREVIEW_DEBOUNCE = 0.06;
/** titik pukul tertinggi yang dipilih otomatis saat stik didatarkan di atas rail (aman dari miscue) */
const AUTO_FOLLOW_MAX = 0.45;
/** laju penghalusan tampilan bidikan (1/detik) — cepat, tapi tanpa lompatan per piksel */
const AIM_SMOOTH = 28;
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Cue ball benar-benar terbang (≥ 5 mm) sebelum kontak pertamanya dengan bola lain. */
function airborneBeforeContact(res: ShotResult): boolean {
  const hit = res.events.find((e) => e.type === 'ball-ball' && e.ids.includes(0));
  const tHit = hit ? hit.t : res.duration;
  const tr = res.frames.find((f) => f.id === 0);
  if (!tr) return false;
  for (let i = 0; i < tr.t.length && tr.t[i] <= tHit; i++) if (tr.p[i * 3 + 2] > R + 0.005) return true;
  return false;
}

/** Orkestrasi: giliran, bidikan, pukulan → simulasi (worker) → playback → aturan. */
export class Game {
  readonly rig: CameraRig;
  readonly ballViews: BallViews;
  readonly cueView: CueView;
  readonly guide = new AimGuide();
  readonly sim = new SimClient();
  /** worker terpisah untuk prediksi lompatan, agar tidak mengantre di depan pukulan sungguhan */
  private readonly previewSim = new SimClient();
  readonly jumpPreview: JumpPreview;

  match: GameState | null = null;
  mode: GameMode = 'idle';
  aimDir = 0;
  /** arah bidik yang ditampilkan (stik, garis bidik, kamera): mengikuti aimDir secara halus */
  aimView = 0;
  tipX = 0;
  tipY = 0;
  elevation = 0;
  /** stik yang dipakai: jump cue (pendek, ringan) atau stik biasa */
  cueType: CueType = 'standard';
  private elevBeforeJump = 0;
  private previewKey = '';
  private previewBusy = false;
  private previewWait = 0;
  /** Dekat rail, elevasi & titik pukul saling terkait. 'tip': titik pukul pemain dipertahankan
   *  (elevasi naik); 'elev': elevasi pemain dipertahankan (titik pukul naik → follow). */
  private railPriority: 'tip' | 'elev' = 'tip';
  /** tarikan stik (m) */
  pull = 0;
  /** level power terkunci (1,0–5,0, kelipatan 0,1); diingat antar pukulan */
  powerLevel = 2.5;
  /** Space ditekan: bidikan terkunci, mouse mengatur power */
  powerActive = false;
  pushOutArmed = false;
  lastSimMs = 0;
  playSpeed = 1;

  private handlers: { [K in keyof GameEvents]?: Handler<GameEvents[K]>[] } = {};
  private result: ShotResult | null = null;
  private pending: ShotResult | null = null;
  private pendingShot: ShotParams | null = null;
  private last: { before: TableState; result: ShotResult; isBreak: boolean; shooter: number; jump: boolean } | null = null;
  /** sisa waktu kartu judul replay; bola diam selama > 0 */
  private replayHold = 0;
  private playT = 0;
  private eventCursor = 0;
  private strokeT = 0;
  private strokeDur = 0.1;
  private strokeFrom = 0;
  private followT = 0;
  private followMin = Infinity;
  private powerRaw = 2.5;
  private shotIsBreak = false;
  private focus: [number, number] = [0, 0];
  private lastTurnPlayer = -1;

  constructor(
    readonly world: World,
    public settings: Settings,
  ) {
    this.rig = new CameraRig(world.camera, world.assets.cameras, world.assets.manifest);
    this.ballViews = new BallViews(world.balls);
    this.cueView = new CueView(world.cue);
    this.guide.mode = settings.guide;
    world.scene.add(this.guide.group);
    this.jumpPreview = new JumpPreview();
    world.scene.add(this.jumpPreview.group);
  }

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): void {
    (this.handlers[type] ??= [] as never[]).push(fn as never);
  }
  private emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    for (const fn of this.handlers[type] ?? []) (fn as Handler<GameEvents[K]>)(payload);
  }

  // ───────────── pertandingan ─────────────

  startMatch(options: Partial<MatchOptions>, seed = (Date.now() & 0x7fffffff) | 1): void {
    this.match = createMatch(options, seed);
    this.last = null;
    this.lastTurnPlayer = -1;
    this.ballViews.setTable(this.match.table);
    this.beginTurn('Break');
  }

  quitMatch(): void {
    this.match = null;
    this.mode = 'idle';
    this.cueView.visible = false;
    this.guide.group.visible = false;
    this.jumpPreview.clear();
    this.emit('change', undefined);
  }

  get cueBall(): { x: number; y: number } {
    const c = this.match?.table.balls.find((b) => b.id === 0);
    return c ? { x: c.pos[0], y: c.pos[1] } : { x: -TABLE_LENGTH / 4, y: 0 };
  }

  private beginTurn(reason: string): void {
    const m = this.match!;
    this.mode = 'aim';
    this.pull = 0;
    this.powerActive = false;
    this.pushOutArmed = false;
    this.tipX = 0;
    this.tipY = 0;
    this.elevation = 0;
    this.railPriority = 'tip';
    this.setCueType('standard');
    this.autoAim();
    this.rig.endShot();
    const changed = m.currentPlayer !== this.lastTurnPlayer || m.phase === 'break';
    this.lastTurnPlayer = m.currentPlayer;
    this.emit('turn', { player: m.currentPlayer, reason, changed });
    this.emit('change', undefined);
  }

  /** Arahkan bidikan ke bola bernomor terendah. */
  autoAim(): void {
    const m = this.match;
    if (!m) return;
    const low = m.table.balls.find((b) => b.id === lowestBall(m.table));
    const c = this.cueBall;
    if (low) this.aimDir = this.aimView = Math.atan2(low.pos[1] - c.y, low.pos[0] - c.x);
  }

  // ───────────── input ─────────────

  aimBy(delta: number): void {
    if (this.mode !== 'aim' || this.powerActive || this.pull > 0.002) return;
    this.aimDir = wrapAngle(this.aimDir + delta);
  }
  /** Titik pukul absolut (widget spin): titik ini dipertahankan, elevasi menyesuaikan rail. */
  setTip(x: number, y: number): void {
    if (this.mode !== 'aim' || this.powerActive) return;
    this.railPriority = 'tip';
    this.applyTip(x, y);
  }
  /** Geser titik pukul (keyboard), mulai dari titik pukul efektif yang sedang dipakai. */
  nudgeTip(dx: number, dy: number): void {
    if (this.mode !== 'aim' || this.powerActive) return;
    if (dy) this.railPriority = 'tip';
    this.applyTip(this.tipX + dx, dy ? this.stroke().tipY + dy : this.tipY);
  }
  private applyTip(x: number, y: number): void {
    const d = Math.hypot(x, y);
    const lim = this.cueType === 'jump' ? JUMP_TIP_LIMIT : TIP_LIMIT;
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    this.tipX = x;
    this.tipY = y;
    this.emit('change', undefined);
  }
  elevateBy(d: number): void {
    if (this.mode !== 'aim' || this.powerActive) return;
    // mulai dari elevasi efektif: menurunkan stik di atas rail langsung terasa (titik pukul naik)
    this.setElevation(this.stroke().elevation + d);
  }
  /** Elevasi absolut (widget elevasi di HUD). */
  setElevation(e: number): void {
    if (this.mode !== 'aim' || this.powerActive) return;
    const lo = this.cueType === 'jump' ? JUMP_MIN_ELEV : MIN_ELEV;
    this.elevation = Math.min(MAX_ELEV, Math.max(lo, e));
    this.railPriority = 'elev';
    this.emit('change', undefined);
  }
  /** Level power minimum (1,0–5,0) agar bola terangkat dengan jump cue; null = tidak mungkin. */
  jumpLiftLevel(): number | null {
    const st = this.stroke();
    const v = jumpLiftSpeed(st.elevation, st.tipX, st.tipY, DEFAULT_PARAMS);
    if (!Number.isFinite(v) || v > CUE_MAX_SPEED) return null;
    // kebalikan powerSpeed(): v = max · (level / 5)^1,8
    return Math.max(POWER_MIN, POWER_MAX * Math.pow(v / CUE_MAX_SPEED, 1 / 1.8));
  }
  /** J: ganti stik biasa ↔ jump cue. Jump cue langsung menaikkan elevasi ke sudut jump. */
  toggleJumpCue(): void {
    if (this.mode !== 'aim' || this.powerActive || this.pull > 0.002) return;
    if (this.cueType === 'standard') {
      this.elevBeforeJump = this.elevation;
      this.elevation = Math.max(this.stroke().elevation, JUMP_ELEV);
      this.railPriority = 'elev';
      // titik pukul ke tengah: english besar pada elevasi tinggi mudah miscue
      this.tipX = 0;
      this.tipY = 0;
      this.setCueType('jump');
    } else {
      this.elevation = this.elevBeforeJump;
      this.railPriority = 'tip';
      this.setCueType('standard');
    }
    this.emit('change', undefined);
  }
  private setCueType(t: CueType): void {
    this.cueType = t;
    this.cueView.setJump(t === 'jump');
    this.previewKey = '';
    if (t === 'standard') this.jumpPreview.clear();
  }
  setPull(p: number): void {
    if (this.mode !== 'aim') return;
    this.pull = Math.min(MAX_PULL, Math.max(0, p));
  }
  /** Space pertama: kunci bidikan/spin/elevasi; mouse kini mengatur power. */
  startPowerBar(): boolean {
    if (this.mode !== 'aim' || this.powerActive || this.pull > 0.002) return false;
    // kunci arah yang sedang TERLIHAT (aimView), bukan target yang masih dikejar penghalusan
    this.aimDir = this.aimView;
    this.powerActive = true;
    this.powerRaw = this.powerLevel;
    this.pull = this.powerPull();
    this.emit('change', undefined);
    return true;
  }
  /** Geser power secara halus (unit level); nilai yang dipakai dibulatkan ke 0,1. */
  adjustPower(delta: number): void {
    if (!this.powerActive) return;
    this.powerRaw = Math.min(POWER_MAX, Math.max(POWER_MIN, this.powerRaw + delta));
    this.powerLevel = roundLevel(this.powerRaw);
    this.pull = this.powerPull();
  }
  /** Naik/turun tepat n langkah 0,1 (scroll / panah). */
  stepPower(n: number): void {
    if (!this.powerActive) return;
    this.powerLevel = roundLevel(this.powerLevel + n * POWER_STEP);
    this.powerRaw = this.powerLevel;
    this.pull = this.powerPull();
  }
  /** Esc: batalkan, bidikan terbuka lagi. */
  cancelPowerBar(): void {
    if (!this.powerActive) return;
    this.powerActive = false;
    this.pull = 0;
    this.emit('change', undefined);
  }
  /** Space kedua: pukul dengan level yang terkunci. */
  releasePowerBar(): void {
    if (!this.powerActive) return;
    this.powerActive = false;
    this.fire(powerSpeed(this.powerLevel));
  }
  /** tarikan stik visual sesuai level */
  private powerPull(): number {
    return 0.025 + 0.235 * ((this.powerLevel - POWER_MIN) / (POWER_MAX - POWER_MIN));
  }
  togglePushOut(): void {
    if (this.mode !== 'aim' || !this.match?.pushOutAvailable) return;
    this.pushOutArmed = !this.pushOutArmed;
    this.emit('change', undefined);
  }
  decidePushOut(accept: boolean): void {
    if (this.mode !== 'decision' || !this.match) return;
    this.match = resolvePushOut(this.match, accept);
    this.beginTurn(accept ? 'Main dari posisi push-out' : 'Giliran dikembalikan');
  }
  continueAfterRack(): void {
    if (this.mode !== 'over' || !this.match || this.match.phase !== 'rack-over') return;
    this.match = nextRack(this.match);
    this.last = null;
    this.ballViews.setTable(this.match.table);
    this.beginTurn('Break');
  }

  /** Ball in hand: pindahkan cue ball ke posisi valid terdekat dari (x, y). */
  moveCueBall(x: number, y: number): boolean {
    const m = this.match;
    if (!m || this.mode !== 'aim' || m.ballInHand === 'none' || this.powerActive) return false;
    const [px, py] = nearestValidCuePlacement(m.table, x, y, m.ballInHand === 'kitchen');
    const next = placeCueBall(m, px, py);
    if (next === m) return false;
    this.match = next;
    this.ballViews.setBallPosition(0, px, py, R);
    return true;
  }

  /**
   * Elevasi & titik pukul yang benar-benar dipakai: stik harus melewati cushion/rail dan bola lain di
   * belakang cue ball (lihat cueClearance.ts). Saat memukul/replay: nilai pukulan terakhir.
   */
  stroke(): Stroke {
    if (this.mode !== 'aim' && this.pendingShot) {
      const p = this.pendingShot;
      return { tipX: p.tipX, tipY: p.tipY, elevation: p.elevation, railElev: false, railFollow: false };
    }
    const { x, y } = this.cueBall;
    const others: [number, number][] = [];
    for (const b of this.match?.table.balls ?? []) {
      if (b.id !== 0 && b.motion !== 'pocketed' && b.motion !== 'off-table') others.push([b.pos[0], b.pos[1]]);
    }
    return resolveStroke(x, y, this.aimView, this.tipX, this.tipY, this.elevation, this.railPriority, AUTO_FOLLOW_MAX, others);
  }
  effectiveElevation(): number {
    return this.stroke().elevation;
  }

  /** Pukul dengan kecepatan stik tertentu (m/s). */
  fire(cueSpeed: number): void {
    const m = this.match;
    if (!m || this.mode !== 'aim') return;
    const speed = Math.min(CUE_MAX_SPEED, Math.max(CUE_MIN_SPEED, cueSpeed));
    this.aimDir = this.aimView;
    const st = this.stroke();
    const shot: ShotParams = {
      dir: this.aimDir,
      speed,
      tipX: st.tipX,
      tipY: st.tipY,
      elevation: st.elevation,
    };
    if (this.cueType === 'jump') shot.cue = 'jump';
    this.pendingShot = shot;
    this.pending = null;
    this.shotIsBreak = m.phase === 'break';
    const before = clone(m.table);
    const shooter = m.currentPlayer;
    this.mode = 'stroke';
    this.strokeT = 0;
    this.strokeFrom = Math.max(this.pull, 0.04);
    this.strokeDur = Math.min(0.16, Math.max(0.05, this.strokeFrom / (speed * 0.9)));
    void this.sim.simulate(before, shot).then(({ result, ms }) => {
      this.lastSimMs = ms;
      this.pending = result;
      this.last = { before, result, isBreak: this.shotIsBreak, shooter, jump: shot.cue === 'jump' };
    });
    this.emit('change', undefined);
  }

  startReplay(speed = 1): boolean {
    if (this.mode !== 'aim' || !this.last) return false;
    this.mode = 'replay';
    this.result = this.last.result;
    this.playSpeed = speed;
    this.playT = 0;
    this.eventCursor = 0;
    this.replayHold = REPLAY_TITLE_DUR;
    this.ballViews.setTable(this.last.before);
    this.ballViews.resetPlayback();
    this.cueView.visible = false;
    this.rig.startShot(this.context(), this.last.isBreak, this.last.jump);
    this.emit('replayTitle', { shooter: this.last.shooter, isBreak: this.last.isBreak, duration: REPLAY_TITLE_DUR });
    this.emit('change', undefined);
    return true;
  }
  stopReplay(): void {
    if (this.mode !== 'replay' || !this.match) return;
    this.replayHold = 0;
    this.ballViews.setTable(this.match.table);
    this.mode = 'aim';
    this.playSpeed = 1;
    this.rig.endShot();
    this.emit('change', undefined);
  }
  /** kartu judul replay sedang tampil (bola belum bergerak) */
  get replayTitleActive(): boolean {
    return this.mode === 'replay' && this.replayHold > 0;
  }
  get canReplay(): boolean {
    return this.mode === 'aim' && !!this.last;
  }

  // ───────────── loop ─────────────

  private context(): RigContext {
    const c = this.cueBall;
    return { cueX: c.x, cueY: c.y, aimDir: this.aimView, focusX: this.focus[0], focusY: this.focus[1] };
  }

  private startPlayback(): void {
    const res = this.pending!;
    this.result = res;
    this.pending = null;
    this.mode = 'play';
    this.playSpeed = 1;
    this.playT = 0;
    this.eventCursor = 0;
    this.followT = 0;
    this.followMin = Infinity;
    this.ballViews.resetPlayback();
    this.rig.startShot(this.context(), this.shotIsBreak, this.pendingShot!.cue === 'jump');
    const first = res.events[0];
    this.emit('shot', { isBreak: this.shotIsBreak, speed: this.pendingShot!.speed, miscue: first?.type === 'miscue' });
    this.emit('change', undefined);
  }

  private finishShot(): void {
    const m = this.match!;
    const res = this.result!;
    const prevPlayer = m.currentPlayer;
    const jumpOk = this.pendingShot?.cue === 'jump' && airborneBeforeContact(res);
    const next = applyShot(m, res, this.pushOutArmed);
    this.match = next;
    this.result = null;
    this.ballViews.setTable(next.table);
    const s = next.lastShot!;
    const names = next.options.playerNames;
    if (jumpOk && !s.foul && s.firstHit !== null) this.emit('toast', { text: 'Jump shot!', kind: 'good' });
    if (s.foul) {
      const text: Record<string, string> = {
        scratch: 'Scratch',
        'cue-off-table': 'Cue ball keluar meja',
        'no-contact': 'Tidak mengenai bola',
        'wrong-ball-first': 'Salah bola pertama',
        'no-rail': 'Tidak ada bola menyentuh cushion',
        'ball-off-table': 'Bola keluar meja',
        'illegal-break': 'Break tidak sah',
      };
      this.emit('toast', { text: `Foul — ${text[s.foul]}`, kind: 'foul' });
    }
    if (next.phase === 'rack-over' || next.phase === 'match-over') {
      this.mode = 'over';
      this.cueView.visible = false;
      this.rig.endShot();
      if (s.threeFoulLoss) this.emit('toast', { text: `3 foul berturut-turut — ${names[s.shooter]} kalah rack`, kind: 'foul' });
      this.emit('rackOver', { winner: next.rackWinner!, matchOver: next.phase === 'match-over' });
      this.emit('change', undefined);
      return;
    }
    if (next.phase === 'pushout-decision') {
      this.mode = 'decision';
      this.cueView.visible = false;
      this.rig.endShot();
      this.emit('change', undefined);
      return;
    }
    let reason = '';
    if (s.foul) {
      reason = 'Ball in hand';
      const n = next.consecutiveFouls[s.shooter];
      if (next.options.threeFoulRule && n === 2) {
        this.emit('toast', { text: `Peringatan: ${names[s.shooter]} sudah 2 foul berturut-turut`, kind: 'foul' });
      }
    } else if (s.nineSpotted) reason = 'Bola 9 di-spot';
    else if (next.currentPlayer === prevPlayer && s.pocketed.length) {
      this.emit('toast', { text: s.pocketed.length > 1 ? `Bola ${s.pocketed.join(', ')} masuk` : `Bola ${s.pocketed[0]} masuk`, kind: 'good' });
    }
    if (s.wasBreak && !s.foul) reason = reason || 'Push-out tersedia';
    this.beginTurn(reason);
  }

  update(dt: number): void {
    const m = this.match;
    if (m) {
      if (this.mode === 'aim') {
        const c = this.cueBall;
        this.focus = [c.x, c.y];
        const d = wrapAngle(this.aimDir - this.aimView);
        this.aimView = Math.abs(d) < 1e-7 ? this.aimDir : wrapAngle(this.aimView + d * (1 - Math.exp(-AIM_SMOOTH * dt)));
        this.cueView.visible = !this.rig.cinematic;
        const st = this.stroke();
        this.cueView.setPose({ x: c.x, y: c.y, dir: this.aimView, elevation: st.elevation, tipX: st.tipX, tipY: st.tipY, gap: 0.014 + this.pull });
        // garis bidik mengikuti arah lari cue ball yang sebenarnya (termasuk squirt english)
        const jump = this.cueType === 'jump';
        this.guide.update(m.table, wrapAngle(this.aimView + squirtAngle(st.tipX, st.tipY, DEFAULT_PARAMS)), !this.rig.cinematic && !jump);
        if (jump) this.updateJumpPreview(dt, st);
      } else if (this.mode === 'stroke') {
        this.jumpPreview.group.visible = false;
        this.strokeT += dt;
        const f = Math.min(1, this.strokeT / this.strokeDur);
        const c = this.cueBall;
        // percepatan ke depan (ease-in)
        const gap = 0.014 + this.strokeFrom * (1 - f * f);
        this.cueView.setPose({ x: c.x, y: c.y, dir: this.aimDir, elevation: this.pendingShot!.elevation, tipX: this.pendingShot!.tipX, tipY: this.pendingShot!.tipY, gap: f >= 1 ? 0.001 : gap });
        this.guide.group.visible = false;
        if (f >= 1 && this.pending) this.startPlayback();
      } else if (this.mode === 'replay' && this.replayHold > 0) {
        // kartu judul: tahan posisi awal sampai judul selesai
        this.jumpPreview.group.visible = false;
        this.replayHold -= dt;
        if (this.replayHold <= 0) this.emit('change', undefined);
      } else if (this.mode === 'play' || this.mode === 'replay') {
        this.jumpPreview.group.visible = false;
        const res = this.result!;
        this.playT += dt * this.playSpeed;
        while (this.eventCursor < res.events.length && res.events[this.eventCursor].t <= this.playT) {
          this.emit('simEvent', { event: res.events[this.eventCursor], replay: this.mode === 'replay' });
          this.eventCursor++;
        }
        this.ballViews.sample(res, Math.min(this.playT, res.duration));
        const cueMesh = this.world.balls[0];
        if (cueMesh.visible) this.focus = [cueMesh.position.x, -cueMesh.position.z];
        // follow-through stik lalu menghilang
        if (this.mode === 'play' && this.cueView.visible) {
          this.followT += dt;
          // sembunyikan juga bila cue ball berbalik ke arah stik (draw kuat)
          const d = this.cueView.tipDistance(cueMesh.position);
          if (d < this.followMin - 0.002) this.cueView.visible = false;
          this.followMin = Math.min(this.followMin, d);
          if (this.followT > 0.45) this.cueView.visible = false;
        }
        if (this.playT >= res.duration + (this.mode === 'play' ? 0.35 : 0.8)) {
          if (this.mode === 'play') this.finishShot();
          else this.stopReplay();
        }
      } else {
        this.guide.group.visible = false;
        this.jumpPreview.group.visible = false;
      }
    }
    this.rig.update(dt, this.context());
    const h = this.rig.height;
    this.world.setOverheadHidden(h > 0.74, h > this.world.assets.manifest.room.ceilingZ - 0.25);
  }

  /**
   * Prediksi lompatan: pukulan disimulasikan penuh di worker (fisika yang sama dengan pukulan
   * sungguhan) dengan power yang sedang terkunci, lalu lintasan cue ball digambar sebagai busur.
   * Dihitung ulang (debounce) hanya bila bidikan/elevasi/titik pukul/power berubah.
   */
  private updateJumpPreview(dt: number, st: Stroke): void {
    const m = this.match!;
    const visible = !this.rig.cinematic && this.guide.mode !== 'off';
    this.jumpPreview.group.visible = visible && this.jumpPreview.ready;
    if (!visible) return;
    const shot: ShotParams = {
      dir: this.aimView,
      speed: Math.min(CUE_MAX_SPEED, Math.max(CUE_MIN_SPEED, powerSpeed(this.powerLevel))),
      tipX: st.tipX,
      tipY: st.tipY,
      elevation: st.elevation,
      cue: 'jump',
    };
    const c = this.cueBall;
    const key = [shot.dir, shot.speed, shot.tipX, shot.tipY, shot.elevation, c.x, c.y].map((v) => v.toFixed(4)).join(',');
    if (key === this.previewKey) return;
    this.previewWait += dt;
    if (this.previewBusy || this.previewWait < PREVIEW_DEBOUNCE) return;
    this.previewBusy = true;
    this.previewWait = 0;
    const table = clone(m.table);
    const target = lowestBall(m.table);
    void this.previewSim.simulate(table, shot, { maxTime: 6 }).then(({ result }) => {
      this.previewBusy = false;
      // buang hasil basi (pukulan sudah dilepas / stik diganti / meja berubah)
      if (this.mode !== 'aim' || this.cueType !== 'jump' || this.match !== m) return;
      this.previewKey = key;
      this.jumpPreview.show(result, target);
      this.emit('change', undefined);
    });
  }

  /** Titik pada bidang meja (fisika) di bawah koordinat layar NDC. */
  pickTable(ndcX: number, ndcY: number): [number, number] | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.world.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (R - o.y) / d.y;
    if (t <= 0) return null;
    return [o.x + d.x * t, -(o.z + d.z * t)];
  }
}
