// @vitest-environment node

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

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

import {
  MAX_NETWORK_PACKET_BYTES,
  NETWORK_BACKPRESSURE_HIGH_WATER_BYTES,
  STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL,
} from "../src/engine/net/internal/NetworkPacketValidator";

import {
  SteamP2PTransport,
} from "../src/engine/net/internal/SteamP2PTransport";

import {
  WebSocketTransport,
} from "../src/engine/net/internal/WebSocketTransport";

class FakeWebSocket {
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;

  public static readonly instances:
    FakeWebSocket[] = [];

  public binaryType:
    BinaryType =
      "blob";

  public readyState =
    0;

  public bufferedAmount =
    0;

  public onopen:
    ((event: Event) => void) | null =
      null;

  public onmessage:
    ((event: MessageEvent) => void) | null =
      null;

  public onerror:
    ((event: Event) => void) | null =
      null;

  public onclose:
    ((event: CloseEvent) => void) | null =
      null;

  public readonly sent:
    Uint8Array[] = [];

  public constructor(
    public readonly url: string,
  ) {
    FakeWebSocket.instances.push(
      this,
    );
  }

  public open(): void {
    this.readyState =
      FakeWebSocket.OPEN;

    this.onopen?.(
      {} as Event,
    );
  }

  public message(
    data: Uint8Array,
  ): void {
    const copied =
      data.slice();

    this.onmessage?.(
      {
        data:
          copied.buffer,
      } as MessageEvent,
    );
  }

  public send(
    data: ArrayBufferView | ArrayBuffer | Blob | string,
  ): void {
    if (
      this.readyState !==
      FakeWebSocket.OPEN
    ) {
      throw new Error(
        "socket fechado",
      );
    }

    if (
      typeof data ===
        "string" ||
      data instanceof Blob
    ) {
      throw new Error(
        "teste aceita apenas binário",
      );
    }

    if (
      data instanceof
      ArrayBuffer
    ) {
      this.sent.push(
        new Uint8Array(
          data,
        ).slice(),
      );
      return;
    }

    this.sent.push(
      new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ).slice(),
    );
  }

  public close(): void {
    const callback =
      this.onclose;

    this.readyState =
      FakeWebSocket.CLOSED;

    callback?.(
      {} as CloseEvent,
    );
  }
}

class FakeSteamApi
  implements SteamApi {
  public isAvailable =
    true;

  public readonly sent:
    Array<{
      targetSteamId: string;
      data: Uint8Array;
      sendType: P2PSendType;
      channel: number;
    }> = [];

  public readonly packets:
    SteamP2PPacket[] = [];

  private sendBarrier:
    Promise<void> | null =
      null;

  private releaseSendBarrier:
    (() => void) | null =
      null;

  public holdSends(): void {
    this.sendBarrier =
      new Promise<void>(
        (resolve) => {
          this.releaseSendBarrier =
            resolve;
        },
      );
  }

  public releaseSends(): void {
    this.releaseSendBarrier?.();
    this.releaseSendBarrier =
      null;
    this.sendBarrier =
      null;
  }

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
    targetSteamId: string,
    data: Uint8Array,
    sendType:
      P2PSendType =
        "unreliable",
    channel = 0,
  ): Promise<boolean> {
    this.sent.push({
      targetSteamId,
      data:
        data.slice(),
      sendType,
      channel,
    });

    if (this.sendBarrier) {
      await this.sendBarrier;
    }

    return true;
  }

  public async readP2PPacket(
    channel = 0,
  ): Promise<SteamP2PPacket | null> {
    const index =
      this.packets.findIndex(
        (packet) =>
          packet.channel ===
          channel,
      );

    if (index < 0) {
      return null;
    }

    return (
      this.packets.splice(
        index,
        1,
      )[0] ??
      null
    );
  }
}

