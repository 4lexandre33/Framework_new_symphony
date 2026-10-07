import type { Plugin, PluginContext } from "@core";
import { NetworkToken } from "../../tokens/net";
import { SteamToken } from "../../tokens/steam";
import { ConnectPeerCommand, DisconnectPeerCommand, NetPacketReceivedEvent, PeerConnectedEvent, PeerDisconnectedEvent, SendNetPacketCommand, WorldSnapshotEvent, type ConnectPeerRequest, type SendNetPacketRequest } from "../../contracts/net/types";
import { NetworkService } from "../../engine/net/internal/NetworkService";

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
      conflicts: [],
    },
  };

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