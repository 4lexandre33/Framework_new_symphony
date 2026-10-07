// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import type {
  SteamApi,
  SteamUser,
} from "../src/tokens/steam";

import type {
  P2PSendType,
  SteamLobbyDetails,
  SteamLobbyType,
  SteamP2PPacket,
} from "../src/contracts/steam/net-types";

import type {
  EntitySnapshot,
} from "../src/contracts/net/types";

import {
  NetworkService,
} from "../src/engine/net/internal/NetworkService";

class ServiceSteamApi
  implements SteamApi {
  public isAvailable =
    true;

  public async checkAvailability():
    Promise<boolean> {
    return this.isAvailable;
  }

  public async getUser():
    Promise<SteamUser | null> {
    return null;
  }

  public async unlockAchievement(
    _achievementId: string,
  ): Promise<boolean> {
    return false;
  }

  public async setStat(
    _statName: string,
    _value: number,
  ): Promise<boolean> {
    return false;
  }

  public async storeStats():
    Promise<boolean> {
    return false;
  }

  public async createLobby(
    _lobbyType: SteamLobbyType,
    _maxMembers: number,
  ): Promise<SteamLobbyDetails | null> {
    return null;
  }

  public async sendP2PPacket(
    _targetSteamId: string,
    _data: Uint8Array,
    _sendType?: P2PSendType,
    _channel?: number,
  ): Promise<boolean> {
    return true;
  }

  public async readP2PPacket(
    _channel?: number,
  ): Promise<SteamP2PPacket | null> {
    return null;
  }
}

function entitySnapshot(
  sequence = 1,
): EntitySnapshot {
  return {
    entityId: "entity-a",
    type: "actor",
    position: {
      x: 5,
      y: 6,
      z: 7,
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    },
    velocity: {
      x: 1,
      y: 2,
      z: 3,
    },
    sequence,
    timestamp:
      sequence * 16,
  };
}

function createContext(
  emitted:
    Array<{
      type: string;
      payload: unknown;
    }>,
): PluginContext {
  return {
    events: {
      emit(
        type: string,
        payload: unknown,
      ): void {
        emitted.push({
          type,
          payload,
        });
      },
    },
  } as unknown as
    PluginContext;
}

describe(
  "Etapa 83 — NetworkService",
  () => {
    it(
      "troca para Steam apenas offline, conecta e emite peer event",
      async () => {
        const emitted:
          Array<{
            type: string;
            payload: unknown;
          }> = [];

        const service =
          new NetworkService(
            createContext(
              emitted,
            ),
          );

        const steam =
          new ServiceSteamApi();

        service.bindSteamCapability(
          steam,
        );

        expect(
          service.transportType,
        ).toBe("steam_p2p");

        await expect(
          service.connect(
            "76561198000000001",
          ),
        ).resolves.toBe(true);

        expect(service.mode).toBe(
          "client",
        );

        expect(
          emitted.some(
            (event) =>
              event.type ===
              "game.net.peer-connected",
          ),
        ).toBe(true);
      },
    );

    it(
      "disconnect limpa replicação e retorna a offline",
      async () => {
        const service =
          new NetworkService(
            createContext([]),
          );

        const steam =
          new ServiceSteamApi();

        service.bindSteamCapability(
          steam,
        );

        await service.connect(
          "76561198000000001",
        );

        service.registerEntity(
          "entity-a",
          entitySnapshot(),
        );

        expect(
          service.getInterpolatedState(
            "entity-a",
            1,
          ),
        ).not.toBeNull();

        await service.disconnect();

        expect(service.mode).toBe(
          "offline",
        );

        expect(
          service.getInterpolatedState(
            "entity-a",
            1,
          ),
        ).toBeNull();

        await expect(
          service.sendTo(
            "76561198000000001",
            0,
            new Uint8Array([1]),
          ),
        ).resolves.toBe(false);
      },
    );

    it(
      "updateEntityState preserva campos omitidos e avança sequence",
      () => {
        const service =
          new NetworkService(
            createContext([]),
          );

        service.registerEntity(
          "entity-a",
          entitySnapshot(10),
        );

        service.updateEntityState(
          "entity-a",
          {
            position: {
              x: 99,
              y: 6,
              z: 7,
            },
          },
        );

        const state =
          service.getInterpolatedState(
            "entity-a",
            1,
          );

        expect(state?.position.x).toBe(99);
        expect(state?.velocity).toEqual({
          x: 1,
          y: 2,
          z: 3,
        });
        expect(state?.sequence).toBe(11);
      },
    );

    it(
      "dispose é idempotente e impede novas operações",
      async () => {
        const service =
          new NetworkService(
            createContext([]),
          );

        service.dispose();
        service.dispose();

        await expect(
          service.startHost(),
        ).resolves.toBe(false);

        await expect(
          service.connect(
            "ws://localhost:7777",
          ),
        ).resolves.toBe(false);

        expect(service.mode).toBe(
          "offline",
        );
      },
    );
  },
);
