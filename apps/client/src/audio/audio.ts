import * as THREE from 'three';
import type { SimEvent } from '@billiards/shared';
import { toThree } from '../render/coords';
import * as synth from './synth';

type Bank = 'clack' | 'cushion' | 'cue' | 'break' | 'miscue' | 'pocket' | 'slate';
const v3 = new THREE.Vector3();
const SOUND_BASE = '/assets/sound/';

/** WebAudio: suara dipicu dari events[] simulasi; volume & pitch mengikuti kecepatan tumbukan. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bank = new Map<Bank, AudioBuffer[]>();
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private volume = 0.8;
  private ambienceOn = true;
  private frameVoices = 0;

  constructor(private camera: THREE.Camera) {
    const unlock = (): void => {
      this.ensure();
      void this.ctx?.resume();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    const buf = (data: Float32Array): AudioBuffer => {
      const b = ctx.createBuffer(1, data.length, synth.SAMPLE_RATE);
      b.getChannelData(0).set(data);
      return b;
    };
    this.bank.set('clack', [0, 1, 2, 3].map((i) => buf(synth.ballClack(i))));
    this.bank.set('cushion', [0, 1, 2].map((i) => buf(synth.cushionThud(i))));
    this.bank.set('cue', [buf(synth.cueHit(false))]);
    this.bank.set('break', [buf(synth.cueHit(true))]);
    this.bank.set('miscue', [buf(synth.miscue())]);
    this.bank.set('pocket', [0, 1, 2].map((i) => buf(synth.pocketDrop(i))));
    this.bank.set('slate', [buf(synth.slateThump())]);
    // rekaman asli (CC0, lihat assets/sound/LICENSES.md) menggantikan sintesis begitu selesai dimuat;
    // sintesis tetap jadi cadangan bila berkas gagal dimuat. Miscue & room tone tetap sintesis.
    void this.loadRecordings(ctx);
    // ambience
    const src = ctx.createBufferSource();
    src.buffer = buf(synth.roomTone());
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = this.ambienceOn ? 0.05 : 0;
    src.connect(gain).connect(this.master);
    src.start();
    this.ambience = { src, gain };
  }

  private async loadRecordings(ctx: AudioContext): Promise<void> {
    try {
      const res = await fetch(`${SOUND_BASE}sounds.json`);
      if (!res.ok) return;
      const banks = (await res.json()) as Partial<Record<Bank, string[]>>;
      await Promise.all(
        (Object.entries(banks) as [Bank, string[]][]).map(async ([bank, files]) => {
          const bufs = await Promise.all(
            files.map(async (f) => ctx.decodeAudioData(await (await fetch(SOUND_BASE + f)).arrayBuffer())),
          );
          if (bufs.length) this.bank.set(bank, bufs);
        }),
      );
    } catch (err) {
      console.warn('rekaman suara gagal dimuat, memakai suara sintesis', err);
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setAmbience(on: boolean): void {
    this.ambienceOn = on;
    if (this.ambience) this.ambience.gain.gain.value = on ? 0.05 : 0;
  }

  /** Panggil sekali per frame (membatasi jumlah suara serentak, mis. saat break). */
  beginFrame(): void {
    this.frameVoices = 0;
  }

  private play(bank: Bank, gain: number, rate: number, pos: [number, number, number] | null, lowpass = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || gain < 0.004) return;
    if (this.frameVoices >= 8) return;
    this.frameVoices++;
    const list = this.bank.get(bank);
    if (!list) return;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    let pan = 0;
    let dist = 1;
    if (pos) {
      toThree(pos[0], pos[1], pos[2], v3);
      dist = Math.max(0.6, v3.distanceTo(this.camera.position));
      v3.project(this.camera);
      pan = Math.max(-0.8, Math.min(0.8, v3.x * 0.7));
    }
    g.gain.value = Math.min(1.4, gain) * Math.min(1, 1.6 / dist) ** 0.6;
    let node: AudioNode = src;
    if (lowpass > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f);
      node = f;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(g).connect(p).connect(this.master);
    src.start();
  }

  onSimEvent(e: SimEvent, slowmo = 1): void {
    const v = e.speed;
    const rate = slowmo < 1 ? 0.6 : 1;
    switch (e.type) {
      case 'ball-ball':
        if (v < 0.015) return;
        // tumbukan pelan lebih lembut dan lebih redup (lowpass)
        this.play('clack', Math.pow(v / 3.5, 0.75), rate * (0.94 + Math.min(0.12, v * 0.012)), e.pos, v < 1.2 ? 2500 + v * 6000 : 0);
        break;
      case 'cushion':
      case 'jaw':
        if (v < 0.03) return;
        this.play('cushion', Math.pow(v / 3, 0.8) * 0.9, rate * (e.type === 'jaw' ? 1.25 : 1), e.pos);
        break;
      case 'cue':
        this.play(v > 6.5 ? 'break' : 'cue', 0.25 + Math.pow(v / 9, 0.7) * 0.9, rate * (0.92 + v * 0.012), e.pos);
        break;
      case 'miscue':
        this.play('miscue', 0.7, rate, e.pos);
        break;
      case 'pocket':
        this.play('pocket', 0.55 + Math.min(0.4, v * 0.12), rate, e.pos);
        break;
      case 'slate':
        this.play('slate', Math.pow(v / 2, 0.8), rate, e.pos);
        break;
      case 'off-table':
        this.play('cushion', 0.8, 0.7 * rate, e.pos);
        break;
    }
  }
}
