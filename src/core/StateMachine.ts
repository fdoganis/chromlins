// core/StateMachine.ts
import type { State } from './State';
import type { Command } from './Command';
import type { ClassOf } from '../types/ClassOf';

export class StateMachine {
  #states = new Map<ClassOf<State>, State>();
  #currentClass: ClassOf<State> | null = null;
  #current: State | null = null;

  register(StateClass: ClassOf<State>, state: State): this {
    this.#states.set(StateClass, state);
    return this;
  }

  start(StateClass: ClassOf<State>) {
    this.#currentClass = StateClass;
    this.#current = this.#states.get(StateClass) ?? null;
    this.#current?.enter();
  }

  change(StateClass: ClassOf<State>) {
    if (this.#currentClass === StateClass) return;
    this.#current?.exit();
    this.#currentClass = StateClass;
    this.#current = this.#states.get(StateClass) ?? null;
    this.#current?.enter();
  }

  get currentClass(): ClassOf<State> | null { return this.#currentClass; }

  // routes a command to the current state : GPP's handleInput()
  dispatch(cmd: Command) { this.#current?.handle(cmd); }

  // advances time-based logic in the current state : GPP's update()
  update(delta: number, frame?: XRFrame) { this.#current?.update(delta, frame); }
}