// A soft "felt" piano, synthesized: each pitch is rendered once into an AudioBuffer (additive
// synthesis of slightly inharmonic string partials, each with its own two-stage decay, two
// detuned strings for the low partials, and a muffled hammer thump), then played as a buffer
// source through a velocity-dependent low-pass. Rendering happens in a worker
// (piano.worker.ts) and is cached; a note asked for before its pitch is ready is skipped.
export interface PianoRequest {
  midi: number;
  sampleRate: number;
}
export interface PianoNote {
  midi: number;
  samples: Float32Array<ArrayBuffer>;
}

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Piano {
  private readonly cache = new Map<number, AudioBuffer>();
  private readonly pending = new Set<number>();
  private readonly worker: Worker;

  constructor(private readonly ctx: BaseAudioContext) {
    this.worker = new Worker(new URL('./piano.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<PianoNote>) => {
      const { midi, samples } = e.data;
      const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      this.cache.set(midi, buffer);
      this.pending.delete(midi);
    };
  }

  /** Renders pitches ahead of time in the worker. */
  prepare(midis: Iterable<number>): void {
    for (const midi of midis) {
      if (this.cache.has(midi) || this.pending.has(midi)) continue;
      this.pending.add(midi);
      this.worker.postMessage({ midi, sampleRate: this.ctx.sampleRate } satisfies PianoRequest);
    }
  }

  /**
   * Plays a note at `time` with velocity 0..1 into `dest`. The note rings out naturally, as with
   * the sustain pedal held: there is no note-off.
   */
  play(midi: number, time: number, velocity: number, dest: AudioNode): void {
    const buffer = this.cache.get(midi);
    if (!buffer) {
      // Still rendering (a note costs 10-50 ms, too much for a frame): skip it this time.
      this.prepare([midi]);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // Softer notes are darker, like a real hammer.
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900 + velocity * velocity * 5200;
    tone.Q.value = 0.3;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.15 + velocity * 0.85;
    src.connect(tone).connect(gain).connect(dest);
    src.start(time);
  }
}

/** Renders one note (mono samples at `sr`). Pure, so it runs in the worker. */
export function renderPianoNote(midi: number, sr: number): Float32Array {
  const f = midiHz(midi);
  // Low notes ring long, high ones short.
  const t1 = Math.min(7, Math.max(1.2, 3.2 * Math.pow(261.6 / f, 0.55)));
  const duration = Math.min(9, t1 * 1.6 + 0.4);
  const length = Math.floor(sr * duration);
  const out = new Float32Array(length);
  // Inharmonicity grows toward the treble.
  const B = 0.00008 * Math.pow(f / 110, 1.2);
  const partials = Math.max(3, Math.min(14, Math.floor(7000 / f)));
  for (let n = 1; n <= partials; n++) {
    const fn = f * n * Math.sqrt(1 + B * n * n);
    // Felt hammer near the string end: a soft spectrum, gently comb-shaped.
    const amp = (Math.abs(Math.sin(Math.PI * n * 0.13)) + 0.15) / Math.pow(n, 1.35);
    const tn = t1 / (1 + 0.55 * Math.pow(n - 1, 1.15));
    const strings = n <= 3 ? 2 : 1;
    for (let s = 0; s < strings; s++) {
      const detune = strings === 2 ? (s === 0 ? -1 : 1) * 0.0006 * n : 0; // slow beating between strings
      const w = 2 * Math.PI * fn * (1 + detune);
      const phase = Math.random() * Math.PI * 2;
      const a = amp / strings;
      // Two-stage decay: a quick early drop, then the long singing tail.
      const fast = 1 / Math.max(0.05, tn * 0.18);
      const slow = 1 / tn;
      // Recurrence for sin(w t + phase) avoids calling Math.sin per sample.
      const c = 2 * Math.cos(w / sr);
      let y1 = Math.sin(phase - w / sr);
      let y2 = Math.sin(phase - (2 * w) / sr);
      let eFast = 1;
      let eSlow = 1;
      const kFast = Math.exp(-fast / sr);
      const kSlow = Math.exp(-slow / sr);
      for (let i = 0; i < length; i++) {
        const y = c * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += a * y * (0.55 * eFast + 0.45 * eSlow);
        eFast *= kFast;
        eSlow *= kSlow;
        if (eSlow < 1e-4) break;
      }
    }
  }
  // Attack: a few ms ramp, plus a dull felt thump.
  const attack = Math.floor(sr * 0.004);
  for (let i = 0; i < attack; i++) out[i] *= i / attack;
  const thump = Math.floor(sr * 0.05);
  let lp = 0;
  for (let i = 0; i < thump; i++) {
    lp += ((Math.random() * 2 - 1) - lp) * 0.08;
    out[i] += lp * 0.25 * (1 - i / thump) ** 2;
  }
  // Fade the tail and normalize.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const tail = Math.floor(sr * 0.3);
  const g = 0.5 / Math.max(peak, 1e-6);
  for (let i = 0; i < length; i++) {
    const fade = i > length - tail ? (length - i) / tail : 1;
    out[i] *= g * fade;
  }
  return out;
}
