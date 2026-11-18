import { CUES, CUE_MAX_SPEED } from '@billiards/physics';
import { ballsOnTable, lowestBall } from '@billiards/rules';
import type { CueCategory, CueSpec, MatchOptions } from '@billiards/shared';
import type { Game } from '../game/game';
import { POWER_MAX, POWER_MIN, powerSpeed } from '../game/power';
import { saveSettings, type Settings } from '../game/settings';
import { ARENAS, type ArenaId } from '../render/arenas';
import { cueThumbnails } from '../render/cueThumbs';

const BALL_COLORS = ['#f4f1e6', '#f2c12e', '#1f55b5', '#d12a20', '#5c2d91', '#f07a1c', '#1f8a4c', '#8a2424', '#1a1a1a', '#f2c12e'];
const DEG = 180 / Math.PI;

export interface HudApp {
  startMatch(options: Partial<MatchOptions>): void;
  applySettings(): void;
  quitToMenu(): void;
  resume(): void;
  nextRack(): void;
  /** muat & tampilkan arena; onProgress 0..1 */
  selectArena(id: ArenaId, onProgress: (f: number) => void): Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
/** Nama pendek untuk tombol: tanpa sufiks kategori (" - Cue Play"). */
const shortCueName = (c: CueSpec): string => c.name.replace(/\s*-\s*Cue Play$/i, '');
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** HUD + menu (DOM di atas canvas). */
export class Hud {
  readonly root = el('div');
  private hudLayer = el('div');
  private score = el('div', 'score');
  private rail = el('div', 'rail');
  private status = el('div', 'status');
  private toasts = el('div', 'toasts');
  private spin = el('div', 'spin interactive');
  private spinDot = el('div', 'dot');
  private shownStroke = '';
  private spinTxt = el('small');
  private elevArc = el('i');
  private elevTxt = el('span');
  private power = el('div', 'power');
  private powerFill = el('i', 'fill');
  private powerMark = el('b', 'mark');
  /** penanda power minimum agar bola terangkat (jump cue) */
  private powerLift = el('em', 'lift');
  private shownLift = '';
  private powerLv = el('span', 'lv');
  private powerSpd = el('small');
  private powerTxt = el('div', 'txt');
  private shownLevel = -1;
  private actions = el('div', 'actions interactive');
  /** menu pilihan stik (K) */
  private cueMenu = el('div', 'cuemenu interactive');
  private shownCueMenu = '';
  cueMenuOpen = false;
  private misRing = el('div', 'mis');
  private hint = el('div', 'hint');
  private overlay = el('div');
  private sheet = el('div');
  private fps = el('div', 'fps');
  private menuOptions: MatchOptions = { playerNames: ['Pemain 1', 'Pemain 2'], raceTo: 5, threeFoulRule: true, alternateBreak: false };
  sheetOpen: 'menu' | 'pause' | 'rack' | 'match' | null = null;
  pointerLocked = false;

