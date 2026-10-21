// Music: a slow, melancholic felt piano in A minor, composed live so it never loops the same way.
//
//  - Harmony: a few progressions built on i–VI–III–VII and iv–i–VI–V shapes, one chord per bar,
//    chosen with gentle randomness so the piece wanders without ever resolving too neatly.
//  - Left hand: broken-chord arpeggios in the low-middle register, a different figure per bar.
//  - Right hand: sparse phrases that start on a chord tone and mostly step downward, ending on a
//    long note; many bars are left empty, because the silences carry the mood.
//  - Rubato and humanized velocities; slower, softer and lower at night.
// Everything goes through a soft "felt" low-pass and a generous reverb.
import type { AudioBus } from './audio';
import type { Piano } from './piano';
import { tuning } from './tuning';

interface Chord {
  /** Bass root (MIDI). */
  root: number;
  /** Chord tones for the arpeggio, low to high (MIDI), above the root. */
  tones: number[];
}

// A natural minor: A B C D E F G.
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const A = 45; // A2

const c = (root: number, ...tones: number[]): Chord => ({ root, tones });
const CHORDS = {
  Am9: c(A, 52, 57, 59, 60), // A | E A B C
  Am: c(A, 52, 57, 60, 64),
  Fmaj7: c(41, 48, 52, 55, 57), // F | C E G A
  Cmaj7: c(48, 52, 55, 59, 64), // C | E G B E
  G6: c(43, 50, 52, 55, 59), // G | D E G B
  Dm9: c(38, 45, 52, 53, 57), // D | A E F A
  Em7: c(40, 47, 50, 55, 59), // E | B D G B
  Esus: c(40, 47, 52, 57, 59), // E | B E A B
  E7: c(40, 47, 50, 56, 59), // E | B D G# B
  Dm7: c(38, 45, 50, 53, 57),
} as const;

const PROGRESSIONS: Chord[][] = [
  [CHORDS.Am9, CHORDS.Fmaj7, CHORDS.Cmaj7, CHORDS.G6],
  [CHORDS.Dm9, CHORDS.Am, CHORDS.Fmaj7, CHORDS.Esus],
  [CHORDS.Fmaj7, CHORDS.Em7, CHORDS.Dm7, CHORDS.Am9],
  [CHORDS.Am, CHORDS.Dm9, CHORDS.E7, CHORDS.Am9],
];

/** Arpeggio figures: (beat, index into [root, ...tones]) pairs within a 4-beat bar. */
const FIGURES: [number, number][][] = [
  [[0, 0], [0.5, 1], [1, 2], [1.5, 3], [2, 4], [3, 2]],
  [[0, 0], [1, 2], [1.5, 3], [2.5, 4], [3, 3]],
  [[0, 0], [0.5, 1], [1.5, 2], [2, 1], [2.5, 3]],
  [[0, 0], [2, 1], [2.5, 2], [3, 3]],
  [[0, 0], [0.75, 2], [1.5, 4], [2.25, 3], [3, 2]],
];

/** Melody rhythms, in beats (note lengths), filling up to two bars. */
const RHYTHMS = [
  [2, 1, 1, 4],
  [1.5, 0.5, 2, 4],
  [3, 1, 4],
  [1, 1, 2, 2, 2],
  [2, 2, 4],
  [1, 0.5, 0.5, 2, 4],
];

const rand = () => Math.random(); // music is not world content: no seed needed
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

export class Music {
  private readonly out: GainNode;
  private readonly felt: BiquadFilterNode;
  private progression = PROGRESSIONS[0];
  private bar = 0;
  /** Context time when the next bar starts. */
  private nextBar = 0;
  /** Melody notes still to place in the next bar (a phrase spans two bars). */
  private phraseCarry: { beat: number; midi: number; len: number; vel: number }[] = [];
  private lastMelody = 76; // E5
  private night = 0;

  constructor(
    private readonly bus: AudioBus,
    private readonly piano: Piano,
  ) {
    const { ctx } = bus;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.felt = ctx.createBiquadFilter();
    this.felt.type = 'lowpass';
    this.felt.frequency.value = 3400;
    this.felt.Q.value = 0.4;
    this.felt.connect(this.out);
    this.out.connect(bus.out);
    // A wetter send than the effects: the piano should sound like a big, quiet room.
    const send = ctx.createGain();
    send.gain.value = 0.75;
    this.out.connect(send).connect(bus.reverb);

    // Render every pitch the piece can use ahead of time.
    const pitches = new Set<number>();
    for (const ch of Object.values(CHORDS)) {
      pitches.add(ch.root);
      ch.tones.forEach((t) => pitches.add(t));
    }
    for (let m = 64; m <= 86; m++) if (SCALE.includes((m - A + 120) % 12)) pitches.add(m);
    pitches.add(68); // G#
    this.piano.prepare(pitches);
    this.nextBar = ctx.currentTime + 2.5; // let the pitches warm up first
  }

