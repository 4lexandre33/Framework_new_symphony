import {
  defineCapability,
} from "@core";

import type {
  EntitySnapshot,
  NetMode,
  NetworkStats,
  TransportType,
  StateReplicationApi,
} from "../contracts/net/types";


export interface NetworkApi {
  readonly mode:
    NetMode;

  readonly transportType:
    TransportType;

  startHost(
    options?: {
      port?: number;
      maxClients?: number;
    },
  ): Promise<boolean>;

  connect(
    targetAddressOrSteamId:
      string,
  ): Promise<boolean>;

  disconnect():
    Promise<void>;

  sendTo(
    targetId: string,
    channel: number,
    data: Uint8Array,
    reliable?: boolean,
  ): Promise<boolean>;

  broadcast(
    channel: number,
    data: Uint8Array,
    reliable?: boolean,
  ): Promise<boolean>;

  getStats():
    NetworkStats;

  getStateReplicator():
    StateReplicationApi;

  registerEntity(
    entityId: string,
    initialSnapshot:
      EntitySnapshot,
  ): void;

  unregisterEntity(
    entityId: string,
  ): void;

  updateEntityState(
    entityId: string,
    state:
      Partial<EntitySnapshot>,
  ): void;

  getInterpolatedState(
    entityId: string,
    renderAlpha: number,
  ): EntitySnapshot | null;
}

export const NetworkToken =
  defineCapability<NetworkApi>(
    "game.net",
    "1.0.0",
  );