// Plain Node unit test: node's own built-in test runner, no browser. This
// file is deliberately also documentation — a worked example of adding or
// adjusting an SFX cue in src/audio/cues.ts, kept executable so it can't
// silently go stale the way a comment or a wiki page could.
//
//   node --experimental-strip-types --test tests/unit/cue-authoring.test.mjs
//
// The workflow, in order:
//
// 1. Pick (or make) an instrument. CUES entries reuse redline's own
//    instruments (its songData[N].i arrays — see cues.ts's NOISE_HIT/
//    NOISE_TICK/LEAD/BASS consts) rather than defining new ones: their
//    bytes already ship as part of the music bed, so a cue built from one
//    costs nothing extra beyond its own note data. A cue CAN use a
//    modified copy instead (see cues.ts's SLIDE and LEAD_LOUD — e.g.
//    `const MINE = [...LEAD]; MINE[24] = 51;`, indexing into the
//    instrument byte array; see player-small.js's createNote for what
//    each index does) when the existing instrument's character genuinely
//    doesn't fit, at the cost of a few more shipped bytes for the copy.
//
// 2. Pick note(s). A Track is `{ inst: <instrument array>, seq: <note
//    ints, 0 = rest> }`. Note numbers aren't a familiar MIDI-style scale —
//    they're a SoundBox tracker value fed straight into getnotefreq
//    (player-small.js): roughly, 128 is the instrument's own reference
//    pitch, higher numbers are higher pitched. There's no shortcut for
//    "what does note N actually sound like" other than measuring it —
//    step 3.
//
// 3. Measure it, don't guess. `renderCue(id)` (tests/lib/render-cue.mjs)
//    renders a cue exactly as AudioManager.#bufferFor does and reports
//    peak (0-1) and duration; `audibleDuration(inst, note)` (tests/lib/
//    instrument-envelope.mjs) measures one note in isolation. Two real
//    bugs this session were found exactly this way, not by ear: spawn/
//    hit/unicorn's old placeholder notes were much quieter than they
//    looked on paper, and their rowLens were truncating or wildly
//    over-provisioning the real audible tail (.doc/DECISIONS.md D23/D24).
//    `node scripts/check-cues.mjs -v` runs this same measurement over every
//    real cue at once.
//
// 4. Add it to CUES with a hardcoded `rowLen` (samples per row). Start from
//    one full envelope slot, (i[10]^2+i[11]^2+i[12]^2)*4 of the instrument, or
//    a small hand-picked pacing plus trailing 0 rests on `seq` so the last
//    release still fits, like cues.ts's win/over.
//    `node scripts/check-cues.mjs -v` (also run by prebuild, and it fails on
//    a truncated note) reports each note's audible length against its buffer.
//
// 5. Nothing else to wire up. tests/unit/cues.test.mjs (does every cue
//    render non-silent) and tests/unit/rowlen.test.mjs (does every cue's
//    real rendered audio fit its buffer) both iterate CUES directly, so a
//    new entry is covered the moment it's added — the test below
//    demonstrates the non-silence half of that on a candidate cue that
//    was never added to CUES, proving it's structural, not something to
//    remember.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueDefinitions } from '../lib/render-cue.mjs';
import { audibleDuration } from '../lib/instrument-envelope.mjs';
import { CPlayer } from '../../src/audio/engines/soundbox/player-small.js';

const { CUES } = await cueDefinitions();

function fakeContext() {
  return {
    createBuffer: (channels, length) => {
      const chans = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i) => chans[i] };
    },
  };
}

// A candidate track, structured exactly like a real CUES entry — reusing
// hit's own BASS layer as the "instrument I'm considering" stand-in, so
// this test needs no instrument of its own to make its point.
const candidateTrack = { inst: CUES.hit.tracks[1].inst, seq: [116] };

test('step 3: measure a candidate note before adding it, not after', () => {
  const audible = audibleDuration(candidateTrack.inst, candidateTrack.seq[0]);
  assert.ok(audible > 0, 'a real candidate note should render some audible signal, not silence');
  console.log(`candidate note ${candidateTrack.seq[0]} stays audible for ${(audible / 44100).toFixed(3)}s`);
});

test('step 5: a candidate cue is non-silent, the same check every real CUES entry gets', () => {
  const rowLen = audibleDuration(candidateTrack.inst, candidateTrack.seq[0]);
  const song = {
    songData: [{ i: candidateTrack.inst, p: [1], c: [{ n: [candidateTrack.seq[0], 0, 0, 0], f: [] }] }],
    rowLen, patternLen: 1, endPattern: 0, numChannels: 1,
  };
  const player = new CPlayer();
  player.init(song);
  while (player.generate() < 1) { /* one pass per channel */ }
  const data = player.createAudioBuffer(fakeContext()).getChannelData(0);

  let peak = 0;
  for (const s of data) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.02, 'a real candidate cue renders non-silent, exactly what tests/unit/cues.test.mjs checks for everything already in CUES');
});

