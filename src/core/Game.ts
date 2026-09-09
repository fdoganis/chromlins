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
import { TEXT_ENGINE, BUILD } from '../game.config';
import { HUD_TEXT } from './palette';
import type { State } from './State';
import type { ClassOf } from '../types/ClassOf';

// Game is the composition root; it is the ctx every State receives.
export class Game {
  readonly rendering: RenderingManager;
  readonly audio: AudioManager;
  readonly world: World;
  readonly text: TextManager;
  readonly haptics: Haptics;
  readonly score = new Score();
  readonly level = new Level();
  readonly hiScore = new HiScore();
  #input: InputManager;
  #sm: StateMachine;
  #hiLabel: TextHandle;
  #hiShown = -1;

  change(state: ClassOf<State>): void { this.#sm.change(state); }


  constructor() {
    this.rendering = new RenderingManager();
    this.audio = new AudioManager(this.rendering.camera, new SoundBoxSoundEngine()); // or: OscillatorSoundEngine / ZzfxSoundEngine
    this.world = new World(this.rendering.anchor, this.audio, this.rendering.camera);
    this.haptics = new Haptics(this.rendering.renderer);
    this.#input = new InputManager(this.rendering.renderer, this.rendering.scene, this.rendering.camera, this.rendering.anchor);
    // TEXT_ENGINE is a literal const — rolldown folds the compare and the
    // unpicked engine (plus, for 'segment', all the voxel glyph data) shakes out.
    const textEngine = TEXT_ENGINE === 'segment'
      ? new SegmentTextEngine(this.rendering.scene, this.rendering.camera)
      : new VoxelTextEngine(this.rendering.scene, this.rendering.camera);
    this.text = new TextManager(textEngine);

    // Persistent HUD: the all-time best, shown everywhere. Game.update() ticks it
    // to max(hiScore, live score) so it climbs in real time while you beat it.
    this.#hiLabel = this.text.show('HI 0', this.rendering.hiAnchor, { color: HUD_TEXT });

    this.#sm = new StateMachine();
    this.#buildStates();

    this.#bindInput();
  }

  // Dev: `?run` skips Intro/Placing and drops the board in front of the default
  // camera, so the running state is testable on plain desktop without WebXR.
  #buildStates(): void {
    const sm = this.#sm;
    const level = this.level;

    const q = getQuery();
    const debugRun = __DEV__ && 'run' in q;
    const debugName = __DEV__ && 'name' in q;   // jump straight to NameEntryState
    const debugL13 = __DEV__ && 'l13' in q;     // jump straight into the level 13 run
    const debugCalib = __DEV__ && 'calib' in q; // hand-whack calibration (CalibState)
    const debugTweak = __DEV__ && 'tweak' in q; // live-tune panel, over a ?run-style round
    const debugIntro = __DEV__ && BUILD === 'deluxe' && 'intro' in q; // watch the opening cinematic on desktop

    sm.register(IntroState, new IntroState(this));
    sm.register(AnchorState, new AnchorState(this));
    sm.register(RunState, new RunState(this));
    sm.register(WinState, new WinState(this));
    sm.register(GameOverState, new GameOverState(this));
    sm.register(NameEntryState, new NameEntryState(this));
    if (__DEV__) sm.register(CalibState, new CalibState(this));

    if (debugRun || debugName || debugL13 || debugCalib || debugTweak || debugIntro) {
      this.rendering.anchor.position.set(0, 0, -0.6);
      this.rendering.camera.position.set(0, 0.6, 0.4);
      this.rendering.camera.lookAt(0, 0, -0.6);
    }
    if (debugL13) level.set(13);
    sm.start(
      debugCalib ? CalibState : // its own hand-on-surface placement step
      debugName ? NameEntryState :
      debugIntro ? IntroState :
      debugRun || debugL13 || debugTweak ? RunState :
      AnchorState, // place the board, then IntroState (cinematic), then RunState
    );
    if (__DEV__ && debugTweak) import('../dev/tweakPanel').then((m) => m.openTweakPanel(this));
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
    this.text.update(delta); // labels are global, not owned by the active state

    const hi = Math.max(this.hiScore.score, this.score.value);
    if (hi !== this.#hiShown) { this.#hiShown = hi; this.text.setText(this.#hiLabel, `HI ${hi}`); }
  }

  render() { this.rendering.render(); }

  // Called once from main before start(): pre-synth the audio buffers so the
  // first playBGM / playSFX doesn't block a frame.
  preload() { this.audio.prewarm(); }

  dispose() {
    this.rendering.renderer.setAnimationLoop(null);
    this.#input.dispose();
    this.world.dispose();
    this.audio.dispose();
    this.rendering.dispose();
    this.text.dispose();

  }

  start() {
    this.rendering.renderer.setAnimationLoop(new GameLoop(this).tick);
  }
}