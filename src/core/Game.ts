import { GameLoop } from './GameLoop';
import { makeSm } from './sm';
import type { Sm, Screen } from './sm';
import { Score } from './Score';
import { Level } from './Level';
import { HiScore } from './HiScore';
import { RenderingManager } from '../rendering/RenderingManager';
import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { World } from '../world/World';
import { SelectCommand } from '../commands/SelectCommand';
import { makeIntro } from '../states/IntroState';
import { makeAnchor } from '../states/AnchorState';
import { makeRun } from '../states/RunState';
import { makeWin } from '../states/WinState';
import { makeGameOver } from '../states/GameOverState';
import { makeNameEntry } from '../states/NameEntryState';
import { getQuery } from '../core/Utils';
import { Haptics } from '../input/XRGamepadUtils';
import { TextManager } from '../text/TextManager';
import type { TextHandle } from '../text/ITextEngine';
import { VoxelTextEngine } from '../text/engines/voxel/VoxelTextEngine';
import { HUD_TEXT } from './palette';

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
  #sm: Sm;
  #hiLabel: TextHandle;
  #hiShown = -1;
  #hiName = '';

  change(state: string): void { this.#sm.change(state); }


  constructor() {
    this.rendering = new RenderingManager();
    this.audio = new AudioManager(this.rendering.camera);
    this.world = new World(this.rendering.anchor, this.audio, this.rendering.camera);
    this.haptics = new Haptics(this.rendering.renderer);
    this.#input = new InputManager(this.rendering.renderer, this.rendering.scene, this.rendering.anchor);
    this.text = new TextManager(new VoxelTextEngine(this.rendering.scene, this.rendering.camera));

    // Persistent HUD: the all-time best, shown everywhere. Game.update() ticks it
    // to max(hiScore, live score) so it climbs in real time while you beat it.
    this.#hiLabel = this.text.show('HI 0', this.rendering.hiAnchor, { color: HUD_TEXT });

    this.#sm = this.#buildStates();

    this.#bindInput();

    // The "START XR" button press is the one gesture every browser accepts as
    // audio-unlocking, see AudioManager.unlock().
    this.rendering.xrButton.addEventListener('click', () => this.audio.unlock());
  }

  // Dev: `?run` skips Intro/Placing and drops the board in front of the default
  // camera, so the running state is testable on plain desktop without WebXR.
  #buildStates(): Sm {
    const level = this.level;

    const q = getQuery();
    const debugRun = __DEV__ && 'run' in q;
    const debugName = __DEV__ && 'name' in q;   // jump straight to NameEntryState
    const debugL13 = __DEV__ && 'l13' in q;     // jump straight into the level 13 run
    const debugUni = __DEV__ && 'uni' in q;     // force the unicorn peeking (mane tuning + tests/mane.spec.ts)

    const screens: Record<string, Screen> = {
      intro: makeIntro(this),
      anchor: makeAnchor(this),
      run: makeRun(this),
      win: makeWin(this),
      over: makeGameOver(this),
      name: makeNameEntry(this),
    };
    const sm = makeSm(screens);

    if (debugRun || debugName || debugL13 || debugUni) {
      this.rendering.anchor.position.set(0, 0, -0.6);
      this.rendering.camera.position.set(0, 0.6, 0.4);
      this.rendering.camera.lookAt(0, 0, -0.6);
    }
    if (debugL13) level.set(13);
    sm.change(
      debugName ? 'name' :
      debugRun || debugL13 || debugUni ? 'run' :
      'anchor', // place the board, then IntroState, then RunState
    );
    // a unicorn peeking at hole 0, held — after RunState.enter()'s world.reset()
    if (debugUni) queueMicrotask(() => this.world.spawnAtHole(0, '#f3ead7', Infinity, -1, true));
    return sm;
  }

  #bindInput(): void {
    const { xrLeft, xrRight, handLeft, handRight } = this.#input;

    xrLeft.bind('select', new SelectCommand(xrLeft.node, 'left'));
    xrRight.bind('select', new SelectCommand(xrRight.node, 'right'));
    handLeft.bind('pinchend', new SelectCommand(handLeft.node, 'left'));
    handRight.bind('pinchend', new SelectCommand(handRight.node, 'right'));
  }

  processInput() {
    this.#input.collect();
    for (const cmd of this.#input.commands) if (cmd instanceof SelectCommand) this.#sm.select(cmd);
  }

  update(delta: number, frame?: XRFrame) {
    this.#sm.update(delta, frame);
    this.text.update(delta); // labels are global, not owned by the active state

    const hi = Math.max(this.hiScore.score, this.score.value);
    const name = this.hiScore.name;
    if (hi !== this.#hiShown || name !== this.#hiName) {
      this.#hiShown = hi;
      this.#hiName = name;
      this.text.setText(this.#hiLabel, `HI ${hi} ${name}`);
    }
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
