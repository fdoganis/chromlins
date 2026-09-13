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
    change(name) {
      if (name === cur) return;
      screens[cur]?.exit?.();
      cur = name;
      screens[name]?.enter?.();
    },
    select(cmd) { screens[cur]?.select?.(cmd); },
    update(delta, frame) { screens[cur]?.update?.(delta, frame); },
  };
}
