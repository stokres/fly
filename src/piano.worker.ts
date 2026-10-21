// Web Worker: renders piano notes off the main thread (each costs tens of milliseconds).
import { type PianoNote, type PianoRequest, renderPianoNote } from './piano';

self.onmessage = (e: MessageEvent<PianoRequest>) => {
  const { midi, sampleRate } = e.data;
  const samples = renderPianoNote(midi, sampleRate) as Float32Array<ArrayBuffer>;
  (self as unknown as Worker).postMessage({ midi, samples } satisfies PianoNote, [samples.buffer]);
};