const originalWebSocket =
  globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances.length =
    0;

  Object.defineProperty(
    globalThis,
    "WebSocket",
    {
      configurable: true,
      writable: true,
      value:
        FakeWebSocket,
    },
  );
});

afterEach(() => {
  Object.defineProperty(
    globalThis,
    "WebSocket",
    {
      configurable: true,
      writable: true,
      value:
        originalWebSocket,
    },
  );
});

describe(
  "Etapa 83 — WebSocketTransport",
  () => {
    it(
      "conecta, desconecta e reconecta sem manter socket antigo",
      async () => {
        const transport =
          new WebSocketTransport();

        const firstConnect =
          transport.connect(
            "ws://localhost:7777",
          );

        const firstSocket =
          FakeWebSocket.instances[0];

        expect(firstSocket).toBeDefined();

        firstSocket?.open();

        await expect(
          firstConnect,
        ).resolves.toBe(true);

        expect(
          transport.isConnected,
        ).toBe(true);

        await transport.disconnect();

        expect(
          transport.isConnected,
        ).toBe(false);

        const secondConnect =
          transport.connect(
            "wss://example.test/game",
          );

        const secondSocket =
          FakeWebSocket.instances[1];

        expect(secondSocket).toBeDefined();
        expect(secondSocket).not.toBe(
          firstSocket,
        );

        secondSocket?.open();

        await expect(
          secondConnect,
        ).resolves.toBe(true);

        expect(
          transport.isConnected,
        ).toBe(true);

        transport.dispose();

        expect(
          transport.isConnected,
        ).toBe(false);
      },
    );

    it(
      "cancela connect pendente ao iniciar nova tentativa",
      async () => {
        const transport =
          new WebSocketTransport();

        const firstConnect =
          transport.connect(
            "ws://localhost:7001",
          );

        const secondConnect =
          transport.connect(
            "ws://localhost:7002",
          );

        await expect(
          firstConnect,
        ).resolves.toBe(false);

        const secondSocket =
          FakeWebSocket.instances[1];

        secondSocket?.open();

        await expect(
          secondConnect,
        ).resolves.toBe(true);

        expect(
          transport.isConnected,
        ).toBe(true);
      },
    );

    it(
      "preserva byteOffset e bloqueia payload/backpressure inválidos",
      async () => {
        const transport =
          new WebSocketTransport();

        const connecting =
          transport.connect(
            "ws://localhost:7777",
          );

        const socket =
          FakeWebSocket.instances[0];

        socket?.open();

        await connecting;

        const backing =
          new Uint8Array([
            9,
            8,
            1,
            2,
            3,
            7,
          ]);

        const view =
          backing.subarray(
            2,
            5,
          );

        await expect(
          transport.send(
            "dedicated_server",
            view,
            0,
            true,
          ),
        ).resolves.toBe(true);

        expect(
          socket?.sent[0],
        ).toEqual(
          new Uint8Array([
            1,
            2,
            3,
          ]),
        );

        if (socket) {
          socket.bufferedAmount =
            NETWORK_BACKPRESSURE_HIGH_WATER_BYTES;
        }

        await expect(
          transport.send(
            "dedicated_server",
            new Uint8Array([1]),
            0,
            true,
          ),
        ).resolves.toBe(false);

        await expect(
          transport.send(
            "dedicated_server",
            new Uint8Array(
              MAX_NETWORK_PACKET_BYTES +
                1,
            ),
            0,
            true,
          ),
        ).resolves.toBe(false);

        await expect(
          transport.send(
            "dedicated_server",
            new Uint8Array([1]),
            999,
            true,
          ),
        ).resolves.toBe(false);
      },
    );

    it(
      "descarta frame binário acima do limite antes de emitir",
      async () => {
        const transport =
          new WebSocketTransport();

        let received =
          0;

        transport.onPacket(
          () => {
            received += 1;
          },
        );

        const connecting =
          transport.connect(
            "ws://localhost:7777",
          );

        const socket =
          FakeWebSocket.instances[0];

        socket?.open();
        await connecting;

        socket?.message(
          new Uint8Array([1, 2, 3]),
        );

        expect(received).toBe(1);

        socket?.message(
          new Uint8Array(
            MAX_NETWORK_PACKET_BYTES +
              1,
          ),
        );

        expect(received).toBe(1);
      },
    );
  },
);

