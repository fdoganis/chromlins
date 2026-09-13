// TODO: WIP : see ARCHI

// see https://github.com/mrdoob/three.js/blob/master/examples/webxr_xr_haptics.html
// and other spatial audio examples

// Owns the shared AudioContext (via its own AudioListener, on the camera),
// mute state, and positioning. Every cue — SFX and the music bed — is a tiny
// SoundBox (CPlayer) song rendered once to an AudioBuffer and cached. The
// instruments are real presets lifted from a public SoundBox song (Rybar/voxby
// pot-break.js); the "songs" are hand-authored, a few notes each.
// audio/AudioManager.ts
import { AudioListener, PositionalAudio } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import { CPlayer } from './engines/soundbox/player-small';
import type { SoundHandle } from './ISoundEngine';

// Instrument presets (29-int SoundBox `i` arrays), shared across cues.
const NOISE_HIT  = [0, 0, 140, 0, 0, 0, 140, 0, 0, 81, 4, 10, 47, 55, 0, 0, 0, 187, 5, 0, 1, 239, 135, 0, 32, 108, 5, 16, 4];
const NOISE_TICK = [0, 0, 128, 0, 0, 0, 128, 0, 0, 125, 0, 1, 59, 0, 0, 0, 0, 0, 0, 0, 2, 193, 171, 0, 29, 39, 3, 88, 3];
const LEAD       = [3, 116, 128, 0, 0, 154, 140, 59, 0, 127, 2, 2, 47, 61, 0, 0, 0, 96, 3, 1, 3, 94, 79, 0, 32, 84, 2, 48, 4];
const BASS       = [0, 255, 116, 64, 0, 255, 120, 0, 64, 127, 4, 6, 35, 0, 0, 0, 0, 0, 0, 0, 2, 14, 0, 3, 72, 0, 0, 25, 3];

type Track = { inst: number[]; seq: number[] }; // seq: one note per row from row 0 (0 = rest)
type Cue = { tracks: Track[]; rows?: number; rowLen?: number; loop?: boolean };

const SFX_ROWLEN = 2205; // ~50 ms/row — snappy

// Placeholder melodies — a few SoundBox note ints each. The instruments are real;
// these note sequences are meant to be replaced by tracker exports (see GNOMES §5).
const CUES: Record<string, Cue> = {
  spawn:   { tracks: [{ inst: NOISE_HIT,  seq: [135] }] },
  hit:     { tracks: [{ inst: NOISE_HIT,  seq: [147, 0, 159] }], rowLen: 1500 },
  unicorn: { tracks: [{ inst: LEAD,       seq: [130, 0, 123] }], rowLen: 3200 },
  win:     { tracks: [{ inst: LEAD,       seq: [147, 151, 154, 159] }], rowLen: 3600 },
  over:    { tracks: [{ inst: BASS,       seq: [123, 0, 116, 0, 109] }], rowLen: 4200 },
  tick:    { tracks: [{ inst: NOISE_TICK, seq: [159] }], rowLen: 1400 },
  music:   {
    tracks: [
      { inst: BASS, seq: [123, 0, 0, 0, 128, 0, 0, 0, 126, 0, 0, 0, 121, 0, 0, 0] },
      { inst: LEAD, seq: [0, 0, 147, 0, 0, 0, 154, 0, 0, 0, 151, 0, 0, 0, 159, 0] },
    ],
    rows: 16, rowLen: 5513, loop: true, // ~2 s loop
  },
};

function toSong(cue: Cue): object {
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

export class AudioManager {
  #listener: AudioListener;
  #buffers = new Map<string, AudioBuffer>();
  #muted: boolean = false;
  #bgm: SoundHandle | null = null;

  constructor(camera: PerspectiveCamera) {
    this.#listener = new AudioListener();
    camera.add(this.#listener);
  }

  get context(): AudioContext { return this.#listener.context; }

  // Asset-load phase: render every cue's buffer now, so nothing stalls the main
  // thread on first play (the music loop from RunState in particular).
  prewarm(): void {
    for (const id in CUES) this.#bufferFor(id, this.context);
  }

  // Non-positional: plays straight through the listener. For cues with no
  // source in the world (UI, stingers).
  playSFX(id: string): void {
    if (this.#muted) { return; }

    const handle = this.#createSource(id, this.context);
    if (!handle) { return; }
    handle.output.connect(this.#listener.getInput());
  }

  // One-shot positional cue emitted from `source` (an actor mesh): attach a
  // PositionalAudio, play, and tear the emitter down when the sound ends.
  playAt(source: Object3D, id: string): void {
    if (this.#muted) { return; }

    const pa = this.attach(source);
    const handle = this.#createSource(id, this.context);
    if (!handle) { pa.removeFromParent(); return; }
    pa.setNodeSource(handle.output);
    handle.source.onended = () => { handle.output.disconnect(); pa.removeFromParent(); };
  }

  // Creates a PositionalAudio parented to `source` for a one-shot positional
  // cue (see playAt, the only caller). refDistance defaults to 0.3m, not
  // PannerNode's spec default of 1m — at 1m, every emitter in this game's
  // ~0.6m play radius would be full volume with zero distance falloff (only
  // HRTF direction would differ).
  attach(source: Object3D, refDistance = 0.3): PositionalAudio {
    const audio = new PositionalAudio(this.#listener);
    audio.setRefDistance(refDistance);
    source.add(audio);
    return audio;
  }

  // Non-positional by design. One channel, not a pool. Starting a new track
  // stops whatever was playing.
  playBGM(id: string) {
    this.stopBGM();
    if (this.#muted) { return; }
    const handle = this.#createSource(id, this.context);
    if (!handle) { return; }
    handle.output.connect(this.#listener.getInput());
    this.#bgm = handle;
  }

  stopBGM() {
    this.#bgm?.source.stop();
    this.#bgm = null;
  }

  toggle() { this.#muted ? this.activate() : this.deactivate(); }

  activate() {
    this.#muted = false;
    this.#listener.setMasterVolume(1);
    if (this.context.state === 'suspended') this.context.resume();
  }

  deactivate() {
    this.#muted = true;
    this.#listener.setMasterVolume(0);
  }

  dispose() {
    this.#bgm?.source.stop();
    this.#listener.removeFromParent();
  }

  #createSource(id: string, context: AudioContext): SoundHandle | null {
    const buffer = this.#bufferFor(id, context);
    if (!buffer) return null;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = !!CUES[id].loop;
    source.start();
    return { source, output: source };
  }

  #bufferFor(id: string, context: AudioContext): AudioBuffer | null {
    const cue = CUES[id];
    if (!cue) return null;

    let buffer = this.#buffers.get(id);
    if (!buffer) {
      const player = new CPlayer();
      player.init(toSong(cue));
      while (player.generate() < 1) { /* one pass per channel */ }
      buffer = player.createAudioBuffer(context);
      this.#buffers.set(id, buffer);
    }
    return buffer;
  }
}