  update(_dt: number, night: number): void {
    const now = this.bus.ctx.currentTime;
    this.night += (night - this.night) * 0.01;
    this.out.gain.setTargetAtTime(tuning.audio.musicVolume * 0.7, now, 2);
    this.felt.frequency.setTargetAtTime(3400 - this.night * 1500, now, 2);
    // Schedule a bar a little before it starts.
    if (now > this.nextBar - 0.4) {
      if (this.nextBar < now) this.nextBar = now + 0.1; // after a pause or tab switch
      this.scheduleBar(this.nextBar);
    }
  }

  private get beat(): number {
    // ~62 bpm by day, slower at night.
    return 60 / (62 - this.night * 8);
  }

  private scheduleBar(t0: number): void {
    const beat = this.beat;
    if (this.bar % 4 === 0) {
      // A new progression every four bars; repeat the current one now and then.
      this.progression = rand() < 0.35 ? this.progression : pick(PROGRESSIONS);
    }
    const chord = this.progression[this.bar % 4];
    const soft = 1 - this.night * 0.35;
    const dest = this.felt;

    // Left hand.
    const notes = [chord.root, ...chord.tones];
    const figure = pick(FIGURES);
    for (const [b, i] of figure) {
      const jitter = (rand() - 0.5) * 0.04;
      const vel = (b === 0 ? 0.42 : 0.26 + rand() * 0.1) * soft;
      this.piano.play(notes[Math.min(i, notes.length - 1)], t0 + b * beat + jitter, vel, dest);
    }
    // Sometimes a low octave under the root for weight.
    if (rand() < 0.3) this.piano.play(chord.root - 12, t0 + 0.02, 0.3 * soft, dest);

    // Right hand: continue a phrase, or start one (or rest).
    let melody = this.phraseCarry;
    this.phraseCarry = [];
    if (melody.length === 0 && this.bar % 2 === 0 && rand() < 0.62 - this.night * 0.25) {
      melody = this.composePhrase(chord, rand() < 0.5 ? 0 : 1);
    }
    for (const n of melody) {
      if (n.beat >= 4) {
        this.phraseCarry.push({ ...n, beat: n.beat - 4 });
        continue;
      }
      const jitter = (rand() - 0.3) * 0.06; // melody lags a hair behind the bass, like a pianist
      this.piano.play(n.midi, t0 + n.beat * beat + jitter, n.vel * soft, dest);
    }

    this.bar++;
    this.nextBar = t0 + 4 * beat * (1 + (rand() - 0.5) * 0.04); // a breath of rubato per bar
  }

  /** A two-bar phrase: starts on a chord tone, moves mostly by step and mostly down. */
  private composePhrase(chord: Chord, startBeat: number): { beat: number; midi: number; len: number; vel: number }[] {
    const rhythm = pick(RHYTHMS);
    const out: { beat: number; midi: number; len: number; vel: number }[] = [];
    // Chord tones raised into the melody register (E4..A5).
    const chordPcs = [chord.root, ...chord.tones].map((m) => m % 12);
    let midi = this.nearestOf(this.lastMelody + (rand() < 0.5 ? 2 : -1), (m) => chordPcs.includes(m % 12));
    let beat = startBeat;
    rhythm.forEach((len, i) => {
      if (beat >= 8) return;
      const last = i === rhythm.length - 1;
      const vel = 0.36 + rand() * 0.12 - i * 0.02;
      out.push({ beat, midi, len, vel: last ? vel * 0.85 : vel });
      // Next pitch: a step in the scale, down more often than up; sometimes a leap of a third.
      const step = rand() < 0.68 ? -1 : 1;
      const size = rand() < 0.2 ? 2 : 1;
      midi = this.scaleStep(midi, step * size);
      if (i === rhythm.length - 2) midi = this.nearestOf(midi, (m) => chordPcs.includes(m % 12)); // land on a chord tone
      midi = Math.max(62, Math.min(84, midi));
      beat += len;
    });
    this.lastMelody = out[out.length - 1]?.midi ?? this.lastMelody;
    // Occasionally a soft echo of the last note an octave up, far away.
    if (rand() < 0.25) {
      const lastNote = out[out.length - 1];
      out.push({ beat: lastNote.beat + 1.5, midi: lastNote.midi + 12, len: 2, vel: 0.16 });
    }
    return out;
  }

  private scaleStep(midi: number, steps: number): number {
    let m = midi;
    const dir = Math.sign(steps);
    for (let k = 0; k < Math.abs(steps); k++) {
      do m += dir;
      while (!SCALE.includes((m - A + 120) % 12));
    }
    return m;
  }

  private nearestOf(midi: number, ok: (m: number) => boolean): number {
    for (let d = 0; d < 12; d++) {
      if (ok(midi - d) && midi - d >= 62) return midi - d;
      if (ok(midi + d) && midi + d <= 84) return midi + d;
    }
    return midi;
  }
}
