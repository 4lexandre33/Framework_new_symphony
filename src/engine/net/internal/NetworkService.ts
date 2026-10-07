import type {
  PluginContext,
} from "@core";

import type {
  NetworkApi,
} from "../../../tokens/net";

import type {
  SteamApi,
} from "../../../tokens/steam";

import type {
  EntitySnapshot,
  NetMode,
  NetworkStats,
  StateReplicationApi,
  TransportType,
} from "../../../contracts/net/types";

import type {
  NetworkTransport,
} from "./NetworkTransport";

import {
  SteamP2PTransport,
} from "./SteamP2PTransport";

import {
  WebSocketTransport,
} from "./WebSocketTransport";

import {
  StateReplicator,
} from "./StateReplicator";

export class NetworkService
  implements NetworkApi {
  private currentMode:
    NetMode =
      "offline";

  private activeTransport:
    NetworkTransport;

  private readonly stateReplicator =
    new StateReplicator();

  private readonly transportUnbinders:
    Array<() => void> =
      [];

  private pollInFlight =
    false;

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.activeTransport =
      new WebSocketTransport();

    this.bindTransportEvents();
  }

  public bindSteamCapability(
    steamApi:
      SteamApi | undefined,
  ): void {
    if (
      this.disposed ||
      !steamApi ||
      !steamApi.isAvailable ||
      this.activeTransport.type ===
        "steam_p2p" ||
      this.currentMode !==
        "offline"
    ) {
      return;
    }

    this.unbindTransportEvents();

    this.activeTransport.dispose();

    this.activeTransport =
      new SteamP2PTransport(
        steamApi,
      );

    this.stateReplicator.clear();

    this.bindTransportEvents();
  }

  public get mode():
    NetMode {
    return this.currentMode;
  }

  public get transportType():
    TransportType {
    return this.activeTransport.type;
  }

  public async startHost(
    _options?: {
      port?: number;
      maxClients?: number;
    },
  ): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    if (
      this.activeTransport.type ===
      "websocket"
    ) {
      return false;
    }

    if (
      this.currentMode !==
      "offline"
    ) {
      await this.disconnect();
    }

    const initialized =
      await this.activeTransport
        .initialize();

    if (initialized) {
      this.currentMode =
        "host";
    }

    return initialized;
  }

  public async connect(
    target: string,
  ): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    if (
      this.currentMode !==
      "offline"
    ) {
      await this.disconnect();
    }

    const connected =
      await this.activeTransport
        .connect(
          target,
        );

    if (connected) {
      this.currentMode =
        "client";
    }

    return connected;
  }

  public async disconnect():
    Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.activeTransport
      .disconnect();

    this.currentMode =
      "offline";

    this.stateReplicator.clear();
  }

  public async sendTo(
    targetId: string,
    channel: number,
    data: Uint8Array,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.currentMode ===
        "offline"
    ) {
      return false;
    }

    return await this.activeTransport
      .send(
        targetId,
        data,
        channel,
        reliable,
      );
  }

  public async broadcast(
    channel: number,
    data: Uint8Array,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      this.disposed ||
      this.currentMode ===
        "offline"
    ) {
      return false;
    }

    return await this.activeTransport
      .broadcast(
        data,
        channel,
        reliable,
      );
  }

  public getStats():
    NetworkStats {
    return this.activeTransport
      .getStats();
  }

  public getStateReplicator():
    StateReplicationApi {
    return this.stateReplicator;
  }

  public registerEntity(
    entityId: string,
    initialSnapshot:
      EntitySnapshot,
  ): void {
    if (this.disposed) {
      return;
    }

    this.stateReplicator
      .registerEntity(
        entityId,
        initialSnapshot,
      );
  }

  public unregisterEntity(
    entityId: string,
  ): void {
    this.stateReplicator
      .unregisterEntity(
        entityId,
      );
  }

  public updateEntityState(
    entityId: string,
    state:
      Partial<EntitySnapshot>,
  ): void {
    if (this.disposed) {
      return;
    }

    const previous =
      this.stateReplicator
        .getInterpolatedState(
          entityId,
          1,
        );

    const snapshot:
      EntitySnapshot = {
        entityId,
        type:
          state.type ??
          previous?.type ??
          "default",
        position:
          state.position ??
          previous?.position ?? {
            x: 0,
            y: 0,
            z: 0,
          },
        rotation:
          state.rotation ??
          previous?.rotation ?? {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          },
        velocity:
          state.velocity ??
          previous?.velocity ?? {
            x: 0,
            y: 0,
            z: 0,
          },
        sequence:
          state.sequence ??
          (
            previous?.sequence ??
            -1
          ) +
            1,
        timestamp:
          state.timestamp ??
          performance.now(),
      };

    this.stateReplicator
      .pushEntitySnapshot(
        snapshot,
      );
  }

  public getInterpolatedState(
    entityId: string,
    renderAlpha: number,
  ): EntitySnapshot | null {
    return this.stateReplicator
      .getInterpolatedState(
        entityId,
        renderAlpha,
      );
  }

  public async pollPackets():
    Promise<void> {
    if (
      this.disposed ||
      this.pollInFlight
    ) {
      return;
    }

    this.pollInFlight =
      true;

    try {
      await this.activeTransport
        .pollPackets();
    } finally {
      this.pollInFlight =
        false;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed =
      true;

    this.currentMode =
      "offline";

    this.pollInFlight =
      false;

    this.unbindTransportEvents();

    this.activeTransport.dispose();

    this.stateReplicator.clear();
  }

  private bindTransportEvents():
    void {
    this.transportUnbinders.push(
      this.activeTransport
        .onPacket(
          (
            senderId,
            channel,
            data,
          ): void => {
            this.ctx.events.emit(
              "game.net.packet-received",
              {
                senderId,
                channel,
                data,
              },
            );
          },
        ),
    );

    this.transportUnbinders.push(
      this.activeTransport
        .onPeerConnected(
          (
            peerId,
          ): void => {
            this.ctx.events.emit(
              "game.net.peer-connected",
              {
                peerId,
                transport:
                  this.activeTransport.type,
              },
            );
          },
        ),
    );

    this.transportUnbinders.push(
      this.activeTransport
        .onPeerDisconnected(
          (
            peerId,
            reason,
          ): void => {
            this.ctx.events.emit(
              "game.net.peer-disconnected",
              {
                peerId,
                reason,
              },
            );
          },
        ),
    );
  }

  private unbindTransportEvents():
    void {
    for (
      let index =
        this.transportUnbinders.length -
        1;
      index >= 0;
      index -= 1
    ) {
      this.transportUnbinders[
        index
      ]?.();
    }

    this.transportUnbinders.length =
      0;
  }
}
