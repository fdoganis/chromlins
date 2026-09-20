// Plain Node unit test: node's own built-in test runner (`node:test`), no
// @playwright/test, no browser.
//
// Renders every CUES entry through the real CPlayer (the exact code path
// AudioManager.#bufferFor uses) and asserts real, audible signal came out —
// this is the test the "hit/spawn/unicorn don't seem to make any sound"
// report asked for: does the CUE DATA itself ever render silent. It does
// not (every cue here renders well above the floor), which points the
// investigation at the playback path instead — see tests/packed.spec.ts's
// "spawn/hit actually get heard live" check, and .doc/DECISIONS.md D19.
//
//   node --experimental-strip-types --test tests/unit/cues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCue, cueIds } from '../lib/render-cue.mjs';

// Real redline playback peaks near 1.0; the placeholder SFX cues peak
// 0.1-0.5 in practice (see .doc/DECISIONS.md D19's measured numbers). 0.02 is
// comfortably below every real cue and comfortably above float rounding
// noise, so it only fails on an actually-silent (or near-silent) render.
const SILENCE_FLOOR = 0.02;

// Every real CUES key, read from the source itself rather than copied here,
// so a future cue is covered automatically.
for (const id of await cueIds()) {
  test(`cue "${id}" renders audible (non-silent) samples`, async () => {
    const { peak, duration } = await renderCue(id);
    assert.ok(duration > 0, `cue "${id}" rendered zero duration`);
    assert.ok(peak > SILENCE_FLOOR, `cue "${id}" peaked at ${peak.toFixed(5)}, at or below the ${SILENCE_FLOOR} silence floor`);
  });
}
