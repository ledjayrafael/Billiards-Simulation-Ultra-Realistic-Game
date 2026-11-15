import { BALL_RADIUS as R, CUE_MAX_SPEED, CUE_MIN_SPEED } from '@billiards/physics';
import type { Game } from '../game/game';
import type { Settings } from '../game/settings';
import type { Hud } from '../ui/hud';

const AIM_RATE = 0.0021; // rad per piksel (gerak cepat)
/** kurva presisi: gerak mouse pelan → rad/piksel jauh lebih kecil */
const AIM_SLOW = 0.3;
const AIM_SLOW_PX = 120; // px/detik: di bawah ini laju = AIM_SLOW
const AIM_FAST_PX = 1400; // px/detik: di atas ini laju penuh
const FINE = 0.12;
const PULL_PER_PX = 0.0007; // meter tarikan per piksel
const SPEED_PER_PX = 0.0023; // m/s kecepatan stik per (piksel/detik)
const POWER_PER_PX = 0.1 / 14; // level power per piksel (0,1 tiap 14 px)

/** Input desktop: mouse (pointer lock) + keyboard. */
export class Controls {
  private keys = new Set<string>();
  private stroking = false;
  private maxPull = 0;
  private moves: { t: number; dy: number }[] = [];
  private draggingCue = false;
  private orbiting = false;
  private softLock = false;
  /** kecepatan horizontal mouse (px/detik, dihaluskan) untuk kurva presisi bidik */
  private aimVel = 0;
  private aimT = 0;
  /** lama tombol panah kiri/kanan ditahan (detik) */
  private arrowHeld = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
    private hud: Hud,
    private settings: Settings,
  ) {
    canvas.tabIndex = 0;
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    addEventListener('mousemove', (e) => this.onMove(e));
    addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => {
      this.keys.clear();
      this.cancelStroke();
    });
    document.addEventListener('pointerlockchange', () => {
      this.hud.pointerLocked = this.locked;
      if (!this.locked) this.cancelStroke();
      this.hud.refresh();
    });
    document.addEventListener('pointerlockerror', () => {
      // pointer lock ditolak → mode kursor bebas: bidik mengikuti gerak mouse setelah klik
      this.softLock = true;
      this.hud.pointerLocked = true;
      this.hud.refresh();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas || this.softLock;
  }

  /** Lepas kursor (mis. saat ball in hand agar cue ball bisa diseret). */
  release(): void {
    this.softLock = false;
    this.cancelStroke();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.pointerLocked = false;
    this.hud.refresh();
  }

  private ndc(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  }

  private cancelStroke(): void {
    this.game.cancelPowerBar();
    if (this.stroking) {
      this.stroking = false;
      this.game.setPull(0);
    }
    this.orbiting = false;
    this.game.rig.orbiting = false;
    this.draggingCue = false;
  }

  private onDown(e: MouseEvent): void {
    const g = this.game;
    if (this.hud.sheetOpen) return;
    if (g.rig.cinematic) {
      g.rig.stopCinematic();
      return;
    }
    if (g.mode === 'replay') {
      g.stopReplay();
      return;
    }
    if (e.button === 2) {
      this.orbiting = true;
      g.rig.orbiting = true;
      return;
    }
    if (e.button !== 0 || g.mode !== 'aim' || g.powerActive) return;
    if (!this.locked) {
      // ball in hand: mulai seret bila klik dekat cue ball
      const m = g.match;
      if (m && m.ballInHand !== 'none') {
        const p = g.pickTable(...this.ndc(e));
        if (p && Math.hypot(p[0] - g.cueBall.x, p[1] - g.cueBall.y) < R * 2.6) {
          this.draggingCue = true;
          return;
        }
      }
      this.softLock = false;
      const req = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (req && typeof req.catch === 'function') {
        req.catch(() => {
          this.softLock = true;
          this.hud.pointerLocked = true;
          this.hud.refresh();
        });
      }
      return;
    }
    this.stroking = true;
    this.maxPull = 0;
    this.moves = [];
  }

  private onMove(e: MouseEvent): void {
    const g = this.game;
    if (this.hud.sheetOpen) return;
    const sens = this.settings.sensitivity;
    if (this.draggingCue) {
      const p = g.pickTable(...this.ndc(e));
      if (p) {
        g.moveCueBall(p[0], p[1]);
        g.autoAim();
      }
      return;
    }
    if (this.orbiting) {
      g.rig.orbit(-e.movementX * 0.004, e.movementY * 0.003);
      return;
    }
    if (g.powerActive) {
      // mouse = power meter: tarik mundur (ke bawah) menambah power
      g.adjustPower(e.movementY * POWER_PER_PX * sens * (e.shiftKey ? 0.25 : 1));
      return;
    }
    if (!this.locked || g.mode !== 'aim') return;
    if (this.stroking) {
      const now = performance.now();
      this.moves.push({ t: now, dy: e.movementY });
      while (this.moves.length && now - this.moves[0].t > 70) this.moves.shift();
      const next = g.pull + e.movementY * PULL_PER_PX * sens;
      this.maxPull = Math.max(this.maxPull, next);
      if (next <= 0 && this.maxPull > 0.02 && e.movementY < 0) {
        // tip menyentuh bola: kecepatan stik = kecepatan dorong mouse (dihaluskan 70 ms)
        const span = Math.max(16, now - this.moves[0].t);
        let fwd = 0;
        for (const mv of this.moves) if (mv.dy < 0) fwd -= mv.dy;
        const pxPerSec = (fwd / span) * 1000;
        const speed = Math.min(CUE_MAX_SPEED, Math.max(CUE_MIN_SPEED, pxPerSec * SPEED_PER_PX * sens));
        this.stroking = false;
        g.setPull(Math.min(this.maxPull, 0.05 + speed * 0.02));
        g.fire(speed);
        return;
      }
      g.setPull(next);
      return;
    }
    const now = performance.now();
    const dtm = Math.min(100, Math.max(1, now - this.aimT));
    this.aimT = now;
    const inst = (Math.abs(e.movementX) / dtm) * 1000;
    this.aimVel += (inst - this.aimVel) * Math.min(1, dtm / 60);
    const k = Math.min(1, Math.max(0, (this.aimVel - AIM_SLOW_PX) / (AIM_FAST_PX - AIM_SLOW_PX)));
    const curve = AIM_SLOW + (1 - AIM_SLOW) * k * k * (3 - 2 * k);
    const rate = AIM_RATE * sens * curve * (e.shiftKey ? FINE : 1);
    g.aimBy(-e.movementX * rate);
  }

  private onUp(e: MouseEvent): void {
    if (e.button === 2) {
      this.orbiting = false;
      this.game.rig.orbiting = false;
    }
    if (e.button === 0) {
      if (this.stroking) {
        this.stroking = false;
        this.game.setPull(0);
      }
      this.draggingCue = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.hud.sheetOpen) return;
    if (this.game.powerActive) {
      if (e.deltaY) this.game.stepPower(e.deltaY > 0 ? -1 : 1);
      return;
    }
    if (e.shiftKey) this.game.rig.tilt(e.deltaY * 0.0006);
    else {
      this.game.rig.zoom(e.deltaY * 0.0009);
      this.game.rig.tilt(e.deltaY * 0.00018);
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const g = this.game;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.hud.sheetOpen) return;
      // tekan sekali: kunci bidikan · tekan lagi: pukul (tahan/lepas tidak berpengaruh)
      if (!down || e.repeat || this.stroking) return;
      if (g.powerActive) g.releasePowerBar();
      else g.startPowerBar();
      return;
    }
    if (down && g.powerActive && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      g.stepPower(e.code === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (!down || e.repeat) return;
    if (e.code === 'Escape' && g.powerActive) {
      g.cancelPowerBar();
      return;
    }
    if (e.code === 'Escape') {
      if (this.softLock) {
        this.softLock = false;
        this.hud.pointerLocked = false;
        this.cancelStroke();
        this.hud.refresh();
        return;
      }
      if (this.hud.sheetOpen === 'pause') this.hud.hidePause();
      else if (g.mode === 'replay') g.stopReplay();
      else if (!document.pointerLockElement) this.hud.showPause();
      return;
    }
    if (this.hud.sheetOpen) return;
    switch (e.code) {
      case 'KeyT':
        g.rig.toggleTop();
        break;
      case 'KeyR':
        g.rig.reset();
        break;
      case 'KeyP':
        if (g.mode === 'replay') {
          g.playSpeed = g.playSpeed < 1 ? 1 : 0.25;
          this.hud.refresh();
        } else g.startReplay(1);
        break;
      case 'KeyX':
        g.togglePushOut();
        break;
      case 'KeyC':
        g.setTip(0, 0);
        break;
    }
  }

  /** Input kontinu dari tombol yang ditahan. */
  update(dt: number): void {
    const g = this.game;
    if (this.hud.sheetOpen || g.mode !== 'aim') return;
    const k = this.keys;
    const fine = k.has('ShiftLeft') || k.has('ShiftRight');
    const left = k.has('ArrowLeft');
    const right = k.has('ArrowRight');
    this.arrowHeld = left !== right ? this.arrowHeld + dt : 0;
    // mulai sangat pelan lalu makin cepat selama ditahan → ketukan singkat = koreksi halus
    const ramp = Math.min(1, 0.06 + this.arrowHeld * this.arrowHeld * 1.6);
    const aim = (fine ? 0.04 : 0.7) * ramp * dt;
    if (left && !right) g.aimBy(aim);
    if (right && !left) g.aimBy(-aim);
    const tip = (fine ? 0.12 : 0.55) * dt;
    let tx = 0;
    let ty = 0;
    if (k.has('KeyA')) tx -= tip;
    if (k.has('KeyD')) tx += tip;
    if (k.has('KeyW')) ty += tip;
    if (k.has('KeyS')) ty -= tip;
    if (tx || ty) g.setTip(g.tipX + tx, g.tipY + ty);
    const el = (fine ? 0.1 : 0.7) * dt;
    if (k.has('KeyE')) g.elevateBy(el);
    if (k.has('KeyQ')) g.elevateBy(-el);
  }
}
