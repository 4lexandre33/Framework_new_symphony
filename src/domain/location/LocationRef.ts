import type {
  LocationId,
} from "./LocationId";

export interface LocationRef {
  readonly locationId:
    LocationId;
}

export function createLocationRef(
  locationId: LocationId,
): LocationRef {
  return Object.freeze({
    locationId,
  });
}

export function sameLocationRef(
  left: LocationRef,
  right: LocationRef,
): boolean {
  return (
    left.locationId ===
    right.locationId
  );
}