  constructor(
    private game: Game,
    private settings: Settings,
    private app: HudApp,
  ) {
    this.root.id = 'ui';
    document.body.appendChild(this.root);
    this.spin.innerHTML = '<div class="ball"></div>';
    const ball = this.spin.firstElementChild as HTMLElement;
    ball.appendChild(this.spinDot);
    ball.appendChild(el('div', 'lim'));
    ball.appendChild(this.misRing);
    const elev = el('div', 'elev', '<div class="arc"></div>');
    elev.title = 'Drag ↕ atau scroll untuk mengatur elevasi';
    elev.firstElementChild!.appendChild(this.elevArc);
    elev.appendChild(this.elevTxt);
    this.spin.append(this.spinTxt, elev);
    // power meter 1,0–5,0: skala angka besar tiap 1, garis kecil tiap 0,1
    const labels = [1, 2, 3, 4, 5].map((n) => `<span style="bottom:${(n - 1) * 25}%">${n}</span>`).join('');
    this.power.innerHTML = `<div class="meter"><div class="scale">${labels}</div><div class="track"><div class="ticks"></div></div></div><div class="info"><div class="read"></div></div>`;
    const track = this.power.querySelector('.track')!;
    track.prepend(this.powerFill);
    track.append(this.powerMark, this.powerLift);
    this.powerLift.title = 'Power minimum agar bola melompat';
    const read = this.power.querySelector('.read')!;
    read.append(this.powerLv, this.powerSpd);
    this.power.querySelector('.info')!.appendChild(this.powerTxt);
    this.hudLayer.append(this.score, this.rail, this.status, this.toasts, this.spin, this.power, this.hint, this.actions, this.cueMenu, this.fps);
    this.cueMenu.hidden = true;
    this.root.append(this.hudLayer, this.overlay, this.sheet);

    // spin widget: klik/drag
    const setFromEvent = (e: PointerEvent): void => {
      const r = ball.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.game.setTip(x, y);
    };
    ball.addEventListener('pointerdown', (e) => {
      ball.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    ball.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) setFromEvent(e);
    });
    ball.addEventListener('dblclick', () => this.game.setTip(0, 0));

