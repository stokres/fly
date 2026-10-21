// Challenge-mode sounds, synthesized like everything else: hits, purifications, near misses,
// lightning (warning crackle, crack and rolling thunder), ring pings, event stings and the end
// of a run. Notes stay in A minor so they sit inside the music. One-shot nodes per sound.
import type { AudioBus } from '../audio';
import { tuning } from '../tuning';

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const PENTA = [0, 3, 5, 7, 10];

export class ChallengeSfx {
  constructor(private readonly bus: () => AudioBus | null) {}

  private get vol(): number {
    return tuning.audio.sfxVolume;
  }

  /** A tone with an attack/decay envelope. */
  private tone(b: AudioBus, freq: number, at: number, len: number, gain: number, type: OscillatorType = 'sine', glideTo = 0, wet = 0.3): void {
    const o = b.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glideTo > 0) o.frequency.exponentialRampToValueAtTime(glideTo, at + len);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain * this.vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    o.connect(g);
    g.connect(b.out);
    if (wet > 0) {
      const send = b.ctx.createGain();
      send.gain.value = wet;
      g.connect(send).connect(b.reverb);
    }
    o.start(at);
    o.stop(at + len + 0.05);
  }

  /** Filtered noise burst, optionally sweeping. */
  private noise(
    b: AudioBus,
    at: number,
    len: number,
    gain: number,
    type: BiquadFilterType,
    freq: number,
    freqTo = 0,
    q = 1,
    brown = false,
    attack = 0.005,
    wet = 0.2,
  ): void {
    const src = b.ctx.createBufferSource();
    src.buffer = brown ? b.noise.brown : b.noise.white;
    const f = b.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, at);
    if (freqTo > 0) f.frequency.exponentialRampToValueAtTime(freqTo, at + len);
    const g = b.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain * this.vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    src.connect(f).connect(g);
    g.connect(b.out);
    if (wet > 0) {
      const send = b.ctx.createGain();
      send.gain.value = wet;
      g.connect(send).connect(b.reverb);
    }
    src.start(at, Math.random() * (src.buffer.duration - len - 0.1));
    src.stop(at + len + 0.05);
  }

  private now(): [AudioBus, number] | null {
    const b = this.bus();
    return b ? [b, b.ctx.currentTime + 0.01] : null;
  }

  /** Hurt: a heavy thud, a crunch and a sour low cluster. */
  hit(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.tone(b, 130, t, 0.5, 0.7, 'sine', 38, 0.1);
    this.noise(b, t, 0.35, 0.5, 'bandpass', 900, 250, 0.8);
    this.tone(b, hz(40), t, 0.6, 0.12, 'sawtooth', hz(37), 0.2);
    this.tone(b, hz(41), t, 0.6, 0.12, 'sawtooth', hz(38), 0.2);
  }

  /** Purified: a rising whoosh into a bright chord. */
  purify(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.noise(b, t, 0.4, 0.35, 'bandpass', 500, 5000, 1.5, false, 0.15);
    [81, 84, 88, 93].forEach((m, i) => this.tone(b, hz(m), t + 0.12 + i * 0.035, 1.2, 0.09, i % 2 ? 'triangle' : 'sine', 0, 0.5));
  }

  /** Near miss: a fast doppler swish. */
  nearMiss(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.noise(b, t, 0.32, 0.45, 'bandpass', 3200, 500, 2.5, false, 0.03, 0.1);
    this.tone(b, hz(88), t + 0.05, 0.3, 0.05, 'triangle');
  }

  /** A shadow appears: a low, uneasy breath. */
  spawn(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.tone(b, hz(52), t, 1.4, 0.06, 'triangle', hz(46), 0.6);
    this.tone(b, hz(53), t + 0.05, 1.4, 0.05, 'triangle', hz(47), 0.6);
    this.noise(b, t, 1.2, 0.12, 'bandpass', 300, 160, 2, true, 0.4, 0.5);
  }

  /** Lightning is coming: a crackle that tightens over the warning time. */
  telegraph(seconds: number): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.noise(b, t, seconds, 0.22, 'bandpass', 400, 3000, 6, false, seconds * 0.8, 0.2);
  }

  /** The bolt: a sharp crack (louder when close) then rolling thunder. */
  thunder(distance: number): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    const near = Math.max(0, 1 - distance / 400);
    this.noise(b, t, 0.18, 0.9 * near + 0.1, 'highpass', 1200, 0, 0.7);
    const delay = Math.min(0.8, distance / 600);
    this.noise(b, t + delay, 3.2, 0.9, 'lowpass', 260, 90, 0.7, true, 0.08, 0.5);
    this.tone(b, 55, t + delay, 1.6, 0.35 * (0.4 + near), 'sine', 32, 0.3);
  }

  /** Ring passed: a bright ping climbing the scale with each ring. */
  ring(index: number): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    const m = 69 + PENTA[index % 5] + 12 * Math.floor(index / 5);
    this.tone(b, hz(m), t, 0.9, 0.16, 'sine', 0, 0.4);
    this.tone(b, hz(m + 12), t, 0.4, 0.06, 'triangle', 0, 0.4);
    this.noise(b, t, 0.25, 0.15, 'highpass', 5000, 0, 0.7);
  }

  /** Caught a falling star. */
  star(count: number): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    const m = 81 + PENTA[count % 5] + 12 * (Math.floor(count / 5) % 2);
    this.tone(b, hz(m), t, 0.7, 0.12, 'sine', 0, 0.5);
    this.tone(b, hz(m + 7), t + 0.04, 0.5, 0.05, 'triangle', 0, 0.5);
  }

  /** Something failed (ring timer, spirit escaped): a falling minor third. */
  fail(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.tone(b, hz(64), t, 0.6, 0.14, 'triangle', 0, 0.4);
    this.tone(b, hz(60), t + 0.22, 1.2, 0.14, 'triangle', 0, 0.5);
  }

  /** An event begins: two drum hits and a low swell. */
  eventStart(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    for (const [d, v] of [[0, 0.8], [0.18, 0.6]]) {
      this.tone(b, 110, t + d, 0.5, v, 'sine', 45, 0.3);
      this.noise(b, t + d, 0.12, 0.35 * v, 'lowpass', 900, 0, 0.7);
    }
    this.tone(b, hz(45), t + 0.3, 2.5, 0.18, 'sine', 0, 0.6);
    this.tone(b, hz(52), t + 0.3, 2.5, 0.1, 'triangle', 0, 0.6);
  }

  /** An event won: a bright, resolving arpeggio (A major, after all that minor). */
  eventWin(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    [69, 73, 76, 81, 85, 88].forEach((m, i) => this.tone(b, hz(m), t + i * 0.07, 1.8, 0.11, i % 2 ? 'triangle' : 'sine', 0, 0.5));
    this.noise(b, t + 0.3, 1.2, 0.08, 'highpass', 6000, 0, 0.5, false, 0.3, 0.6);
  }

  /** A light (life) regained. */
  lifeUp(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    this.tone(b, hz(76), t, 0.6, 0.12, 'sine', 0, 0.5);
    this.tone(b, hz(81), t + 0.12, 1.0, 0.12, 'sine', 0, 0.5);
  }

  /** Danger rises: a low two-note warning. */
  warn(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    for (let i = 0; i < 2; i++) {
      this.tone(b, hz(45), t + i * 0.45, 0.4, 0.22, 'square', 0, 0.2);
      this.tone(b, hz(46), t + i * 0.45, 0.4, 0.12, 'square', 0, 0.2);
    }
  }

  /** Your light goes out: a slow fall into the low register. */
  gameOver(): void {
    const n = this.now();
    if (!n) return;
    const [b, t] = n;
    [69, 64, 60, 57, 45].forEach((m, i) => this.tone(b, hz(m), t + i * 0.32, 2.4, 0.13, 'triangle', 0, 0.7));
    this.noise(b, t, 2.5, 0.25, 'lowpass', 600, 80, 0.7, true, 0.4, 0.6);
  }
}
