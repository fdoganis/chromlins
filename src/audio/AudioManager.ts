// TODO: WIP : see ARCHI

// see https://github.com/mrdoob/three.js/blob/master/examples/webxr_xr_haptics.html
// and other spatial audio examples

// Owns the shared AudioContext (via its own AudioListener, on the camera),
// mute state, and positioning. Every SFX cue is a tiny SoundBox (CPlayer)
// song rendered once to an AudioBuffer and cached; the music bed is the real
// "redline" track (see CREDITS.md), played back verbatim. The SFX
// instruments are redline's own (instruments 6/5/0/1), referenced rather
// than duplicated, so its bytes serve both jobs.
//
// Every sound but one is positional: this is an AR toy the player places on
// their own real table, and a sound that doesn't come from somewhere in
// that space (win/over/tick playing "in your head" instead of from the
// board) breaks the one illusion the whole game is built on. `origin`
// (Game's `render.anchor`, the board's own placed root) is where the
// board-wide cues (win/over/tick) emanate from; actor-specific cues (spawn/
// hit/unicorn) emanate from the actual actor mesh — see attach()/playAt().
// `miss` (an aimed swing that hit nothing) has no persistent mesh to hang
// off of, so it gets its own throwaway emitter at the whiff point — see
// playAtPoint(). `music` is the deliberate exception: ambient score, not a
// diegetic sound any object in the scene is producing, so it stays
// non-positional, playing straight through the listener like a film score
// rather than a stereo the board owns — see playBGM.
// audio/AudioManager.ts
import { AudioListener, Object3D, PositionalAudio } from 'three';
import type { PerspectiveCamera, Vector3 } from 'three';
import { CPlayer } from './engines/soundbox/player-small';
import { CUES, toSong } from './cues';
import type { SoundHandle } from './ISoundEngine';

export class AudioManager {
  #listener: AudioListener;
  #origin: Object3D;
  #buffers = new Map<string, AudioBuffer>();
  #muted: boolean = false;
  #bgm: SoundHandle | null = null;

