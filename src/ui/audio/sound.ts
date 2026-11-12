// Sound effects and ambient music, synthesized with the Web Audio API: no audio files, works offline.
//
// Browsers only allow sound after the player interacts with the page, so the audio graph is built on the first
// click or key press. Settings (mute, effect and music volume) are kept in this browser.
import { store } from '../../store/simStore';
import { detectCues, tensionOf, trackCues, type Cue, type CueMemo } from './cues';

const KEY = 'mds.audio';
export interface AudioSettings { muted: boolean; sfx: number; music: number }
const DEFAULTS: AudioSettings = { muted: false, sfx: 0.55, music: 0.3 };

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<AudioSettings>;
      const v = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
      return { muted: !!p.muted, sfx: v(p.sfx, DEFAULTS.sfx), music: v(p.music, DEFAULTS.music) };
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

// ── Minimum spacing per cue (seconds): at 8x speed many things happen at once, and a wall of noise helps nobody.
const SPACING: Partial<Record<Cue, number>> = {
  intercept: 0.07, impact: 0.12, report: 0.5, reportCritical: 0.8, launch: 1.2, click: 0.04, escalation: 0.8, resolved: 0.4,
};
const MAX_PER_SECOND = 10;

// Pad chords (Hz), a slow minor progression around D. Each chord: three voices.
const n = (semi: number) => 73.42 * Math.pow(2, semi / 12); // D2 = 73.42 Hz
const CHORDS = [
  [n(0), n(7), n(15)], // Dm (D A F)
  [n(-4), n(5), n(12)], // Bb (Bb F D)
  [n(-7), n(3), n(10)], // Gm (G D Bb) inverted
  [n(-5), n(7), n(14)], // A (A E C#) — the turnaround
];

class SoundSystem {
  settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private pad: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private last = new Map<Cue, number>();
  private recent: number[] = [];
  private listeners = new Set<() => void>();
  private memo: CueMemo | null = null;
  private lastT: number | null = null;
  private tension = 0.12;
  private chord = 0;
  private timers: number[] = [];

  /** Starts listening for the first interaction and for game changes. Safe to call more than once. */
  install() {
    if (typeof window === 'undefined' || (window as unknown as { __mdsSound?: boolean }).__mdsSound) return;
    (window as unknown as { __mdsSound?: boolean }).__mdsSound = true;
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    // Quiet clicks on buttons.
    window.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button, [role=tab], [role=radio]');
      if (b && !(b as HTMLButtonElement).disabled) this.play('click');
    }, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    store.subscribe(() => this.onStore());
    // Interceptions and hits are timed against continuous sim time, so they land when the map shows them.
    this.timers.push(window.setInterval(() => this.onFrame(), 100));
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  update(p: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.applyVolumes();
    this.listeners.forEach((f) => f());
  }

  toggleMute() {
    this.update({ muted: !this.settings.muted });
  }

