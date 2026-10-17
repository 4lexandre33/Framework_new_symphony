// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { PluginContext } from "@core";

import type { EntitySnapshot, WorldStateSnapshot } from "../src/contracts/net/types";
import type { SteamApi, SteamUser } from "../src/tokens/steam";
import type { P2PSendType, SteamLobbyDetails, SteamLobbyType, SteamP2PPacket } from "../src/contracts/steam/net-types";
import { NetworkService } from "../src/engine/net/internal/NetworkService";
import { LoopbackTransport } from "../src/engine/net/internal/LoopbackTransport";
import { BroadcastChannelTransport } from "../src/engine/net/internal/BroadcastChannelTransport";
import { SteamP2PTransport } from "../src/engine/net/internal/SteamP2PTransport";
import { StateReplicator, slerpQuaternion } from "../src/engine/net/internal/StateReplicator";
import {
  FRAME_FRAGMENT,
  decodeFrame,
  decodeSnapshotPayload,
  encodeDataFrame,
  encodeSnapshotPayload,
} from "../src/engine/net/internal/NetProtocol";
import { createNetworkPlugin, netManifest } from "../src/plugins/net/plugin";

type Emitted = Array<{ type: string; payload: unknown }>;

function ctxWith(emitted: Emitted): PluginContext {
  return {
    events: {
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
    },
  } as unknown as PluginContext;
}

let clock = 0;
const now = (): number => clock;
const services: NetworkService[] = [];

function makeService(emitted: Emitted = [], options: ConstructorParameters<typeof NetworkService>[1] = {}): NetworkService {
  const service = new NetworkService(ctxWith(emitted), { now, ...options });
  services.push(service);
  return service;
}

async function pump(list: NetworkService[], rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    for (const service of list) await service.pollPackets();
  }
}

async function connectPair(
  host: NetworkService,
  client: NetworkService,
  target = "loopback://7777",
): Promise<boolean> {
  const connecting = client.connect(target);
  await pump([host, client], 6);
  return connecting;
}

function entity(id: string, sequence: number, x = 0, rotation = { x: 0, y: 0, z: 0, w: 1 }): EntitySnapshot {
  return {
    entityId: id,
    type: "actor",
    position: { x, y: 0, z: 0 },
    rotation,
    velocity: { x: 0, y: 0, z: 0 },
    sequence,
    timestamp: sequence,
  };
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  clock = 0;
});