    // widget elevasi: drag vertikal (0,5°/px) atau scroll (±1°)
    const DEG_RAD = Math.PI / 180;
    let dragY = 0;
    elev.addEventListener('pointerdown', (e) => {
      elev.setPointerCapture(e.pointerId);
      dragY = e.clientY;
    });
    elev.addEventListener('pointermove', (e) => {
      if (!(e.buttons & 1)) return;
      const dy = dragY - e.clientY;
      dragY = e.clientY;
      if (dy) this.game.elevateBy(dy * 0.5 * DEG_RAD);
    });
    elev.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.deltaY) this.game.elevateBy((e.deltaY < 0 ? 1 : -1) * DEG_RAD);
      },
      { passive: false },
    );

    game.on('change', () => this.refresh());
    game.on('toast', (t) => this.toast(t.text, t.kind));
    game.on('turn', (t) => {
      if (t.changed || t.reason) this.turnOverlay(t.player, t.reason, t.changed);
    });
    game.on('rackOver', (r) => this.showRackOver(r.winner, r.matchOver));
    game.on('replayTitle', (r) => this.replayTitle(r.shooter, r.isBreak, r.duration));
    this.refresh();
  }

  setFps(text: string): void {
    this.fps.textContent = text;
  }

  toast(text: string, kind: 'info' | 'foul' | 'good' = 'info'): void {
    const t = el('div', `toast ${kind}`);
    t.textContent = text;
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  private turnOverlay(player: number, reason: string, changed: boolean): void {
    const m = this.game.match;
    if (!m) return;
    this.overlay.innerHTML = '';
    const o = el('div', 'turn', `<div><small>${changed ? 'Giliran' : 'Lanjut'}</small><h2>${esc(m.options.playerNames[player])}</h2>${reason ? `<p>${esc(reason)}</p>` : ''}</div>`);
    this.overlay.appendChild(o);
    setTimeout(() => o.remove(), 1950);
  }

  private replayCard: HTMLElement | null = null;

  /** Kartu judul sebelum replay diputar. */
  private replayTitle(shooter: number, isBreak: boolean, duration: number): void {
    const m = this.game.match;
    if (!m) return;
    this.overlay.innerHTML = '';
    const o = el(
      'div',
      'replay-title',
      `<div><small>Tayangan ulang</small><h2>Replay</h2><p>${esc(m.options.playerNames[shooter])}${isBreak ? ' · break' : ''}</p></div>`,
    );
    o.style.animationDuration = `${duration}s`;
    this.overlay.appendChild(o);
    this.replayCard = o;
  }

  /** Dipanggil tiap frame untuk elemen yang berubah terus (power, spin). */
  tick(): void {
    const g = this.game;
    if (g.mode === 'aim') this.updateStroke();
    const lv = g.powerLevel;
    if (lv === this.shownLevel) return;
    if (this.shownLevel >= 0 && g.powerActive) {
      this.powerLv.classList.remove('bump');
      void this.powerLv.offsetWidth;
      this.powerLv.classList.add('bump');
    }
    this.shownLevel = lv;
    const f = (lv - POWER_MIN) / (POWER_MAX - POWER_MIN);
    this.power.style.setProperty('--f', f.toFixed(4));
    this.powerLv.textContent = lv.toFixed(1).replace('.', ',');
    this.powerSpd.textContent = `${powerSpeed(lv).toFixed(2).replace('.', ',')} m/s`;
  }

  /** Widget spin & elevasi: nilai efektif berubah saat membidik (rail di belakang cue ball). */
  private updateStroke(): void {
    const g = this.game;
    // nilai efektif: dekat rail, elevasi/titik pukul bisa dipaksa naik agar stik melewati rail
    const sk = g.stroke();
    const jump = g.isJumpCue;
    const lim = g.miscueLimit;
    const key = `${sk.tipX.toFixed(3)},${sk.tipY.toFixed(3)},${(sk.elevation * DEG).toFixed(0)},${sk.railFollow},${sk.railElev},${jump},${lim}`;
    if (key === this.shownStroke) return;
    this.shownStroke = key;
    this.spin.classList.toggle('jump', jump);
    this.spinDot.style.left = `${50 + sk.tipX * 50}%`;
    this.spinDot.style.top = `${50 - sk.tipY * 50}%`;
    const off = Math.hypot(sk.tipX, sk.tipY);
    // cincin batas miscue stik aktif
    this.misRing.style.left = this.misRing.style.top = `${50 - lim * 50}%`;
    this.misRing.style.width = this.misRing.style.height = `${lim * 100}%`;
    this.spinDot.classList.toggle('miscue', off > lim + 1e-9);
    const spin = off > lim + 1e-9 ? 'risiko miscue!' : off < 0.02 ? 'center ball' : `spin ${[Math.abs(sk.tipX) >= 0.01 ? `${sk.tipX > 0 ? 'kanan' : 'kiri'} ${Math.abs(sk.tipX * 100).toFixed(0)}%` : '', Math.abs(sk.tipY) >= 0.01 ? `${sk.tipY > 0 ? 'atas' : 'bawah'} ${Math.abs(sk.tipY * 100).toFixed(0)}%` : ''].filter(Boolean).join(' · ')}`;
    this.spinTxt.textContent = sk.railFollow ? `${spin} · follow (stik lewat atas)` : spin;
    const ev = sk.elevation;
    this.elevArc.style.transform = `rotate(${-ev * DEG}deg)`;
    this.elevTxt.textContent = jump
      ? `elevasi ${(ev * DEG).toFixed(0)}° · jump`
      : sk.railElev
        ? `elevasi ${(ev * DEG).toFixed(0)}° · minimum${sk.railFollow ? '' : ' (Q datarkan)'}`
        : `elevasi ${(ev * DEG).toFixed(0)}°`;
    this.updateLift();
  }

  /** Penanda power minimum agar bola terangkat (hanya jump cue). */
  private updateLift(): void {
    const g = this.game;
    const lv = g.isJumpCue ? g.jumpLiftLevel() : null;
    const key = !g.isJumpCue ? 'off' : lv === null ? 'none' : `${lv.toFixed(2)}`;
    if (key === this.shownLift) return;
    this.shownLift = key;
    this.powerLift.hidden = !g.isJumpCue;
    this.powerLift.classList.toggle('none', lv === null);
    const f = lv === null ? 1 : (lv - POWER_MIN) / (POWER_MAX - POWER_MIN);
    this.power.style.setProperty('--lf', f.toFixed(4));
  }

  /** Ringkasan prediksi jump shot untuk baris status. */
  private jumpText(): string {
    const p = this.game.jumpPreview;
    const v = p.verdict;
    if (!v) return '<b>Jump cue</b> — menghitung lompatan…';
    const h = p.apex * 100;
    const hop = h < 0.3 ? 'bola tidak terangkat (naikkan elevasi/power)' : `lompat ${h.toFixed(1).replace('.', ',')} cm`;
    const res: Record<typeof v.kind, string> = {
      target: `kena bola ${'ball' in v ? v.ball : ''} ✓`,
      wrong: `<span class="bad">menabrak bola ${'ball' in v ? v.ball : ''}</span>`,
      'off-table': '<span class="bad">keluar meja!</span>',
      miscue: '<span class="bad">miscue!</span>',
      'no-hit': 'tidak mengenai bola',
    };
    return `<b>Jump cue</b> — ${hop} · ${res[v.kind]}`;
  }

  /** Buka/tutup menu pilihan stik (hanya saat membidik, sebelum power dikunci). */
  toggleCueMenu(open = !this.cueMenuOpen): void {
    this.cueMenuOpen = open && this.game.canChangeCue;
    this.refresh();
  }

  private renderCueMenu(): void {
    const g = this.game;
    const key = this.cueMenuOpen ? `${g.cueId}|${g.playCue}` : '';
    if (key === this.shownCueMenu) return;
    this.shownCueMenu = key;
    this.cueMenu.hidden = !this.cueMenuOpen;
    if (!this.cueMenuOpen) return;
    const groups: [CueCategory, string][] = [
      ['play', 'Cue Play'],
      ['jump-break', 'Jump Break'],
    ];
    const tol = (lim: number): string => (lim >= 0.53 ? 'tinggi' : lim >= 0.48 ? 'sedang' : 'rendah');
    const stat = (label: string, v: number): string =>
      `<span class="lb">${label}</span><span class="bar"><i style="width:${v * 10}%"></i></span><span class="v">${v}</span>`;
    const thumbs = cueThumbnails(CUES, g.world.cues);
    this.cueMenu.innerHTML =
      `<div class="head">Pilih stik <kbd>K</kbd></div>` +
      groups
        .map(
          ([cat, title]) =>
            `<div class="grp">${title}</div>` +
            CUES.filter((c) => c.category === cat)
              .map(
                (c) => `<button class="item ${c.id === g.cueId ? 'active' : ''}" data-id="${c.id}">
                  ${thumbs.has(c.id) ? `<img class="thumb" src="${thumbs.get(c.id)}" alt="" draggable="false">` : ''}
                  <span class="nm">${esc(c.name)}${c.id === g.playCue && cat === 'play' ? ' <em>dipakai</em>' : ''}</span>
                  <span class="stats">${stat('Power', c.power)}${stat('Spin', c.spin)}${stat('Deflection', c.deflection)}</span>
                  <span class="meta">toleransi miscue ${tol(c.miscueLimit)} · ${esc(c.note)}</span>
                </button>`,
              )
              .join(''),
        )
        .join('');
    for (const b of this.cueMenu.querySelectorAll<HTMLButtonElement>('button.item')) {
      b.onclick = (e) => {
        e.stopPropagation();
        g.selectCue(b.dataset.id!);
        this.toggleCueMenu(false);
      };
    }
  }

  refresh(): void {
    if (this.replayCard && !this.game.replayTitleActive) {
      this.replayCard.remove();
      this.replayCard = null;
    }
    const g = this.game;
    const m = g.match;
    const inGame = !!m && this.sheetOpen !== 'menu';
    this.hudLayer.classList.toggle('hidden', !inGame);
    if (!m) return;
    const names = m.options.playerNames;
    const fouls = (n: number): string => (n > 0 && m.options.threeFoulRule ? `<span class="fouls">${'<i></i>'.repeat(n)}</span>` : '');
    const sub = (i: number): string => (m.breaker === i && m.phase === 'break' ? 'break' : '');
    this.score.innerHTML = `
      <div class="player p1 ${m.currentPlayer === 0 ? 'active' : ''}"><div><div class="name">${esc(names[0])}${fouls(m.consecutiveFouls[0])}</div><div class="sub">${sub(0)}</div></div><div class="pts">${m.scores[0]}</div></div>
      <div class="mid">race to<b>${m.options.raceTo}</b></div>
      <div class="player p2 ${m.currentPlayer === 1 ? 'active' : ''}"><div><div class="name">${fouls(m.consecutiveFouls[1])}${esc(names[1])}</div><div class="sub">${sub(1)}</div></div><div class="pts">${m.scores[1]}</div></div>`;
    const on = new Set(ballsOnTable(m.table));
    const target = lowestBall(m.table);
    this.rail.innerHTML = Array.from({ length: 9 }, (_, i) => i + 1)
      .map((n) => `<div class="b ${n === 9 ? 'stripe' : ''} ${on.has(n) ? '' : 'down'} ${n === target ? 'target' : ''}" style="--c:${BALL_COLORS[n]}" data-n="${n}"></div>`)
      .join('');

    // status
    let st = '';
    if (g.mode === 'aim' && g.powerActive) st = '<b>Bidikan terkunci</b> — atur power, lalu tekan Space untuk memukul';
    else if (g.mode === 'aim') {
      if (m.phase === 'break') st = '<b>Break</b> — seret cue ball di belakang head string, lalu bidik';
      else if (m.ballInHand === 'anywhere') st = '<b>Ball in hand</b> — seret cue ball ke mana saja';
      else if (g.pushOutArmed) st = '<b>Push-out</b> dinyatakan — pukulan ini tidak wajib mengenai bola';
      else if (m.pushOutAvailable) st = `Bola target: <b>${target}</b> · push-out tersedia`;
      else st = `Bola target: <b>${target}</b>`;
      if (g.isJumpCue) st += ` · ${this.jumpText()}`;
    } else if (g.mode === 'decision') st = `<b>${esc(names[m.currentPlayer])}</b>: main dari posisi ini, atau kembalikan giliran?`;
    else if (g.mode === 'replay') st = `<b>Replay</b> ${g.playSpeed < 1 ? '· slow-motion ' + g.playSpeed + '×' : ''}`;
    if (g.mode === 'aim' && g.powerActive && g.isJumpCue) st += `<br>${this.jumpText()}`;
    if (g.mode === 'aim') st += `<br><span class="cuename">${esc(g.cue.name)} · P${g.cue.power} · S${g.cue.spin} · D${g.cue.deflection}</span>`;
    this.status.innerHTML = st;

    // spin & elevasi
    this.updateStroke();
    const aiming = g.mode === 'aim';
    this.spin.classList.toggle('hidden', !aiming);
    this.power.classList.toggle('hidden', !aiming);
    this.power.classList.toggle('armed', aiming && g.powerActive);
    this.powerTxt.innerHTML = g.powerActive
      ? '<b>Bidikan terkunci</b><br><kbd>Mouse ↕</kbd> atur power · <kbd>Scroll</kbd>/<kbd>↑↓</kbd> ±0,1<br><kbd>Space</kbd> pukul · <kbd>Esc</kbd> batal'
      : '<kbd>Space</kbd> kunci bidikan &amp; atur power<br><kbd>Klik kiri</kbd> tahan, tarik lalu dorong<br><kbd>W A S D</kbd> spin · <kbd>Q</kbd>/<kbd>E</kbd> elevasi · <kbd>K</kbd> stik · <kbd>J</kbd> jump';

    // tombol
    this.actions.innerHTML = '';
    const btn = (label: string, fn: () => void, cls = ''): void => {
      const b = el('button', cls);
      b.innerHTML = label;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
        b.blur();
      };
      this.actions.appendChild(b);
    };
    if (g.mode === 'aim') {
      if (m.pushOutAvailable) btn(g.pushOutArmed ? 'Batalkan push-out' : 'Push-out', () => g.togglePushOut(), g.pushOutArmed ? 'on' : '');
      if (!g.powerActive) {
        btn(`Stik: ${esc(shortCueName(g.cue))} ▾ <kbd>K</kbd>`, () => this.toggleCueMenu(), this.cueMenuOpen ? 'on' : '');
        btn(g.isJumpCue ? 'Stik play <kbd>J</kbd>' : 'Jump cue <kbd>J</kbd>', () => g.toggleJumpCue(), g.isJumpCue ? 'on' : '');
      }
      if (g.canReplay) btn('Replay <kbd>P</kbd>', () => g.startReplay(1));
      btn('Tampak atas <kbd>T</kbd>', () => g.rig.toggleTop());
      btn('Menu <kbd>Esc</kbd>', () => this.showPause());
    } else if (g.mode === 'decision') {
      btn('Main dari sini', () => g.decidePushOut(true), 'primary');
      btn('Kembalikan giliran', () => g.decidePushOut(false));
    } else if (g.mode === 'replay') {
      btn(g.playSpeed < 1 ? 'Kecepatan normal' : 'Slow-motion 0.25×', () => {
        g.playSpeed = g.playSpeed < 1 ? 1 : 0.25;
        this.refresh();
      });
      btn('Selesai', () => g.stopReplay(), 'primary');
    }
    if (this.cueMenuOpen && !g.canChangeCue) this.cueMenuOpen = false;
    this.renderCueMenu();
    this.hint.textContent =
      g.mode === 'aim' && !g.powerActive ? (this.pointerLocked ? 'Gerakkan mouse untuk membidik · Shift = bidik halus · Esc = lepas kursor' : 'Klik meja untuk membidik dengan mouse · ←/→ juga bisa') : '';
  }

  // ───────────── sheet: menu / pause / rack / match ─────────────

  private closeSheet(): void {
    this.sheet.innerHTML = '';
    this.sheet.className = '';
    this.sheetOpen = null;
    this.refresh();
  }

  private settingsRows(heading = true): string {
    const s = this.settings;
    const opt = (v: string, label: string, cur: string): string => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
    return `
      ${heading ? '<h3>Pengaturan</h3>' : ''}
      <div class="row"><label>Grafis</label><select data-s="quality">${opt('low', 'Low', s.quality)}${opt('medium', 'Medium', s.quality)}${opt('high', 'High', s.quality)}${opt('ultra', 'Ultra', s.quality)}</select></div>
      <div class="row"><label>Garis bidik</label><select data-s="guide">${opt('on', 'On (dengan arah bola)', s.guide)}${opt('short', 'Pendek', s.guide)}${opt('off', 'Off', s.guide)}</select></div>
      <div class="row"><label>Volume</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-s="volume"></div>
      <div class="row"><label>Ambience ruangan</label><input type="checkbox" ${s.ambience ? 'checked' : ''} data-s="ambience"></div>
      <div class="row"><label>Sensitivitas mouse</label><input type="range" min="0.4" max="2" step="0.05" value="${s.sensitivity}" data-s="sensitivity"></div>`;
  }

  private bindSettings(card: HTMLElement): void {
    card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.s as keyof Settings;
        const s = this.settings as unknown as Record<string, unknown>;
        if (inp instanceof HTMLInputElement && inp.type === 'checkbox') s[k] = inp.checked;
        else if (inp instanceof HTMLInputElement && inp.type === 'range') s[k] = +inp.value;
        else s[k] = inp.value;
        saveSettings(this.settings);
        this.app.applySettings();
      });
    });
  }

  private open(kind: NonNullable<Hud['sheetOpen']>, html: string, clear = false, cls = ''): HTMLElement {
    this.sheet.className = `sheet interactive ${clear ? 'clear' : ''}`;
    this.sheet.innerHTML = `<div class="card ${cls}">${html}</div>`;
    this.sheetOpen = kind;
    this.refresh();
    return this.sheet.firstElementChild as HTMLElement;
  }

  showMenu(): void {
    const o = this.menuOptions;
    const card = this.open(
      'menu',
      `<header class="hero">
        <img src="/brand/openbilliard-320.png" alt="Open Billiard">
        <div class="tag"><i></i>Simulator biliar 9-ball<i></i></div>
      </header>
      <nav class="tabs" role="tablist">
        <button class="on" data-tab="match" role="tab">Pertandingan</button><button data-tab="settings" role="tab">Pengaturan</button><button data-tab="help" role="tab">Kontrol</button>
      </nav>
      <div class="panes">
        <section data-pane="match">
          <div class="arenas" role="radiogroup" aria-label="Arena">
            <small>Arena</small>
            ${ARENAS.map(
              (a) =>
                `<button class="arena ${a.id === this.settings.arena ? 'on' : ''}" data-arena="${a.id}" role="radio" aria-checked="${a.id === this.settings.arena}" style="--ac:${a.accent}"><i></i><span><b>${esc(a.name)}</b><em>${esc(a.desc)}</em></span></button>`,
            ).join('')}
          </div>
          <div class="versus">
            <label><small>Pemain 1</small><input type="text" maxlength="16" value="${esc(o.playerNames[0])}" data-p="0"></label>
            <b>VS</b>
            <label><small>Pemain 2</small><input type="text" maxlength="16" value="${esc(o.playerNames[1])}" data-p="1"></label>
          </div>
          <div class="race"><div><small>Race to</small><span>Rack untuk menang</span></div><div class="stepper"><button data-r="-1" aria-label="Kurangi">−</button><b>${o.raceTo}</b><button data-r="1" aria-label="Tambah">+</button></div></div>
          <div class="row"><label>Kalah rack setelah 3 foul beruntun</label><input type="checkbox" ${o.threeFoulRule ? 'checked' : ''} data-o="threeFoulRule"></div>
          <div class="row"><label>Break bergantian</label><input type="checkbox" ${o.alternateBreak ? 'checked' : ''} data-o="alternateBreak"></div>
        </section>
        <section data-pane="settings" hidden>${this.settingsRows(false)}</section>
        <section data-pane="help" class="keys" hidden><div><kbd>Mouse</kbd><span>Bidik</span></div><div><kbd>Shift</kbd><span>Bidik halus</span></div><div><kbd>Klik kiri</kbd><span>Tarik &amp; dorong = pukul</span></div><div><kbd>Space</kbd><span>Kunci bidikan · power · pukul</span></div><div><kbd>W A S D</kbd><span>Titik pukul (spin)</span></div><div><kbd>Q / E</kbd><span>Elevasi stik</span></div><div><kbd>Klik kanan</kbd><span>Orbit kamera</span></div><div><kbd>Scroll</kbd><span>Zoom</span></div><div><kbd>T</kbd><span>Tampak atas</span></div><div><kbd>R</kbd><span>Reset kamera</span></div><div><kbd>P</kbd><span>Replay</span></div><div><kbd>C</kbd><span>Titik pukul ke tengah</span></div><div><kbd>K</kbd><span>Menu pilihan stik</span></div><div><kbd>J</kbd><span>Stik play ↔ jump cue</span></div></section>
      </div>
      <button class="primary go"><span>Mulai pertandingan</span><i>→</i></button>`,
      true,
      'menu',
    );
    card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((t) => (t.onclick = () => {
      card.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((x) => x.classList.toggle('on', x === t));
      card.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
    }));
    card.querySelectorAll<HTMLInputElement>('[data-p]').forEach((i) => i.addEventListener('input', () => (o.playerNames[+i.dataset.p!] = i.value.trim() || `Pemain ${+i.dataset.p! + 1}`)));
    card.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => (b.onclick = () => {
      o.raceTo = Math.min(11, Math.max(1, o.raceTo + +b.dataset.r!));
      card.querySelector('.stepper b')!.textContent = String(o.raceTo);
    }));
    card.querySelectorAll<HTMLInputElement>('[data-o]').forEach((i) => i.addEventListener('input', () => ((o as unknown as Record<string, boolean>)[i.dataset.o!] = i.checked)));
    this.bindSettings(card);
    const go = card.querySelector('.go') as HTMLButtonElement;
    const arenaBtns = [...card.querySelectorAll<HTMLButtonElement>('[data-arena]')];
    let arenaBusy = false;
    for (const b of arenaBtns) {
      b.onclick = async () => {
        const id = b.dataset.arena as ArenaId;
        if (arenaBusy || id === this.settings.arena) return;
        arenaBusy = true;
        go.disabled = true;
        b.classList.add('loading');
        b.style.setProperty('--p', '0');
        try {
          await this.app.selectArena(id, (f) => b.style.setProperty('--p', String(f)));
          for (const x of arenaBtns) {
            const on = x === b;
            x.classList.toggle('on', on);
            x.setAttribute('aria-checked', String(on));
          }
        } catch (err) {
          console.error(err);
          this.toast('Gagal memuat arena');
        } finally {
          b.classList.remove('loading');
          arenaBusy = false;
          go.disabled = false;
        }
      };
    }
    go.onclick = () => {
      if (arenaBusy) return;
      this.closeSheet();
      this.app.startMatch({ ...o, playerNames: [o.playerNames[0], o.playerNames[1]] });
    };
  }

  showPause(): void {
    if (this.sheetOpen || !this.game.match) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const card = this.open('pause', `<h2>Jeda</h2>${this.settingsRows()}<div class="two"><button class="quit">Keluar ke menu</button><button class="primary resume">Lanjutkan</button></div>`);
    this.bindSettings(card);
    (card.querySelector('.resume') as HTMLButtonElement).onclick = () => this.hidePause();
    (card.querySelector('.quit') as HTMLButtonElement).onclick = () => {
      this.closeSheet();
      this.app.quitToMenu();
    };
  }
  hidePause(): void {
    if (this.sheetOpen !== 'pause') return;
    this.closeSheet();
    this.app.resume();
  }

  private showRackOver(winner: number, matchOver: boolean): void {
    const m = this.game.match!;
    const name = esc(m.options.playerNames[winner]);
    if (document.pointerLockElement) document.exitPointerLock();
    if (matchOver) {
      const card = this.open(
        'match',
        `<div class="tag" style="margin:0 0 8px">Pertandingan selesai</div><h2>${name} menang!</h2>
         <div class="final">${m.scores[0]}<span>–</span>${m.scores[1]}</div>
         <div style="color:var(--muted)">${esc(m.options.playerNames[0])} vs ${esc(m.options.playerNames[1])} · race to ${m.options.raceTo}</div>
         <div class="two"><button class="menu">Menu utama</button><button class="primary again">Main lagi</button></div>`,
        true,
      );
      (card.querySelector('.again') as HTMLButtonElement).onclick = () => {
        this.closeSheet();
        this.app.startMatch({ ...m.options });
      };
      (card.querySelector('.menu') as HTMLButtonElement).onclick = () => {
        this.closeSheet();
        this.app.quitToMenu();
      };
    } else {
      const card = this.open(
        'rack',
        `<div class="tag" style="margin:0 0 8px">Rack ${m.rackNumber} selesai</div><h2>${name} menang rack</h2>
         <div class="final">${m.scores[0]}<span>–</span>${m.scores[1]}</div>
         <button class="primary go">Rack berikutnya</button>`,
        true,
      );
      (card.querySelector('.go') as HTMLButtonElement).onclick = () => {
        this.closeSheet();
        this.app.nextRack();
      };
    }
  }
}

export function createLoading(): { set(f: number, label: string): void; done(): void } {
  const root = el('div', 'loading', '<div><h1 class="brand"><img src="/brand/openbilliard-320.png" alt="Open Billiard"></h1><div class="track"><i></i></div><p>memuat…</p></div>');
  document.body.appendChild(root);
  const bar = root.querySelector('i') as HTMLElement;
  const p = root.querySelector('p') as HTMLElement;
  return {
    set(f, label) {
      bar.style.width = `${Math.round(f * 100)}%`;
      p.textContent = label;
    },
    done() {
      root.classList.add('done');
      setTimeout(() => root.remove(), 900);
    },
  };
}

export const MAX_CUE_SPEED = CUE_MAX_SPEED;