  get started() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); // keeps stacked effects from clipping
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes(true);
    this.startMusic();
    this.listeners.forEach((f) => f());
  }

  private applyVolumes(now = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.settings.muted ? 0 : 1;
    const set = (g: GainNode, v: number) => (now ? g.gain.setValueAtTime(v, t) : g.gain.setTargetAtTime(v, t, 0.08));
    set(this.master, m);
    set(this.sfxBus, this.settings.sfx);
    set(this.musicBus, this.settings.music * 0.6);
  }

  // ── Game hooks ──

  private onStore() {
    const s = store.state;
    if (!s) {
      this.memo = null;
      this.lastT = null;
      return;
    }
    const r = detectCues(this.memo, s);
    this.memo = r.memo;
    for (const c of r.cues) this.play(c);
  }

  private onFrame() {
    const s = store.state;
    const t = s ? store.simTime() : 0;
    if (s && this.lastT !== null && t > this.lastT && t - this.lastT < 24) {
      for (const c of trackCues(s, this.lastT, t)) this.play(c);
    }
    this.lastT = s ? t : null;
    this.setTension(tensionOf(s, t));
  }

  /** Coach and other UI moments. */
  cue(c: Cue) {
    this.play(c);
  }

  // ── Effects ──

  play(cue: Cue) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.settings.muted || this.settings.sfx <= 0) return;
    const now = ctx.currentTime;
    const gap = SPACING[cue] ?? 0.15;
    if (now - (this.last.get(cue) ?? -99) < gap) return;
    this.recent = this.recent.filter((x) => now - x < 1);
    if (this.recent.length >= MAX_PER_SECOND && cue !== 'complete' && cue !== 'phaseStart') return;
    this.last.set(cue, now);
    this.recent.push(now);
    const fx = this.fx;
    switch (cue) {
      case 'click': return fx.tone(1900, now, 0.018, 0.035, 'sine');
      case 'report': fx.tone(880, now, 0.12, 0.16, 'sine'); return fx.tone(1320, now + 0.11, 0.16, 0.14, 'sine');
      case 'reportCritical':
        for (let i = 0; i < 3; i++) fx.tone(1040, now + i * 0.13, 0.08, 0.12, 'square', 2400);
        return;
      case 'confirm': return fx.sweep(600, 950, now, 0.12, 0.14, 'triangle');
      case 'dismiss': return fx.sweep(720, 380, now, 0.14, 0.12, 'triangle');
      case 'respond': fx.tone(523, now, 0.1, 0.14, 'triangle'); return fx.tone(784, now + 0.09, 0.16, 0.14, 'triangle');
      case 'maintain': fx.tone(220, now, 0.06, 0.12, 'square', 900); return fx.noise(now + 0.02, 0.08, 0.1, 'bandpass', 3200);
      case 'invest': fx.tone(392, now, 0.1, 0.12, 'triangle'); fx.tone(523, now + 0.08, 0.1, 0.12, 'triangle'); return fx.tone(659, now + 0.16, 0.2, 0.12, 'triangle');
      case 'deploy': fx.thump(now, 120, 0.18, 0.3); return fx.tone(1175, now + 0.06, 0.12, 0.08, 'sine');
      case 'alert':
        for (let i = 0; i < 3; i++) {
          fx.tone(660, now + i * 0.3, 0.15, 0.13, 'sawtooth', 1600);
          fx.tone(520, now + i * 0.3 + 0.15, 0.15, 0.13, 'sawtooth', 1600);
        }
        return;
      case 'resupply':
        for (let i = 0; i < 3; i++) fx.noise(now + i * 0.07, 0.03, 0.12, 'highpass', 2500);
        return fx.tone(880, now + 0.22, 0.08, 0.08, 'sine');
      case 'redeploy': return fx.noiseSweep(now, 0.5, 0.14, 400, 2400);
      case 'launch':
        fx.sweep(320, 900, now, 0.35, 0.14, 'sine');
        fx.sweep(320, 900, now + 0.4, 0.35, 0.14, 'sine');
        return fx.thump(now, 55, 0.9, 0.25);
      case 'intercept': fx.noise(now, 0.04, 0.12, 'highpass', 3000); return fx.tone(1600, now, 0.07, 0.07, 'sine');
      case 'impact': fx.thump(now, 90, 0.35, 0.4); return fx.noise(now, 0.25, 0.16, 'lowpass', 700);
      case 'phaseStart': [0, 3, 7, 12].forEach((s, i) => fx.tone(293.66 * Math.pow(2, s / 12), now + i * 0.11, 0.22, 0.11, 'triangle')); return;
      case 'phaseEnd': [12, 7, 3, 0].forEach((s, i) => fx.tone(293.66 * Math.pow(2, s / 12), now + i * 0.11, 0.22, 0.1, 'triangle')); return;
      case 'complete': [0, 4, 7, 12].forEach((s) => fx.tone(261.63 * Math.pow(2, s / 12), now, 1.4, 0.07, 'triangle')); return;
      case 'escalation': fx.tone(110, now, 0.5, 0.14, 'sawtooth', 600); return fx.tone(116.5, now, 0.5, 0.12, 'sawtooth', 600);
      case 'resolved': return fx.tone(1046, now, 0.18, 0.08, 'sine');
      case 'success': fx.tone(988, now, 0.1, 0.1, 'sine'); return fx.tone(1480, now + 0.08, 0.18, 0.1, 'sine');
    }
  }

  private get fx() {
    const ctx = this.ctx!;
    const out = this.sfxBus;
    const env = (g: GainNode, at: number, dur: number, peak: number) => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.01, dur / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    };
    const chain = (src: AudioNode, at: number, dur: number, peak: number, filter?: { type: BiquadFilterType; f: number }) => {
      const g = ctx.createGain();
      env(g, at, dur, peak);
      if (filter) {
        const bq = ctx.createBiquadFilter();
        bq.type = filter.type;
        bq.frequency.value = filter.f;
        src.connect(bq).connect(g);
      } else src.connect(g);
      g.connect(out);
    };
    return {
      tone: (f: number, at: number, dur: number, peak: number, type: OscillatorType, lowpass?: number) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        chain(o, at, dur, peak, lowpass ? { type: 'lowpass', f: lowpass } : undefined);
        o.start(at);
        o.stop(at + dur + 0.05);
      },
      sweep: (f0: number, f1: number, at: number, dur: number, peak: number, type: OscillatorType) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f1, at + dur);
        chain(o, at, dur, peak);
        o.start(at);
        o.stop(at + dur + 0.05);
      },
      thump: (at: number, f: number, dur: number, peak: number) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, at);
        o.frequency.exponentialRampToValueAtTime(Math.max(30, f * 0.4), at + dur);
        chain(o, at, dur, peak);
        o.start(at);
        o.stop(at + dur + 0.05);
      },
      noise: (at: number, dur: number, peak: number, type: BiquadFilterType, f: number) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        chain(src, at, dur, peak, { type, f });
        src.start(at, Math.random() * 0.5);
        src.stop(at + dur + 0.05);
      },
      noiseSweep: (at: number, dur: number, peak: number, f0: number, f1: number) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bq = ctx.createBiquadFilter();
        bq.type = 'bandpass';
        bq.Q.value = 2;
        bq.frequency.setValueAtTime(f0, at);
        bq.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.6);
        bq.frequency.exponentialRampToValueAtTime(f0, at + dur);
        const g = ctx.createGain();
        env(g, at, dur, peak);
        src.connect(bq).connect(g).connect(out);
        src.start(at, Math.random() * 0.4);
        src.stop(at + dur + 0.05);
      },
    };
  }

  // ── Music: a slow generative pad whose brightness and pulse follow the tension. ──

  private startMusic() {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.22, ctx.currentTime, 3); // fade in
    filter.connect(gain).connect(this.musicBus);
    // Slow filter wobble so the pad breathes.
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoAmt.gain.value = 120;
    lfo.connect(lfoAmt).connect(filter.frequency);
    lfo.start();
    const osc: OscillatorNode[] = [];
    for (const [v, f] of CHORDS[0].entries()) {
      for (const detune of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = v === 0 ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = v === 0 ? 0.5 : 0.18;
        o.connect(g).connect(filter);
        o.start();
        osc.push(o);
      }
    }
    // A low sub drone on D.
    const sub = ctx.createOscillator();
    sub.frequency.value = n(-12);
    const subG = ctx.createGain();
    subG.gain.value = 0.35;
    sub.connect(subG).connect(filter);
    sub.start();
    this.pad = { osc, filter, gain };
    // Change chord every 12 s with a slow glide.
    this.timers.push(window.setInterval(() => this.nextChord(), 12_000));
    // A heartbeat pulse when tension is high.
    this.timers.push(window.setInterval(() => this.pulse(), 1100));
  }

  private nextChord() {
    const ctx = this.ctx;
    if (!ctx || !this.pad) return;
    this.chord = (this.chord + 1) % CHORDS.length;
    const ch = CHORDS[this.chord];
    this.pad.osc.forEach((o, i) => o.frequency.setTargetAtTime(ch[Math.floor(i / 2)], ctx.currentTime, 1.5));
  }

  private setTension(x: number) {
    const ctx = this.ctx;
    if (!ctx || !this.pad) return;
    if (Math.abs(x - this.tension) < 0.01) return;
    this.tension = x;
    const t = ctx.currentTime;
    this.pad.filter.frequency.setTargetAtTime(380 + x * 1500, t, 1.2);
    this.pad.gain.gain.setTargetAtTime(0.18 + x * 0.12, t, 1.5);
  }

  private pulse() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.settings.muted || this.tension < 0.55) return;
    const at = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(62, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.25);
    const g = ctx.createGain();
    const peak = 0.12 + (this.tension - 0.55) * 0.5;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    o.connect(g).connect(this.musicBus);
    o.start(at);
    o.stop(at + 0.35);
  }
}

export const sound = new SoundSystem();
