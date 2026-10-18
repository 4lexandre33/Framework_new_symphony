// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";

import { Kernel, type Plugin } from "@core";

import { createEngineServices, type EngineServices } from "../src/app/EngineServices";
import { createGameLoopPlugin } from "../src/plugins/game-loop/plugin";
import { createWorldPlugin } from "../src/plugins/world/plugin";
import { WorldToken } from "../src/tokens/world";
import { RenderToken } from "../src/tokens/render";
import {
  DEVBRIDGE_METHODS,
  DevBridge,
  devBridgeGlobToRegExp,
  isLoopbackDevBridgeUrl,
  parseDevBridgeMessage,
  resolveDevBridgeConfig,
  setupDevBridge,
  type DevBridgeHandle,
  type DevBridgeSocketFactory,
  type DevBridgeState,
} from "../src/debug/devbridge";
import * as sharedProtocol from "../tools/mcp/src/runtime/protocol";

const TOKEN = "tok_0123456789abcdef";
const WS = NodeWebSocket as unknown as DevBridgeSocketFactory;

// ── servidor MCP falso (lado Node) ───────────────────────────────────────

interface FakeServer {
  readonly port: number;
  readonly hellos: Record<string, unknown>[];
  readonly messages: Record<string, unknown>[];
  waitReady(): Promise<void>;
  request(method: string, params?: unknown): Promise<{ ok: boolean; result?: any; error?: { code: string; message: string } }>;
  sendRaw(data: unknown): void;
  waitFor(pred: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

async function startFakeServer(opts: { token?: string; port?: number } = {}): Promise<FakeServer> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: opts.port ?? 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  const port = (wss.address() as AddressInfo).port;
  const hellos: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const pending = new Map<number, (m: any) => void>();
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];
  let client: NodeWebSocket | null = null;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let nextId = 1;

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      messages.push(msg);
      for (const w of [...waiters]) {
        if (w.pred(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
      if (msg.type === "hello") {
        hellos.push(msg);
        if (msg.token === (opts.token ?? TOKEN)) {
          client = socket;
          socket.send(JSON.stringify({ type: "welcome", protocol: 1 }));
          readyResolve();
        } else {
          socket.send(JSON.stringify({ type: "reject", reason: "token inválido" }));
          socket.close();
        }
      } else if (msg.type === "res") {
        pending.get(msg.id as number)?.(msg);
        pending.delete(msg.id as number);
      } else if (msg.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", ts: msg.ts }));
      }
    });
  });

  return {
    port,
    hellos,
    messages,
    waitReady: () => ready,
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        client?.send(JSON.stringify({ type: "req", id, method, params }));
      });
    },
    sendRaw(data) {
      client?.send(typeof data === "string" ? data : JSON.stringify(data));
    },
    waitFor(pred) {
      const found = messages.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ pred, resolve }));
    },
    close() {
      for (const c of wss.clients) c.terminate();
      return new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout esperando condição");
    await sleep(10);
  }
}

// ── jogo: kernel real (game.loop + game.world) + fakes ───────────────────

interface Game {
  kernel: Kernel;
  services: EngineServices;
  handle: DevBridgeHandle;
  canvas: HTMLCanvasElement;
  renderCalls: number[];
  states: DevBridgeState[];
}

function fakeRenderPlugin(canvas: HTMLCanvasElement, renderCalls: number[]): Plugin {
  const api = {
    render(alpha: number): void {
      renderCalls.push(alpha);
    },
    getCanvas: () => canvas,
    isContextLost: () => false,
    getRenderer: () => ({ info: { render: { calls: 7, triangles: 120 }, memory: { geometries: 3, textures: 2 } } }),
  };
  return {
    manifest: {
      id: "test.fake-render",
      name: "Render falso",
      version: "1.0.0",
      kind: "preloaded",
      capabilities: { provides: [{ id: RenderToken.id, version: "1.0.0" }], conflicts: [] },
    },
    setup(ctx): void {
      ctx.caps.provide(RenderToken, api as never);
      ctx.lifecycle.ready();
    },
  };
}

