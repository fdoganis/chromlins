// Test-only: the independent, render-based check on top of cues.ts's own
// deriveRowLen (which uses a pure, fast, deterministic formula —
// mathEnvelopeDuration — precisely so production code never needs to
// synthesize audio just to size a buffer). This file exists to verify that
// formula is actually safe, by rendering the real note and measuring where
// it truly falls silent, not assuming the formula's own reasoning is
// bug-free. See cues.ts's mathEnvelopeDuration comment for why the formula
// is expected to be a safe upper bound, and what it does NOT model (filter
// resonance ringing past the envelope's own defined length).
//
// This measurement is NOT perfectly reproducible for a noise instrument
// (noiseVol, i[9], nonzero uses real Math.random() per sample) — two
// independent renders of the same (instrument, note) can disagree by a
// handful of samples right at the threshold. That's fine here: this is a
// one-sided regression check (does the formula's buffer contain this
// measurement, with headroom to spare in every real cue), not a value
// production code depends on being exactly reproducible.
import { CPlayer } from '../../src/audio/engines/soundbox/player-small.js';

export function audibleDuration(instrument, note, floorRatio = 0.02) {
  const mathTotal = (instrument[10] ** 2 + instrument[11] ** 2 + instrument[12] ** 2) * 4;
  const rowLen = mathTotal + 4000; // generous margin: nothing here should truncate
  const song = {
    songData: [{ i: instrument, p: [1], c: [{ n: [note, 0, 0, 0], f: [] }] }],
    rowLen, patternLen: 1, endPattern: 0, numChannels: 1,
  };
  const player = new CPlayer();
  player.init(song);
  while (player.generate() < 1) { /* one pass per channel */ }
  const data = player.createAudioBuffer({
    createBuffer: (channels, length) => {
      const chans = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i) => chans[i] };
    },
  }).getChannelData(0);

  let peak = 0;
  for (let j = 0; j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
  const floor = peak * floorRatio;
  for (let j = data.length - 1; j >= 0; j--) {
    if (Math.abs(data[j]) > floor) return j + 1;
  }
  return 0;
}
