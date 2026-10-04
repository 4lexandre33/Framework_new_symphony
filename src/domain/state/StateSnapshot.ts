import type {
  StateKey,
} from "./StateKey";

import type {
  StateValue,
} from "./StateValue";

export interface StateSnapshotEntry {
  readonly key:
    StateKey;
  readonly value:
    StateValue;
}

export interface StateSnapshot {
  readonly entries:
    readonly StateSnapshotEntry[];
}
