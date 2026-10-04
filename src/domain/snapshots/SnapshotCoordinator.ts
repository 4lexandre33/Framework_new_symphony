import {
  createSnapshotBundle,
  normalizeSnapshotBundle,
} from "./SnapshotBundle";

import type {
  SnapshotBundleSnapshot,
} from "./SnapshotBundle";

import type {
  DomainSnapshotRegistry,
} from "./DomainSnapshotRegistry";

import {
  createSnapshotSlotId,
  createSnapshotTypeId,
} from "./SnapshotIds";

import type {
  SnapshotSlotId,
  SnapshotTypeId,
} from "./SnapshotIds";

export interface SnapshotCaptureBinding {
  readonly slotId:
    SnapshotSlotId;
  readonly typeId:
    SnapshotTypeId;
  readonly value:
    unknown;
}

export type SnapshotRestoreContexts =
  ReadonlyMap<
    SnapshotSlotId,
    unknown
  >;

export type SnapshotCoordinatorErrorCode =
  | "duplicate-binding"
  | "unknown-context-slot"
  | "unsupported-codec-schema"
  | "capture-failed"
  | "restore-failed";

export class SnapshotCoordinatorError
  extends Error {
  public readonly name =
    "SnapshotCoordinatorError";

  public constructor(
    public readonly code:
      SnapshotCoordinatorErrorCode,
    message: string,
    public readonly slotId:
      SnapshotSlotId | null =
        null,
    public readonly typeId:
      SnapshotTypeId | null =
        null,
  ) {
    super(message);
  }
}

function compareSlotId(
  left:
    SnapshotSlotId,
  right:
    SnapshotSlotId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Resultado read-only de restore.
 */
export class RestoredSnapshotSet {
  private readonly values =
    new Map<
      SnapshotSlotId,
      unknown
    >();

  private readonly slotIds:
    readonly SnapshotSlotId[];

  public constructor(
    entries:
      readonly [
        SnapshotSlotId,
        unknown,
      ][],
  ) {
    for (
      const [
        slotId,
        value,
      ] of entries
    ) {
      this.values.set(
        slotId,
        value,
      );
    }

    this.slotIds =
      Object.freeze(
        [...this.values.keys()]
          .sort(compareSlotId),
      );
  }

  public get size():
    number {
    return this.values.size;
  }

  public has(
    slotId:
      SnapshotSlotId,
  ): boolean {
    return this.values.has(
      slotId,
    );
  }

  public get<
    TValue,
  >(
    slotId:
      SnapshotSlotId,
  ): TValue | null {
    return (
      this.values.get(
        slotId,
      ) as TValue | undefined
    ) ?? null;
  }

  public require<
    TValue,
  >(
    slotId:
      SnapshotSlotId,
  ): TValue {
    const value =
      this.values.get(
        slotId,
      );

    if (value === undefined) {
      throw new SnapshotCoordinatorError(
        "restore-failed",
        `SnapshotSlotId restaurado não encontrado: "${slotId}".`,
        slotId,
      );
    }

    return value as TValue;
  }

  public getSlotIds():
    readonly SnapshotSlotId[] {
    return this.slotIds;
  }
}

/**
 * Coordena capture e restore sem I/O.
 *
 * Restore sempre cria novos aggregates através dos codecs. Nenhum aggregate
 * existente é mutado durante o processo, portanto uma falha não deixa estado
 * parcialmente restaurado no chamador.
 */
export class SnapshotCoordinator {
  public constructor(
    private readonly registry:
      DomainSnapshotRegistry,
  ) {}

  public capture(
    bindings:
      readonly SnapshotCaptureBinding[],
  ): SnapshotBundleSnapshot {
    const seen =
      new Set<
        SnapshotSlotId
      >();

    const entries = [];

    for (
      const binding of
      bindings
    ) {
      if (
        seen.has(
          binding.slotId,
        )
      ) {
        throw new SnapshotCoordinatorError(
          "duplicate-binding",
          `SnapshotSlotId duplicado no capture: "${binding.slotId}".`,
          binding.slotId,
          binding.typeId,
        );
      }

      seen.add(
        binding.slotId,
      );

      const codec =
        this.registry.require(
          binding.typeId,
        );

      let state:
        unknown;

      try {
        state =
          codec.capture(
            binding.value,
          );
      } catch (error) {
        throw new SnapshotCoordinatorError(
          "capture-failed",
          `Falha ao capturar slot "${binding.slotId}" com codec "${binding.typeId}": ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
          binding.slotId,
          binding.typeId,
        );
      }

      entries.push({
        slotId:
          binding.slotId,
        typeId:
          binding.typeId,
        schemaVersion:
          codec.schemaVersion,
        state,
      });
    }

    return createSnapshotBundle(
      entries,
    );
  }

  public restore(
    bundle:
      unknown,
    contexts:
      SnapshotRestoreContexts =
        new Map(),
  ): RestoredSnapshotSet {
    const normalized =
      normalizeSnapshotBundle(
        bundle,
      );

    const bundleSlots =
      new Set<
        SnapshotSlotId
      >();

    for (
      const entry of
      normalized.entries
    ) {
      bundleSlots.add(
        createSnapshotSlotId(
          entry.slotId,
        ),
      );
    }

    for (
      const contextSlotId of
      contexts.keys()
    ) {
      if (
        !bundleSlots.has(
          contextSlotId,
        )
      ) {
        throw new SnapshotCoordinatorError(
          "unknown-context-slot",
          `Context fornecido para slot inexistente no bundle: "${contextSlotId}".`,
          contextSlotId,
        );
      }
    }

    const restored:
      [
        SnapshotSlotId,
        unknown,
      ][] = [];

    for (
      const entry of
      normalized.entries
    ) {
      const slotId =
        createSnapshotSlotId(
          entry.slotId,
        );

      const typeId =
        createSnapshotTypeId(
          entry.typeId,
        );

      const codec =
        this.registry.require(
          typeId,
        );

      if (
        entry.schemaVersion !==
        codec.schemaVersion
      ) {
        throw new SnapshotCoordinatorError(
          "unsupported-codec-schema",
          `Slot "${slotId}" usa schema ${String(entry.schemaVersion)}, mas codec "${typeId}" suporta ${String(codec.schemaVersion)}.`,
          slotId,
          typeId,
        );
      }

      let value:
        unknown;

      try {
        value =
          codec.restore(
            entry.state,
            contexts.get(
              slotId,
            ),
          );
      } catch (error) {
        throw new SnapshotCoordinatorError(
          "restore-failed",
          `Falha ao restaurar slot "${slotId}" com codec "${typeId}": ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
          slotId,
          typeId,
        );
      }

      restored.push([
        slotId,
        value,
      ]);
    }

    return new RestoredSnapshotSet(
      restored,
    );
  }
}
