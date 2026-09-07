import { GameLoop } from './GameLoop';
import { StateMachine } from './StateMachine';
import { Score } from './Score';
import { Level } from './Level';
import { HiScore } from './HiScore';
import { RenderingManager } from '../rendering/RenderingManager';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';

import { SoundBoxSoundEngine } from '../audio/engines/soundbox/SoundBoxSoundEngine';

import { World } from '../world/World';
import { SelectCommand } from '../commands/SelectCommand';
import { IntroState } from '../states/IntroState';
import { AnchorState } from '../states/AnchorState';
import { RunState } from '../states/RunState';
import { WinState } from '../states/WinState';
import { GameOverState } from '../states/GameOverState';
import { NameEntryState } from '../states/NameEntryState';
import { CalibState } from '../states/CalibState';
import { randomTransform, getQuery } from '../core/Utils';
import { Haptics } from '../input/XRGamepadUtils';
import { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { VoxelTextEngine } from '../text/engines/voxel/VoxelTextEngine';
import { SegmentTextEngine } from '../text/engines/segment/SegmentTextEngine';
import { TEXT_ENGINE } from '../game.config';

export class Game {
  #render: RenderingManager;
  #input: InputManager;
  #audio: AudioManager;
  #world: World;
  #text: TextManager
  #sm: StateMachine;
  #haptics: Haptics;
  #score = new Score();
  #level = new Level();
  #hiScore = new HiScore();
  #hiLabel: TextHandle;
  #hiShown = -1;


  constructor() {
    this.#render = new RenderingManager();
    this.#audio = new AudioManager(this.#render.camera, new SoundBoxSoundEngine()); // or: OscillatorSoundEngine / ZzfxSoundEngine
    this.#world = new World(this.#render.anchor, this.#audio, this.#render.camera);
    this.#haptics = new Haptics(this.#render.renderer);
    this.#input = new InputManager(this.#render.renderer, this.#render.scene, this.#render.camera, this.#render.anchor);
    // TEXT_ENGINE is a literal const — rolldown folds the compare and the
    // unpicked engine (plus, for 'segment', all the voxel glyph data) shakes out.
    const textEngine = TEXT_ENGINE === 'segment'
      ? new SegmentTextEngine(this.#render.scene, this.#render.camera)
      : new VoxelTextEngine(this.#render.scene, this.#render.camera);
    this.#text = new TextManager(textEngine);

    // Persistent HUD: the all-time best, shown everywhere. Game.update() ticks it
    // to max(hiScore, live score) so it climbs in real time while you beat it.
    this.#hiLabel = this.#text.show('HI 0', this.#render.hiAnchor);

    this.#sm = this.#buildStateMachine();


    this.#bindInput();
  }

  // IntroState / GameOverState
  // NOTE: Starting in Intro means the first tap changes state instead of spawning a cone.
  // Dev: `?run` skips Intro/Placing and drops the board in front of the default
  // camera, so the running state is testable on plain desktop without WebXR.
  #buildStateMachine(): StateMachine {
    const sm = new StateMachine();
    const score = this.#score, level = this.#level;

    const q = getQuery();
    const debugRun = __DEV__ && 'run' in q;
    const debugName = __DEV__ && 'name' in q;   // jump straight to NameEntryState
    const debugL13 = __DEV__ && 'l13' in q;     // jump straight into the level 13 run
    const debugCalib = __DEV__ && 'calib' in q; // hand-whack calibration (CalibState)
    const debugTweak = __DEV__ && 'tweak' in q; // live-tune panel, over a ?run-style round
    const debugIntro = __DEV__ && 'intro' in q; // watch the opening cinematic on desktop

    sm.register(IntroState, new IntroState(sm, this.#world, this.#audio, this.#render, score, level));
    sm.register(AnchorState, new AnchorState(this.#render, sm));
    sm.register(RunState, new RunState(this.#world, this.#audio, this.#haptics, sm, this.#text, this.#render, score, level));
    sm.register(WinState, new WinState(sm, this.#text, this.#render.hudAnchor, score, level, this.#hiScore, RunState, this.#audio));
    sm.register(GameOverState, new GameOverState(sm, this.#text, this.#render.hudAnchor, score, this.#hiScore, this.#audio));
    sm.register(NameEntryState, new NameEntryState(sm, this.#world, this.#text, this.#render, score, level, this.#hiScore, RunState));
    if (__DEV__) sm.register(CalibState, new CalibState(sm, this.#world, this.#text, this.#render));

    if (debugRun || debugName || debugL13 || debugCalib || debugTweak || debugIntro) {
      this.#render.anchor.position.set(0, 0, -0.6);
      this.#render.camera.position.set(0, 0.6, 0.4);
      this.#render.camera.lookAt(0, 0, -0.6);
    }
    if (debugL13) level.set(13);
    sm.start(
      debugCalib ? CalibState : // its own hand-on-surface placement step
      debugName ? NameEntryState :
      debugIntro ? IntroState :
      debugRun || debugL13 || debugTweak ? RunState :
      AnchorState, // place the board, then IntroState (cinematic), then RunState
    );
    if (__DEV__ && debugTweak) import('../dev/tweakPanel').then((m) => m.openTweakPanel(this.#render, this.#world, this.#audio));
    return sm;
  }

  #bindInput(): void {
    const { xrLeft, xrRight, handLeft, handRight, gamepadPool } = this.#input;

    xrLeft.bind('select', new SelectCommand(xrLeft.node, 'left'));
    xrRight.bind('select', new SelectCommand(xrRight.node, 'right'));
    handLeft.bind('pinchend', new SelectCommand(handLeft.node, 'left'));
    handRight.bind('pinchend', new SelectCommand(handRight.node, 'right'));

    // The XR controller trigger already emits `select` above; a real (non-XR)
    // gamepad still routes through gamepadPool.
    gamepadPool.onConnect((pad) => pad.bind(0, new SelectCommand(randomTransform())));
  }

  processInput() {
    this.#input.collect();
    for (const cmd of this.#input.commands) this.#sm.dispatch(cmd);
  }

  update(delta: number, frame?: XRFrame) {
    this.#sm.update(delta, frame);
    this.#text.update(delta); // labels are global, not owned by the active state

    const hi = Math.max(this.#hiScore.score, this.#score.value);
    if (hi !== this.#hiShown) { this.#hiShown = hi; this.#text.setText(this.#hiLabel, `HI ${hi}`); }
  }

  render() { this.#render.render(); }

  // Called once from main before start(): pre-synth the audio buffers so the
  // first playBGM / playSFX doesn't block a frame.
  preload() { this.#audio.prewarm(); }

  dispose() {
    this.#render.renderer.setAnimationLoop(null);
    this.#input.dispose();
    this.#world.dispose();
    this.#audio.dispose();
    this.#render.dispose();
    this.#text.dispose();

  }

  start() {
    this.#render.renderer.setAnimationLoop(new GameLoop(this).tick);
  }
}