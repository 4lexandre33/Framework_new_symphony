import type { Plugin, PluginContext } from "@core";
import { SteamToken } from "../../tokens/steam";
import { SteamNetworkToken } from "../../tokens/steam-net";
import {
  SteamAvailabilityChangedEvent,
  SteamMicroTxnAuthorizationEvent,
  SteamStatsReadyEvent,
  SteamWorkshopDownloadResultEvent,
  UnlockAchievementCommand,
} from "../../contracts/steam/types";
import {
  AcceptP2PSessionCommand,
  CreateLobbyCommand,
  JoinLobbyCommand,
  LeaveLobbyCommand,
  LobbyCreatedEvent,
  LobbyDataUpdatedEvent,
  LobbyInviteReceivedEvent,
  LobbyJoinedEvent,
  LobbyMemberLeftEvent,
  P2PMessageReceivedEvent,
  P2PSessionFailedEvent,
  P2PSessionRequestEvent,
  SendP2PPacketCommand,
  type P2PSendType,
  type SteamLobbyType,
} from "../../contracts/steam/net-types";
import {
  SteamBridgeService,
  type SteamNativeEvent,
} from "../../engine/steam/internal/SteamBridgeService";

const STEAM_EVENTS = [
  P2PMessageReceivedEvent.type,
  P2PSessionRequestEvent.type,
  P2PSessionFailedEvent.type,
  LobbyCreatedEvent.type,
  LobbyJoinedEvent.type,
  LobbyMemberLeftEvent.type,
  LobbyDataUpdatedEvent.type,
  LobbyInviteReceivedEvent.type,
  SteamAvailabilityChangedEvent.type,
  SteamStatsReadyEvent.type,
  SteamMicroTxnAuthorizationEvent.type,
  SteamWorkshopDownloadResultEvent.type,
];

export const steamManifest: Plugin["manifest"] = {
  id: "game.steam",
  name: "Steamworks Integration Plugin",
  version: "1.1.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [SteamToken.id, SteamNetworkToken.id],
    events: STEAM_EVENTS,
  },
  capabilities: {
    provides: [
      {
        id: SteamToken.id,
        version: "1.1.0",
      },
      {
        // G109: lobbies/P2P reais via steamworks; sem Steam degrada para indisponível.
        id: SteamNetworkToken.id,
        version: "1.0.0",
      },
    ],
    conflicts: [],
  },
};

/**
 * Traduz um evento nativo drenado de `steam_poll_events` em eventos do
 * kernel (`game.steam.*`). Exportado para testes.
 */
export function forwardSteamNativeEvent(ctx: PluginContext, event: SteamNativeEvent): void {
  switch (event.kind) {
    case "p2pSessionRequest":
      ctx.events.emit(P2PSessionRequestEvent.type, { remoteSteamId: event.remoteSteamId });
      return;
    case "p2pSessionConnectFail":
      ctx.events.emit(P2PSessionFailedEvent.type, {
        remoteSteamId: event.remoteSteamId,
        error: event.error,
      });
      return;
    case "lobbyChatUpdate":
      if (event.change === "entered") {
        ctx.events.emit(LobbyJoinedEvent.type, {
          lobbyId: event.lobbyId,
          memberSteamId: event.userSteamId,
        });
      } else {
        ctx.events.emit(LobbyMemberLeftEvent.type, {
          lobbyId: event.lobbyId,
          memberSteamId: event.userSteamId,
        });
      }
      return;
    case "lobbyDataUpdate":
      ctx.events.emit(LobbyDataUpdatedEvent.type, {
        lobbyId: event.lobbyId,
        memberSteamId: event.memberSteamId,
        success: event.success,
      });
      return;
    case "lobbyJoinRequested":
      ctx.events.emit(LobbyInviteReceivedEvent.type, {
        lobbyId: event.lobbyId,
        friendSteamId: event.friendSteamId,
      });
      return;
    case "userStatsReceived":
      if (event.success) {
        ctx.events.emit(SteamStatsReadyEvent.type, { steamId: event.steamId });
      }
      return;
    case "microTxnAuthorization":
      ctx.events.emit(SteamMicroTxnAuthorizationEvent.type, {
        appId: event.appId,
        orderId: event.orderId,
        authorized: event.authorized,
      });
      return;
    case "workshopDownloadResult":
      ctx.events.emit(SteamWorkshopDownloadResultEvent.type, {
        publishedFileId: event.publishedFileId,
        success: event.success,
        ...(event.error ? { error: event.error } : {}),
      });
      return;
    case "eventsDropped":
      ctx.log.warn("Fila de eventos nativos da Steam transbordou; eventos antigos descartados.", {
        count: event.count,
      });
      return;
    default:
      return;
  }
}

export interface SteamPluginOptions {
  /** Intervalo do pump de eventos nativos (padrão 50 ms). */
  readonly eventPumpIntervalMs?: number;
  /** Serviço injetado (testes). */
  readonly service?: SteamBridgeService;
  /**
   * Quando `true`, o pump também drena pacotes P2P e emite
   * `game.steam.p2p-received`. Deixe `false` (padrão) se `game.net` usa o
   * transporte Steam: ele drena os pacotes (que também geram
   * `game.steam.p2p-received`, pois todo pacote lido pelo bridge é emitido).
   */
  readonly autoReadP2P?: boolean;
}