describe("net gaps", () => {
  it("G8: host sem Steam (loopback) + handshake + troca de dados", async () => {
    const hostEvents: Emitted = [];
    const clientEvents: Emitted = [];
    const host = makeService(hostEvents);
    const client = makeService(clientEvents);

    expect(await host.startHost()).toBe(true);
    expect(host.mode).toBe("host");
    expect(host.transportType).toBe("mock");
    expect(await connectPair(host, client)).toBe(true);
    expect(client.mode).toBe("client");

    const clientPeer = host.getPeers()[0]?.peerId ?? "";
    expect(hostEvents.some((e) => e.type === "game.net.peer-connected")).toBe(true);
    expect(clientEvents.some((e) => e.type === "game.net.peer-connected")).toBe(true);

    expect(await client.broadcast(200, new Uint8Array([1, 2, 3]))).toBe(true);
    await pump([host]);
    const received = hostEvents.find((e) => e.type === "game.net.packet-received")?.payload as {
      senderId: string;
      channel: number;
      data: Uint8Array;
    };
    expect(received.senderId).toBe(clientPeer);
    expect(received.channel).toBe(200);
    expect(Array.from(received.data)).toEqual([1, 2, 3]);
  });

  it("G8: snapshot automático do host e game.net.snapshot no cliente", async () => {
    const clientEvents: Emitted = [];
    const host = makeService();
    const client = makeService(clientEvents);
    await host.startHost({ room: "snap" });
    expect(await connectPair(host, client, "loopback://snap")).toBe(true);

    host.registerEntity("a", entity("a", 1, 5));
    host.registerEntity("b", entity("b", 1, 7));
    expect(host.setAutoSnapshot({ enabled: true, intervalTicks: 2 })).toBe(true);
    expect(host.setAutoSnapshot({ enabled: true, intervalTicks: 0 })).toBe(false);

    host.onTick(1);
    await pump([host, client]);
    expect(clientEvents.some((e) => e.type === "game.net.snapshot")).toBe(false);

    host.onTick(2);
    await pump([host, client]);
    await pump([host, client]);
    const snapshotEvent = clientEvents.find((e) => e.type === "game.net.snapshot");
    expect((snapshotEvent?.payload as { snapshot: WorldStateSnapshot }).snapshot.entities).toHaveLength(2);
    expect(client.getInterpolatedState("a", 1)?.position.x).toBe(5);

    // G107: entidade removida no host some do cliente no próximo snapshot
    host.unregisterEntity("b");
    host.onTick(4);
    await pump([host, client]);
    await pump([host, client]);
    expect(client.getInterpolatedState("b", 1)).toBeNull();
    expect(client.getInterpolatedState("a", 1)).not.toBeNull();
  });

  it("G104: mensagem confiável grande é fragmentada e remontada; não confiável grande é recusada", async () => {
    const hostEvents: Emitted = [];
    const host = makeService(hostEvents);
    const client = makeService();
    await host.startHost();
    expect(await connectPair(host, client)).toBe(true);

    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 251;
    expect(await client.broadcast(9, big, true)).toBe(true);
    await pump([host], 2);
    const packet = hostEvents.find((e) => e.type === "game.net.packet-received")?.payload as {
      channel: number;
      data: Uint8Array;
    };
    expect(packet.channel).toBe(9);
    expect(packet.data.byteLength).toBe(200_000);
    expect(packet.data[199_999]).toBe(199_999 % 251);

    expect(await client.broadcast(9, big, false)).toBe(false);
    expect(await client.sendTo("nobody", 0, new Uint8Array([1]))).toBe(false);
    expect(await client.broadcast(256, new Uint8Array([1]))).toBe(false);
  });

  it("G104: transporte Steam lê todos os canais via leitura em lote", async () => {
    const steam = new BatchSteam();
    const transport = new SteamP2PTransport(steam);
    await transport.initialize();
    const channels: number[] = [];
    transport.onPacket((_sender, channel) => channels.push(channel));
    steam.inbox.push(packet(0), packet(7), packet(255));
    await transport.pollPackets();
    expect(channels).toEqual([0, 7, 255]);
    expect(transport.maxFrameBytes(false)).toBe(1_200);
  });

  it("G105: queda silenciosa detectada por heartbeat; cliente volta a offline", async () => {
    const hostEvents: Emitted = [];
    const clientEvents: Emitted = [];
    let hostTransport: LoopbackTransport | null = null;
    const host = makeService(hostEvents, {
      createTransport: {
        mock: () => {
          hostTransport = new LoopbackTransport({ now });
          return hostTransport;
        },
      },
    });
    const client = makeService(clientEvents);
    host.configure({ heartbeatIntervalMs: 100, peerTimeoutMs: 500 });
    client.configure({ heartbeatIntervalMs: 100, peerTimeoutMs: 500 });
    await host.startHost();
    expect(await connectPair(host, client)).toBe(true);

    // rede "cai": nada mais é entregue em nenhuma direção
    (hostTransport as unknown as LoopbackTransport).packetFilter = () => false;
    const clientLoop = (client as unknown as { activeTransport: LoopbackTransport }).activeTransport;
    clientLoop.packetFilter = () => false;

    for (let step = 0; step < 8; step += 1) {
      clock += 100;
      await pump([host, client], 1);
    }

    expect(hostEvents.some((e) => e.type === "game.net.peer-disconnected" && (e.payload as { reason: string }).reason === "timeout")).toBe(true);
    expect(clientEvents.some((e) => e.type === "game.net.peer-disconnected")).toBe(true);
    expect(client.mode).toBe("offline");
    expect(host.getPeers()).toHaveLength(0);
  });

  it("G105: connect sem host / sem resposta falha; BYE avisa o host; maxClients é imposto", async () => {
    const lonely = makeService();
    expect(await lonely.connect("loopback://ninguem")).toBe(false);
    expect(lonely.mode).toBe("offline");

    const hostEvents: Emitted = [];
    const host = makeService(hostEvents);
    await host.startHost({ maxClients: 1, room: "full" });

    const first = makeService();
    const second = makeService();
    first.configure({ handshakeTimeoutMs: 300 });
    second.configure({ handshakeTimeoutMs: 300 });
    expect(await connectPair(host, first, "loopback://full")).toBe(true);
    expect(await connectPair(host, second, "loopback://full")).toBe(false);
    expect(host.getPeers()).toHaveLength(1);

    await first.disconnect();
    await pump([host]);
    expect(
      hostEvents.some((e) => e.type === "game.net.peer-disconnected" && (e.payload as { reason: string }).reason === "remote_bye"),
    ).toBe(true);

    // host que nunca responde: timeout de handshake
    const mute = makeService(
      [],
      {
        createTransport: {
          mock: () => {
            const transport = new LoopbackTransport({ now });
            transport.packetFilter = () => false;
            return transport;
          },
        },
      },
    );
    await mute.startHost({ room: "mute" });
    const waiting = makeService();
    waiting.configure({ handshakeTimeoutMs: 200 });
    const attempt = waiting.connect("loopback://mute");
    for (let step = 0; step < 5; step += 1) {
      clock += 100;
      await pump([mute, waiting], 1);
    }
    expect(await attempt).toBe(false);
  });

  it("G106: seleção de transporte explícita e honesta", async () => {
    const steam = new BatchSteam();
    const service = makeService();
    service.bindSteamCapability(steam);
    expect(service.transportType).toBe("steam_p2p");

    expect(service.setPreferredTransport("webrtc")).toBe(false);
    expect(service.setPreferredTransport("mock")).toBe(true);
    expect(service.getAvailableTransports()).toEqual(expect.arrayContaining(["mock", "steam_p2p"]));
    expect(await service.startHost({ transport: "websocket" })).toBe(false);
    expect(await service.startHost({ port: 70_000 })).toBe(false);
    expect(await service.startHost({ maxClients: 0 })).toBe(false);

    const noSteam = makeService();
    expect(await noSteam.connect("76561198000000009")).toBe(false);
    expect(await noSteam.connect("ftp://x")).toBe(false);
  });

  it("G107: slerp com correção de sinal e replicador com autoria", () => {
    const out = { x: 0, y: 0, z: 0, w: 1 };
    // q e -q são a mesma rotação: interpolar entre eles deve ficar parado
    slerpQuaternion(0, 0, 0, 1, 0, 0, 0, -1, 0.5, out);
    expect(Math.abs(out.w)).toBeCloseTo(1, 6);

    const s = Math.SQRT1_2;
    slerpQuaternion(0, 0, 0, 1, 0, -s, 0, -s, 0.5, out); // 90° em Y com sinal invertido
    const angle = 2 * Math.acos(Math.min(1, Math.abs(out.w)));
    expect(angle).toBeCloseTo(Math.PI / 4, 4);

    const replicator = new StateReplicator();
    replicator.registerEntity("mine", entity("mine", 1));
    replicator.processWorldSnapshot(
      { sequence: 5, tick: 1, timestamp: 1, hostSteamId: "host", entities: [entity("mine", 9, 99), entity("r1", 1), entity("r2", 1)] },
      "host",
    );
    expect(replicator.getInterpolatedState("mine", 1)?.position.x).toBe(0);
    expect(replicator.getEntityOwner("r1")).toBe("host");

    // snapshot antigo ignorado (não remove nada)
    replicator.processWorldSnapshot({ sequence: 4, tick: 1, timestamp: 1, hostSteamId: "host", entities: [] }, "host");
    expect(replicator.getInterpolatedState("r1", 1)).not.toBeNull();

    replicator.processWorldSnapshot({ sequence: 6, tick: 2, timestamp: 2, hostSteamId: "host", entities: [entity("r1", 2)] }, "host");
    expect(replicator.getInterpolatedState("r2", 1)).toBeNull();
    expect(replicator.getInterpolatedState("mine", 1)).not.toBeNull();

    replicator.clearRemote();
    expect(replicator.getInterpolatedState("r1", 1)).toBeNull();
    expect(replicator.getInterpolatedState("mine", 1)).not.toBeNull();
  });

  it("G107: bind da Steam e connect não apagam entidades locais", async () => {
    const service = makeService();
    service.registerEntity("mine", entity("mine", 1));
    service.bindSteamCapability(new BatchSteam());
    expect(await service.connect("loopback://nada")).toBe(false);
    expect(service.getInterpolatedState("mine", 1)).not.toBeNull();
  });

  it("G108: RTT e perda reais, getStats não destrutivo", async () => {
    let hostTransport: LoopbackTransport | null = null;
    const host = makeService([], {
      createTransport: {
        mock: () => {
          hostTransport = new LoopbackTransport({ now });
          return hostTransport;
        },
      },
    });
    const client = makeService();
    host.configure({ heartbeatIntervalMs: 100, peerTimeoutMs: 10_000 });
    client.configure({ heartbeatIntervalMs: 100, peerTimeoutMs: 10_000 });
    await host.startHost();
    expect(await connectPair(host, client)).toBe(true);

    for (let step = 0; step < 3; step += 1) {
      clock += 100;
      await host.pollPackets(); // envia ping
      await client.pollPackets(); // responde pong
      clock += 40;
      await host.pollPackets(); // recebe pong 40 ms depois
    }

    const stats = host.getStats();
    expect(stats.rttMs).toBeGreaterThanOrEqual(39);
    expect(stats.rttMs).toBeLessThanOrEqual(41);
    expect(stats.packetLossRate).toBe(0);
    expect(stats.activeConnections).toBe(1);
    expect(stats.bytesSentPerSec).toBeGreaterThan(0);
    expect(host.getStats()).toEqual(stats);

    // pongs perdidos contam como perda
    const clientLoop = (client as unknown as { activeTransport: LoopbackTransport }).activeTransport;
    clientLoop.packetFilter = () => false;
    for (let step = 0; step < 6; step += 1) {
      clock += 100;
      await pump([host, client], 1);
    }
    expect(host.getStats().packetLossRate).toBeGreaterThan(0);
  });

  it("G108: startHost honra port (sala) e maxClients", async () => {
    const host = makeService();
    expect(await host.startHost({ port: 9100, maxClients: 2 })).toBe(true);
    const other = makeService();
    expect(await other.startHost({ port: 9100 })).toBe(false); // sala ocupada
    const client = makeService();
    expect(await connectPair(host, client, "loopback://9100")).toBe(true);
    expect(await makeService().connect("loopback://7777")).toBe(false);
  });

  it("BroadcastChannel: host/cliente pelo protocolo de sessão", async () => {
    const channels = new Map<string, Set<FakeChannel>>();
    const factory = (name: string): FakeChannel => new FakeChannel(name, channels);
    const make = (): NetworkService =>
      makeService([], { createTransport: { broadcast_channel: () => new BroadcastChannelTransport({ factory, now }) } });
    const host = make();
    const client = make();
    expect(await host.startHost({ transport: "broadcast_channel", room: "lan" })).toBe(true);
    expect(await connectPair(host, client, "bc://lan")).toBe(true);
    expect(client.transportType).toBe("broadcast_channel");
  });

  it("G105/G106: WebSocket faz handshake real, honra canal e detecta queda por erro", async () => {
    const sockets: FakeSocket[] = [];
    class FakeSocket {
      public binaryType = "blob";
      public readyState = 0;
      public bufferedAmount = 0;
      public onopen: (() => void) | null = null;
      public onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: (() => void) | null = null;
      public readonly sent: Uint8Array[] = [];
      public constructor(public readonly url: string) {
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      public send(data: Uint8Array): void {
        this.sent.push(data.slice());
        const frame = decodeFrame(data);
        if (frame?.type === 3 && this.url.includes("good")) {
          // servidor de referência: responde HELLO com WELCOME
          const welcome = new TextEncoder().encode(JSON.stringify({ protocol: 1, peerId: "server" }));
          const out = new Uint8Array(4 + welcome.byteLength);
          out.set([0xa7, 1, 4, 0]);
          out.set(welcome, 4);
          queueMicrotask(() => this.onmessage?.({ data: out.buffer }));
        }
      }
      public close(): void {
        this.readyState = 3;
      }
    }
    const previous = (globalThis as { WebSocket?: unknown }).WebSocket;
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
    try {
      const events: Emitted = [];
      const client = makeService(events);
      client.configure({ handshakeTimeoutMs: 200 });
      const connecting = client.connect("ws://good.example/game");
      await pump([client], 4);
      expect(await connecting).toBe(true);
      expect(client.transportType).toBe("websocket");
      expect(client.mode).toBe("client");

      expect(await client.sendTo("dedicated_server", 42, new Uint8Array([7]))).toBe(true);
      const last = sockets[0]?.sent.at(-1) ?? new Uint8Array();
      expect(decodeFrame(last)).toMatchObject({ type: 1, channel: 42 });
      expect(await client.sendTo("someone-else", 0, new Uint8Array([1]))).toBe(false);

      sockets[0]?.onerror?.();
      await pump([client], 1);
      expect(events.some((e) => e.type === "game.net.peer-disconnected")).toBe(true);
      expect(client.mode).toBe("offline");

      const silent = makeService();
      silent.configure({ handshakeTimeoutMs: 100 });
      const attempt = silent.connect("ws://mute.example/game");
      await pump([silent], 2);
      clock += 200;
      await pump([silent], 2);
      expect(await attempt).toBe(false);
    } finally {
      (globalThis as { WebSocket?: unknown }).WebSocket = previous;
    }
  });

  it("protocolo: frames inválidos, fragmento e snapshot validados", () => {
    expect(decodeFrame(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0xa7, 1, 99, 0]))).toBeNull();
    const frame = decodeFrame(encodeDataFrame(5, new Uint8Array([9])));
    expect(frame).toMatchObject({ type: 1, channel: 5 });
    expect(decodeSnapshotPayload(new TextEncoder().encode('{"sequence":-1}'))).toBeNull();
    const good = encodeSnapshotPayload({ sequence: 1, tick: 1, timestamp: 1, hostSteamId: "h", entities: [entity("a", 1)] });
    expect(decodeSnapshotPayload(good)?.entities).toHaveLength(1);
    expect(FRAME_FRAGMENT).toBe(2);
  });

  it("plugin: consome game.steam.net opcional e trata broadcast-snapshot", () => {
    const consumes = netManifest.capabilities?.consumes?.map((entry) => entry.id) ?? [];
    expect(consumes).toContain("game.steam.net");
    expect(createNetworkPlugin().manifest.id).toBe("game.net");
  });
});

