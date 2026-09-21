// Plain Node unit test: node's own built-in test runner, no browser.
//
// Fails when a cue's hardcoded rowLen/rows in cues.ts is too short for a
// note's REAL, rendered audible tail (tests/lib/instrument-envelope.mjs's
// audibleDuration), i.e. the note would be cut off with an audible click.
// Change a cue's notes or instrument and forget its rowLen, and this catches
// it. `node scripts/check-cues.mjs -v` prints the same measurements, and
// suggests numbers, for tuning.
//
// Reads song.rowLen and patternLen straight from toSong()'s real output, so it
// checks exactly what production ships.
//
//   node --experimental-strip-types --test tests/unit/rowlen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueDefinitions } from '../lib/render-cue.mjs';
import { audibleDuration } from '../lib/instrument-envelope.mjs';

const { CUES, toSong } = await cueDefinitions();

for (const [id, cue] of Object.entries(CUES)) {
  if (cue.raw) continue; // a verbatim song (music/redline), not a note sequence this check applies to

  const song = toSong(cue);
  const rows = song.patternLen;
  const rowLen = song.rowLen;

  for (const [trackIndex, track] of cue.tracks.entries()) {
    track.seq.forEach((note, row) => {
      if (!note) return; // a rest, nothing to check

      test(`cue "${id}" track ${trackIndex} row ${row} (note ${note}) does not truncate its real, rendered audible tail`, () => {
        const needed = audibleDuration(track.inst, note);
        const available = (rows - row) * rowLen;
        assert.ok(
          available >= needed,
          `cue "${id}"'s note ${note} at row ${row} needs ${needed} measured samples to ring out audibly ` +
          `but only ${available} are available (rowLen=${rowLen}, rows=${rows}); ` +
          `raise the cue's rowLen or rows in cues.ts`,
        );
      });
    });
  }
}
