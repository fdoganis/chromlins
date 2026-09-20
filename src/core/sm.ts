// Flat state machine: screens are plain objects keyed by name, not classes.
// Replaces core/State.ts + core/StateMachine.ts + types/ClassOf.ts.
import type { SelectCommand } from '../commands/SelectCommand';

export type Screen = {
  enter?(): void;
  exit?(): void;
  update?(delta: number, frame?: XRFrame): void;
  select?(cmd: SelectCommand): void;
};

export type Sm = {
  change(name: string): void;
  select(cmd: SelectCommand): void;
  update(delta: number, frame?: XRFrame): void;
};

export function makeSm(screens: Record<string, Screen>): Sm {
  let cur = '';
  return {
    // screens[cur] (not screens[name]) keeps its `?.`: cur starts as '', a
    // real "no screen yet" sentinel on the very first call, not a bug.
    // screens[name] does NOT: name is always a real, intended target, so a
    // typo'd or wrongly-renamed key throws here immediately instead of
    // silently doing nothing (see gen-three-externs.mjs's OWN_DISPATCH_KEYS
    // for the actual bug this class of mistake caused, twice).
    change(name) {
      if (name === cur) return;
      screens[cur]?.exit?.();
      cur = name;
      screens[name].enter?.();
    },
    // By the time either of these runs, change() has always run at least
    // once (Game's constructor calls it before the loop starts), so cur is
    // never the '' sentinel here, same reasoning as screens[name] above.
    select(cmd) { screens[cur].select?.(cmd); },
    update(delta, frame) { screens[cur].update?.(delta, frame); },
  };
}
