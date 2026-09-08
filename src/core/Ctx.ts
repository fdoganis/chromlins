// The one thing every State (and the state-scoped helpers Scoring / Cinematic)
// receives: state transitions + the shared services. Game implements it, so a
// state constructor is `(ctx: Ctx)` instead of a 4–8 argument list, and adding a
// dependency to one state is a one-line change there rather than threading a new
// parameter through Game.
import type { ClassOf } from '../types/ClassOf';
import type { State } from './State';
import type { World } from '../world/World';
import type { AudioManager } from '../audio/AudioManager';
import type { TextManager } from '../text/TextManager';
import type { RenderingManager } from '../rendering/RenderingManager';
import type { Haptics } from '../input/XRGamepadUtils';
import type { Score } from './Score';
import type { Level } from './Level';
import type { HiScore } from './HiScore';

export interface Ctx {
  change(state: ClassOf<State>): void;
  readonly world: World;
  readonly audio: AudioManager;
  readonly text: TextManager;
  readonly render: RenderingManager;
  readonly haptics: Haptics;
  readonly score: Score;
  readonly level: Level;
  readonly hiScore: HiScore;
}