function servicesProbe(services: EngineServices): Plugin {
  return {
    manifest: {
      id: "test.services-probe",
      name: "Probe",
      version: "1.0.0",
      kind: "preloaded",
      capabilities: { provides: [], consumes: [{ id: WorldToken.id, range: "^1.0.0" }], conflicts: [] },
      lifecycleHooks: {
        onBoot(ctx): void {
          services.world = ctx.caps.require(WorldToken);
        },
      },
    },
    setup(ctx): void {
      ctx.lifecycle.ready();
    },
  };
}

function fakeServices(services: EngineServices): void {
  let activeCamera: string | null = "main";
  const follows: Record<string, unknown> = {};
  services.physics = {
    castRay: (req: { origin: { x: number } }) => ({ hit: true, distance: 2, point: { x: req.origin.x, y: 0, z: 2 }, normal: { x: 0, y: 0, z: -1 }, entityId: "wall" }),
    getStats: () => ({ rigidBodyCount: 1, colliderCount: 2, stepTimeMs: 0.5, isWasmLoaded: true }),
  } as never;
  services.camera = {
    getActiveCameraId: () => activeCamera,
    setActiveCamera: (id: string) => {
      if (id !== "main" && id !== "alt") return false;
      activeCamera = id;
      return true;
    },
    getCurrentCameraSnapshot: () => ({ position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, fov: 60, isColliding: false, currentArmLength: 0, currentTrauma: 0 }),
    setFollowTarget: (id: string, pos: { x: number; y: number; z: number }) => {
      follows[id] = { ...pos };
    },
    clearFollowTarget: (id: string) => delete follows[id],
    __follows: follows,
  } as never;
  services.storage = {
    listSaves: async () => [{ saveId: "s1", slotName: "slot-1", playTimeSeconds: 10, timestamp: 1, gameVersion: "1", checksum: "x" }],
  } as never;
}

const originalRaf = globalThis.requestAnimationFrame;
const originalCaf = globalThis.cancelAnimationFrame;
let game: Game | null = null;
let server: FakeServer | null = null;

async function bootGame(port: number, extra: { token?: string; reconnectMinMs?: number } = {}): Promise<Game> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  document.body.appendChild(canvas);
  const renderCalls: number[] = [];
  const states: DevBridgeState[] = [];
  const services = createEngineServices();
  fakeServices(services);
  const kernel = new Kernel();
  kernel.register(createGameLoopPlugin());
  kernel.register(createWorldPlugin());
  kernel.register(fakeRenderPlugin(canvas, renderCalls));
  kernel.register(servicesProbe(services));
  const handle = setupDevBridge({
    kernel,
    services,
    search: `?devbridge=ws://127.0.0.1:${port}&devtoken=${extra.token ?? TOKEN}&project=demo`,
    env: {},
    WebSocketImpl: WS,
    reconnectMinMs: extra.reconnectMinMs ?? 20,
    reconnectMaxMs: 100,
    onStateChange: (s) => states.push(s),
  });
  expect(handle).not.toBeNull();
  await kernel.boot();
  handle!.start();
  game = { kernel, services, handle: handle!, canvas, renderCalls, states };
  return game;
}

beforeEach(() => {
  globalThis.requestAnimationFrame = (() => 1) as never;
  globalThis.cancelAnimationFrame = (() => {}) as never;
});

afterEach(async () => {
  if (game !== null) {
    game.handle.stop();
    await game.kernel.stop().catch(() => {});
    game.canvas.remove();
    game = null;
  }
  if (server !== null) {
    await server.close();
    server = null;
  }
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
  vi.restoreAllMocks();
});

// ── protocolo e configuração ─────────────────────────────────────────────

