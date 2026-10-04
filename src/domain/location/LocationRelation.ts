import type {
  LocationId,
} from "./LocationId";

export type LocationRelationKind =
  | "contains"
  | "connected-to"
  | "parent"
  | "child"
  | "neighbor";

export interface LocationRelation {
  readonly kind:
    LocationRelationKind;
  readonly from:
    LocationId;
  readonly to:
    LocationId;
}

export type LocationRelationErrorCode =
  | "self-relation";

export class LocationRelationError
  extends Error {
  public readonly name =
    "LocationRelationError";

  public constructor(
    public readonly code:
      LocationRelationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function isSymmetricLocationRelationKind(
  kind:
    LocationRelationKind,
): boolean {
  return (
    kind === "connected-to" ||
    kind === "neighbor"
  );
}

export function createLocationRelation(
  kind: LocationRelationKind,
  from: LocationId,
  to: LocationId,
): LocationRelation {
  if (from === to) {
    throw new LocationRelationError(
      "self-relation",
      `Location relation "${kind}" não pode referenciar o mesmo LocationId em from/to: "${from}".`,
    );
  }

  return Object.freeze({
    kind,
    from,
    to,
  });
}
