// Percussion for the music when the game gets tense: synthesized taiko (a pitched-down thump with
// a skin slap), a dry rim "ka" and a shaker. music.ts schedules it bar by bar on its own grid,
// so the drums always land with the piano; patterns grow busier with tension.
import type { AudioBus } from './audio';

export class Percussion {
  constructor(
    private readonly bus: AudioBus,
    private readonly out: AudioNode,
  ) {}

  /** Schedules one bar of drums starting at `t0`. `tension` 0..1 picks the pattern. */
  scheduleBar(t0: number, beat: number, tension: number, bar: number): void {
    if (tension < 0.25) return;
    const v = Math.min(1, (tension - 0.25) / 0.5);
    const at = (b: number) => t0 + b * beat;
    // Taiko: the heartbeat.
    this.taiko(at(0), 0.75 * v + 0.25);
    this.taiko(at(2), 0.5 * v + 0.15);
    if (tension > 0.55) {
      this.taiko(at(1.5), 0.45 * v);
      this.taiko(at(3), 0.55 * v);
      this.ka(at(1), 0.5 * v);
      this.ka(at(3), 0.4 * v);
    }
    // Shaker eighths, accented on the off-beats.
    if (tension > 0.4) for (let i = 0; i < 8; i++) this.shaker(at(i * 0.5), (i % 2 ? 0.28 : 0.16) * v);
    // A rolling fill at the end of every fourth bar when it really matters.
    if (tension > 0.8 && bar % 4 === 3) {
      for (let i = 0; i < 4; i++) this.taiko(at(3 + i * 0.25), 0.35 + i * 0.15);
    }
  }

  private taiko(at: number, vel: number): void {
    const { ctx } = this.bus;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(105, at);
    o.frequency.exponentialRampToValueAtTime(44, at + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.9 * vel, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.7);
    o.connect(g).connect(this.out);
    o.start(at);
    o.stop(at + 0.75);
    // Skin slap.
    const n = ctx.createBufferSource();
    n.buffer = this.bus.noise.white;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, at);
    ng.gain.linearRampToValueAtTime(0.35 * vel, at + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0005, at + 0.12);
    n.connect(f).connect(ng).connect(this.out);
    n.start(at, Math.random() * 2);
    n.stop(at + 0.15);
  }

  private ka(at: number, vel: number): void {
    this.click(at, vel, 'bandpass', 2400, 4, 0.05);
  }

  private shaker(at: number, vel: number): void {
    this.click(at, vel, 'highpass', 6500, 0.7, 0.07);
  }

  private click(at: number, vel: number, type: BiquadFilterType, freq: number, q: number, len: number): void {
    const { ctx } = this.bus;
    const n = ctx.createBufferSource();
    n.buffer = this.bus.noise.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5 * vel, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    n.connect(f).connect(g).connect(this.out);
    n.start(at, Math.random() * 2);
    n.stop(at + len + 0.02);
  }
}
