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


/** Dois SteamApi ligados em memória (entrega na fila do outro lado). */
class LinkedSteamApi
  extends ServiceSteamApi {
  private peer:
    LinkedSteamApi | null =
      null;

  public readonly inbox:
    SteamP2PPacket[] = [];

  public constructor(
    public readonly steamId: string,
  ) {
    super();
  }

  public link(
    other: LinkedSteamApi,
  ): void {
    this.peer = other;
    other.peer = this;
  }

  public override async getUser():
    Promise<SteamUser | null> {
    return {
      steamId: this.steamId,
      personaName: this.steamId,
      isOverlayEnabled: false,
    };
  }

  public override async sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    _sendType?: P2PSendType,
    channel = 0,
  ): Promise<boolean> {
    if (!this.peer || this.peer.steamId !== targetSteamId) {
      return false;
    }
    this.peer.inbox.push({
      sourceSteamId: this.steamId,
      channel,
      data: data.slice(),
      bytesReceived: data.byteLength,
    });
    return true;
  }

  public async readP2PPackets():
    Promise<ReadonlyArray<SteamP2PPacket>> {
    return this.inbox.splice(0, this.inbox.length);
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
    // G105: "conectado" só depois do WELCOME do host (antes o connect Steam
    // resolvia true sem contatar ninguém). O teste agora liga dois pares Steam.
    it(
      "troca para Steam apenas offline, conecta com handshake e emite peer event",
      async () => {
        const emitted:
          Array<{
            type: string;
            payload: unknown;
          }> = [];

        const hostSteam =
          new LinkedSteamApi("76561198000000009");
        const clientSteam =
          new LinkedSteamApi("76561198000000001");
        hostSteam.link(clientSteam);

        const host =
          new NetworkService(
            createContext([]),
            { backgroundPump: false },
          );
        const service =
          new NetworkService(
            createContext(
              emitted,
            ),
            { backgroundPump: false },
          );

        host.bindSteamCapability(hostSteam);
        service.bindSteamCapability(
          clientSteam,
        );

        expect(
          service.transportType,
        ).toBe("steam_p2p");

        await expect(host.startHost()).resolves.toBe(true);

        const connecting =
          service.connect(
            "76561198000000009",
          );

        for (let i = 0; i < 10; i += 1) {
          await host.pollPackets();
          await service.pollPackets();
        }

        await expect(connecting).resolves.toBe(true);

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

    // G107: disconnect preserva entidades locais (só as remotas saem).
    it(
      "disconnect preserva entidades locais e retorna a offline",
      async () => {
        const service =
          new NetworkService(
            createContext([]),
            { backgroundPump: false },
          );

        const steam =
          new ServiceSteamApi();

        service.bindSteamCapability(
          steam,
        );

        service.registerEntity(
          "entity-a",
          entitySnapshot(),
        );

        await service.disconnect();

        expect(service.mode).toBe(
          "offline",
        );

        expect(
          service.getInterpolatedState(
            "entity-a",
            1,
          ),
        ).not.toBeNull();

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
