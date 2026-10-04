import type {
  RuntimeSnapshotCodec,
} from "./SnapshotCodec";

import type {
  SnapshotTypeId,
} from "./SnapshotIds";

export type DomainSnapshotRegistryErrorCode =
  | "duplicate-snapshot-type"
  | "unknown-snapshot-type";

export class DomainSnapshotRegistryError
  extends Error {
  public readonly name =
    "DomainSnapshotRegistryError";

  public constructor(
    public readonly code:
      DomainSnapshotRegistryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareSnapshotTypeId(
  left:
    SnapshotTypeId,
  right:
    SnapshotTypeId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Registry imutável de codecs.
 *
 * Não existe register() em runtime. O conjunto de codecs é fechado no
 * construtor para tornar bootstrap e restore previsíveis.
 */
export class DomainSnapshotRegistry {
  private readonly codecs =
    new Map<
      SnapshotTypeId,
      RuntimeSnapshotCodec
    >();

  private readonly typeIds:
    readonly SnapshotTypeId[];

  public constructor(
    codecs:
      readonly RuntimeSnapshotCodec[],
  ) {
    for (
      const codec of codecs
    ) {
      if (
        this.codecs.has(
          codec.typeId,
        )
      ) {
        throw new DomainSnapshotRegistryError(
          "duplicate-snapshot-type",
          `SnapshotTypeId duplicado: "${codec.typeId}".`,
        );
      }

      this.codecs.set(
        codec.typeId,
        codec,
      );
    }

    this.typeIds =
      Object.freeze(
        [...this.codecs.keys()]
          .sort(
            compareSnapshotTypeId,
          ),
      );
  }

  public get size():
    number {
    return this.codecs.size;
  }

  public has(
    typeId:
      SnapshotTypeId,
  ): boolean {
    return this.codecs.has(
      typeId,
    );
  }

  public get(
    typeId:
      SnapshotTypeId,
  ): RuntimeSnapshotCodec | null {
    return (
      this.codecs.get(typeId) ??
      null
    );
  }

  public require(
    typeId:
      SnapshotTypeId,
  ): RuntimeSnapshotCodec {
    const codec =
      this.codecs.get(
        typeId,
      );

    if (
      codec === undefined
    ) {
      throw new DomainSnapshotRegistryError(
        "unknown-snapshot-type",
        `SnapshotTypeId desconhecido: "${typeId}".`,
      );
    }

    return codec;
  }

  public getTypeIds():
    readonly SnapshotTypeId[] {
    return this.typeIds;
  }
}
