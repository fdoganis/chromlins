// What a "cue" is and how it becomes a playable SoundBox song. Deliberately
// dependency-free (no three, no AudioContext, no browser API, no CPlayer):
// AudioManager.ts owns the browser-facing playback (AudioListener/
// PositionalAudio/AudioContext), this module owns the data, so it's
// directly unit-testable in plain Node (tests/unit/cues.test.mjs) without
// pulling in any of that.
import { redline } from './redline';

const NOISE_HIT  = redline.songData[6].i;
const NOISE_TICK = redline.songData[5].i;
const LEAD       = redline.songData[0].i;
const BASS       = redline.songData[1].i;

// A copy of NOISE_TICK with a much longer attack (i[10]): SoundBox's
// amplitude envelope during attack is a literal 0->1 ramp (see createNote in
// player-small.js — `e = j / attack`, multiplied straight into the sample),
// so lengthening it turns the same noise+tone texture into a rising swell
// instead of an instant hit — a "reverse cymbal" is exactly this shape:
// noise ramping up in volume into a peak, not a pitch effect at all.
const SLIDE = [...NOISE_TICK];
SLIDE[10] = 41; // attack = 41^2*4 = 6724 samples (~152ms) to swell up, everything else (tone, filter, release) unchanged from NOISE_TICK

// A copy of LEAD, loudness-matched to hit's peak (0.445): unicorn was
// reported audibly quieter than the other SFX cues even with the same
// AudioManager.SFX_BOOST applied, because LEAD's own peak is genuinely
// lower at the source — this raises that, not the playback-time boost.
// Two levers, not one: oscillator volume (i[1]/i[5]) pushed to the 0-255
// max first, then post-filter drive (i[24], `rsample *= drive` in
// createNote — LEAD's own is 32, unity) raised further on top, since
// volume alone tops out below hit's level. Measured directly at each step
// (note 140, this instrument's loudest — see below): vol 192->255 alone
// gives 0.279; drive 32->51 on top of that reaches 0.445, matching hit,
// with peak still comfortably under 1.0 (no clipping) at every note in the
// actual sequence. Volume alone wasn't the whole loudness story either:
// LEAD's peak at a given volume varies by note (a fixed filter cutoff
// interacting differently with different played pitches, not a bug, just
// how a resonant filter behaves) — note 140 measured ~50% louder than
// unicorn's original 135, which is why its sequence (below) starts at 140,
// not 135; still a real descending run, just starting from a stronger note.
const LEAD_LOUD = [...LEAD];
LEAD_LOUD[1] = 255;
LEAD_LOUD[5] = 254;
LEAD_LOUD[24] = 51;

export type Track = { inst: number[]; seq: number[] }; // seq: one note per row from row 0 (0 = rest); trailing 0s pad the buffer so a release can ring out
export type Cue = {
  tracks: Track[];
  rowLen?: number; // samples per row (required unless `raw`), see the big comment below
  loop?: boolean;
  raw?: object;
};

// rowLen only controls note SPACING and total buffer length (rowLen *
// patternLen samples), it never changes how long a note itself rings: that is
// fixed by the INSTRUMENT's own attack/sustain/release. Too small cuts a note
// off mid-decay (an audible click), too large only wastes buffer. It is a plain
// hardcoded number per cue, and nothing checks it at runtime: `node
// scripts/check-cues.mjs` (run by prebuild, `-v` for per-note numbers) renders
// every note and fails on a truncated one, and tests/unit/rowlen.test.mjs does
// the same in the test suite. Changed a cue's notes or instrument? Run the
// script and paste the number it suggests.
//
// Most cues use "one full envelope slot per row" (attack+sustain+release
// samples of the longest instrument, `(i[10]^2+i[11]^2+i[12]^2)*4`), so every
// note rings out completely in its own row and the cue is exactly as many rows
// as `seq` has entries. win/over instead keep a deliberately small,
// already-tuned pacing (3600/4200) and pad 4 trailing 0 rests onto `seq` so
// the last release still fits; the full-slot value made them ~2x and ~5x
// slower when tried, a real reported regression.

// Placeholder cues: a few SoundBox note ints each, on redline's own
// instruments (or a minimally modified copy, see SLIDE/LEAD_LOUD above).
// `music` skips the placeholder shape entirely and plays redline verbatim
// (`raw`). This is a dictionary looked up by a dynamic string (CUES[id]),
// the same shape as Game.ts's `screens` and the same real bug: PACK_EXTERNS=
// three renamed spawn/hit/unicorn/tick/music while the string literals passed
// to playSFX/playAt/playBGM elsewhere stayed as-is, so every cue lookup
// silently missed. See scripts/gen-record-keys.mjs for the fix (these keys
// protected explicitly) and why quoting them here instead does not work in
// this pipeline (Rolldown un-quotes them again before Closure runs, see
// .doc/DECISIONS.md D18).
//
// spawn: SLIDE (NOISE_TICK's own tone/noise/filter, long attack) for a
// rising, "reverse cymbal" swell, one note, one continuous gesture. hit: two
// simultaneous tracks (NOISE_HIT for the transient click, BASS for a low
// thump underneath). miss: NOISE_TICK (noise plus an audible tonal component)
// for a lighter whiff than hit. unicorn: LEAD_LOUD (see above), a slower
// 4-note fall where each note gets its own full slot, which is what makes it
// an actual descending run instead of a blur.
export const CUES: Record<string, Cue> = {
  spawn:   { tracks: [{ inst: SLIDE,     seq: [140] }], rowLen: 26340 },
  hit:     { tracks: [{ inst: NOISE_HIT, seq: [140] }, { inst: BASS, seq: [116] }], rowLen: 21312 },
  unicorn: { tracks: [{ inst: LEAD_LOUD, seq: [140, 133, 127, 120] }], rowLen: 6704 },
  win:     { tracks: [{ inst: LEAD,      seq: [147, 151, 154, 159, 0, 0, 0, 0] }], rowLen: 3600 },
  over:    { tracks: [{ inst: BASS,      seq: [123, 0, 116, 0, 109, 0, 0, 0, 0] }], rowLen: 4200 },
  tick:    { tracks: [{ inst: NOISE_TICK, seq: [159] }], rowLen: 19716 },
  miss:    { tracks: [{ inst: NOISE_TICK, seq: [166] }], rowLen: 19716 },
  music:   { tracks: [], loop: true, raw: redline },
};

export function toSong(cue: Cue): object {
  if (cue.raw) return cue.raw;
  const rows = Math.max(...cue.tracks.map((t) => t.seq.length));
  return {
    songData: cue.tracks.map((t) => {
      const n = new Array(rows * 4).fill(0); // SoundBox pattern: 4 sub-columns of `rows`
      t.seq.forEach((note, r) => { if (note) n[r] = note; });
      return { i: t.inst, p: [1], c: [{ n, f: [] }] };
    }),
    rowLen: cue.rowLen,
    patternLen: rows,
    endPattern: 0,
    numChannels: cue.tracks.length,
  };
}