describe("DevBridge — protocolo e configuração", () => {
  it("tools/mcp re-exporta o MESMO protocolo", () => {
    expect(sharedProtocol.DEVBRIDGE_METHODS).toBe(DEVBRIDGE_METHODS);
    expect(sharedProtocol.DEVBRIDGE_PROTOCOL_VERSION).toBe(1);
  });

  it("só aceita ws:// em loopback", () => {
    expect(isLoopbackDevBridgeUrl("ws://127.0.0.1:47100")).toBe(true);
    expect(isLoopbackDevBridgeUrl("ws://localhost:1")).toBe(true);
    expect(isLoopbackDevBridgeUrl("ws://[::1]:47100")).toBe(true);
    expect(isLoopbackDevBridgeUrl("wss://127.0.0.1:47100")).toBe(false);
    expect(isLoopbackDevBridgeUrl("http://127.0.0.1:47100")).toBe(false);
    expect(isLoopbackDevBridgeUrl("ws://example.com:47100")).toBe(false);
    expect(isLoopbackDevBridgeUrl("ws://127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackDevBridgeUrl("ws://user:pw@127.0.0.1:1")).toBe(false);
    expect(isLoopbackDevBridgeUrl("lixo")).toBe(false);
  });

  it("resolveDevBridgeConfig: desligado sem URL, recusa com aviso URL remota/token ruim", () => {
    const warn = vi.fn();
    expect(resolveDevBridgeConfig({ search: "", env: {}, warn })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(resolveDevBridgeConfig({ search: `?devbridge=ws://10.0.0.5:1&devtoken=${TOKEN}`, warn })).toBeNull();
    expect(resolveDevBridgeConfig({ search: "?devbridge=ws://127.0.0.1:1&devtoken=curto", warn })).toBeNull();
    expect(resolveDevBridgeConfig({ search: "?devbridge=ws://127.0.0.1:1", warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
    expect(resolveDevBridgeConfig({ search: `?devbridge=ws://127.0.0.1:9&devtoken=${TOKEN}&project=p1` })).toEqual({
      url: "ws://127.0.0.1:9",
      token: TOKEN,
      project: "p1",
    });
    expect(
      resolveDevBridgeConfig({ env: { VITE_DEVBRIDGE_URL: "ws://localhost:5", VITE_DEVBRIDGE_TOKEN: TOKEN, VITE_PROJECT: "x" } }),
    ).toEqual({ url: "ws://localhost:5", token: TOKEN, project: "x" });
  });

  it("setupDevBridge sem configuração não registra nada", () => {
    const register = vi.fn();
    const handle = setupDevBridge({
      kernel: { status: "idle", inspect: () => ({}), register },
      services: createEngineServices(),
      search: "",
      env: {},
    });
    expect(handle).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("parseDevBridgeMessage valida a forma e globs casam como documentado", () => {
    expect(parseDevBridgeMessage("{")).toBeNull();
    expect(parseDevBridgeMessage(JSON.stringify({ type: "req", method: "x" }))).toBeNull();
    expect(parseDevBridgeMessage(JSON.stringify({ type: "req", id: 1, method: "x" }))).toMatchObject({ type: "req" });
    expect(parseDevBridgeMessage(JSON.stringify({ type: "nada" }))).toBeNull();
    expect(devBridgeGlobToRegExp("game.world.*").test("game.world.entity-spawned")).toBe(true);
    expect(devBridgeGlobToRegExp("game.world.*").test("game.worldX")).toBe(false);
    expect(devBridgeGlobToRegExp("game.?oop.tick").test("game.loop.tick")).toBe(true);
  });

  it("DevBridge recusa URL não loopback sem abrir socket", () => {
    const ctor = vi.fn();
    const bridge = new DevBridge({
      url: "ws://192.168.0.2:1",
      token: TOKEN,
      project: null,
      kernelApiVersion: "1.0.0",
      methods: {} as never,
      WebSocketImpl: ctor as unknown as DevBridgeSocketFactory,
      logger: { info() {}, warn() {} },
    });
    bridge.start();
    expect(bridge.state).toBe("stopped");
    expect(ctor).not.toHaveBeenCalled();
  });
});

// ── conexão ──────────────────────────────────────────────────────────────

describe("DevBridge — conexão", () => {
  it("handshake: hello com token/projeto/versão e welcome deixa ready", async () => {
    server = await startFakeServer();
    const g = await bootGame(server.port);
    await server.waitReady();
    await waitUntil(() => g.handle.bridge?.state === "ready");
    expect(server.hellos[0]).toMatchObject({ type: "hello", protocol: 1, token: TOKEN, project: "demo", kernelApiVersion: "1.0.0" });
    expect(typeof server.hellos[0]?.userAgent).toBe("string");
    expect(g.states).toContain("handshake");
  });

  it("token errado: reject e não reconecta", async () => {
    server = await startFakeServer({ token: "outro_token_0123456789" });
    const g = await bootGame(server.port);
    await waitUntil(() => g.handle.bridge?.state === "rejected");
    await sleep(150);
    expect(g.handle.bridge?.connectionAttempts).toBe(1);
    expect(server.hellos).toHaveLength(1);
  });

  it("reconecta com backoff quando o servidor MCP sobe depois do jogo", async () => {
    const probe = await startFakeServer();
    const port = probe.port;
    await probe.close();
    const g = await bootGame(port);
    await waitUntil(() => (g.handle.bridge?.connectionAttempts ?? 0) >= 2);
    expect(g.handle.bridge?.state).toBe("connecting");
    server = await startFakeServer({ port });
    await server.waitReady();
    await waitUntil(() => g.handle.bridge?.state === "ready");
  });

  it("reconecta depois de queda e responde ping com pong", async () => {
    server = await startFakeServer();
    const g = await bootGame(server.port);
    await server.waitReady();
    await waitUntil(() => g.handle.bridge?.state === "ready");
    server.sendRaw({ type: "ping", ts: 42 });
    await server.waitFor((m) => m.type === "pong" && m.ts === 42);
    const port = server.port;
    await server.close();
    await waitUntil(() => g.handle.bridge?.state === "connecting");
    server = await startFakeServer({ port });
    await server.waitReady();
    await waitUntil(() => g.handle.bridge?.state === "ready");
  });

  it("método desconhecido e params inválidos viram erro estruturado", async () => {
    server = await startFakeServer();
    await bootGame(server.port);
    await server.waitReady();
    expect(await server.request("eval", { code: "1" })).toMatchObject({ ok: false, error: { code: "UNKNOWN_METHOD" } });
    expect(await server.request("world.get", { entityId: 5 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await server.request("loop.stats", { extra: true })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await server.request("loop.stats", [])).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("stop() fecha a conexão e restaura o console", async () => {
    const originalWarn = console.warn;
    server = await startFakeServer();
    const g = await bootGame(server.port);
    await server.waitReady();
    expect(console.warn).not.toBe(originalWarn);
    g.handle.stop();
    expect(console.warn).toBe(originalWarn);
    expect(g.handle.bridge?.state).toBe("stopped");
  });
});

// ── métodos ──────────────────────────────────────────────────────────────

describe("DevBridge — métodos com kernel real", () => {
  async function ready(): Promise<{ g: Game; s: FakeServer }> {
    server = await startFakeServer();
    const g = await bootGame(server.port);
    await server.waitReady();
    await waitUntil(() => g.handle.bridge?.state === "ready");
    return { g, s: server };
  }

  it("kernel.inspect", async () => {
    const { s } = await ready();
    const res = await s.request("kernel.inspect");
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe("running");
    expect(res.result.plugins.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["game.loop", "game.world", "debug.devbridge"]));
  });

  it("loop.stats / pause / step / resume", async () => {
    const { s } = await ready();
    expect((await s.request("loop.stats")).result).toMatchObject({ available: true, isPaused: false, tickRate: 60 });
    expect(await s.request("loop.step", { ticks: 2 })).toMatchObject({ ok: false, error: { code: "NOT_AVAILABLE" } });
    expect((await s.request("loop.pause")).result.isPaused).toBe(true);
    await s.request("events.subscribe", { patterns: ["game.loop.tick"] });
    const mark = (await s.request("events.tail")).result.lastSeq;
    const step = await s.request("loop.step", { ticks: 3 });
    expect(step.result.ticksRun).toBe(3);
    expect(step.result.stats.runningTimeSeconds).toBeCloseTo(3 / 60, 6);
    const tail = await s.request("events.tail", { since: mark });
    expect(tail.result.events.map((e: { payload: { tickCount: number } }) => e.payload.tickCount)).toEqual([1, 2, 3]);
    expect(await s.request("loop.step", { ticks: 601 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect((await s.request("loop.resume")).result.isPaused).toBe(false);
  });

  it("world.spawn / list / get / patch / snapshot / despawn", async () => {
    const { g, s } = await ready();
    const spawn = await s.request("world.spawn", { entityId: "e1", type: "crate", position: { x: 1, y: 0, z: 0 }, tags: ["box"], customData: { hp: 3 } });
    expect(spawn).toMatchObject({ ok: true, result: { spawned: true, replaced: false, entity: { entityId: "e1", type: "crate", customData: { hp: 3 } } } });
    await s.request("world.spawn", { entityId: "e2", type: "tree", position: { x: 50, y: 0, z: 0 } });
    expect(g.services.world?.hasEntity("e1")).toBe(true);

    expect((await s.request("world.list")).result.total).toBe(2);
    expect((await s.request("world.list", { type: "crate" })).result.entities.map((e: { entityId: string }) => e.entityId)).toEqual(["e1"]);
    expect((await s.request("world.list", { tag: "box" })).result.returned).toBe(1);
    const near = await s.request("world.list", { near: { x: 0, y: 0, z: 0, r: 5 } });
    expect(near.result.entities).toEqual([expect.objectContaining({ entityId: "e1", distance: 1 })]);
    expect((await s.request("world.list", { limit: 1 })).result).toMatchObject({ total: 2, returned: 1 });

    expect((await s.request("world.get", { entityId: "e1" })).result.position).toEqual({ x: 1, y: 0, z: 0 });
    expect(await s.request("world.get", { entityId: "nao" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const patch = await s.request("world.patch", { entityId: "e1", patch: { position: { x: 4, y: 0, z: 0 }, tags: ["moved"] } });
    expect(patch.result.entity).toMatchObject({ position: { x: 4, y: 0, z: 0 }, tags: ["moved"] });
    expect(await s.request("world.patch", { entityId: "e1", patch: { position: { x: "a" } } })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });

    const snap = await s.request("world.snapshot");
    expect(snap.result.entityCount).toBe(2);
    expect(JSON.stringify(snap.result.state)).toContain("e1");

    expect((await s.request("world.despawn", { entityId: "e2" })).result.despawned).toBe(true);
    expect(await s.request("world.despawn", { entityId: "e2" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await s.request("world.spawn", { entityId: "bad", position: { x: Number.NaN } })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("physics.raycast / physics.stats", async () => {
    const { s } = await ready();
    const hit = await s.request("physics.raycast", { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 });
    expect(hit.result).toMatchObject({ hit: true, distance: 2, entityId: "wall" });
    expect(await s.request("physics.raycast", { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect((await s.request("physics.stats")).result).toMatchObject({ rigidBodyCount: 1 });
  });

  it("camera.get / camera.set (troca câmera e segue entidade a cada render)", async () => {
    const { g, s } = await ready();
    expect((await s.request("camera.get")).result).toMatchObject({ available: true, activeCameraId: "main", snapshot: { fov: 60 } });
    expect((await s.request("camera.set", { cameraId: "alt" })).result.activeCameraId).toBe("alt");
    expect(await s.request("camera.set", { cameraId: "nenhuma" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await s.request("camera.set", { followTargetId: "nao" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await s.request("world.spawn", { entityId: "hero", position: { x: 3, y: 1, z: 0 } });
    expect((await s.request("camera.set", { followTargetId: "hero" })).result.followTargetId).toBe("hero");
    const follows = (g.services.camera as unknown as { __follows: Record<string, unknown> }).__follows;
    expect(follows.alt).toEqual({ x: 3, y: 1, z: 0 });
    // move e renderiza um frame (loop.step emite game.loop.render)
    g.services.world?.updateEntityTransform("hero", { position: { x: 9, y: 1, z: 0 } });
    await s.request("loop.pause");
    await s.request("loop.step", { ticks: 1 });
    expect(follows.alt).toEqual({ x: 9, y: 1, z: 0 });
    expect((await s.request("camera.set", { followTargetId: null })).result.followTargetId).toBeNull();
    expect(follows.alt).toBeUndefined();
  });

  it("input.send despacha teclado no window e mouse/wheel no canvas", async () => {
    const { g, s } = await ready();
    const seen: string[] = [];
    window.addEventListener("keydown", (e) => seen.push(`down:${e.code}:${e.key}`));
    window.addEventListener("keyup", (e) => seen.push(`up:${e.code}`));
    window.addEventListener("mousedown", (e) => seen.push(`mdown:${e.button}:${e.clientX},${e.clientY}`));
    window.addEventListener("mouseup", (e) => seen.push(`mup:${e.button}`));
    window.addEventListener("mousemove", (e) => seen.push(`move:${e.clientX},${e.clientY}`));
    g.canvas.addEventListener("wheel", (e) => seen.push(`wheel:${(e as WheelEvent).deltaY}`));
    const res = await s.request("input.send", {
      keys: [{ code: "KeyW", down: true }, { code: "KeyW", down: false }],
      pointer: { x: 10, y: 20, buttons: 1 },
      wheel: { deltaY: 120 },
    });
    expect(res.ok).toBe(true);
    await s.request("input.send", { pointer: { x: 10, y: 20, buttons: 0 } });
    expect(seen).toEqual(["down:KeyW:w", "up:KeyW", "move:10,20", "mdown:0:10,20", "wheel:120", "mup:0"]);
    expect(await s.request("input.send", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await s.request("input.send", { keys: [{ code: "KeyA" }] })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("events.subscribe / events.tail com globs e payload JSON-safe", async () => {
    const { s } = await ready();
    expect(await s.request("events.subscribe", { patterns: ["bad pattern!"] })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect((await s.request("events.subscribe", { patterns: ["game.world.*"] })).result.patterns).toEqual(["game.world.*"]);
    const before = (await s.request("events.tail")).result.lastSeq;
    await s.request("world.spawn", { entityId: "ev1" });
    const tail = await s.request("events.tail", { since: before });
    expect(tail.result.events.map((e: { type: string }) => e.type)).toEqual(["game.world.entity-spawned"]);
    expect(tail.result.events[0].source).toBe("game.world");
    // curinga amplo não captura tick/render
    await s.request("events.subscribe", { patterns: ["*"] });
    await s.request("loop.pause");
    const mark = (await s.request("events.tail")).result.lastSeq;
    await s.request("loop.step", { ticks: 2 });
    const after = await s.request("events.tail", { since: mark });
    expect(after.result.events.filter((e: { type: string }) => e.type.startsWith("game.loop."))).toHaveLength(0);
  });

  it("commands.send: só game.* e via commands.request", async () => {
    const { g, s } = await ready();
    const res = await s.request("commands.send", { command: "game.world.spawn-entity", payload: { state: { entityId: "cmd1" } } });
    expect(res.ok).toBe(true);
    expect(g.services.world?.hasEntity("cmd1")).toBe(true);
    expect(await s.request("commands.send", { command: "kernel.stop" })).toMatchObject({ ok: false, error: { code: "COMMAND_NOT_ALLOWED" } });
    expect(await s.request("commands.send", { command: "game.nao.existe" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("logs.tail captura console e erros não tratados, filtra por nível", async () => {
    const { s } = await ready();
    const mark = (await s.request("logs.tail")).result.lastSeq;
    console.info("info do jogo", { a: 1 });
    console.warn("aviso do jogo");
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "game.js", lineno: 3, colno: 4 }));
    const all = await s.request("logs.tail", { since: mark });
    expect(all.result.logs.map((l: { message: string }) => l.message)).toEqual(
      expect.arrayContaining(['info do jogo {"a":1}', "aviso do jogo", "boom (game.js:3:4)"]),
    );
    const warns = await s.request("logs.tail", { since: mark, level: "warn" });
    expect(warns.result.logs.every((l: { level: string }) => l.level === "warn" || l.level === "error")).toBe(true);
    expect(warns.result.logs.some((l: { origin: string }) => l.origin === "window.error")).toBe(true);
    expect(await s.request("logs.tail", { level: "fatal" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("screenshot: renderiza um frame, lê o canvas e reduz com maxWidth", async () => {
    const { g, s } = await ready();
    const png = "iVBORw0KGgo=";
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${png}`);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    const full = await s.request("screenshot", { maxWidth: 4096 });
    expect(full.result).toEqual({ mimeType: "image/png", data: png, width: 640, height: 360 });
    expect(g.renderCalls.length).toBe(1);
    const small = await s.request("screenshot", { maxWidth: 320 });
    expect(small.result).toMatchObject({ width: 320, height: 180 });
    expect(drawImage).toHaveBeenCalledWith(g.canvas, 0, 0, 320, 180);
    expect(toDataURL).toHaveBeenCalledTimes(2);
    toDataURL.mockReturnValue("data:,");
    expect(await s.request("screenshot")).toMatchObject({ ok: false, error: { code: "METHOD_FAILED" } });
    expect(await s.request("screenshot", { maxWidth: 0 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("perf.stats e storage.slots", async () => {
    const { s } = await ready();
    const perf = await s.request("perf.stats");
    expect(perf.result).toMatchObject({ fps: 60, tickRate: 60, drawCalls: 7, triangles: 120, geometries: 3, textures: 2, entities: 0 });
    expect((await s.request("storage.slots")).result.slots[0]).toMatchObject({ slotName: "slot-1" });
  });

  it("scene.load: NOT_AVAILABLE sem loadSceneDocument; usa a API quando existe", async () => {
    const { g, s } = await ready();
    const doc = { format: "engine.scene", version: 1, sceneId: "s1", sceneName: "S1", entities: [] };
    const realWorld = g.services.world;
    if (typeof (realWorld as unknown as { loadSceneDocument?: unknown }).loadSceneDocument !== "function") {
      expect(await s.request("scene.load", { document: doc })).toMatchObject({ ok: false, error: { code: "NOT_AVAILABLE" } });
    }
    const calls: unknown[] = [];
    g.services.world = {
      currentSceneId: "s1",
      activeEntityCount: 4,
      loadSceneDocument: async (d: unknown, o: unknown) => {
        calls.push([d, o]);
        return true;
      },
    } as never;
    const res = await s.request("scene.load", { document: doc, prefabs: { p: { format: "engine.prefab" } } });
    expect(res.result).toEqual({ loaded: true, sceneId: "s1", entityCount: 4, error: null });
    expect(calls).toEqual([[doc, { prefabs: { p: { format: "engine.prefab" } } }]]);
    expect(await s.request("scene.load", {})).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    g.services.world = realWorld;
  });

  it("todo método da tabela responde (sem UNKNOWN_METHOD)", async () => {
    const { s } = await ready();
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    for (const method of DEVBRIDGE_METHODS) {
      const res = await s.request(method, method === "events.subscribe" ? { patterns: ["*"] } : undefined);
      expect(res.error?.code, method).not.toBe("UNKNOWN_METHOD");
    }
  });
});