describe(
  "Etapa 83 — SteamP2PTransport",
  () => {
    it(
      "é reconectável e limpa peers no disconnect",
      async () => {
        const steam =
          new FakeSteamApi();

        const transport =
          new SteamP2PTransport(
            steam,
          );

        const connectedPeers:
          string[] = [];

        const disconnectedPeers:
          string[] = [];

        transport.onPeerConnected(
          (peerId) => {
            connectedPeers.push(
              peerId,
            );
          },
        );

        transport.onPeerDisconnected(
          (peerId) => {
            disconnectedPeers.push(
              peerId,
            );
          },
        );

        await expect(
          transport.connect(
            "76561198000000001",
          ),
        ).resolves.toBe(true);

        expect(
          connectedPeers,
        ).toEqual([
          "76561198000000001",
        ]);

        await transport.disconnect();

        expect(
          transport.getStats()
            .activeConnections,
        ).toBe(0);

        expect(
          disconnectedPeers,
        ).toEqual([
          "76561198000000001",
        ]);

        await expect(
          transport.connect(
            "76561198000000001",
          ),
        ).resolves.toBe(true);
      },
    );

    it(
      "limita drenagem de pacotes por poll e rejeita pacote corrompido",
      async () => {
        const steam =
          new FakeSteamApi();

        const transport =
          new SteamP2PTransport(
            steam,
          );

        await transport.initialize();

        let received =
          0;

        transport.onPacket(
          () => {
            received += 1;
          },
        );

        steam.packets.push({
          sourceSteamId:
            "76561198000000001",
          channel: 0,
          data:
            new Uint8Array([1]),
          bytesReceived: 2,
        });

        for (
          let index = 0;
          index <
          STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL +
            5;
          index += 1
        ) {
          steam.packets.push({
            sourceSteamId:
              "76561198000000001",
            channel: 0,
            data:
              new Uint8Array([1]),
            bytesReceived: 1,
          });
        }

        await transport.pollPackets();

        expect(received).toBe(
          STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL -
            1,
        );

        expect(
          steam.packets.length,
        ).toBe(6);
      },
    );

    it(
      "aplica backpressure sobre bytes pendentes concorrentes",
      async () => {
        const steam =
          new FakeSteamApi();

        steam.holdSends();

        const transport =
          new SteamP2PTransport(
            steam,
          );

        await transport.initialize();

        const oneMiB =
          new Uint8Array(
            MAX_NETWORK_PACKET_BYTES,
          );

        const first =
          transport.send(
            "76561198000000001",
            oneMiB,
            0,
            true,
          );

        const second =
          transport.send(
            "76561198000000002",
            oneMiB,
            0,
            true,
          );

        await expect(
          transport.send(
            "76561198000000003",
            new Uint8Array([1]),
            0,
            true,
          ),
        ).resolves.toBe(false);

        steam.releaseSends();

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
      },
    );

    it(
      "recusa envio inválido antes da bridge Steam",
      async () => {
        const steam =
          new FakeSteamApi();

        const transport =
          new SteamP2PTransport(
            steam,
          );

        await transport.initialize();

        await expect(
          transport.send(
            "",
            new Uint8Array([1]),
            0,
            true,
          ),
        ).resolves.toBe(false);

        await expect(
          transport.send(
            "76561198000000001",
            new Uint8Array(
              MAX_NETWORK_PACKET_BYTES +
                1,
            ),
            0,
            true,
          ),
        ).resolves.toBe(false);

        expect(
          steam.sent,
        ).toHaveLength(0);
      },
    );
  },
);
