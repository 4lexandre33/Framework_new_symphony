// @vitest-environment node
// G8: host WebSocket nativo. O servidor Rust (src-tauri/src/net_ws_host.rs)
// tem testes próprios com sockets reais (cargo test); aqui um servidor
// simulado que fala o MESMO formato de eventos do IPC liga um host
// NetworkService (WebSocketTransport em modo host) a clientes
// NetworkService comuns (WebSocketTransport cliente), passando pelo
// protocolo de sessão real (HELLO/WELCOME, dados por canal, BYE).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@core";

import { NetworkService } from "../src/engine/net/internal/NetworkService";
import { WebSocketTransport } from "../src/engine/net/internal/WebSocketTransport";
import {
  NATIVE_WS_EVENT_CONNECTED,
  NATIVE_WS_EVENT_DISCONNECTED,
  NATIVE_WS_EVENT_MESSAGE,
  decodeNativeWsHostEvents,
  type NativeWsHostBind,
  type NativeWsHostBridge,
  type NativeWsHostInfo,
} from "../src/engine/net/internal/NativeWebSocketHostBridge";

type Emitted = Array<{ type: string; payload: any }>;

const ctxWith = (emitted: Emitted): PluginContext =>
  ({ events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) } }) as unknown as PluginContext;

let clock = 0;
const now = (): number => clock;
const services: NetworkService[] = [];

function encode(kind: number, peerId: string, body: Uint8Array = new Uint8Array()): Uint8Array {
  const id = new TextEncoder().encode(peerId);
  const out = new Uint8Array(2 + id.length + 4 + body.length);
  out[0] = kind;
  out[1] = id.length;
  out.set(id, 2);
  new DataView(out.buffer).setUint32(2 + id.length, body.length, false);
  out.set(body, 6 + id.length);
  return out;
}

/** Simula o servidor nativo + a rede até os clientes WebSocket. */
class FakeNativeServer implements NativeWsHostBridge {
  public running: { port: number; bind: NativeWsHostBind; maxClients: number } | null = null;
  public readonly queue: Uint8Array[] = [];
  public readonly sockets = new Map<string, FakeClientSocket>();
  public startCalls: Array<[number, string, number]> = [];
  public nextId = 1;
  public failStart: { code: string; message: string } | null = null;
  public sendAccepts = true;

  public isAvailable(): boolean {
    return true;
  }

  public async start(port: number, bind: NativeWsHostBind, maxClients: number): Promise<NativeWsHostInfo> {
    this.startCalls.push([port, bind, maxClients]);
    if (this.failStart) throw this.failStart;
    if (this.running) throw { code: "already-running", message: "x" };
    this.running = { port, bind, maxClients };
    return { running: true, port, bind, maxClients, peers: 0, lanAddress: bind === "lan" ? "192.168.0.10" : null };
  }

  public async stop(): Promise<boolean> {
    if (!this.running) return false;
    this.running = null;
    for (const [, socket] of this.sockets) socket.serverClosed();
    this.sockets.clear();
    this.queue.length = 0;
    return true;
  }

  public async poll(): Promise<ArrayBuffer> {
    if (!this.running) throw { code: "not-running", message: "parado" };
    const total = this.queue.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.queue.splice(0)) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out.buffer;
  }

  public async send(peerId: string, data: Uint8Array): Promise<boolean> {
    if (!this.running || !this.sendAccepts) return false;
    const targets = peerId === "*" ? [...this.sockets.values()] : [this.sockets.get(peerId)].filter(Boolean);
    for (const socket of targets) socket!.deliver(data.slice());
    return targets.length > 0;
  }

  public async closePeer(peerId: string): Promise<boolean> {
    const socket = this.sockets.get(peerId);
    if (!socket) return false;
    this.sockets.delete(peerId);
    socket.serverClosed();
    this.queue.push(encode(NATIVE_WS_EVENT_DISCONNECTED, peerId, new TextEncoder().encode("host_closed")));
    return true;
  }

  /** Conexão chegando de um cliente. */
  public accept(socket: FakeClientSocket): string | null {
    if (!this.running || !socket.url.endsWith(`:${String(this.running.port)}`)) return null;
    // Como o Rust: folga acima de maxClients para a sessão mandar REJECT server_full.
    if (this.sockets.size >= this.running.maxClients + 4) return null;
    const id = `ws_${String(this.nextId++)}`;
    this.sockets.set(id, socket);
    this.queue.push(encode(NATIVE_WS_EVENT_CONNECTED, id));
    return id;
  }

  public fromClient(id: string, data: Uint8Array): void {
    this.queue.push(encode(NATIVE_WS_EVENT_MESSAGE, id, data));
  }

  public clientClosed(id: string): void {
    if (this.sockets.delete(id)) {
      this.queue.push(encode(NATIVE_WS_EVENT_DISCONNECTED, id, new TextEncoder().encode("conexao_fechada")));
    }
  }
}

