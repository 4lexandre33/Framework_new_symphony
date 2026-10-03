import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SteamBridgeService,
  createSteamPlugin,
} from "../src/plugins/steam/plugin";

import {
  SteamToken,
} from "../src/tokens/steam";

vi.mock(
  "@tauri-apps/api/core",
  () => ({
    invoke:
      vi.fn(
        async (
          command: string,
          args?:
            Record<
              string,
              unknown
            >,
        ): Promise<unknown> => {
          switch (command) {
            case "steam_is_initialized": {
              return true;
            }

            case "steam_get_user": {
              return {
                steamId:
                  "76561198765756356",

                personaName:
                  "TestPlayer",

                isOverlayEnabled:
                  true,
              };
            }

            case "steam_create_lobby": {
              const maxMembers =
                typeof args
                  ?.maxMembers ===
                "number"
                  ? args.maxMembers
                  : 4;

              return {
                lobbyId:
                  "lobby_76561198765756356_123456789",

                ownerSteamId:
                  "76561198765756356",

                memberCount:
                  1,

                maxMembers,
              };
            }

            case "steam_send_p2p_packet": {
              return true;
            }

            case "steam_read_p2p_packet": {
              const channel =
                typeof args
                  ?.channel ===
                "number"
                  ? args.channel
                  : 0;

              return {
                sourceSteamId:
                  "76561198000000000",

                channel,

                data: [
                  10,
                  20,
                  30,
                  40,
                  50,
                ],

                bytesReceived:
                  5,
              };
            }

            case "steam_unlock_achievement": {
              return true;
            }

            case "steam_set_stat": {
              return true;
            }

            case "steam_store_stats": {
              return true;
            }

            default: {
              return null;
            }
          }
        },
      ),
  }),
);

describe(
  "Camada 1: Steamworks P2P & Lobbies Integration Tests",
  (): void => {
    let steamService:
      SteamBridgeService;

    beforeEach(
      async (): Promise<void> => {
        vi.clearAllMocks();

        steamService =
          new SteamBridgeService();

        await steamService
          .checkAvailability();
      },
    );

    it(
      "deve confirmar que a Steamworks API está inicializada e disponível",
      async (): Promise<void> => {
        const isOnline =
          await steamService
            .checkAvailability();

        expect(
          isOnline,
        ).toBe(
          true,
        );

        expect(
          steamService.isAvailable,
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve recuperar os dados do usuário autenticado no formato camelCase",
      async (): Promise<void> => {
        const user =
          await steamService
            .getUser();

        expect(
          user,
        ).not.toBeNull();

        expect(
          user?.steamId,
        ).toBe(
          "76561198765756356",
        );

        expect(
          user?.personaName,
        ).toBe(
          "TestPlayer",
        );

        expect(
          user
            ?.isOverlayEnabled,
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve criar um lobby multiplayer da Steam com sucesso",
      async (): Promise<void> => {
        const lobby =
          await steamService
            .createLobby(
              "public",
              4,
            );

        expect(
          lobby,
        ).not.toBeNull();

        expect(
          lobby?.lobbyId,
        ).toContain(
          "lobby_76561198765756356",
        );

        expect(
          lobby?.maxMembers,
        ).toBe(
          4,
        );

        expect(
          lobby?.memberCount,
        ).toBe(
          1,
        );
      },
    );

    it(
      "deve enviar pacotes P2P brutos de dados para um SteamID remoto",
      async (): Promise<void> => {
        const payload =
          new Uint8Array([
            1,
            2,
            3,
          ]);

        const success =
          await steamService
            .sendP2PPacket(
              "76561198000000000",
              payload,
              "reliable",
              0,
            );

        expect(
          success,
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve ler o próximo pacote P2P disponível da fila de rede",
      async (): Promise<void> => {
        const packet =
          await steamService
            .readP2PPacket(
              0,
            );

        expect(
          packet,
        ).not.toBeNull();

        expect(
          packet
            ?.sourceSteamId,
        ).toBe(
          "76561198000000000",
        );

        expect(
          packet?.channel,
        ).toBe(
          0,
        );

        expect(
          packet
            ?.bytesReceived,
        ).toBe(
          5,
        );

        expect(
          packet?.data,
        ).toEqual(
          new Uint8Array([
            10,
            20,
            30,
            40,
            50,
          ]),
        );
      },
    );

    it(
      "deve registrar o plugin da Steam no Kernel com manifesto versão 1.1.0 e SteamToken",
      (): void => {
        const plugin =
          createSteamPlugin();

        expect(
          plugin.manifest.id,
        ).toBe(
          "game.steam",
        );

        expect(
          plugin.manifest.version,
        ).toBe(
          "1.1.0",
        );

        const providedCapabilities =
          plugin.manifest
            .capabilities
            ?.provides ??
          [];

        expect(
          providedCapabilities.some(
            (
              capability,
            ): boolean =>
              capability.id ===
                SteamToken.id &&
              capability.version ===
                "1.1.0",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);