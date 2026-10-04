import type { PluginContext } from "@core";
import { type NetworkApi } from "../../../tokens/net";
import { type SteamApi } from "../../../tokens/steam";
import type {
  EntitySnapshot,
  NetMode,
  NetworkStats,
  TransportType,
  StateReplicationApi,
} from "../../../contracts/net/types";
import { NetworkTransport } from "./NetworkTransport";
import { SteamP2PTransport } from "./SteamP2PTransport";
import { WebSocketTransport } from "./WebSocketTransport";
import { StateReplicator } from "./StateReplicator";

export class NetworkService
  implements NetworkApi {
  private currentMode:
    NetMode =
      "offline";

  private activeTransport:
    NetworkTransport;

  private readonly stateReplicator =
    new StateReplicator();

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
      !steamApi ||
      !steamApi.isAvailable
    ) {
      return;
    }

    if (
      this.activeTransport
        .type ===
      "steam_p2p"
    ) {
      return;
    }

    if (
      this.currentMode !==
      "offline"
    ) {
      return;
    }

    this.activeTransport
      .dispose();

    this.activeTransport =
      new SteamP2PTransport(
        steamApi,
      );

    this.bindTransportEvents();
  }

  public get mode():
    NetMode {
    return this.currentMode;
  }

  public get transportType():
    TransportType {
    return this.activeTransport
      .type;
  }

  public async startHost(
    _options?: {
      port?: number;
      maxClients?: number;
    },
  ): Promise<boolean> {
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
    await this.activeTransport
      .disconnect();

    this.currentMode =
      "offline";
  }

  public async sendTo(
    targetId: string,
    channel: number,
    data: Uint8Array,
    reliable: boolean = true,
  ): Promise<boolean> {
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
    const snapshot:
      EntitySnapshot = {
        entityId,

        type:
          state.type ??
          "default",

        position:
          state.position ?? {
            x: 0,
            y: 0,
            z: 0,
          },

        rotation:
          state.rotation ?? {
            x: 0,
            y: 0,
            z: 0,
            w: 1,
          },

        velocity:
          state.velocity ?? {
            x: 0,
            y: 0,
            z: 0,
          },

        sequence:
          state.sequence ??
          0,

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
    await this.activeTransport
      .pollPackets();
  }

  public dispose(): void {
    this.activeTransport
      .dispose();

    this.stateReplicator
      .clear();
  }

  private bindTransportEvents():
    void {
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
      );

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
                this.activeTransport
                  .type,
            },
          );
        },
      );

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
      );
  }
}
