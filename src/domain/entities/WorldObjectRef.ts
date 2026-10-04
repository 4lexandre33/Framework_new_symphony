import type {
  WorldObjectId,
} from "./WorldObjectId";

export interface WorldObjectRef {
  readonly worldObjectId:
    WorldObjectId;
}

export function createWorldObjectRef(
  worldObjectId:
    WorldObjectId,
): WorldObjectRef {
  return Object.freeze({
    worldObjectId,
  });
}

export function sameWorldObjectRef(
  left: WorldObjectRef,
  right: WorldObjectRef,
): boolean {
  return (
    left.worldObjectId ===
    right.worldObjectId
  );
}
