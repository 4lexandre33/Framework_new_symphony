import {
  createFactionId,
} from "./FactionId";

import type {
  FactionId,
} from "./FactionId";

export type FactionDisposition =
  | "hostile"
  | "unfriendly"
  | "neutral"
  | "friendly"
  | "allied";

export interface FactionRelation {
  readonly sourceFactionId:
    FactionId;
  readonly targetFactionId:
    FactionId;
  readonly disposition:
    FactionDisposition;
}

export interface FactionRelationSnapshot {
  readonly sourceFactionId:
    string;
  readonly targetFactionId:
    string;
  readonly disposition:
    FactionDisposition;
}

export type FactionRelationErrorCode =
  | "invalid-disposition"
  | "invalid-snapshot";

export class FactionRelationError
  extends Error {
  public readonly name =
    "FactionRelationError";

  public constructor(
    public readonly code:
      FactionRelationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isFactionDisposition(
  value: unknown,
): value is FactionDisposition {
  return (
    value === "hostile" ||
    value === "unfriendly" ||
    value === "neutral" ||
    value === "friendly" ||
    value === "allied"
  );
}

/**
 * Relação direcional entre duas facções.
 *
 * source -> target não implica target -> source.
 */
export function createFactionRelation(
  sourceFactionId:
    FactionId,
  targetFactionId:
    FactionId,
  disposition:
    FactionDisposition,
): FactionRelation {
  if (
    !isFactionDisposition(
      disposition,
    )
  ) {
    throw new FactionRelationError(
      "invalid-disposition",
      `FactionDisposition inválida: "${String(disposition)}".`,
    );
  }

  return Object.freeze({
    sourceFactionId,
    targetFactionId,
    disposition,
  });
}

export function factionRelationToSnapshot(
  relation:
    FactionRelation,
): FactionRelationSnapshot {
  return Object.freeze({
    sourceFactionId:
      relation.sourceFactionId,
    targetFactionId:
      relation.targetFactionId,
    disposition:
      relation.disposition,
  });
}

export function factionRelationFromSnapshot(
  snapshot:
    FactionRelationSnapshot,
): FactionRelation {
  try {
    return createFactionRelation(
      createFactionId(
        snapshot.sourceFactionId,
      ),
      createFactionId(
        snapshot.targetFactionId,
      ),
      snapshot.disposition,
    );
  } catch (error) {
    throw new FactionRelationError(
      "invalid-snapshot",
      `FactionRelationSnapshot inválido: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}
