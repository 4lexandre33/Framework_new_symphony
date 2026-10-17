import type { Plugin, PluginContext } from "@core";
import { NetworkToken } from "../../tokens/net";
import { SteamToken } from "../../tokens/steam";
import { SteamNetworkToken } from "../../tokens/steam-net";
import { BroadcastSnapshotCommand, ConnectPeerCommand, DisconnectPeerCommand, NetPacketReceivedEvent, PeerConnectedEvent, PeerDisconnectedEvent, SendNetPacketCommand, WorldSnapshotEvent, type BroadcastSnapshotRequest, type ConnectPeerRequest, type SendNetPacketRequest } from "../../contracts/net/types";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { NetworkService, type NetworkServiceOptions } from "../../engine/net/internal/NetworkService";

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
        SteamNetworkToken.id,
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
        {
          id:
            SteamNetworkToken.id,

          range:
            "^1.0.0",

          optional:
            true,
        },
      ],
      conflicts: [],
    },
  };

export function createNetworkPlugin(
  serviceOptions: NetworkServiceOptions = {},
):
  Plugin {
  let networkService:
    NetworkService | null =
      null;

  const manifest:
    Plugin["manifest"] = {
      ...netManifest,

      lifecycleHooks: {
        ...netManifest.lifecycleHooks,

        async onBoot(
          ctx:
            PluginContext,
        ): Promise<void> {
          if (!networkService) {
            throw new Error(
              "NetworkService não foi criado durante setup().",
            );
          }

          const steamApi =
            ctx.caps.get(
              SteamToken,
            );

          if (steamApi) {
            await steamApi
              .checkAvailability();
          }

          networkService
            .bindSteamCapability(
              steamApi,
            );

          networkService
            .bindSteamNetwork(
              ctx.caps.get(
                SteamNetworkToken,
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
          serviceOptions,
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

      ctx.commands.define(
        BroadcastSnapshotCommand,
      );

      const unbindTick =
        ctx.events.on<"game.loop.tick", GameTickPayload>(
          "game.loop.tick",
          (envelope): void => {
            service.onTick(
              envelope.payload?.tickCount ?? 0,
            );
          },
        );

      // Steam P2P: host aceita sessões de clientes; falha derruba o par.
      const unbindSessionRequest =
        ctx.events.on<"game.steam.p2p-session-request", { remoteSteamId: string }>(
          "game.steam.p2p-session-request",
          (envelope): void => {
            void service.handleSteamSessionRequest(
              envelope.payload.remoteSteamId,
            );
          },
        );

      const unbindSessionFailed =
        ctx.events.on<"game.steam.p2p-session-failed", { remoteSteamId: string }>(
          "game.steam.p2p-session-failed",
          (envelope): void => {
            service.handleSteamSessionFailed(
              envelope.payload.remoteSteamId,
            );
          },
        );

      const unbindBroadcastSnapshot =
        ctx.commands.handle(
          BroadcastSnapshotCommand.type,
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                BroadcastSnapshotRequest;

            return service.broadcastSnapshot(
              payload.snapshot,
            );
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
          unbindSessionRequest();
          unbindSessionFailed();
          unbindBroadcastSnapshot();
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