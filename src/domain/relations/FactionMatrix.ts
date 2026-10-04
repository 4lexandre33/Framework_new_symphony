import type {
  FactionId,
} from "./FactionId";

import {
  createFactionRelation,
  factionRelationFromSnapshot,
  factionRelationToSnapshot,
  isFactionDisposition,
} from "./FactionRelation";

import type {
  FactionDisposition,
  FactionRelation,
  FactionRelationSnapshot,
} from "./FactionRelation";

export interface FactionMatrixSnapshot {
  readonly defaultDisposition:
    FactionDisposition;
  readonly relations:
    readonly FactionRelationSnapshot[];
}

export type FactionMatrixErrorCode =
  | "duplicate-relation"
  | "invalid-default-disposition"
  | "invalid-snapshot";

export class FactionMatrixError
  extends Error {
  public readonly name =
    "FactionMatrixError";

  public constructor(
    public readonly code:
      FactionMatrixErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareFactionId(
  left: FactionId,
  right: FactionId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Matriz direcional de relações entre facções.
 *
 * Relações ausentes retornam defaultDisposition, mas `hasExplicit()` permite
 * distinguir "default" de uma entrada explicitamente configurada.
 */
export class FactionMatrix {
  private readonly rows =
    new Map<
      FactionId,
      Map<
        FactionId,
        FactionDisposition
      >
    >();

  public readonly defaultDisposition:
    FactionDisposition;

  private relationCountValue =
    0;

  public constructor(
    defaultDisposition:
      FactionDisposition =
        "neutral",
  ) {
    if (
      !isFactionDisposition(
        defaultDisposition,
      )
    ) {
      throw new FactionMatrixError(
        "invalid-default-disposition",
        `defaultDisposition inválida: "${String(defaultDisposition)}".`,
      );
    }

    this.defaultDisposition =
      defaultDisposition;
  }

  public static fromSnapshot(
    snapshot:
      FactionMatrixSnapshot,
  ): FactionMatrix {
    let matrix:
      FactionMatrix;

    try {
      matrix =
        new FactionMatrix(
          snapshot
            .defaultDisposition,
        );
    } catch (error) {
      throw new FactionMatrixError(
        "invalid-snapshot",
        `FactionMatrixSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    for (
      const relationSnapshot of
      snapshot.relations
    ) {
      let relation:
        FactionRelation;

      try {
        relation =
          factionRelationFromSnapshot(
            relationSnapshot,
          );
      } catch (error) {
        throw new FactionMatrixError(
          "invalid-snapshot",
          `FactionMatrix relation inválida: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      if (
        matrix.hasExplicit(
          relation.sourceFactionId,
          relation.targetFactionId,
        )
      ) {
        throw new FactionMatrixError(
          "duplicate-relation",
          `Relação duplicada: "${relation.sourceFactionId}" -> "${relation.targetFactionId}".`,
        );
      }

      matrix.setRelation(
        relation,
      );
    }

    return matrix;
  }

  public get size():
    number {
    return this.relationCountValue;
  }

  public get isEmpty():
    boolean {
    return (
      this.relationCountValue ===
      0
    );
  }

  public hasExplicit(
    sourceFactionId:
      FactionId,
    targetFactionId:
      FactionId,
  ): boolean {
    return (
      this.rows
        .get(
          sourceFactionId,
        )
        ?.has(
          targetFactionId,
        ) ??
      false
    );
  }

  public get(
    sourceFactionId:
      FactionId,
    targetFactionId:
      FactionId,
  ): FactionDisposition {
    return (
      this.rows
        .get(
          sourceFactionId,
        )
        ?.get(
          targetFactionId,
        ) ??
      this.defaultDisposition
    );
  }

  public set(
    sourceFactionId:
      FactionId,
    targetFactionId:
      FactionId,
    disposition:
      FactionDisposition,
  ): void {
    this.setRelation(
      createFactionRelation(
        sourceFactionId,
        targetFactionId,
        disposition,
      ),
    );
  }

  public setRelation(
    relation:
      FactionRelation,
  ): void {
    let row =
      this.rows.get(
        relation
          .sourceFactionId,
      );

    if (
      row === undefined
    ) {
      row =
        new Map<
          FactionId,
          FactionDisposition
        >();

      this.rows.set(
        relation
          .sourceFactionId,
        row,
      );
    }

    if (
      !row.has(
        relation
          .targetFactionId,
      )
    ) {
      this.relationCountValue +=
        1;
    }

    row.set(
      relation
        .targetFactionId,
      relation.disposition,
    );
  }

  public delete(
    sourceFactionId:
      FactionId,
    targetFactionId:
      FactionId,
  ): boolean {
    const row =
      this.rows.get(
        sourceFactionId,
      );

    if (
      row === undefined ||
      !row.delete(
        targetFactionId,
      )
    ) {
      return false;
    }

    this.relationCountValue -=
      1;

    if (
      row.size === 0
    ) {
      this.rows.delete(
        sourceFactionId,
      );
    }

    return true;
  }

  public clear(): void {
    this.rows.clear();
    this.relationCountValue =
      0;
  }

  public forEach(
    visitor: (
      sourceFactionId:
        FactionId,
      targetFactionId:
        FactionId,
      disposition:
        FactionDisposition,
    ) => void,
  ): void {
    for (
      const [
        sourceFactionId,
        row,
      ] of this.rows
    ) {
      for (
        const [
          targetFactionId,
          disposition,
        ] of row
      ) {
        visitor(
          sourceFactionId,
          targetFactionId,
          disposition,
        );
      }
    }
  }

  /**
   * Snapshot determinístico ordenado por source -> target.
   */
  public toSnapshot():
    FactionMatrixSnapshot {
    const sourceIds =
      [...this.rows.keys()]
        .sort(
          compareFactionId,
        );

    const relations:
      FactionRelationSnapshot[] =
        [];

    for (
      const sourceFactionId of
      sourceIds
    ) {
      const row =
        this.rows.get(
          sourceFactionId,
        );

      if (
        row === undefined
      ) {
        continue;
      }

      const targetIds =
        [...row.keys()]
          .sort(
            compareFactionId,
          );

      for (
        const targetFactionId of
        targetIds
      ) {
        const disposition =
          row.get(
            targetFactionId,
          );

        if (
          disposition ===
          undefined
        ) {
          continue;
        }

        relations.push(
          factionRelationToSnapshot(
            createFactionRelation(
              sourceFactionId,
              targetFactionId,
              disposition,
            ),
          ),
        );
      }
    }

    return Object.freeze({
      defaultDisposition:
        this.defaultDisposition,
      relations:
        Object.freeze(
          relations,
        ),
    });
  }
}
