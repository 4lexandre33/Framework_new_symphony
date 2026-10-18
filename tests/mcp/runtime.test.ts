// @vitest-environment node
/**
 * Runtime (T6): DevBridge REAL (src/debug/devbridge) rodando neste processo
 * (jsdom + `ws` como WebSocket) conectado ao servidor de bridge REAL do MCP,
 * exercitado pelo cliente MCP em memória. Nenhuma porta fixa: bridge na 0.
 */

import "./fixtures/t6/dom-globals.ts";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Kernel, type Plugin } from "@core";
import { createEngineServices, type EngineServices } from "../../src/app/EngineServices";
import { createGameLoopPlugin } from "../../src/plugins/game-loop/plugin";
import { createWorldPlugin } from "../../src/plugins/world/plugin";
import { RenderToken } from "../../src/tokens/render";
import { WorldToken } from "../../src/tokens/world";
import { setupDevBridge, type DevBridgeHandle, type DevBridgeSocketFactory, type DevBridgeState } from "../../src/debug/devbridge";
import { BridgeRemoteError, isAllowedOrigin, newBridgeToken } from "../../tools/mcp/src/runtime/bridge-server.ts";
import { findFreePort, loadPlaywright } from "../../tools/mcp/src/runtime/launcher.ts";
import { isValidDevBridgeToken } from "../../tools/mcp/src/runtime/protocol.ts";
import { loadWs, rawToString, type WsSocket } from "../../tools/mcp/src/runtime/ws.ts";
import { configureRuntime, getBridgeServer, mapBridgeError } from "../../tools/mcp/src/tools/runtime.ts";
import { McpToolError } from "../../tools/mcp/src/core/errors.ts";
import { createTestClient, makeTempRepo, waitFor, type TempRepo, type TestClient } from "./harness.ts";

const { WebSocket: NodeWs } = loadWs();
const WS = NodeWs as unknown as DevBridgeSocketFactory;
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const RUNTIME_TOOLS = [
  "runtime_launch",
  "runtime_connect_info",
  "runtime_status",
  "runtime_stop",
  "kernel_inspect",
  "loop_control",
  "world_entities",
  "world_entity",
  "world_spawn",
  "world_despawn",
  "world_patch",
  "world_snapshot",
  "physics_raycast",
  "physics_stats",
  "camera_get",
  "camera_set",
  "input_send",
  "events_subscribe",
  "events_tail",
  "commands_send",
  "logs_tail",
  "screenshot",
  "perf_stats",
  "storage_slots",
  "scene_load_live",
];

/* ============================================================================
 * Jogo de teste: kernel real (game.loop + game.world) + render/serviços falsos
 * ========================================================================== */

interface Game {
  kernel: Kernel;
  services: EngineServices;
  handle: DevBridgeHandle;
  canvas: HTMLCanvasElement;
  states: DevBridgeState[];
}

function fakeRenderPlugin(canvas: HTMLCanvasElement): Plugin {
  const api = {
    render(): void {},
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
    setFollowTarget: () => undefined,
    clearFollowTarget: () => undefined,
  } as never;
  services.storage = {
    listSaves: async () => [{ saveId: "s1", slotName: "slot-1", playTimeSeconds: 10, timestamp: 1, gameVersion: "1", checksum: "x" }],
  } as never;
}

async function bootGame(bridgeUrl: string, token: string, project = "demo"): Promise<Game> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  document.body.appendChild(canvas);
  const states: DevBridgeState[] = [];
  const services = createEngineServices();
  fakeServices(services);
  const kernel = new Kernel();
  kernel.register(createGameLoopPlugin());
  kernel.register(createWorldPlugin());
  kernel.register(fakeRenderPlugin(canvas));
  kernel.register(servicesProbe(services));
  const handle = setupDevBridge({
    kernel,
    services,
    search: `?devbridge=${encodeURIComponent(bridgeUrl)}&devtoken=${token}&project=${project}`,
    env: {},
    WebSocketImpl: WS,
    reconnectMinMs: 20,
    reconnectMaxMs: 100,
    onStateChange: (s) => states.push(s),
  });
  if (handle === null) throw new Error("setupDevBridge devolveu null");
  await kernel.boot();
  handle.start();
  return { kernel, services, handle, canvas, states };
}

