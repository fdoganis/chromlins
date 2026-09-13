// TODO: WIP : see ARCHI

// see https://github.com/mrdoob/three.js/blob/master/examples/webxr_xr_haptics.html
// and other spatial audio examples

// Owns the shared AudioContext (via its own AudioListener, on the camera),
// mute state, and positioning. Every SFX cue is a tiny SoundBox (CPlayer)
// song rendered once to an AudioBuffer and cached; the music bed is the real
// "redline" track (see CREDITS.md), played back verbatim. The SFX
// instruments are redline's own (instruments 6/5/0/1), referenced rather
// than duplicated, so its bytes serve both jobs.
// audio/AudioManager.ts
import { AudioListener, PositionalAudio } from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import { CPlayer } from './engines/soundbox/player-small';
import { redline } from './redline';
import type { SoundHandle } from './ISoundEngine';

const NOISE_HIT  = redline.songData[6].i;
const NOISE_TICK = redline.songData[5].i;
const LEAD       = redline.songData[0].i;
const BASS       = redline.songData[1].i;

type Track = { inst: number[]; seq: number[] }; // seq: one note per row from row 0 (0 = rest)
type Cue = { tracks: Track[]; rows?: number; rowLen?: number; loop?: boolean; raw?: object };

const SFX_ROWLEN = 2205; // ~50 ms/row — snappy

// Placeholder melodies for the short cues — a few SoundBox note ints each,
// on redline's own instruments. `music` skips the placeholder shape
// entirely and plays redline verbatim (`raw`).
const CUES: Record<string, Cue> = {
  spawn:   { tracks: [{ inst: NOISE_HIT,  seq: [135] }] },
  hit:     { tracks: [{ inst: NOISE_HIT,  seq: [147, 0, 159] }], rowLen: 1500 },
  unicorn: { tracks: [{ inst: LEAD,       seq: [130, 0, 123] }], rowLen: 3200 },
  win:     { tracks: [{ inst: LEAD,       seq: [147, 151, 154, 159] }], rowLen: 3600 },
  over:    { tracks: [{ inst: BASS,       seq: [123, 0, 116, 0, 109] }], rowLen: 4200 },
  tick:    { tracks: [{ inst: NOISE_TICK, seq: [159] }], rowLen: 1400 },
  music:   { tracks: [], loop: true, raw: redline },
};

function toSong(cue: Cue): object {
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
