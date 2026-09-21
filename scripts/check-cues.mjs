// Build-time check of src/audio/cues.ts: renders every real note of every cue
// and compares its measured audible length against the buffer the cue's
// hardcoded rowLen/rows actually gives it. A truncated note (or a cue with no
// rowLen) fails the build; a buffer much longer than needed only warns.
// tests/unit/rowlen.test.mjs enforces the same truncation rule in the tests.
//
//   node scripts/check-cues.mjs        warnings and a summary line
//   node scripts/check-cues.mjs -v     also one line per note (peak, audible, buffer)
//
// "Audible" = where the rendered note permanently drops below 2% of its own
// peak. A noise instrument uses real Math.random(), so exact numbers wiggle
// slightly between runs; fine for a report, which is why nothing asserts on it
// here.
import { CPlayer } from '../src/audio/engines/soundbox/player-small.js';
import { createServer } from 'vite';

const SAMPLE_RATE = 44100;
const verbose = process.argv.includes('-v');
const sec = (samples) => `${(samples / SAMPLE_RATE).toFixed(2)} s`;

function measure(instrument, note) {
  const song = {
    songData: [{ i: instrument, p: [1], c: [{ n: [note, 0, 0, 0], f: [] }] }],
    rowLen: (instrument[10] ** 2 + instrument[11] ** 2 + instrument[12] ** 2) * 4 + 4000,
    patternLen: 1, endPattern: 0, numChannels: 1,
  };
  const player = new CPlayer();
  player.init(song);
  while (player.generate() < 1) { /* one pass per channel */ }
  const data = player.createAudioBuffer({ createBuffer: (_c, n) => { const a = new Float32Array(n); return { getChannelData: () => a }; } }).getChannelData(0);
  let peak = 0;
  for (const s of data) peak = Math.max(peak, Math.abs(s));
  let audible = data.length;
  while (audible > 0 && Math.abs(data[audible - 1]) <= peak * 0.02) audible--;
  return { peak, audible };
}

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const { CUES, toSong } = await server.ssrLoadModule('/src/audio/cues.ts');
await server.close();

let truncated = 0, shrinkable = 0;
for (const [id, cue] of Object.entries(CUES)) {
  if (cue.raw) continue;
  if (!cue.rowLen) { truncated++; console.error(`ERROR sound ${id} has no rowLen in cues.ts`); continue; }
  const { rowLen, patternLen } = toSong(cue);
  const total = patternLen * rowLen;
  let soundEnd = 0, minRowLen = 1;
  for (const [t, track] of cue.tracks.entries()) {
    track.seq.forEach((note, row) => {
      if (!note) return;
      const { peak, audible } = measure(track.inst, note);
      const buffer = (patternLen - row) * rowLen;
      const where = `${id} (track ${t}, row ${row}, note ${note})`;
      soundEnd = Math.max(soundEnd, row * rowLen + audible);
      minRowLen = Math.max(minRowLen, Math.ceil(audible / (patternLen - row)));
      if (verbose) console.log(`${where}: peak ${peak.toFixed(3)}, audible ${audible} samples (${sec(audible)}), buffer ${buffer} samples (${sec(buffer)})`);
      if (buffer < audible) {
        truncated++;
        console.warn(`WARNING sound ${where} is ${sec(audible)} long (${audible} samples) but is truncated to ${sec(buffer)} (${buffer} samples): raise its rowLen, or pad its seq with trailing 0 rests, in cues.ts`);
      }
    });
  }
  // Whole-cue slack, not per note: a multi-note cue's early notes always have
  // later rows to spare. rowLen is also the tempo, so this is only a hint.
  if (total > soundEnd * 2) {
    shrinkable++;
    console.warn(`note: sound ${id} is ${sec(soundEnd)} long (${soundEnd} samples) in a ${sec(total)} buffer (${total} samples): rowLen could shrink to ${minRowLen} (synthesis time only, no shipped bytes)`);
  }
}
console.warn(`check-cues: ${truncated} truncated, ${shrinkable} shrinkable`);
if (truncated) process.exitCode = 1;