  constructor(camera: PerspectiveCamera, origin: Object3D) {
    this.#listener = new AudioListener();
    camera.add(this.#listener);
    this.#origin = origin;
  }

  // The AudioContext above is created right now, on page load, with no user
  // gesture yet, so every browser (Safari strictest) starts it 'suspended'.
  // RunState's own activate() call is too late to count as gesture-driven on
  // some browsers: it fires after XR session setup plus at least one WebXR
  // select event, several async hops past the original click. Game hangs
  // this directly off the "START XR" button, the one gesture every browser
  // accepts, instead of a generic first-interaction-anywhere listener, so
  // there's no ambiguity about which gesture it's riding on.
  unlock(): void {
    this.context.resume(); // no-op if already running
  }

  get context(): AudioContext { return this.#listener.context; }

  // Asset-load phase: render every cue's buffer now, so nothing stalls the main
  // thread on first play (the music loop from RunState in particular).
  prewarm(): void {
    for (const id in CUES) this.#bufferFor(id, this.context);
  }

  // For a board-wide cue with no specific emitter (a UI-ish sting, or the
  // music bed) — still positional, from the board's own placed origin, not
  // the listener: see the class comment above for why "positional" isn't
  // optional here. Just playAt(this.#origin, id) with a friendlier name for
  // the common case; RunState/WinState/GameOverState never need to know
  // where the board is to call this.
  playSFX(id: string): void {
    this.playAt(this.#origin, id);
  }

  // One-shot positional cue emitted from `source` (an actor mesh, or
  // `#origin` for a board-wide one via playSFX): attach a PositionalAudio,
  // play, and tear the emitter down when the sound ends. `detachSource`
  // additionally removes `source` ITSELF when the sound ends, not just the
  // PositionalAudio child attach() adds to it — wrong for a real, persistent
  // actor mesh (the normal case, default false: only the transient audio
  // node it briefly wore gets cleaned up), right for a throwaway holder that
  // exists solely for this one sound (see playAtPoint, its only caller).
  playAt(source: Object3D, id: string, detachSource = false): void {
    if (this.#muted) { return; }

    const pa = this.attach(source);
    const handle = this.#createSource(id, this.context);
    if (!handle) { detachSource ? source.removeFromParent() : pa.removeFromParent(); return; }
    pa.setNodeSource(handle.output);
    handle.source.onended = () => {
      handle.output.disconnect();
      detachSource ? source.removeFromParent() : pa.removeFromParent();
    };
  }

  // One-shot positional cue at a bare point with no persistent mesh to hang
  // off of (a whiff — an aimed swing that hit nothing, so there's no actor
  // to attach to). Makes a throwaway holder parented to `root`, positioned
  // at `point` (in `root`'s local space), and plays through playAt with
  // detachSource: true so the holder itself, not just its PositionalAudio
  // child, gets torn down once the sound ends.
  playAtPoint(root: Object3D, point: Vector3, id: string): void {
    const holder = new Object3D();
    holder.position.copy(point);
    root.add(holder);
    this.playAt(holder, id, true);
  }

  // How much louder than the panner's own output a short SFX cue plays, to
  // compensate for real distance-based falloff (a player often stands
  // farther than refDistance from their own table) without giving up
  // spatial correctness by going non-positional. A flat multiplier, not a
  // distance-aware one: closer still sounds louder than farther, only the
  // whole curve is raised. Deliberately a tunable knob, not a derived
  // number — perceived loudness depends on real hardware this automated
  // suite can't judge; tests/audio-loudness.spec.ts prints the resulting
  // ratios at several distances so a device check has real numbers to
  // compare against, not a guess. See .doc/DECISIONS.md D21/D22.
  static readonly SFX_BOOST = 1.5;

  // Creates a PositionalAudio parented to `source` (an actor mesh via
  // playAt, or `#origin` via playSFX — never called for music, see the
  // class comment and playBGM, so SFX_BOOST is unconditional here, not a
  // parameter). refDistance defaults to 0.3m, not PannerNode's spec default
  // of 1m — at 1m, every emitter in this game's ~0.6m play radius would be
  // full volume with zero distance falloff (only HRTF direction would
  // differ).
  attach(source: Object3D, refDistance = 0.3): PositionalAudio {
    const audio = new PositionalAudio(this.#listener);
    audio.setRefDistance(refDistance);
    // PositionalAudio's constructor hardcodes panningModel='HRTF' with no
    // public setter; reached directly here to drop it. Not a step away from
    // spatial audio, a cheaper way to keep it: HRTF's own binaural,
    // head-tracked cues are built for pinpointing a sound's exact direction
    // by ear alone, more precision than a short percussive blip needs here,
    // and measured (tests/audio-loudness.spec.ts) to cost an extra ~4.4 dB
    // (~1.66x amplitude) versus ordinary 'equalpower' stereo panning for
    // that precision — equalpower keeps the same real distance-based
    // falloff and left/right positioning (still audibly "from the board",
    // still quieter as the player steps back), just without paying HRTF's
    // convolution cost for directional precision this game doesn't need.
    // See .doc/DECISIONS.md D19/D20/D21.
    audio.panner.panningModel = 'equalpower';
    audio.gain.gain.value = AudioManager.SFX_BOOST;
    source.add(audio);
    return audio;
  }

  // Non-positional by design (see the class comment: ambient score, not a
  // diegetic sound the board itself makes). One channel, not a pool.
  // Starting a new track stops whatever was playing.
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
    this.stopBGM();
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
    // Every caller passes a hardcoded literal matching a real CUES key, so a
    // missing cue is always a bug (a typo, or the renaming bug this project
    // hit twice, see scripts/gen-record-keys.mjs), never a legitimate runtime
    // condition. Throw instead of silently returning null: this call sits
    // one line before the audio actually plays, so throwing surfaces the
    // exact failure immediately instead of a generic "no sound" report.
    if (!cue) throw new Error(`no such cue: ${id}`);

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