async function stopGame(game: Game | null): Promise<void> {
  if (!game) return;
  game.handle.stop();
  await game.kernel.stop().catch(() => undefined);
  game.canvas.remove();
}

/* ============================================================================
 * Cliente ws cru (para handshake inválido, timeout, ambiguidade)
 * ========================================================================== */

interface RawClient {
  readonly socket: WsSocket;
  readonly messages: Record<string, unknown>[];
  readonly closed: Promise<void>;
  waitFor(pred: (m: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
}

async function rawClient(url: string, first: unknown, headers?: Record<string, string>): Promise<RawClient> {
  const socket = new NodeWs(url, headers ? { headers } : undefined);
  const messages: Record<string, unknown>[] = [];
  let closedResolve: () => void = () => {};
  const closed = new Promise<void>((r) => {
    closedResolve = r;
  });
  socket.on("message", (data) => messages.push(JSON.parse(rawToString(data)) as Record<string, unknown>));
  socket.on("close", () => closedResolve());
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  if (first !== undefined) socket.send(typeof first === "string" ? first : JSON.stringify(first));
  return {
    socket,
    messages,
    closed,
    async waitFor(pred, timeoutMs = 3000) {
      let found: Record<string, unknown> | undefined;
      await waitFor(() => (found = messages.find(pred)) !== undefined, timeoutMs, "mensagem do bridge");
      return found!;
    },
  };
}

function hello(token: string, project: string | null = "raw", protocol = 1): Record<string, unknown> {
  return { type: "hello", protocol, token, project, kernelApiVersion: "1.0.0", userAgent: "teste" };
}

/* ============================================================================
 * Testes
 * ========================================================================== */

describe("runtime: utilidades puras", () => {
  it("token aleatório é aceito pelo DevBridge e Origin só de loopback/tauri", () => {
    const a = newBridgeToken();
    expect(isValidDevBridgeToken(a)).toBe(true);
    expect(a).not.toBe(newBridgeToken());
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost:1420")).toBe(true);
    expect(isAllowedOrigin("tauri://localhost")).toBe(true);
    expect(isAllowedOrigin("http://tauri.localhost")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.example")).toBe(false);
    expect(isAllowedOrigin("file:///x")).toBe(false);
  });

  it("mapBridgeError traduz os códigos do DevBridge", () => {
    const map = (code: string) => mapBridgeError(new BridgeRemoteError(code, "x", "world.get"), "world.get", "s-1") as McpToolError;
    expect(map("INVALID_PARAMS").code).toBe("INVALID_INPUT");
    expect(map("NOT_FOUND").code).toBe("NOT_FOUND");
    expect(map("COMMAND_NOT_ALLOWED").code).toBe("COMMAND_NOT_ALLOWED");
    expect(map("NOT_AVAILABLE")).toMatchObject({ code: "BRIDGE_ERROR", details: { code: "NOT_AVAILABLE", method: "world.get", sessionId: "s-1" } });
    expect(map("METHOD_FAILED").code).toBe("BRIDGE_ERROR");
    const other = new Error("x");
    expect(mapBridgeError(other, "m", "s")).toBe(other);
  });

  it("loadPlaywright devolve null quando não acha o pacote", async () => {
    const empty = await makeTempRepo();
    try {
      expect(loadPlaywright(empty.root, [])).toBeNull();
    } finally {
      await empty.cleanup();
    }
  });
});

describe("runtime: DevBridge real ↔ servidor MCP real", () => {
  let repo: TempRepo;
  let t: TestClient;
  let game: Game | null = null;
  let bridgeUrl = "";
  let token = "";
  let sessionId = "";
  const raws: RawClient[] = [];

  beforeAll(async () => {
    repo = await makeTempRepo();
    const demo = path.join(repo.root, "src/projects/demo");
    await mkdir(path.join(demo, "scenes"), { recursive: true });
    await mkdir(path.join(demo, "prefabs"), { recursive: true });
    await writeFile(path.join(demo, "index.ts"), "export {};\n");
    await writeFile(
      path.join(demo, "prefabs/caixa.prefab.json"),
      JSON.stringify({ format: "engine.prefab", version: 1, prefabId: "caixa", type: "crate", tags: ["caixa"], data: { hp: 5 } }),
    );
    await writeFile(
      path.join(demo, "scenes/fase-1.scene.json"),
      JSON.stringify({
        format: "engine.scene",
        version: 1,
        sceneId: "fase-1",
        sceneName: "Fase 1",
        entities: [
          { id: "c1", prefab: "caixa", position: { x: 1, y: 0, z: 0 } },
          { id: "c2", prefab: "caixa", position: { x: 2, y: 0, z: 0 }, data: { hp: 9 } },
          { id: "chao", type: "ground" },
        ],
      }),
    );
    await writeFile(path.join(demo, "scenes/quebrada.scene.json"), JSON.stringify({ format: "engine.scene", version: 1, sceneId: "x", entities: [] }));
    globalThis.requestAnimationFrame = (() => 1) as never;
    globalThis.cancelAnimationFrame = (() => {}) as never;
    t = await createTestClient({ root: repo.root, config: { bridgePort: 0 } });
    configureRuntime(t.ctx, { requestTimeoutMs: 1500, playwrightDirs: [] });
  });

  afterAll(async () => {
    for (const r of raws) r.socket.terminate();
    await stopGame(game);
    await t?.close();
    await repo?.cleanup();
    vi.restoreAllMocks();
  });

  it("registra todas as tools da SPEC 3.4", async () => {
    const names = (await t.listTools()).map((tool) => tool.name);
    for (const name of RUNTIME_TOOLS) expect(names, name).toContain(name);
  });

  it("init não abre socket; sem jogo → NO_RUNTIME", async () => {
    expect(getBridgeServer(t.ctx)).toBeNull();
    await expect(t.callTool("kernel_inspect")).rejects.toMatchObject({ code: "NO_RUNTIME" });
    await expect(t.callTool("world_entities", { sessionId: "x-1" })).rejects.toMatchObject({ code: "NO_RUNTIME" });
    const status = await t.callTool("runtime_status");
    expect(status).toMatchObject({ bridge: null, sessions: [], launches: [] });
    expect(getBridgeServer(t.ctx)).toBeNull();
  });

  it("runtime_connect_info sobe o bridge e devolve URL/token/env do tauri", async () => {
    await expect(t.callTool("runtime_connect_info", { id: "nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("runtime_connect_info", { id: "../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const info = await t.callTool("runtime_connect_info", { id: "demo" });
    expect(isValidDevBridgeToken(info.token)).toBe(true);
    expect(info.bridgePort).toBeGreaterThan(0);
    expect(info.bridgeUrl).toBe(`ws://127.0.0.1:${info.bridgePort}`);
    expect(info.bridgePortFallback).toBe(false);
    const url = new URL(info.url);
    expect(url.searchParams.get("devbridge")).toBe(info.bridgeUrl);
    expect(url.searchParams.get("devtoken")).toBe(info.token);
    expect(url.searchParams.get("project")).toBe("demo");
    expect(info.tauri).toEqual({
      command: "node scripts/tauri-project-config.mjs demo --dev",
      env: { VITE_DEVBRIDGE_URL: info.bridgeUrl, VITE_DEVBRIDGE_TOKEN: info.token },
    });
    // idempotente: mesma porta e token
    expect(await t.callTool("runtime_connect_info", { id: "demo" })).toMatchObject({ bridgePort: info.bridgePort, token: info.token });
    bridgeUrl = info.bridgeUrl;
    token = info.token;
  });

  it("o jogo conecta e aparece no runtime_status", async () => {
    game = await bootGame(bridgeUrl, token);
    await waitFor(() => game!.handle.bridge?.state === "ready", 5000, "DevBridge pronto");
    const status = await t.callTool("runtime_status");
    expect(status.bridge.url).toBe(bridgeUrl);
    expect(status.sessions).toHaveLength(1);
    const s = status.sessions[0];
    expect(s).toMatchObject({ project: "demo", launched: false, launchId: null, lastKernelStatus: "running", isPaused: false });
    expect(s.sessionId).toMatch(/^demo-\d+$/);
    expect(Date.parse(s.connectedAt)).not.toBeNaN();
    sessionId = s.sessionId;
  });

  it("kernel_inspect", async () => {
    const out = await t.callTool("kernel_inspect");
    expect(out.sessionId).toBe(sessionId);
    expect(out.status).toBe("running");
    expect(out.plugins.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(["game.loop", "game.world", "debug.devbridge"]));
    expect((await t.callTool("kernel_inspect", { sessionId })).status).toBe("running");
    await expect(t.callTool("kernel_inspect", { sessionId: "outro-9" })).rejects.toMatchObject({ code: "NO_RUNTIME" });
  });

  it("loop_control pause/step/resume/stats", async () => {
    await expect(t.callTool("loop_control", { action: "step", ticks: 2 })).rejects.toMatchObject({ code: "BRIDGE_ERROR", details: { code: "NOT_AVAILABLE" } });
    expect((await t.callTool("loop_control", { action: "pause" })).stats.isPaused).toBe(true);
    const step = await t.callTool("loop_control", { action: "step", ticks: 3 });
    expect(step.ticksRun).toBe(3);
    expect(step.stats.runningTimeSeconds).toBeCloseTo(3 / 60, 6);
    expect((await t.callTool("loop_control", { action: "stats" })).stats.isPaused).toBe(true);
    await expect(t.callTool("loop_control", { action: "pause", ticks: 2 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("loop_control", { action: "step", ticks: 601 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("loop_control", { action: "voar" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await t.callTool("loop_control", { action: "resume" })).stats.isPaused).toBe(false);
  });

  it("world_spawn / entities / entity / patch / snapshot / despawn", async () => {
    const spawn = await t.callTool("world_spawn", { entityId: "e1", type: "crate", position: { x: 1 }, tags: ["box"], customData: { hp: 3 } });
    expect(spawn).toMatchObject({ sessionId, spawned: true, replaced: false, entity: { entityId: "e1", type: "crate", position: { x: 1, y: 0, z: 0 } } });
    await t.callTool("world_spawn", { entityId: "e2", type: "tree", position: { x: 50, y: 0, z: 0 } });
    const all = await t.callTool("world_entities");
    expect(all.entities.map((e: { entityId: string }) => e.entityId)).toEqual(expect.arrayContaining(["e1", "e2"]));
    expect((await t.callTool("world_entities", { type: "crate" })).entities.map((e: { entityId: string }) => e.entityId)).toEqual(["e1"]);
    const near = await t.callTool("world_entities", { near: { x: 0, y: 0, z: 0, r: 5 } });
    expect(near.entities).toEqual([expect.objectContaining({ entityId: "e1", distance: 1 })]);
    expect((await t.callTool("world_entities", { limit: 1 })).returned).toBe(1);
    expect((await t.callTool("world_entity", { entityId: "e1" })).customData).toEqual({ hp: 3 });
    await expect(t.callTool("world_entity", { entityId: "nao" })).rejects.toMatchObject({ code: "NOT_FOUND", details: { code: "NOT_FOUND" } });
    const patched = await t.callTool("world_patch", { entityId: "e1", patch: { position: { x: 4, y: 0, z: 0 }, tags: ["moved"] } });
    expect(patched.entity).toMatchObject({ position: { x: 4, y: 0, z: 0 }, tags: ["moved"] });
    await expect(t.callTool("world_patch", { entityId: "e1", patch: { position: { x: "a" } } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("world_patch", { entityId: "nao", patch: { tags: [] } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const snap = await t.callTool("world_snapshot");
    expect(snap.entityCount).toBeGreaterThanOrEqual(2);
    expect(snap.state).toBeTypeOf("object");
    expect(await t.callTool("world_despawn", { entityId: "e2" })).toMatchObject({ despawned: true });
    await expect(t.callTool("world_despawn", { entityId: "e2" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("world_spawn", { entityId: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("physics_raycast / physics_stats", async () => {
    const ray = await t.callTool("physics_raycast", { origin: { x: 3, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: 10 });
    expect(ray.hit).toMatchObject({ hit: true, entityId: "wall", point: { x: 3 } });
    await expect(t.callTool("physics_raycast", { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 }, maxDistance: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await t.callTool("physics_stats")).toMatchObject({ rigidBodyCount: 1, isWasmLoaded: true });
  });

  it("camera_get / camera_set", async () => {
    expect(await t.callTool("camera_get")).toMatchObject({ available: true, activeCameraId: "main", snapshot: { fov: 60 } });
    expect(await t.callTool("camera_set", { cameraId: "alt" })).toMatchObject({ activeCameraId: "alt" });
    expect(await t.callTool("camera_set", { followTargetId: "e1" })).toMatchObject({ followTargetId: "e1" });
    expect(await t.callTool("camera_set", { followTargetId: null })).toMatchObject({ followTargetId: null });
    await expect(t.callTool("camera_set", { cameraId: "nenhuma" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("camera_set", {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("input_send dispara eventos DOM", async () => {
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent): void => {
      seen.push(`${e.type}:${e.code}`);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    try {
      const out = await t.callTool("input_send", { keys: [{ code: "KeyW", down: true }, { code: "KeyW", down: false }], pointer: { x: 10, y: 5, buttons: 1 }, wheel: { deltaY: 3 } });
      expect(out.dispatched).toBeGreaterThanOrEqual(4);
      expect(seen).toEqual(["keydown:KeyW", "keyup:KeyW"]);
    } finally {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    }
    await expect(t.callTool("input_send", {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("events_subscribe / events_tail", async () => {
    expect((await t.callTool("events_subscribe", { patterns: ["game.world.*"] })).patterns).toEqual(["game.world.*"]);
    const mark = (await t.callTool("events_tail")).lastSeq;
    await t.callTool("world_spawn", { entityId: "ev1" });
    const tail = await t.callTool("events_tail", { since: mark });
    expect(tail.events.length).toBeGreaterThan(0);
    expect(tail.events.every((e: { type: string }) => e.type.startsWith("game.world."))).toBe(true);
    await expect(t.callTool("events_subscribe", { patterns: ["a b"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await t.callTool("events_subscribe", { patterns: ["*"] });
  });

  it("commands_send só game.*", async () => {
    const out = await t.callTool("commands_send", { command: "game.world.spawn-entity", payload: { state: { entityId: "cmd1" } } });
    expect(out.command).toBe("game.world.spawn-entity");
    expect(game!.services.world?.hasEntity("cmd1")).toBe(true);
    await expect(t.callTool("commands_send", { command: "game.nao.existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("commands_send", { command: "kernel.stop" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("logs_tail captura o console do jogo", async () => {
    const mark = (await t.callTool("logs_tail")).lastSeq;
    console.warn("aviso-runtime-t6");
    const warns = await t.callTool("logs_tail", { since: mark, level: "warn" });
    expect(warns.logs.map((l: { message: string }) => l.message)).toContain("aviso-runtime-t6");
    await expect(t.callTool("logs_tail", { level: "fatal" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("screenshot devolve imagem MCP + {width,height,bytes}", async () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${PNG_1PX}`);
    try {
      const raw = await t.callToolRaw("screenshot");
      expect(raw.isError).toBeFalsy();
      expect(raw.structuredContent).toEqual({ sessionId, mimeType: "image/png", width: 640, height: 360, bytes: Buffer.from(PNG_1PX, "base64").length });
      const image = raw.content.find((c) => c.type === "image") as { data: string; mimeType: string } | undefined;
      expect(image).toEqual({ type: "image", data: PNG_1PX, mimeType: "image/png" });
      expect(Buffer.from(image!.data, "base64").subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      spy.mockReturnValue("data:,");
      await expect(t.callTool("screenshot")).rejects.toMatchObject({ code: "BRIDGE_ERROR", details: { code: "METHOD_FAILED" } });
    } finally {
      spy.mockRestore();
    }
    await expect(t.callTool("screenshot", { maxWidth: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("perf_stats / storage_slots", async () => {
    expect(await t.callTool("perf_stats")).toMatchObject({ drawCalls: 7, triangles: 120, tickRate: 60 });
    expect((await t.callTool("storage_slots")).slots[0]).toMatchObject({ slotName: "slot-1" });
  });

  it("scene_load_live: inline, arquivo com prefabs e erros", async () => {
    const inline = {
      format: "engine.scene",
      version: 1,
      sceneId: "inline-1",
      sceneName: "Inline",
      entities: [
        { id: "a1", type: "crate", position: { x: 0, y: 1, z: 0 } },
        { id: "a2", type: "crate", position: { x: 3, y: 1, z: 0 }, tags: ["t"] },
      ],
    };
    const out = await t.callTool("scene_load_live", { id: "demo", scene: inline });
    expect(out).toMatchObject({ sessionId, source: "inline", loaded: true, sceneId: "inline-1", prefabsLoaded: 1, projectMismatch: false });
    const listed = await t.callTool("world_entities", { type: "crate" });
    expect(listed.entities.map((e: { entityId: string }) => e.entityId)).toEqual(expect.arrayContaining(["a1", "a2"]));

    const file = await t.callTool("scene_load_live", { id: "demo", scene: "fase-1" });
    expect(file).toMatchObject({ source: "src/projects/demo/scenes/fase-1.scene.json", loaded: true, sceneId: "fase-1" });
    expect((await t.callTool("world_entity", { entityId: "c2" })).customData).toEqual({ hp: 9 });
    expect((await t.callTool("world_entity", { entityId: "c1" })).tags).toEqual(["caixa"]);

    await expect(t.callTool("scene_load_live", { id: "demo", scene: "quebrada" })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("scene_load_live", { id: "demo", scene: { ...inline, entities: [{ id: "x", prefab: "nao" }] } })).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
    await expect(t.callTool("scene_load_live", { id: "demo", scene: "nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("scene_load_live", { id: "demo", scene: "../../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("scene_load_live", { id: "outro", scene: inline })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("handshake: token errado, protocolo errado, sem hello e Origin externa são recusados", async () => {
    const wrong = await rawClient(bridgeUrl, hello("x".repeat(32)));
    raws.push(wrong);
    expect(await wrong.waitFor((m) => m.type === "reject")).toMatchObject({ reason: "token inválido" });
    await wrong.closed;

    const proto = await rawClient(bridgeUrl, hello(token, "raw", 2));
    raws.push(proto);
    expect((await proto.waitFor((m) => m.type === "reject")).reason).toMatch(/protocolo 2/);
    await proto.closed;

    const noHello = await rawClient(bridgeUrl, { type: "ping", ts: 1 });
    raws.push(noHello);
    expect((await noHello.waitFor((m) => m.type === "reject")).reason).toMatch(/hello/);

    await expect(rawClient(bridgeUrl, undefined, { Origin: "https://evil.example" })).rejects.toThrow();

    // DevBridge real com token errado fica "rejected"
    const badGame = await bootGame(bridgeUrl, newBridgeToken(), "intruso");
    try {
      await waitFor(() => badGame.handle.bridge?.state === "rejected", 3000, "DevBridge rejeitado");
    } finally {
      await stopGame(badGame);
    }
    expect((await t.callTool("runtime_status", { refresh: false })).sessions).toHaveLength(1);
  });

  it("várias sessões: ambiguidade, timeout, ping e desconexão no meio", async () => {
    const raw = await rawClient(bridgeUrl, hello(token, "raw"));
    raws.push(raw);
    const welcome = await raw.waitFor((m) => m.type === "welcome");
    expect(welcome).toMatchObject({ protocol: 1, sessionId: expect.stringMatching(/^raw-\d+$/) });
    const rawId = welcome.sessionId as string;

    raw.socket.send(JSON.stringify({ type: "ping", ts: 42 }));
    expect(await raw.waitFor((m) => m.type === "pong")).toEqual({ type: "pong", ts: 42 });

    await expect(t.callTool("kernel_inspect")).rejects.toMatchObject({ code: "INVALID_INPUT", details: { sessions: expect.any(Array) } });
    // scene_load_live escolhe a sessão do mesmo projeto quando ambígua
    const scene = { format: "engine.scene", version: 1, sceneId: "amb", sceneName: "Amb", entities: [] };
    expect((await t.callTool("scene_load_live", { id: "demo", scene })).sessionId).toBe(sessionId);

    const started = Date.now();
    await expect(t.callTool("physics_stats", { sessionId: rawId })).rejects.toMatchObject({ code: "BRIDGE_TIMEOUT", details: { method: "physics.stats" } });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);

    // resposta de erro e resposta ok do cliente cru
    raw.socket.on("message", (data) => {
      const m = JSON.parse(rawToString(data)) as { type: string; id: number; method: string };
      if (m.type !== "req") return;
      if (m.method === "camera.get") raw.socket.send(JSON.stringify({ type: "res", id: m.id, ok: false, error: { code: "NOT_AVAILABLE", message: "sem câmera" } }));
      if (m.method === "storage.slots") raw.socket.send(JSON.stringify({ type: "res", id: m.id, ok: true, result: { slots: [] } }));
    });
    await expect(t.callTool("camera_get", { sessionId: rawId })).rejects.toMatchObject({ code: "BRIDGE_ERROR", details: { code: "NOT_AVAILABLE" } });
    expect(await t.callTool("storage_slots", { sessionId: rawId })).toEqual({ sessionId: rawId, slots: [] });

    const pending = t.callTool("world_snapshot", { sessionId: rawId });
    await waitFor(() => raw.messages.length >= 0 && (getBridgeServer(t.ctx)?.get(rawId)?.info().pendingRequests ?? 0) > 0, 2000, "requisição pendente");
    raw.socket.close();
    await expect(pending).rejects.toMatchObject({ code: "NO_RUNTIME" });
    await waitFor(async () => (await t.callTool("runtime_status", { refresh: false })).sessions.length === 1, 3000, "sessão crua removida");
  });

  it("runtime_stop numa sessão manual fecha a sessão (o DevBridge reconecta)", async () => {
    await expect(t.callTool("runtime_stop", { sessionId: "nada-1" })).rejects.toMatchObject({ code: "NO_RUNTIME" });
    const out = await t.callTool("runtime_stop", { sessionId });
    expect(out).toMatchObject({ sessionId, launched: false, closedSessions: [sessionId], closedBrowser: false, killedVite: false });
    await waitFor(
      async () => {
        const s = (await t.callTool("runtime_status", { refresh: false })).sessions;
        return s.length === 1 && s[0].sessionId !== sessionId;
      },
      5000,
      "reconexão do DevBridge",
    );
    expect((await t.callTool("kernel_inspect")).status).toBe("running");
  });

  it("runtime_launch: NOT_FOUND e PLAYWRIGHT_MISSING (antes de subir o vite)", async () => {
    await expect(t.callTool("runtime_launch", { id: "nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const spawned = t.ctx.exec.running;
    const err = await t.callTool("runtime_launch", { id: "demo" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "PLAYWRIGHT_MISSING" });
    expect((err as { hint: string }).hint).toMatch(/npm i -D playwright/);
    expect((err as { hint: string }).hint).toMatch(/runtime_connect_info/);
    expect(t.ctx.exec.running).toBe(spawned);
    await expect(t.callTool("runtime_launch", { id: "demo", timeoutMs: 10 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("encerrar o servidor fecha o bridge e as sessões", async () => {
    const port = Number(new URL(bridgeUrl).port);
    await t.close();
    expect(getBridgeServer(t.ctx)).toBeNull();
    await waitFor(() => game!.handle.bridge?.state === "connecting", 3000, "DevBridge desconectado");
    await expect(rawClient(`ws://127.0.0.1:${port}`, undefined)).rejects.toThrow();
  });
});

describe("runtime: porta do bridge ocupada", () => {
  it("cai para uma porta livre e informa", async () => {
    const busy = net.createServer();
    const port = await findFreePort();
    await new Promise<void>((resolve) => busy.listen(port, "127.0.0.1", () => resolve()));
    const repo = await makeTempRepo();
    await mkdir(path.join(repo.root, "src/projects/demo"), { recursive: true });
    await writeFile(path.join(repo.root, "src/projects/demo/index.ts"), "export {};\n");
    const t = await createTestClient({ root: repo.root, config: { bridgePort: port } });
    try {
      const info = await t.callTool("runtime_connect_info", { id: "demo" });
      expect(info.bridgePortFallback).toBe(true);
      expect(info.bridgePort).not.toBe(port);
      const status = await t.callTool("runtime_status");
      expect(status.bridge).toMatchObject({ requestedPort: port, fallback: true, port: info.bridgePort });
    } finally {
      await t.close();
      await new Promise<void>((resolve) => busy.close(() => resolve()));
      await repo.cleanup();
    }
  });
});
