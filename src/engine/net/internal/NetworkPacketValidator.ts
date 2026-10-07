import type {
  EntitySnapshot,
  NetQuaternion,
  NetVector3,
} from "../../../contracts/net/types";

export const MAX_NETWORK_PACKET_BYTES =
  1024 * 1024;

export const MAX_NETWORK_CHANNEL =
  255;

export const NETWORK_BACKPRESSURE_HIGH_WATER_BYTES =
  2 * 1024 * 1024;

export const STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL =
  128;

export const STEAM_POLL_CHANNEL_COUNT =
  2;

function isFiniteNumber(
  value: number,
): boolean {
  return Number.isFinite(value);
}

function isValidVector3(
  value: NetVector3,
): boolean {
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isValidQuaternion(
  value: NetQuaternion,
): boolean {
  if (
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.w)
  ) {
    return false;
  }

  const lengthSquared =
    value.x * value.x +
    value.y * value.y +
    value.z * value.z +
    value.w * value.w;

  return lengthSquared > 0.000000000001;
}

export function isValidNetworkChannel(
  channel: number,
): boolean {
  return (
    Number.isInteger(channel) &&
    channel >= 0 &&
    channel <= MAX_NETWORK_CHANNEL
  );
}

export function isValidNetworkPeerId(
  peerId: string,
): boolean {
  const normalized =
    peerId.trim();

  return (
    normalized.length > 0 &&
    normalized.length <= 128
  );
}

export function isValidNetworkPayload(
  data: Uint8Array,
): boolean {
  return (
    data.byteLength >= 0 &&
    data.byteLength <=
      MAX_NETWORK_PACKET_BYTES
  );
}

export function isValidEntitySnapshot(
  snapshot: EntitySnapshot,
): boolean {
  return (
    isValidNetworkPeerId(
      snapshot.entityId,
    ) &&
    snapshot.type.trim().length > 0 &&
    snapshot.type.length <= 128 &&
    isValidVector3(
      snapshot.position,
    ) &&
    isValidQuaternion(
      snapshot.rotation,
    ) &&
    isValidVector3(
      snapshot.velocity,
    ) &&
    Number.isSafeInteger(
      snapshot.sequence,
    ) &&
    snapshot.sequence >= 0 &&
    isFiniteNumber(
      snapshot.timestamp,
    ) &&
    snapshot.timestamp >= 0
  );
}

export function isNewerSequence(
  nextSequence: number,
  previousSequence: number,
): boolean {
  return (
    Number.isSafeInteger(
      nextSequence,
    ) &&
    nextSequence >
      previousSequence
  );
}