class FakeChannel {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public constructor(
    private readonly name: string,
    private readonly registry: Map<string, Set<FakeChannel>>,
  ) {
    const set = registry.get(name) ?? new Set<FakeChannel>();
    set.add(this);
    registry.set(name, set);
  }
  public postMessage(message: unknown): void {
    for (const channel of this.registry.get(this.name) ?? []) {
      if (channel !== this) channel.onmessage?.({ data: message } as MessageEvent);
    }
  }
  public close(): void {
    this.registry.get(this.name)?.delete(this);
  }
}

function packet(channel: number): SteamP2PPacket {
  return { sourceSteamId: "76561198000000009", channel, data: new Uint8Array([channel & 0xff]), bytesReceived: 1 };
}

class BatchSteam implements SteamApi {
  public isAvailable = true;
  public readonly inbox: SteamP2PPacket[] = [];
  public async checkAvailability(): Promise<boolean> {
    return true;
  }
  public async getUser(): Promise<SteamUser | null> {
    return { steamId: "76561198000000001", personaName: "x", isOverlayEnabled: false };
  }
  public async unlockAchievement(): Promise<boolean> {
    return false;
  }
  public async setStat(): Promise<boolean> {
    return false;
  }
  public async storeStats(): Promise<boolean> {
    return false;
  }
  public async createLobby(_t: SteamLobbyType, _m: number): Promise<SteamLobbyDetails | null> {
    return null;
  }
  public async sendP2PPacket(_t: string, _d: Uint8Array, _s?: P2PSendType, _c?: number): Promise<boolean> {
    return true;
  }
  public async readP2PPacket(): Promise<SteamP2PPacket | null> {
    return null;
  }
  public async readP2PPackets(): Promise<ReadonlyArray<SteamP2PPacket>> {
    return this.inbox.splice(0, this.inbox.length);
  }
}
