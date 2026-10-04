import {
  defineSnapshotCodec,
  toRuntimeSnapshotCodec,
} from "../snapshots";

import type {
  RuntimeSnapshotCodec,
  SnapshotCodec,
} from "../snapshots";

import {
  DeterministicRng,
} from "./DeterministicRng";

import type {
  DeterministicRngSnapshot,
} from "./DeterministicRng";

import {
  RandomStream,
} from "./RandomStream";

import type {
  RandomStreamSnapshot,
} from "./RandomStream";

import {
  createSnapshotTypeId,
} from "../snapshots";

export const DETERMINISTIC_RNG_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.deterministic-rng",
  );

export const RANDOM_STREAM_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.random-stream",
  );

export const DETERMINISTIC_RNG_SNAPSHOT_CODEC:
  SnapshotCodec<
    DeterministicRng,
    DeterministicRngSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      DETERMINISTIC_RNG_SNAPSHOT_TYPE_ID,

    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is DeterministicRng {
      return (
        value instanceof
        DeterministicRng
      );
    },

    capture(
      aggregate:
        DeterministicRng,
    ): DeterministicRngSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        DeterministicRngSnapshot,
    ): DeterministicRng {
      return DeterministicRng
        .fromSnapshot(
          state,
        );
    },
  });

export const RANDOM_STREAM_SNAPSHOT_CODEC:
  SnapshotCodec<
    RandomStream,
    RandomStreamSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      RANDOM_STREAM_SNAPSHOT_TYPE_ID,

    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is RandomStream {
      return (
        value instanceof
        RandomStream
      );
    },

    capture(
      aggregate:
        RandomStream,
    ): RandomStreamSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        RandomStreamSnapshot,
    ): RandomStream {
      return RandomStream
        .fromSnapshot(
          state,
        );
    },
  });

export function createRandomRuntimeSnapshotCodecs():
  readonly RuntimeSnapshotCodec[] {
  return Object.freeze([
    toRuntimeSnapshotCodec(
      DETERMINISTIC_RNG_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      RANDOM_STREAM_SNAPSHOT_CODEC,
    ),
  ]);
}
