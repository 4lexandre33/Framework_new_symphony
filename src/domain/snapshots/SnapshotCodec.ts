import type {
  SnapshotTypeId,
} from "./SnapshotIds";

export type SnapshotSchemaVersion =
  number;

export interface SnapshotCodec<
  TAggregate,
  TState,
  TContext = undefined,
> {
  readonly typeId:
    SnapshotTypeId;

  readonly schemaVersion:
    SnapshotSchemaVersion;

  isAggregate(
    value: unknown,
  ): value is TAggregate;

  capture(
    aggregate:
      TAggregate,
  ): TState;

  restore(
    state:
      TState,
    context:
      TContext,
  ): TAggregate;
}

/**
 * Shape type-erased usada pelo registry/coordinator.
 */
export interface RuntimeSnapshotCodec {
  readonly typeId:
    SnapshotTypeId;

  readonly schemaVersion:
    SnapshotSchemaVersion;

  readonly isAggregate:
    (
      value: unknown,
    ) => boolean;

  readonly capture:
    (
      value: unknown,
    ) => unknown;

  readonly restore:
    (
      state: unknown,
      context: unknown,
    ) => unknown;
}

export type SnapshotCodecErrorCode =
  | "invalid-schema-version"
  | "aggregate-type-mismatch";

export class SnapshotCodecError
  extends Error {
  public readonly name =
    "SnapshotCodecError";

  public constructor(
    public readonly code:
      SnapshotCodecErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertSchemaVersion(
  schemaVersion:
    number,
): void {
  if (
    !Number.isSafeInteger(
      schemaVersion,
    ) ||
    schemaVersion < 1
  ) {
    throw new SnapshotCodecError(
      "invalid-schema-version",
      "Snapshot codec schemaVersion deve ser inteiro seguro >= 1.",
    );
  }
}

export function defineSnapshotCodec<
  TAggregate,
  TState,
  TContext = undefined,
>(
  codec:
    SnapshotCodec<
      TAggregate,
      TState,
      TContext
    >,
): SnapshotCodec<
  TAggregate,
  TState,
  TContext
> {
  assertSchemaVersion(
    codec.schemaVersion,
  );

  return Object.freeze(
    codec,
  );
}

export function toRuntimeSnapshotCodec<
  TAggregate,
  TState,
  TContext = undefined,
>(
  codec:
    SnapshotCodec<
      TAggregate,
      TState,
      TContext
    >,
): RuntimeSnapshotCodec {
  assertSchemaVersion(
    codec.schemaVersion,
  );

  return Object.freeze({
    typeId:
      codec.typeId,

    schemaVersion:
      codec.schemaVersion,

    isAggregate(
      value: unknown,
    ): boolean {
      return codec.isAggregate(
        value,
      );
    },

    capture(
      value: unknown,
    ): unknown {
      if (
        !codec.isAggregate(
          value,
        )
      ) {
        throw new SnapshotCodecError(
          "aggregate-type-mismatch",
          `Valor incompatível com SnapshotCodec "${codec.typeId}".`,
        );
      }

      return codec.capture(
        value,
      );
    },

    restore(
      state: unknown,
      context: unknown,
    ): unknown {
      return codec.restore(
        state as TState,
        context as TContext,
      );
    },
  });
}