let server: FakeNativeServer;

class FakeClientSocket {
  public binaryType = "blob";
  public readyState = 0;
  public bufferedAmount = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  private id: string | null = null;

  public constructor(public readonly url: string) {
    queueMicrotask(() => {
      this.id = server.accept(this);
      if (this.id === null) {
        this.readyState = 3;
        this.onerror?.();
        return;
      }
      this.readyState = 1;
      this.onopen?.();
    });
  }

  public send(data: Uint8Array): void {
    if (this.id) server.fromClient(this.id, data.slice());
  }

  public deliver(data: Uint8Array): void {
    queueMicrotask(() => this.onmessage?.({ data: data.buffer as ArrayBuffer }));
  }

  public serverClosed(): void {
    this.readyState = 3;
    this.id = null;
    queueMicrotask(() => this.onclose?.());
  }

  public close(): void {
    if (this.id) server.clientClosed(this.id);
    this.id = null;
    this.readyState = 3;
  }
}

function makeHost(emitted: Emitted = []): NetworkService {
  const service = new NetworkService(ctxWith(emitted), {
    now,
    createTransport: { websocket: () => new WebSocketTransport({ hostBridge: server }) },
  });
  services.push(service);
  return service;
}

function makeClient(emitted: Emitted = []): NetworkService {
  const service = new NetworkService(ctxWith(emitted), { now });
  services.push(service);
  return service;
}

async function pump(list: NetworkService[], rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    for (const service of list) await service.pollPackets();
    await Promise.resolve();
  }
}

const previousWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  (globalThis as { WebSocket?: unknown }).WebSocket = previousWebSocket;
  clock = 0;
});

function install(): void {
  server = new FakeNativeServer();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeClientSocket;
}

