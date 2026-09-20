// What a "cue" is and how it becomes a playable SoundBox song. Deliberately
// dependency-free (no three, no AudioContext, no browser API): AudioManager.ts
// owns the browser-facing playback (AudioListener/PositionalAudio/AudioContext),
// this module owns the data, so it's directly unit-testable in plain Node
// (tests/unit/cues.test.mjs) without pulling in any of that.
import { redline } from './redline';

const NOISE_HIT  = redline.songData[6].i;
const NOISE_TICK = redline.songData[5].i;
const LEAD       = redline.songData[0].i;
const BASS       = redline.songData[1].i;

export type Track = { inst: number[]; seq: number[] }; // seq: one note per row from row 0 (0 = rest)
export type Cue = { tracks: Track[]; rows?: number; rowLen?: number; loop?: boolean; raw?: object };

const SFX_ROWLEN = 2205; // ~50 ms/row — snappy

// Placeholder melodies for the short cues — a few SoundBox note ints each,
// on redline's own instruments. `music` skips the placeholder shape
// entirely and plays redline verbatim (`raw`).
// This is a dictionary looked up by a dynamic string (CUES[id]), the same
// shape as Game.ts's `screens` and the same real bug: PACK_EXTERNS=three
// renamed spawn/hit/unicorn/tick/music (all of them, in the build actually
// inspected) while the string literals passed to playSFX/playAt/playBGM
// elsewhere stayed as-is, so every cue lookup silently missed, no sound, no
// error. See scripts/gen-record-keys.mjs for the fix (these keys
// protected explicitly) and why quoting them here instead does not work in
// this pipeline (Rolldown un-quotes them again before Closure runs, see
// .doc/DECISIONS.md D18).
export const CUES: Record<string, Cue> = {
  spawn:   { tracks: [{ inst: NOISE_HIT,  seq: [135] }] },
  hit:     { tracks: [{ inst: NOISE_HIT,  seq: [147, 0, 159] }], rowLen: 1500 },
  unicorn: { tracks: [{ inst: LEAD,       seq: [130, 0, 123] }], rowLen: 3200 },
  win:     { tracks: [{ inst: LEAD,       seq: [147, 151, 154, 159] }], rowLen: 3600 },
  over:    { tracks: [{ inst: BASS,       seq: [123, 0, 116, 0, 109] }], rowLen: 4200 },
  tick:    { tracks: [{ inst: NOISE_TICK, seq: [159] }], rowLen: 1400 },
  music:   { tracks: [], loop: true, raw: redline },
};

export function toSong(cue: Cue): object {
  if (cue.raw) return cue.raw;
  const rows = cue.rows ?? Math.max(...cue.tracks.map((t) => t.seq.length)) + 4; // tail rows so releases ring out
  return {
    songData: cue.tracks.map((t) => {
      const n = new Array(rows * 4).fill(0); // SoundBox pattern: 4 sub-columns of `rows`
      t.seq.forEach((note, r) => { if (note) n[r] = note; });
      return { i: t.inst, p: [1], c: [{ n, f: [] }] };
    }),
    rowLen: cue.rowLen ?? SFX_ROWLEN,
    patternLen: rows,
    endPattern: 0,
    numChannels: cue.tracks.length,
  };
}
