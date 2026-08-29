import { InvalidTransitionError } from "./errors.js";

/** Maps each state to the states it may legally transition to. */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(
  entity: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}
