import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  NetworkToken,
  type NetworkApi,
} from "../../tokens/net";

import {
  SteamToken,
  type SteamApi,
} from "../../tokens/steam";

import {
  ConnectPeerCommand,
  DisconnectPeerCommand,
  NetPacketReceivedEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  SendNetPacketCommand,
  WorldSnapshotEvent,
  type ConnectPeerRequest,
  type EntitySnapshot,
  type NetMode,
  type NetworkStats,
  type SendNetPacketRequest,
  type TransportType,
} from "../../contracts/net/types";

import {
  NetworkTransport,
} from "../../engine/net/NetworkTransport";

import {
  SteamP2PTransport,
} from "../../engine/net/SteamP2PTransport";

import {
  WebSocketTransport,
} from "../../engine/net/WebSocketTransport";

import {
  StateReplicator,
} from "../../engine/net/StateReplicator";

export const netManifest:
  Plugin["manifest"] = {
    id:
      "game.net",

    name:
      "Multiplayer Network & State Replication Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    dependsOn: [
      {
        id:
          "game.loop",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        NetworkToken.id,
        SteamToken.id,
      ],

      events: [
        "game.net.packet-received",
        "game.net.peer-connected",
        "game.net.peer-disconnected",
        "game.net.snapshot",
        "game.loop.tick",
        "game.loop.render",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            NetworkToken.id,

          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            SteamToken.id,

          range:
            "^1.0.0",

          optional:
            true,
        },
      ],
    },
  };

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
    StateReplicator {
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

export function createNetworkPlugin():
  Plugin {
  let networkService:
    NetworkService | null =
      null;

  const manifest:
    Plugin["manifest"] = {
      ...netManifest,

      lifecycleHooks: {
        ...netManifest.lifecycleHooks,

        onBoot(
          ctx:
            PluginContext,
        ): void {
          if (!networkService) {
            throw new Error(
              "NetworkService não foi criado durante setup().",
            );
          }

          networkService
            .bindSteamCapability(
              ctx.caps.get(
                SteamToken,
              ),
            );
        },
      },
    };

  return {
    manifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const service =
        new NetworkService(
          ctx,
        );

      networkService =
        service;

      ctx.caps.provide(
        NetworkToken,
        service,
      );

      ctx.events.define(
        NetPacketReceivedEvent,
      );

      ctx.events.define(
        PeerConnectedEvent,
      );

      ctx.events.define(
        PeerDisconnectedEvent,
      );

      ctx.events.define(
        WorldSnapshotEvent,
      );

      ctx.commands.define(
        SendNetPacketCommand,
      );

      ctx.commands.define(
        ConnectPeerCommand,
      );

      ctx.commands.define(
        DisconnectPeerCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (): void => {
            void service
              .pollPackets();
          },
        );

      const unbindSend =
        ctx.commands.handle(
          SendNetPacketCommand.type,
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SendNetPacketRequest;

            return service
              .sendTo(
                payload.targetId,
                payload.channel,
                payload.data,
                payload.reliable,
              );
          },
        );

      const unbindConnect =
        ctx.commands.handle(
          ConnectPeerCommand.type,
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                ConnectPeerRequest;

            return service
              .connect(
                payload.targetId,
              );
          },
        );

      const unbindDisconnect =
        ctx.commands.handle(
          DisconnectPeerCommand.type,
          () => {
            return service
              .disconnect();
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindSend();
          unbindConnect();
          unbindDisconnect();

          service.dispose();

          if (
            networkService ===
            service
          ) {
            networkService =
              null;
          }
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
