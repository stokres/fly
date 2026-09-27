// Sounds from below, to make altitude audible: surf along coastlines that fades as you climb,
// and seabird calls placed in 3D where birds circle in thermals. Calls are sparse and random,
// so the world feels alive without looping patterns.
import { Vector3 } from 'three';
import type { AudioBus } from './audio';
import { tuning } from './tuning';

export interface SoundscapeInput {
  /** Height above whatever is below (terrain or sea). */
  aboveGround: number;
  /** 0..1: how much coastline is around the player (land and sea both near). */
  coast: number;
  /** 0..1: fraction of open sea around the player. */
  sea: number;
  /** Nearest circling birds (a thermal), or null. */
  birds: Vector3 | null;
  /** Distance from the camera to `birds`. */
  birdDistance: number;
  night: number;
}

export class Soundscape {
  private readonly bus: AudioBus;
  private readonly surf: { gain: GainNode; period: number; phase: number }[] = [];
  private readonly surfOut: GainNode;
  private time = 0;
  private nextCall = 3;
  private readonly callPos = new Vector3();

  constructor(bus: AudioBus) {
    this.bus = bus;
    const { ctx } = bus;
    this.surfOut = ctx.createGain();
    this.surfOut.gain.value = 0;
    this.surfOut.connect(bus.out);
    // Two layers of low-passed noise swelling on different periods: waves that never quite repeat.
    for (const [cutoff, period, phase] of [
      [450, 7.3, 0],
      [900, 5.1, 2.2],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = bus.noise.brown;
      src.loop = true;
      src.start(0, Math.random() * bus.noise.brown.duration);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.surfOut);
      this.surf.push({ gain, period, phase });
    }
  }

  update(dt: number, input: SoundscapeInput): void {
    const a = tuning.audio;
    const now = this.bus.ctx.currentTime;
    this.time += dt;

    // Surf: loud along coasts, a faint hush over open sea, gone at altitude.
    const nearness = Math.exp(-Math.max(0, input.aboveGround) / a.surfFalloff);
    const level = a.wavesVolume * (input.coast + 0.2 * input.sea) * nearness;
    this.surfOut.gain.setTargetAtTime(level, now, 0.3);
    for (const layer of this.surf) {
      const swell = Math.pow(0.5 + 0.5 * Math.sin((this.time / layer.period) * Math.PI * 2 + layer.phase), 2);
      layer.gain.gain.setTargetAtTime(0.25 + 0.75 * swell, now, 0.4);
    }

    // Seabird calls: more often the closer the circling birds; rare at night.
    this.nextCall -= dt;
    if (this.nextCall <= 0) {
      const proximity = input.birds ? Math.exp(-input.birdDistance / a.birdHearing) : 0;
      const rate = proximity * (1 - 0.9 * input.night); // calls per ~3 s at best
      this.nextCall = 1 + Math.random() * 4;
      if (a.birdsVolume > 0 && input.birds && Math.random() < rate) {
        const angle = Math.random() * Math.PI * 2;
        this.callPos.set(Math.cos(angle) * 40, (Math.random() - 0.5) * 60, Math.sin(angle) * 40).add(input.birds);
        this.gullCall(this.callPos, 1 + Math.floor(Math.random() * 3));
      }
    }
  }

  /** A gull-like "kyow", repeated a few times, from a point in the world. */
  private gullCall(at: Vector3, repeats: number): void {
    const { ctx } = this.bus;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 60,
      rolloffFactor: 1,
      positionX: at.x,
      positionY: at.y,
      positionZ: at.z,
    });
    panner.connect(this.bus.out);
    panner.connect(this.bus.reverb);

    const start = ctx.currentTime + 0.05;
    const pitch = 0.85 + Math.random() * 0.3;
    for (let r = 0; r < repeats; r++) {
      const t = start + r * (0.32 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1500 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(820 * pitch, t + 0.28);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 28;
      const depth = ctx.createGain();
      depth.gain.value = 40;
      vibrato.connect(depth).connect(osc.frequency);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1700;
      band.Q.value = 1.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35 * tuning.audio.birdsVolume, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(band).connect(gain).connect(panner);
      osc.start(t);
      vibrato.start(t);
      osc.stop(t + 0.32);
      vibrato.stop(t + 0.32);
    }
    // Let the panner go once the last call has faded.
    setTimeout(() => panner.disconnect(), (repeats * 0.45 + 1) * 1000);
  }
}
