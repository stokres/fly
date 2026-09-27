// Ambient pad: four slow voices gliding between open chords in D, each breathing on its own
// slow cycle, through a gently moving low-pass and into the reverb. No melody, no beat: it
// should sit under the wind and never demand attention. Darker (lower filter) at night.
import type { AudioBus } from './audio';
import { tuning } from './tuning';

/** Chord voicings as MIDI notes, one per voice. Open, suspended shapes: no tension to resolve. */
const CHORDS = [
  [50, 57, 64, 66], // Dmaj9 (no 3rd in the bass): D A E F#
  [47, 54, 62, 64], // Bm11: B F# D E
  [43, 50, 59, 66], // Gmaj7: G D B F#
  [45, 52, 59, 62], // A6sus: A E B D
];

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
  /** Breathing: each voice swells on its own slow period. */
  period: number;
  phase: number;
}

export class Music {
  private readonly bus: AudioBus;
  private readonly filter: BiquadFilterNode;
  private readonly out: GainNode;
  private readonly voices: Voice[] = [];
  private chord = 0;
  private chordTime = 0;
  private time = 0;

  constructor(bus: AudioBus) {
    this.bus = bus;
    const { ctx } = bus;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.5;
    this.filter.connect(this.out);
    this.out.connect(bus.out);
    this.out.connect(bus.reverb);

    CHORDS[0].forEach((note, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.filter);
      // A soft triangle plus a slightly detuned sine an octave up for shimmer.
      const oscs = [
        this.osc('triangle', midiHz(note), 0),
        this.osc('sine', midiHz(note) * 2, 6),
      ];
      oscs.forEach((o) => o.connect(gain));
      this.voices.push({ oscs, gain, period: 11 + i * 3.7, phase: i * 1.9 });
    });
  }

  update(dt: number, night: number): void {
    const a = tuning.audio;
    const now = this.bus.ctx.currentTime;
    this.time += dt;
    this.chordTime += dt;

    if (this.chordTime > a.chordSeconds) {
      this.chordTime = 0;
      this.chord = (this.chord + 1) % CHORDS.length;
      // Glide each voice to its note in the next chord, slowly, so changes are felt more than heard.
      CHORDS[this.chord].forEach((note, i) => {
        const [low, high] = this.voices[i].oscs;
        low.frequency.setTargetAtTime(midiHz(note), now, 2.5);
        high.frequency.setTargetAtTime(midiHz(note) * 2, now, 2.5);
      });
    }

    this.out.gain.setTargetAtTime(a.musicVolume * 0.18, now, 1.5);
    const sway = 0.5 + 0.5 * Math.sin(this.time * 0.05);
    this.filter.frequency.setTargetAtTime((700 + 900 * sway) * (1 - 0.45 * night), now, 1);
    for (const v of this.voices) {
      const breathe = 0.55 + 0.45 * Math.sin((this.time / v.period) * Math.PI * 2 + v.phase);
      v.gain.gain.setTargetAtTime(breathe, now, 0.5);
    }
  }

  private osc(type: OscillatorType, hz: number, cents: number): OscillatorNode {
    const o = this.bus.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.detune.value = cents;
    o.start();
    return o;
  }
}