export function createSteamPlugin(options: SteamPluginOptions = {}): Plugin {
  let bootService: SteamBridgeService | null = null;

  const manifest: Plugin["manifest"] = {
    ...steamManifest,
    lifecycleHooks: {
      // G112: disponibilidade resolvida no boot, antes dos consumidores começarem.
      onBoot: async (): Promise<void> => {
        await bootService?.checkAvailability();
      },
    },
  };

  return {
    manifest,

    setup(ctx: PluginContext) {
      const steamService = options.service ?? new SteamBridgeService();
      const service = steamService;
      bootService = service;

      ctx.caps.provide(SteamToken, steamService);
      ctx.caps.provide(SteamNetworkToken, steamService);

      ctx.events.define(P2PMessageReceivedEvent);
      ctx.events.define(P2PSessionRequestEvent);
      ctx.events.define(P2PSessionFailedEvent);
      ctx.events.define(LobbyCreatedEvent);
      ctx.events.define(LobbyJoinedEvent);
      ctx.events.define(LobbyMemberLeftEvent);
      ctx.events.define(LobbyDataUpdatedEvent);
      ctx.events.define(LobbyInviteReceivedEvent);
      ctx.events.define(SteamAvailabilityChangedEvent);
      ctx.events.define(SteamStatsReadyEvent);
      ctx.events.define(SteamMicroTxnAuthorizationEvent);
      ctx.events.define(SteamWorkshopDownloadResultEvent);
      ctx.commands.define(UnlockAchievementCommand);
      ctx.commands.define(CreateLobbyCommand);
      ctx.commands.define(JoinLobbyCommand);
      ctx.commands.define(LeaveLobbyCommand);
      ctx.commands.define(SendP2PPacketCommand);
      ctx.commands.define(AcceptP2PSessionCommand);

      const unbindNative = service.onNativeEvent((event) => {
        forwardSteamNativeEvent(ctx, event);
      });

      const unbindPackets = service.onP2PPacket((packet) => {
        ctx.events.emit(P2PMessageReceivedEvent.type, {
          sourceSteamId: packet.sourceSteamId,
          channel: packet.channel,
          data: packet.data,
          bytesReceived: packet.bytesReceived,
        });
      });

      let p2pTimer: ReturnType<typeof setInterval> | null = null;
      const startP2PReader = (): void => {
        if (options.autoReadP2P !== true || p2pTimer !== null) return;
        let inFlight = false;
        p2pTimer = setInterval(() => {
          if (inFlight || !service.isAvailable) return;
          inFlight = true;
          void service.readP2PPackets().finally(() => {
            inFlight = false;
          });
        }, options.eventPumpIntervalMs ?? 50);
      };
      const stopP2PReader = (): void => {
        if (p2pTimer !== null) {
          clearInterval(p2pTimer);
          p2pTimer = null;
        }
      };

      const unbindAvailability = service.onAvailabilityChanged((isAvailable) => {
        ctx.events.emit(SteamAvailabilityChangedEvent.type, { isAvailable });
        if (isAvailable) {
          service.startEventPump(options.eventPumpIntervalMs);
          startP2PReader();
        } else {
          service.stopEventPump();
          stopP2PReader();
        }
      });

      // A verificação do construtor pode já ter terminado antes do listener.
      if (service.isAvailabilityResolved) {
        ctx.events.emit(SteamAvailabilityChangedEvent.type, { isAvailable: service.isAvailable });
        if (service.isAvailable) {
          service.startEventPump(options.eventPumpIntervalMs);
          startP2PReader();
        }
      }

      const handlers = [
        ctx.commands.handle<"game.steam.unlock-achievement", { achievementId: string }>(
          UnlockAchievementCommand.type,
          async (env) => {
            const isOnline = await service.checkAvailability();
            if (!isOnline) return false;
            return await service.unlockAchievement(env.payload.achievementId);
          },
        ),
        ctx.commands.handle<"game.steam.create-lobby", { lobbyType: SteamLobbyType; maxMembers: number }>(
          CreateLobbyCommand.type,
          async (env) => {
            const res = await service.createLobby(env.payload.lobbyType, env.payload.maxMembers);
            ctx.events.emit(LobbyCreatedEvent.type, {
              lobbyId: res?.lobbyId ?? "",
              isSuccess: res !== null,
              ...(res === null ? { error: service.isAvailable ? "create_lobby_failed" : "steam_unavailable" } : {}),
            });
            // G29: send/request entregam o retorno — detalhes do lobby (ou null).
            return res;
          },
        ),
        ctx.commands.handle<"game.steam.join-lobby", { lobbyId: string }>(JoinLobbyCommand.type, async (env) => {
          return await service.joinLobby(env.payload.lobbyId);
        }),
        ctx.commands.handle<"game.steam.leave-lobby", { lobbyId: string }>(LeaveLobbyCommand.type, async (env) => {
          return await service.leaveLobby(env.payload.lobbyId);
        }),
        ctx.commands.handle<"game.steam.accept-p2p-session", { remoteSteamId: string }>(
          AcceptP2PSessionCommand.type,
          async (env) => {
            return await service.acceptP2PSession(env.payload.remoteSteamId);
          },
        ),
        ctx.commands.handle<
          "game.steam.send-p2p-packet",
          { targetSteamId: string; data: Uint8Array; sendType: P2PSendType; channel: number }
        >(SendP2PPacketCommand.type, async (env) => {
          return await service.sendP2PPacket(
            env.payload.targetSteamId,
            env.payload.data,
            env.payload.sendType,
            env.payload.channel,
          );
        }),
      ];

      ctx.lifecycle.onDispose(() => {
        for (const unbind of handlers) unbind();
        unbindNative();
        unbindPackets();
        unbindAvailability();
        stopP2PReader();
        service.dispose();
        if (bootService === service) bootService = null;
      });

      ctx.lifecycle.ready();
    },
  };
}
