// Game audio, all synthesized with the Web Audio API (no sample files).
// This file owns the context, the mix bus (master, reverb) and the creature's own sounds: wind
// driven by airspeed, and wing flaps timed to the downstroke. The pad lives in music.ts and the
// sounds from below in soundscape.ts.
//
// Browsers only allow audio after a user gesture, so nothing starts until start() is called
// from the first key press or click.
import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import { Music } from './music';
import { Soundscape, type SoundscapeInput } from './soundscape';
import { tuning } from './tuning';

/** Shared mix bus handed to the other audio systems. */
export interface AudioBus {
  ctx: AudioContext;
  /** Dry output. */
  out: AudioNode;
  /** Reverb send. */
  reverb: AudioNode;
  noise: { white: AudioBuffer; brown: AudioBuffer };
}

export interface AudioInput extends SoundscapeInput {
  speed: number;
  bank: number;
  flapCount: number;
  /** 0..1 inside a cloud. */
  inCloud: number;
  /** 0 by day, 1 at night. */
  night: number;
}

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1; // audio noise need not be reproducible
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
  }
  return buffer;
}

/** A long, soft stereo reverb tail made from decaying noise. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3);
    }
  }
  return buffer;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private bus!: AudioBus;
  private music!: Music;
  private soundscape!: Soundscape;

  // Wind.
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private whistleFilter!: BiquadFilterNode;
  private whistleGain!: GainNode;
  private windPan!: StereoPannerNode;
  private gust = 0;

  private lastFlapCount = 0;
  private muted = false;
  private readonly levelData = new Float32Array(1024);
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Creates the audio graph. Call from a user gesture handler. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = impulse(ctx, 4.5);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.5;
    convolver.connect(reverbReturn).connect(this.master);

    this.bus = {
      ctx,
      out: this.master,
      reverb: convolver,
      noise: { white: noiseBuffer(ctx, 3, false), brown: noiseBuffer(ctx, 5, true) },
    };

    // Wind body: brown noise, low-passed; brighter and louder with speed.
    this.windPan = ctx.createStereoPanner();
    this.windPan.connect(this.master);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop(this.bus.noise.brown).connect(this.windFilter).connect(this.windGain).connect(this.windPan);

    // Whistle: narrow band of white noise that only comes in at dive speeds.
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.Q.value = 7;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.loop(this.bus.noise.white).connect(this.whistleFilter).connect(this.whistleGain).connect(this.windPan);

    this.music = new Music(this.bus);
    this.soundscape = new Soundscape(this.bus);

    // Don't burn CPU (or play) in a background tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  toggleMute(): void {
    this.muted = !this.muted;
  }

  /** RMS level of the output, 0..1 (for the readout). */
  level(): number {
    if (!this.ctx) return 0;
    this.analyser.getFloatTimeDomainData(this.levelData);
    let sum = 0;
    for (const v of this.levelData) sum += v * v;
    return Math.sqrt(sum / this.levelData.length);
  }

  update(dt: number, input: AudioInput, camera: PerspectiveCamera): void {
    if (!this.ctx) return;
    const a = tuning.audio;
    const now = this.ctx.currentTime;
    const glide = (param: AudioParam, value: number, time = 0.08) => param.setTargetAtTime(value, now, time);

    glide(this.master.gain, this.muted ? 0 : a.masterVolume, 0.1);

    // Wind: a slow random walk adds gusts on top of the speed mapping.
    this.gust += (Math.random() - 0.5) * dt * 2 - this.gust * dt * 0.8;
    const s = MathUtils.clamp((input.speed - a.windMinSpeed) / (a.windMaxSpeed - a.windMinSpeed), 0, 1);
    const cutoff = a.windCutoffMin * Math.pow(a.windCutoffMax / a.windCutoffMin, Math.pow(s, 1.2));
    glide(this.windFilter.frequency, cutoff * (1 - 0.55 * input.inCloud) * (1 + this.gust * 0.3));
    glide(this.windGain.gain, a.windVolume * (0.1 + 0.9 * Math.pow(s, 1.5)) * (1 + this.gust * 0.35));
    glide(this.whistleFilter.frequency, 900 + 1800 * s);
    glide(this.whistleGain.gain, a.whistleVolume * MathUtils.smoothstep(s, 0.45, 1));
    glide(this.windPan.pan, MathUtils.clamp(input.bank * 0.5, -0.6, 0.6), 0.2);

    if (input.flapCount !== this.lastFlapCount) {
      this.lastFlapCount = input.flapCount;
      // The downstroke lands about halfway through the creature's wingbeat animation.
      this.flap(now + tuning.creature.flapDuration * 0.5);
    }

    // The listener rides with the camera, for positioned sounds from below.
    const l = this.ctx.listener;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.setValueAtTime(camera.position.x, now);
      l.positionY.setValueAtTime(camera.position.y, now);
      l.positionZ.setValueAtTime(camera.position.z, now);
      l.forwardX.setValueAtTime(this.forward.x, now);
      l.forwardY.setValueAtTime(this.forward.y, now);
      l.forwardZ.setValueAtTime(this.forward.z, now);
      l.upX.setValueAtTime(this.up.x, now);
      l.upY.setValueAtTime(this.up.y, now);
      l.upZ.setValueAtTime(this.up.z, now);
    }

    this.music.update(dt, input.night);
    this.soundscape.update(dt, input);
  }

  /** One wingbeat: a low whoosh of air plus a soft thump with some weight. */
  private flap(at: number): void {
    const ctx = this.ctx!;
    const v = tuning.audio.flapVolume;

    const air = ctx.createBufferSource();
    air.buffer = this.bus.noise.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(700, at);
    band.frequency.exponentialRampToValueAtTime(260, at + 0.25);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0, at);
    airGain.gain.linearRampToValueAtTime(0.5 * v, at + 0.03);
    airGain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
    air.connect(band).connect(airGain);
    airGain.connect(this.master);
    airGain.connect(this.bus.reverb);
    air.start(at, Math.random() * 2, 0.4);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(95, at);
    thump.frequency.exponentialRampToValueAtTime(45, at + 0.18);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0, at);
    thumpGain.gain.linearRampToValueAtTime(0.35 * v, at + 0.02);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    thump.connect(thumpGain).connect(this.master);
    thump.start(at);
    thump.stop(at + 0.25);
  }

  private loop(buffer: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start(0, Math.random() * buffer.duration);
    return src;
  }
}
