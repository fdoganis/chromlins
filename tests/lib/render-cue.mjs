// Shared by tests/unit/cues.test.mjs (does the cue DATA render silent) and
// tests/packed.spec.ts (does the real playback path in the packed artifact
// actually reach the listener) so both check against the same ground truth
// instead of two hand-copied guesses at a cue's expected duration/loudness.
//
// Loads src/audio/cues.ts through Vite's own resolver (ssrLoadModule), not
// Node's, because src/ uses extensionless relative imports that only a
// bundler's resolver understands — see the comment in cues.test.mjs.
import { createServer } from 'vite';
import { CPlayer } from '../../src/audio/engines/soundbox/player-small.js';

let cuesModule;
async function getCues() {
  if (!cuesModule) {
    const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
    cuesModule = await server.ssrLoadModule('/src/audio/cues.ts');
    await server.close();
  }
  return cuesModule;
}

// The raw { CUES, toSong } module, for tests that need to inspect a cue's
// own tracks/notes/rowLen directly (see tests/unit/rowlen.test.mjs) rather
// than just its rendered output.
export const cueDefinitions = getCues;

// context.createBuffer(channels, length, sampleRate) is CPlayer's entire
// AudioContext surface (see createAudioBuffer in player-small.js) — a plain
// Float32Array-backed stand-in is enough, no real audio hardware/API needed.
function fakeContext() {
  return {
    createBuffer: (channels, length) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i) => data[i] };
    },
  };
}

export async function cueIds() {
  const { CUES } = await getCues();
  return Object.keys(CUES);
}

// Renders a CUES entry exactly as AudioManager.#bufferFor does, and returns
// its duration (seconds) and peak amplitude (0-1), the same two signals
// tests/packed.spec.ts's audio tap logs from the real browser, plus the raw
// mono samples (a plain array, serializable into a page.evaluate() argument)
// for tests that need to feed the exact real cue signal through a real
// browser AudioContext (see tests/audio-loudness.spec.ts).
export async function renderCue(id) {
  const { CUES, toSong } = await getCues();
  const player = new CPlayer();
  player.init(toSong(CUES[id]));
  while (player.generate() < 1) { /* one pass per channel */ }
  const buffer = player.createAudioBuffer(fakeContext());
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  return { duration: data.length / 44100, peak, samples: Array.from(data) };
}
