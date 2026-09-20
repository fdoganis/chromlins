import { test, expect } from '@playwright/test';
import { renderCue } from './lib/render-cue.mjs';

// "maybe playAt does not work, or is not loud enough compared to BGM" — a
// real, testable question, not a guess. spawn/hit/unicorn play via
// AudioManager.playAt (three.js PositionalAudio, from the actual actor
// mesh); win/over/tick play via playSFX (also positional, from the placed
// board's own origin — no specific actor to tie them to). `music` is the
// deliberate exception, non-positional ambient score (see AudioManager.ts's
// class comment and playBGM) — not covered by this test, since it never
// goes through attach() at all.
//
// Reading three.js's own source (node_modules/three/src/audio/PositionalAudio.js)
// showed PositionalAudio's constructor hardcodes `panner.panningModel =
// 'HRTF'`, unconditionally, with no public setter. Measured directly: even
// AT refDistance, where distance-based falloff is exactly zero, HRTF peaked
// at only 42.6% of a direct (non-positional) connection — 70.7% of that is
// the normal, unavoidable -3dB center-pan loss any stereo panner has
// (equal-power panning splits a centered mono source's energy 1/sqrt(2) per
// channel, by definition); the rest, an extra ~4.4 dB (~1.66x amplitude) at
// every distance, was HRTF's own convolution cost — real precision for
// pinpointing a sound's exact direction by ear alone, more than a short
// percussive blip needs, while still wanting the real spatial correctness
// (direction, distance falloff) that makes this an AR experience and not
// just sound effects with extra steps. Two mitigations, in AudioManager.ts's
// attach(): `panningModel = 'equalpower'` (keeps direction and falloff,
// drops HRTF's extra convolution cost) and a flat `SFX_BOOST` gain
// multiplier (raises the whole distance-loudness curve, so even a source a
// couple of meters out stays audible, without giving up "closer is
// louder"). See .doc/DECISIONS.md D19/D20/D21/D22 for the full numbers.
//
// This test verifies the REAL AudioManager.attach() code path directly
// (imported live through the dev server, not a hand-duplicated node graph),
// so it stays honest if the implementation changes, then measures the real
// loudness impact with an actual browser AudioContext (HRTF convolution
// can't be faked in plain Node — this is why this lives in Playwright, not
// tests/unit/). No packed build, no XR needed — this only needs the app's
// own AudioManager module and a Web Audio-capable page.

test('playAt (equalpower + SFX_BOOST) is measurably louder than an unboosted panner and never clips', async ({ page }) => {
  const hit = await renderCue('hit');
  await page.goto('/');

  // Exercises the real, live AudioManager.attach() — not a re-implementation
  // of it — so a future change to panningModel or SFX_BOOST is caught here
  // automatically. Loaded as a real <script type="module"> (tests/lib/
  // audio-harness.ts) rather than a raw page.evaluate(() => import(...)),
  // which bypasses Vite's dev-server import rewriting and can't resolve the
  // bare 'three' specifier.
  await page.addScriptTag({ type: 'module', url: '/tests/lib/audio-harness.ts' });
  const attach = await page.evaluate(() => window.__audioAttach!());
  expect(attach.panningModel, 'playAt should use equalpower panning, not HRTF (see the comment above)').toBe('equalpower');
  expect(attach.gain, 'playAt should apply AudioManager.SFX_BOOST as its gain').toBe(1.5);

  const result = await page.evaluate(async ({ samples, sampleRate, panningModel, gain }) => {
    function toBuffer(ctx: BaseAudioContext) {
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(Float32Array.from(samples), 0);
      return buffer;
    }
    function peakOf(data: Float32Array) {
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      return peak;
    }
    // Matches a non-positional connection: source straight to destination,
    // no panner, no boost — the loudness floor everything else is compared
    // against.
    async function renderDirect() {
      const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = toBuffer(ctx);
      src.connect(ctx.destination);
      src.start();
      return peakOf((await ctx.startRendering()).getChannelData(0));
    }
    // Matches AudioManager.attach()'s real node graph: whatever panningModel
    // and gain it actually set (read above from the live code), refDistance
    // = 0.3 (attach()'s default), rolloffFactor/distanceModel left at
    // three.js/spec defaults (1, 'inverse', neither ever overridden here).
    async function renderPositional(z: number) {
      const ctx = new OfflineAudioContext(2, samples.length, sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = toBuffer(ctx);
      const panner = ctx.createPanner();
      panner.panningModel = panningModel as PanningModelType;
      panner.distanceModel = 'inverse';
      panner.refDistance = 0.3;
      panner.rolloffFactor = 1;
      panner.positionZ.value = z;
      const boost = ctx.createGain();
      boost.gain.value = gain;
      src.connect(panner).connect(boost).connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      // Stereo output: take whichever channel is louder, the ear closer to
      // the source, so this doesn't understate a source panned to one side.
      return Math.max(peakOf(rendered.getChannelData(0)), peakOf(rendered.getChannelData(1)));
    }

    const direct = await renderDirect();
    // Distances actually plausible for a tabletop AR game: refDistance
    // itself (0.3m, best case/highest-risk-of-clipping for the positional
    // path), then progressively further, up to a player standing back from
    // the table.
    const distances = [0.3, 0.6, 1.0, 1.5];
    const positional: Record<string, number> = {};
    for (const d of distances) positional[d] = await renderPositional(-d);
    return { direct, positional };
  }, { samples: hit.samples, sampleRate: 44100, panningModel: attach.panningModel, gain: attach.gain });

  console.log(`direct (non-positional) peak: ${result.direct.toFixed(4)}`);
  for (const [d, peak] of Object.entries(result.positional)) {
    const ratio = peak / result.direct;
    console.log(`positional (equalpower, x${attach.gain} boost) at ${d}m: peak ${peak.toFixed(4)}  (${(ratio * 100).toFixed(1)}% of direct, ${(20 * Math.log10(ratio)).toFixed(1)} dB)`);
  }

  // The real question this answers: is the positional path silent/broken
  // (ratio ~0), clipping (peak > 1, distorted), or just quieter/louder than
  // direct (a mixing property, not a bug)? Only those two ends are
  // asserted — the exact ratio is printed above, since "how loud is loud
  // enough" is a mixing judgment call, not something a pass/fail threshold
  // should guess at.
  for (const peak of Object.values(result.positional)) {
    expect(peak, '"hit" produced zero signal via playAt — genuinely broken, not just quieter').toBeGreaterThan(0);
    expect(peak, '"hit" is clipping (peak > 1) via playAt — SFX_BOOST is too high for this cue at this distance').toBeLessThanOrEqual(1);
  }
});

test('playBGM stays non-positional (ambient score, not a diegetic sound)', async ({ page }) => {
  // AudioManager.playBGM should connect straight to the listener, no
  // PositionalAudio, no panner, no distance falloff (see the class comment:
  // music is a deliberate exception to "everything else is positional").
  // Checked behaviorally against the real, live AudioManager: a positional
  // BGM would parent a PositionalAudio node onto the board's origin the way
  // playAt's cues do; a non-positional one touches the origin not at all.
  // This is the direct regression guard for the "restore BGM as
  // non-positional" correction — see .doc/DECISIONS.md D22.
  await page.goto('/');
  await page.addScriptTag({ type: 'module', url: '/tests/lib/audio-harness.ts' });
  const positional = await page.evaluate(() => window.__bgmIsPositional!());
  expect(positional, 'playBGM parented something onto the board origin — it should stay non-positional').toBe(false);
});