describe("G8 host WebSocket nativo", () => {
  it("decodifica o formato de eventos do Rust e recusa entrada truncada", () => {
    const seen: string[] = [];
    const sink = {
      connected: (id: string) => seen.push(`+${id}`),
      disconnected: (id: string, reason: string) => seen.push(`-${id}:${reason}`),
      message: (id: string, data: Uint8Array) => seen.push(`${id}=${Array.from(data).join(",")}`),
    };
    const bytes = new Uint8Array([
      ...encode(1, "ws_1"),
      ...encode(3, "ws_1", new Uint8Array([0xa7, 1, 3, 0])),
      ...encode(2, "ws_1", new TextEncoder().encode("bye")),
    ]);
    expect(decodeNativeWsHostEvents(bytes, sink)).toBe(true);
    expect(seen).toEqual(["+ws_1", "ws_1=167,1,3,0", "-ws_1:bye"]);
    expect(decodeNativeWsHostEvents(bytes.subarray(0, 9), sink)).toBe(false);
  });

  it("startHost websocket: porta/bind/maxClients chegam ao Rust; clientes ws:// fazem handshake e trocam dados", async () => {
    install();
    const hostEvents: Emitted = [];
    const clientEvents: Emitted = [];
    const host = makeHost(hostEvents);
    const client = makeClient(clientEvents);

    expect(await host.startHost({ transport: "websocket", port: 4100, bind: "lan", maxClients: 3 })).toBe(true);
    expect(server.startCalls).toEqual([[4100, "lan", 3]]);
    expect(host.mode).toBe("host");
    expect(host.getHostEndpoint()).toEqual({
      transport: "websocket",
      port: 4100,
      bind: "lan",
      localUrl: "ws://127.0.0.1:4100",
      lanUrl: "ws://192.168.0.10:4100",
    });

    const connecting = client.connect("ws://127.0.0.1:4100");
    await pump([host, client]);
    expect(await connecting).toBe(true);
    expect(client.mode).toBe("client");
    const peers = host.getPeers();
    expect(peers).toHaveLength(1);
    expect(hostEvents.some((e) => e.type === "game.net.peer-connected")).toBe(true);

    // cliente → host (canal preservado pelo protocolo de sessão)
    expect(await client.sendTo("dedicated_server", 77, new Uint8Array([1, 2, 3]))).toBe(true);
    await pump([host]);
    const received = hostEvents.find((e) => e.type === "game.net.packet-received")?.payload;
    expect(received.senderId).toBe(peers[0]!.peerId);
    expect(received.channel).toBe(77);
    expect(Array.from(received.data)).toEqual([1, 2, 3]);

    // host → cliente (unicast e broadcast)
    expect(await host.sendTo(peers[0]!.peerId, 5, new Uint8Array([9]))).toBe(true);
    expect(await host.broadcast(6, new Uint8Array([8]))).toBe(true);
    await pump([client]);
    const got = clientEvents.filter((e) => e.type === "game.net.packet-received").map((e) => [e.payload.channel, Array.from(e.payload.data)]);
    expect(got).toEqual([
      [5, [9]],
      [6, [8]],
    ]);

    // cliente sai: host vê o par cair
    await client.disconnect();
    await pump([host]);
    expect(host.getPeers()).toHaveLength(0);
    expect(hostEvents.some((e) => e.type === "game.net.peer-disconnected")).toBe(true);

    // host para: servidor nativo encerrado
    await host.disconnect();
    expect(server.running).toBeNull();
    expect(host.getHostEndpoint()).toBeNull();
  });

  it("maxClients da sessão + do link; host parando derruba os clientes", async () => {
    install();
    const host = makeHost();
    expect(await host.startHost({ transport: "websocket", maxClients: 1 })).toBe(true);
    expect(server.startCalls[0]).toEqual([7777, "loopback", 1]);
    expect(host.getHostEndpoint()?.lanUrl).toBeNull();

    const first = makeClient();
    const firstEvents: Emitted = [];
    const firstWithEvents = new NetworkService(ctxWith(firstEvents), { now });
    services.push(firstWithEvents);
    const a = firstWithEvents.connect("ws://127.0.0.1:7777");
    await pump([host, firstWithEvents]);
    expect(await a).toBe(true);

    first.configure({ handshakeTimeoutMs: 100 });
    const b = first.connect("ws://127.0.0.1:7777");
    await pump([host, first]);
    expect(await b).toBe(false); // REJECT server_full da sessão (o link tem folga)
    expect(host.getPeers()).toHaveLength(1);
    await pump([host]);
    expect(server.sockets.size).toBe(1); // link recusado foi fechado pelo host

    await host.disconnect();
    await pump([firstWithEvents]);
    expect(firstWithEvents.mode).toBe("offline");
    expect(firstEvents.some((e) => e.type === "game.net.peer-disconnected")).toBe(true);
  });

  it("erro nativo (porta em uso) resolve false com o motivo; navegador não hospeda", async () => {
    install();
    server.failStart = { code: "bind-failed", message: "porta em uso" };
    const transport = new WebSocketTransport({ hostBridge: server });
    expect(await transport.listen({ port: 80 })).toBe(false);
    expect(transport.lastHostError).toEqual({ code: "bind-failed", message: "porta em uso" });
    transport.dispose();

    const browser = new WebSocketTransport({
      hostBridge: { ...server, isAvailable: () => false } as unknown as NativeWsHostBridge,
    });
    expect(browser.canHost).toBe(false);
    expect(await browser.listen()).toBe(false);

    const plain = makeClient();
    expect(await plain.startHost({ transport: "websocket" })).toBe(false); // sem Tauri
    expect(await plain.startHost({ transport: "websocket", bind: "everything" as never })).toBe(false);
  });

  it("servidor nativo sumindo (not-running) derruba os pares; backpressure devolve false", async () => {
    install();
    const transport = new WebSocketTransport({ hostBridge: server });
    const dropped: string[] = [];
    transport.onPeerDisconnected((id, reason) => dropped.push(`${id}:${reason}`));
    expect(await transport.listen({ port: 9000 })).toBe(true);
    server.accept(new FakeClientSocket("ws://x:1")); // fora da porta: ignorado
    const socket = Object.create(FakeClientSocket.prototype) as FakeClientSocket;
    Object.assign(socket, { url: "ws://127.0.0.1:9000" });
    const id = server.accept(socket)!;
    await transport.pollPackets();
    expect(transport.getStats().activeConnections).toBe(1);

    server.sendAccepts = false;
    expect(await transport.send(id, new Uint8Array([0xa7, 1, 1, 0]), 0, true)).toBe(false);
    expect(transport.rejectedSends).toBe(1);

    server.running = null; // processo nativo parou
    await transport.pollPackets();
    expect(dropped).toEqual([`${id}:host_parado`]);
    expect(transport.isHosting).toBe(false);
    transport.dispose();
  });

  it("reload do WebView: host órfão (already-running) é parado e o listen tenta de novo uma vez", async () => {
    install();
    // Página anterior deixou o servidor nativo rodando, com um cliente.
    await server.start(7777, "loopback", 4);
    const orphanSocket = Object.create(FakeClientSocket.prototype) as FakeClientSocket;
    Object.assign(orphanSocket, { url: "ws://127.0.0.1:7777", onclose: null });
    server.accept(orphanSocket);
    server.startCalls.length = 0;

    const transport = new WebSocketTransport({ hostBridge: server });
    expect(await transport.listen({ port: 7778, maxClients: 2 })).toBe(true);
    expect(server.startCalls).toEqual([
      [7778, "loopback", 2],
      [7778, "loopback", 2],
    ]);
    expect(server.running).toEqual({ port: 7778, bind: "loopback", maxClients: 2 });
    expect(server.sockets.size).toBe(0); // cliente órfão derrubado
    expect(transport.lastHostError).toBeNull();
    transport.dispose();

    // Só UMA nova tentativa: se o segundo start também falhar, resolve false.
    install();
    let starts = 0;
    const stubborn = {
      ...server,
      isAvailable: () => true,
      start: async () => {
        starts += 1;
        throw { code: "already-running", message: "x" };
      },
      stop: async () => true,
    } as unknown as NativeWsHostBridge;
    const second = new WebSocketTransport({ hostBridge: stubborn });
    expect(await second.listen()).toBe(false);
    expect(starts).toBe(2);
    expect(second.lastHostError?.code).toBe("already-running");
    second.dispose();

    // Outros erros não disparam a nova tentativa.
    install();
    server.failStart = { code: "bind-failed", message: "porta em uso" };
    const third = new WebSocketTransport({ hostBridge: server });
    expect(await third.listen()).toBe(false);
    expect(server.startCalls).toHaveLength(1);
    third.dispose();
  });

  it("prazo de handshake: link sem HELLO é fechado pelo host no relógio da sessão (sem timers)", async () => {
    install();
    const host = makeHost();
    host.configure({ handshakeTimeoutMs: 5000, peerTimeoutMs: 600_000 });
    expect(await host.startHost({ transport: "websocket", maxClients: 2 })).toBe(true);

    // Socket "mudo": conecta no servidor nativo e nunca manda HELLO.
    const mute = Object.create(FakeClientSocket.prototype) as FakeClientSocket;
    Object.assign(mute, { url: "ws://127.0.0.1:7777", onclose: null });
    const muteId = server.accept(mute)!;
    await pump([host], 2);
    expect(server.sockets.has(muteId)).toBe(true);

    // Cliente de verdade conecta no meio do prazo.
    clock = 2000;
    const client = makeClient();
    const ok = client.connect("ws://127.0.0.1:7777");
    await pump([host, client]);
    expect(await ok).toBe(true);

    clock = 4999;
    await pump([host], 2);
    expect(server.sockets.has(muteId)).toBe(true);

    clock = 5000;
    await pump([host], 2);
    expect(server.sockets.has(muteId)).toBe(false); // vaga liberada
    expect(host.getPeers()).toHaveLength(1); // o par que fez HELLO continua
    expect(server.sockets.size).toBe(1);
  });

  it("pump do loop (tick/render) não deixa rejeição solta: conta e reporta", async () => {
    install();
    class ThrowingTransport extends WebSocketTransport {
      public override async pollPackets(): Promise<void> {
        throw new Error("transporte quebrou");
      }
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const service = new NetworkService(ctxWith([]), {
        now,
        createTransport: { websocket: () => new ThrowingTransport({ hostBridge: server }) },
      });
      services.push(service);
      expect(await service.startHost({ transport: "websocket" })).toBe(true);
      for (let i = 0; i < 3; i += 1) {
        service.onTick(i);
        await new Promise((resolve) => setImmediate(resolve));
        service.onRenderFrame();
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(service.pollErrorCount).toBe(6);
      expect((service.lastPollError as Error).message).toBe("transporte quebrou");
      expect(warn).toHaveBeenCalledTimes(1); // 1ª falha; depois só a cada 100
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      warn.mockRestore();
    }
  });
});
