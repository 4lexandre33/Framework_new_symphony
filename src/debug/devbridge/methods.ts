/**
 * Tabela FECHADA de métodos do DevBridge (SPEC §3.4). Cada método valida os
 * parâmetros à mão e devolve só dados JSON-safe. Nada de eval/código livre.
 */
import type { EngineServices } from "../../app/EngineServices";
import type { GameLoopApi } from "../../tokens/game-loop";
import type { Render3DApi } from "../../tokens/render";
import type { EntityComponentState, EntitySpawnInput, EntityStatePatch } from "../../contracts/world/types";
import { toJsonSafe, isCapturedLogLevel, type EventCapture, type LogCapture } from "./capture";
import {
  DEVBRIDGE_COMMAND_RE,
  DEVBRIDGE_DEFAULT_SCREENSHOT_WIDTH,
  isSideEffectDevBridgeCommand,
  DEVBRIDGE_MAX_LIST_LIMIT,
  DEVBRIDGE_MAX_SCREENSHOT_WIDTH,
  DEVBRIDGE_MAX_STEP_TICKS,
  type CameraGetResult,
  type DevBridgeErrorCode,
  type DevBridgeMethod,
  type EntitySnapshot,
  type LoopStatsResult,
  type PerfStatsResult,
  type ScreenshotResult,
} from "./protocol";

export class DevBridgeMethodError extends Error {
  public constructor(public readonly code: DevBridgeErrorCode, message: string) {
    super(message);
    this.name = "DevBridgeMethodError";
  }
}

export interface DevBridgeKernelLike {
  readonly status: string;
  inspect(): unknown;
}

export interface DevBridgeRuntime {
  readonly kernel: DevBridgeKernelLike;
  readonly services: EngineServices;
  getLoop(): GameLoopApi | null;
  getRender(): Render3DApi | null;
  request(type: string, payload: unknown): Promise<unknown>;
  getCanvas(): HTMLCanvasElement | null;
  getFollowTargetId(): string | null;
  setFollowTargetId(entityId: string | null): void;
  getLastSceneError(): { seq: number; payload: unknown } | null;
  readonly logs: LogCapture;
  readonly events: EventCapture;
  /** Alvo de teclado/blur (padrão window). */
  readonly inputWindow: EventTarget | null;
  /**
   * Opt-in do JOGO para comandos com efeito externo em `commands.send`
   * (`devbridgeUnsafe=1` / `VITE_DEVBRIDGE_UNSAFE=1`). Padrão false: recusa.
   */
  readonly allowSideEffectCommands?: boolean;
}

export type DevBridgeMethodHandler = (params: unknown) => unknown | Promise<unknown>;
export type DevBridgeMethodTable = Readonly<Record<DevBridgeMethod, DevBridgeMethodHandler>>;

// ── validação ────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function invalid(message: string): never {
  throw new DevBridgeMethodError("INVALID_PARAMS", message);
}

function notAvailable(what: string): never {
  throw new DevBridgeMethodError("NOT_AVAILABLE", `${what} não está disponível neste jogo/sessão`);
}

function obj(params: unknown, allowed: readonly string[]): Obj {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) invalid("params deve ser um objeto");
  const record = params as Obj;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) invalid(`parâmetro desconhecido: ${key} (aceitos: ${allowed.join(", ") || "nenhum"})`);
  }
  return record;
}

function optString(o: Obj, key: string, max = 256): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length === 0 || v.length > max) invalid(`${key} deve ser texto de 1 a ${max} caracteres`);
  return v;
}

function reqString(o: Obj, key: string, max = 256): string {
  const v = optString(o, key, max);
  if (v === undefined) invalid(`${key} é obrigatório`);
  return v;
}

function optNumber(o: Obj, key: string, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) invalid(`${key} deve ser número finito em [${min}, ${max}]`);
  return v;
}

function optInt(o: Obj, key: string, min: number, max: number): number | undefined {
  const v = optNumber(o, key, min, max);
  if (v !== undefined && !Number.isInteger(v)) invalid(`${key} deve ser inteiro`);
  return v;
}

function vec(value: unknown, key: string, keys: readonly string[] = ["x", "y", "z"], partial = false): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${key} deve ser {${keys.join(",")}}`);
  const o = obj(value, keys);
  for (const k of keys) {
    if (o[k] === undefined && partial) continue;
    if (typeof o[k] !== "number" || !Number.isFinite(o[k] as number)) invalid(`${key}.${k} deve ser número finito`);
  }
  return o;
}

function optRecord(o: Obj, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "object" || v === null || Array.isArray(v)) invalid(`${key} deve ser um objeto`);
  return v as Record<string, unknown>;
}

function optStringArray(o: Obj, key: string, maxItems: number, maxLen = 128): string[] | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > maxItems) invalid(`${key} deve ser lista com até ${maxItems} textos`);
  for (const item of v) {
    if (typeof item !== "string" || item.length === 0 || item.length > maxLen) invalid(`${key}: cada item deve ser texto de 1 a ${maxLen} caracteres`);
  }
  return [...(v as string[])];
}

// ── conversões ───────────────────────────────────────────────────────────

function entitySnapshot(state: EntityComponentState, distance?: number): EntitySnapshot {
  const base: EntitySnapshot = {
    entityId: state.entityId,
    type: state.type,
    position: { x: state.position.x, y: state.position.y, z: state.position.z },
    rotation: { x: state.rotation.x, y: state.rotation.y, z: state.rotation.z, w: state.rotation.w },
    scale: { x: state.scale.x, y: state.scale.y, z: state.scale.z },
    tags: [...state.tags],
    customData: toJsonSafe(state.customData, { maxDepth: 6 }),
  };
  return distance === undefined ? base : { ...base, distance };
}

function loopStats(loop: GameLoopApi | null): LoopStatsResult {
  if (loop === null) {
    return { available: false, fps: 0, targetFps: 0, tickRate: 0, isPaused: false, isHidden: false, runningTimeSeconds: 0 };
  }
  const s = loop.getStats();
  return {
    available: true,
    fps: s.fps,
    targetFps: s.targetFps,
    tickRate: s.tickRate,
    isPaused: s.isPaused,
    isHidden: s.isHidden,
    runningTimeSeconds: s.runningTimeSeconds,
  };
}

function parseEntityPatch(value: unknown): EntityStatePatch {
  const p = obj(value, ["type", "position", "rotation", "scale", "tags", "customData"]);
  const out: {
    type?: string;
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scale?: { x: number; y: number; z: number };
    tags?: string[];
    customData?: Record<string, unknown>;
  } = {};
  const type = optString(p, "type", 128);
  if (type !== undefined) out.type = type;
  if (p.position !== undefined) out.position = vec(p.position, "position") as unknown as { x: number; y: number; z: number };
  if (p.rotation !== undefined) out.rotation = vec(p.rotation, "rotation", ["x", "y", "z", "w"]) as unknown as { x: number; y: number; z: number; w: number };
  if (p.scale !== undefined) out.scale = vec(p.scale, "scale") as unknown as { x: number; y: number; z: number };
  const tags = optStringArray(p, "tags", 64);
  if (tags !== undefined) out.tags = tags;
  const customData = optRecord(p, "customData");
  if (customData !== undefined) out.customData = customData;
  return out;
}

const KEY_FROM_CODE: Readonly<Record<string, string>> = {
  Space: " ",
  Enter: "Enter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  ControlLeft: "Control",
  ControlRight: "Control",
  AltLeft: "Alt",
  AltRight: "Alt",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
};

function keyFromCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return KEY_FROM_CODE[code] ?? code;
}

/** bit do `buttons` → índice `button` do DOM. */
const BUTTON_BITS: readonly [number, number][] = [
  [1, 0],
  [2, 2],
  [4, 1],
];

// ── tabela ───────────────────────────────────────────────────────────────

export function createDevBridgeMethods(rt: DevBridgeRuntime): DevBridgeMethodTable {
  const pointerState = { x: 0, y: 0, buttons: 0 };

  const world = () => rt.services.world ?? notAvailable("game.world");
  const loop = () => rt.getLoop() ?? notAvailable("game.loop");

  const inputTarget = (): EventTarget => {
    const canvas = rt.getCanvas();
    if (canvas !== null) return canvas;
    if (rt.inputWindow !== null) return rt.inputWindow;
    return notAvailable("alvo de input (canvas/window)");
  };

  const cameraGet = (): CameraGetResult => {
    const camera = rt.services.camera;
    if (camera === null) return { available: false, activeCameraId: null, followTargetId: rt.getFollowTargetId(), snapshot: null };
    const snap = camera.getCurrentCameraSnapshot();
    return {
      available: true,
      activeCameraId: camera.getActiveCameraId(),
      followTargetId: rt.getFollowTargetId(),
      snapshot: snap === null
        ? null
        : {
            position: { x: snap.position.x, y: snap.position.y, z: snap.position.z },
            rotation: { x: snap.rotation.x, y: snap.rotation.y, z: snap.rotation.z, w: snap.rotation.w },
            fov: snap.fov,
          },
    };
  };

  return {
    "kernel.inspect": (params) => {
      obj(params, []);
      return toJsonSafe(rt.kernel.inspect(), { maxDepth: 8, maxArrayItems: 500 });
    },

    "loop.stats": (params) => {
      obj(params, []);
      return loopStats(rt.getLoop());
    },

    "loop.pause": (params) => {
      const p = obj(params, ["freezeRender"]);
      if (p.freezeRender !== undefined && typeof p.freezeRender !== "boolean") invalid("freezeRender deve ser booleano");
      const l = loop();
      l.pause(p.freezeRender === true ? { freezeRender: true } : undefined);
      return loopStats(l);
    },

    "loop.resume": (params) => {
      obj(params, []);
      const l = loop();
      l.resume();
      return loopStats(l);
    },

    "loop.step": async (params) => {
      const p = obj(params, ["ticks"]);
      const ticks = optInt(p, "ticks", 1, DEVBRIDGE_MAX_STEP_TICKS) ?? 1;
      const l = loop();
      if (!l.getStats().isPaused) {
        throw new DevBridgeMethodError("NOT_AVAILABLE", "loop.step exige o loop pausado (use loop.pause antes)");
      }
      const ticksRun = await l.stepTicks(ticks);
      return { ticksRun, stats: loopStats(l) };
    },

    "world.list": (params) => {
      const p = obj(params, ["type", "tag", "near", "limit"]);
      const type = optString(p, "type", 128);
      const tag = optString(p, "tag", 128);
      const limit = optInt(p, "limit", 1, DEVBRIDGE_MAX_LIST_LIMIT) ?? 100;
      const w = world();
      let candidates: { state: EntityComponentState; distance?: number }[];
      if (p.near !== undefined) {
        const near = vec(p.near, "near", ["x", "y", "z", "r"]);
        const r = near.r as number;
        if (r <= 0) invalid("near.r deve ser > 0");
        candidates = [];
        for (const hit of w.querySphere({ x: near.x as number, y: near.y as number, z: near.z as number }, r)) {
          const state = w.getEntityState(hit.entityId);
          if (state !== null) candidates.push({ state, distance: hit.distance });
        }
      } else {
        candidates = w.getAllEntities().map((state) => ({ state }));
      }
      const filtered = candidates.filter(
        (c) => (type === undefined || c.state.type === type) && (tag === undefined || c.state.tags.includes(tag)),
      );
      const entities = filtered.slice(0, limit).map((c) => entitySnapshot(c.state, c.distance));
      return { total: filtered.length, returned: entities.length, entities };
    },

    "world.get": (params) => {
      const p = obj(params, ["entityId"]);
      const entityId = reqString(p, "entityId", 128);
      const state = world().getEntityState(entityId);
      if (state === null) throw new DevBridgeMethodError("NOT_FOUND", `entidade "${entityId}" não existe`);
      return entitySnapshot(state);
    },

    "world.spawn": (params) => {
      const p = obj(params, ["entityId", "type", "position", "rotation", "scale", "tags", "customData"]);
      const entityId = reqString(p, "entityId", 128);
      const input: {
        -readonly [K in keyof EntitySpawnInput]: EntitySpawnInput[K];
      } = { entityId };
      const type = optString(p, "type", 128);
      if (type !== undefined) input.type = type;
      if (p.position !== undefined) input.position = vec(p.position, "position", ["x", "y", "z"], true) as EntitySpawnInput["position"];
      if (p.rotation !== undefined) input.rotation = vec(p.rotation, "rotation", ["x", "y", "z", "w"]) as unknown as EntitySpawnInput["rotation"];
      if (p.scale !== undefined) input.scale = vec(p.scale, "scale", ["x", "y", "z"], true) as EntitySpawnInput["scale"];
      const tags = optStringArray(p, "tags", 64);
      if (tags !== undefined) input.tags = tags;
      const customData = optRecord(p, "customData");
      if (customData !== undefined) input.customData = customData;
      const w = world();
      const replaced = w.hasEntity(entityId);
      if (!w.spawnEntity(input)) invalid("o world recusou a entidade (valores inválidos)");
      const state = w.getEntityState(entityId);
      return { spawned: true, replaced, entity: state === null ? null : entitySnapshot(state) };
    },

    "world.despawn": (params) => {
      const p = obj(params, ["entityId"]);
      const entityId = reqString(p, "entityId", 128);
      const w = world();
      if (!w.hasEntity(entityId)) throw new DevBridgeMethodError("NOT_FOUND", `entidade "${entityId}" não existe`);
      return { despawned: w.despawnEntity(entityId) };
    },

    "world.patch": (params) => {
      const p = obj(params, ["entityId", "patch"]);
      const entityId = reqString(p, "entityId", 128);
      if (p.patch === undefined) invalid("patch é obrigatório");
      const patch = parseEntityPatch(p.patch);
      const w = world();
      if (!w.hasEntity(entityId)) throw new DevBridgeMethodError("NOT_FOUND", `entidade "${entityId}" não existe`);
      if (!w.patchEntity(entityId, patch)) invalid("o world recusou o patch (valores inválidos)");
      const state = w.getEntityState(entityId);
      return { patched: true, entity: state === null ? null : entitySnapshot(state) };
    },

    "world.snapshot": (params) => {
      obj(params, []);
      const w = world();
      const raw = w.serializeWorldState();
      let state: unknown;
      try {
        state = JSON.parse(raw);
      } catch {
        state = raw;
      }
      return { sceneId: w.currentSceneId, entityCount: w.activeEntityCount, state };
    },

    "physics.raycast": (params) => {
      const p = obj(params, ["origin", "direction", "maxDistance", "excludeEntityId"]);
      if (p.origin === undefined || p.direction === undefined) invalid("origin e direction são obrigatórios");
      const origin = vec(p.origin, "origin");
      const direction = vec(p.direction, "direction");
      const maxDistance = optNumber(p, "maxDistance", Number.MIN_VALUE, 1e6);
      if (maxDistance === undefined) invalid("maxDistance é obrigatório");
      const excludeEntityId = optString(p, "excludeEntityId", 128);
      const physics = rt.services.physics ?? notAvailable("game.physics");
      const hit = physics.castRay({
        origin: origin as unknown as { x: number; y: number; z: number },
        direction: direction as unknown as { x: number; y: number; z: number },
        maxDistance,
        ...(excludeEntityId === undefined ? {} : { excludeEntityId }),
      });
      return toJsonSafe(hit);
    },

    "physics.stats": (params) => {
      obj(params, []);
      const physics = rt.services.physics ?? notAvailable("game.physics");
      return toJsonSafe(physics.getStats());
    },

    "camera.get": (params): CameraGetResult => {
      obj(params, []);
      return cameraGet();
    },

    "camera.set": (params) => {
      const p = obj(params, ["cameraId", "followTargetId"]);
      const cameraId = optString(p, "cameraId", 128);
      const follow = p.followTargetId;
      if (follow !== undefined && follow !== null && (typeof follow !== "string" || follow.length === 0 || follow.length > 128)) {
        invalid("followTargetId deve ser id de entidade ou null");
      }
      if (cameraId === undefined && follow === undefined) invalid("informe cameraId e/ou followTargetId");
      const camera = rt.services.camera ?? notAvailable("game.camera");
      if (cameraId !== undefined && !camera.setActiveCamera(cameraId)) {
        throw new DevBridgeMethodError("NOT_FOUND", `câmera "${cameraId}" não está registrada`);
      }
      if (follow === null) {
        const active = camera.getActiveCameraId();
        rt.setFollowTargetId(null);
        if (active !== null) camera.clearFollowTarget(active);
      } else if (typeof follow === "string") {
        if (!world().hasEntity(follow)) throw new DevBridgeMethodError("NOT_FOUND", `entidade "${follow}" não existe`);
        rt.setFollowTargetId(follow);
      }
      return cameraGet();
    },

    "input.send": (params) => {
      const p = obj(params, ["keys", "pointer", "wheel"]);
      if (p.keys === undefined && p.pointer === undefined && p.wheel === undefined) invalid("informe keys, pointer e/ou wheel");
      let dispatched = 0;

      if (p.keys !== undefined) {
        if (!Array.isArray(p.keys) || p.keys.length > 64) invalid("keys deve ser lista com até 64 itens");
        const keyTarget = rt.inputWindow ?? notAvailable("window");
        const parsed = p.keys.map((k, i) => {
          const o = obj(k, ["code", "down", "key"]);
          const code = reqString(o, "code", 32);
          if (typeof o.down !== "boolean") invalid(`keys[${i}].down deve ser booleano`);
          return { code, down: o.down, key: optString(o, "key", 32) ?? keyFromCode(code) };
        });
        for (const k of parsed) {
          keyTarget.dispatchEvent(
            new KeyboardEvent(k.down ? "keydown" : "keyup", { code: k.code, key: k.key, bubbles: true, cancelable: true }),
          );
          dispatched += 1;
        }
      }

      if (p.pointer !== undefined) {
        const o = obj(p.pointer, ["x", "y", "buttons"]);
        const x = optNumber(o, "x", -1e6, 1e6);
        const y = optNumber(o, "y", -1e6, 1e6);
        if (x === undefined || y === undefined) invalid("pointer.x e pointer.y são obrigatórios");
        const buttons = optInt(o, "buttons", 0, 31) ?? pointerState.buttons;
        const target = inputTarget();
        const canvas = rt.getCanvas();
        const rect = canvas?.getBoundingClientRect();
        const clientX = (rect?.left ?? 0) + x;
        const clientY = (rect?.top ?? 0) + y;
        const movementX = x - pointerState.x;
        const movementY = y - pointerState.y;
        const init = { clientX, clientY, screenX: clientX, screenY: clientY, bubbles: true, cancelable: true, buttons };
        const fire = (type: string, extra: MouseEventInit = {}): void => {
          const ev = new MouseEvent(type, { ...init, ...extra });
          // movementX/Y nem sempre são aceitos no init (jsdom): define direto.
          try {
            Object.defineProperty(ev, "movementX", { value: movementX });
            Object.defineProperty(ev, "movementY", { value: movementY });
          } catch {
            // ignora
          }
          target.dispatchEvent(ev);
          dispatched += 1;
          if (typeof PointerEvent === "function") {
            const pointerType = type.replace("mouse", "pointer");
            target.dispatchEvent(new PointerEvent(pointerType, { ...init, ...extra, pointerId: 1, pointerType: "mouse", isPrimary: true }));
          }
        };
        if (movementX !== 0 || movementY !== 0 || (buttons === pointerState.buttons)) fire("mousemove");
        for (const [bit, button] of BUTTON_BITS) {
          const was = (pointerState.buttons & bit) !== 0;
          const is = (buttons & bit) !== 0;
          if (!was && is) fire("mousedown", { button });
          if (was && !is) fire("mouseup", { button });
        }
        pointerState.x = x;
        pointerState.y = y;
        pointerState.buttons = buttons;
      }

      if (p.wheel !== undefined) {
        const o = obj(p.wheel, ["deltaX", "deltaY"]);
        const deltaY = optNumber(o, "deltaY", -1e5, 1e5);
        if (deltaY === undefined) invalid("wheel.deltaY é obrigatório");
        const deltaX = optNumber(o, "deltaX", -1e5, 1e5) ?? 0;
        const rect = rt.getCanvas()?.getBoundingClientRect();
        inputTarget().dispatchEvent(
          new WheelEvent("wheel", {
            deltaX,
            deltaY,
            clientX: (rect?.left ?? 0) + pointerState.x,
            clientY: (rect?.top ?? 0) + pointerState.y,
            bubbles: true,
            cancelable: true,
          }),
        );
        dispatched += 1;
      }

      return { dispatched };
    },

    "events.subscribe": (params) => {
      const p = obj(params, ["patterns"]);
      const patterns = optStringArray(p, "patterns", 32, 128);
      if (patterns === undefined) invalid("patterns é obrigatório (lista de globs, ex.: [\"game.world.*\"])");
      for (const pattern of patterns) {
        if (!/^[A-Za-z0-9_.:*?-]+$/.test(pattern)) invalid(`padrão inválido: ${pattern} (use letras, números, . _ - : * ?)`);
      }
      rt.events.setPatterns(patterns);
      return { patterns: [...rt.events.getPatterns()] };
    },

    "events.tail": (params) => {
      const p = obj(params, ["since", "limit"]);
      const since = optInt(p, "since", 0, Number.MAX_SAFE_INTEGER);
      const limit = optInt(p, "limit", 1, 1000);
      return rt.events.tail({ since, limit });
    },

    "commands.send": async (params) => {
      const p = obj(params, ["command", "payload", "allowSideEffects"]);
      const command = reqString(p, "command", 128);
      if (!DEVBRIDGE_COMMAND_RE.test(command)) {
        throw new DevBridgeMethodError("COMMAND_NOT_ALLOWED", `só comandos game.* são permitidos (recebido "${command}")`);
      }
      if (p.allowSideEffects !== undefined && typeof p.allowSideEffects !== "boolean") invalid("allowSideEffects deve ser booleano");
      if (isSideEffectDevBridgeCommand(command)) {
        // Defesa em profundidade: o jogo recusa por padrão, mesmo que o MCP peça.
        if (rt.allowSideEffectCommands !== true) {
          throw new DevBridgeMethodError(
            "COMMAND_NOT_ALLOWED",
            `"${command}" tem efeito externo (compra/Steam/rede/workshop/janela) e este jogo não foi aberto com devbridgeUnsafe=1 (ou VITE_DEVBRIDGE_UNSAFE=1)`,
          );
        }
        if (p.allowSideEffects !== true) {
          throw new DevBridgeMethodError("COMMAND_NOT_ALLOWED", `"${command}" tem efeito externo: exige allowSideEffects=true`);
        }
      }
      try {
        const result = await rt.request(command, p.payload ?? {});
        return { command, result: toJsonSafe(result) };
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === "DISPATCH_NO_HANDLER") {
          throw new DevBridgeMethodError("NOT_FOUND", `nenhum handler registrado para "${command}"`);
        }
        throw new DevBridgeMethodError("METHOD_FAILED", `comando "${command}" falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    "logs.tail": (params) => {
      const p = obj(params, ["since", "limit", "level"]);
      if (p.level !== undefined && !isCapturedLogLevel(p.level)) invalid("level deve ser debug|log|info|warn|error");
      const since = optInt(p, "since", 0, Number.MAX_SAFE_INTEGER);
      const limit = optInt(p, "limit", 1, 1000);
      return rt.logs.tail({ since, limit, level: p.level as Parameters<LogCapture["tail"]>[0]["level"] });
    },

    screenshot: (params): ScreenshotResult => {
      const p = obj(params, ["maxWidth"]);
      const maxWidth = optInt(p, "maxWidth", 1, DEVBRIDGE_MAX_SCREENSHOT_WIDTH) ?? DEVBRIDGE_DEFAULT_SCREENSHOT_WIDTH;
      const canvas = rt.getCanvas() ?? notAvailable("canvas");
      const render = rt.getRender();
      // Desenha um frame e lê NA MESMA TAREFA: funciona sem preserveDrawingBuffer.
      if (render !== null && !render.isContextLost()) {
        render.render(1 - Number.EPSILON, 0);
      }
      const width = canvas.width;
      const height = canvas.height;
      if (width <= 0 || height <= 0) notAvailable("canvas com tamanho > 0");
      let source: HTMLCanvasElement = canvas;
      let outW = width;
      let outH = height;
      if (width > maxWidth) {
        outW = maxWidth;
        outH = Math.max(1, Math.round((height * maxWidth) / width));
        const scaled = canvas.ownerDocument.createElement("canvas");
        scaled.width = outW;
        scaled.height = outH;
        const ctx2d = scaled.getContext("2d");
        if (ctx2d === null) notAvailable("contexto 2D para reduzir a imagem");
        ctx2d.drawImage(canvas, 0, 0, outW, outH);
        source = scaled;
      }
      const url = source.toDataURL("image/png");
      const prefix = "data:image/png;base64,";
      if (typeof url !== "string" || !url.startsWith(prefix) || url.length === prefix.length) {
        throw new DevBridgeMethodError("METHOD_FAILED", "canvas.toDataURL não devolveu um PNG");
      }
      return { mimeType: "image/png", data: url.slice(prefix.length), width: outW, height: outH };
    },

    "perf.stats": (params): PerfStatsResult => {
      obj(params, []);
      const l = rt.getLoop();
      const stats = l?.getStats() ?? null;
      type RenderInfo = { render?: { calls?: number; triangles?: number }; memory?: { geometries?: number; textures?: number } };
      let info: RenderInfo | null = null;
      try {
        info = (rt.getRender()?.getRenderer().info as unknown as RenderInfo | undefined) ?? null;
      } catch {
        info = null;
      }
      const mem = (globalThis.performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } } | undefined)?.memory;
      let physics: unknown = null;
      try {
        physics = rt.services.physics ? toJsonSafe(rt.services.physics.getStats()) : null;
      } catch {
        physics = null;
      }
      return {
        fps: stats?.fps ?? null,
        frameTimeMs: stats !== null && stats.fps > 0 ? 1000 / stats.fps : null,
        tickRate: stats?.tickRate ?? null,
        drawCalls: info?.render?.calls ?? null,
        triangles: info?.render?.triangles ?? null,
        geometries: info?.memory?.geometries ?? null,
        textures: info?.memory?.textures ?? null,
        memory: mem ? { usedJSHeapSize: mem.usedJSHeapSize, totalJSHeapSize: mem.totalJSHeapSize, jsHeapSizeLimit: mem.jsHeapSizeLimit } : null,
        entities: rt.services.world?.activeEntityCount ?? null,
        physics,
      };
    },

    "storage.slots": async (params) => {
      obj(params, []);
      const storage = rt.services.storage ?? notAvailable("game.storage");
      return { slots: toJsonSafe(await storage.listSaves()) };
    },

    "scene.load": async (params) => {
      const p = obj(params, ["document", "prefabs"]);
      if (p.document === undefined || p.document === null || typeof p.document !== "object") invalid("document (SceneDocument) é obrigatório");
      const w = world();
      const loader = getSceneDocumentLoader(w);
      if (loader === null) notAvailable("world.loadSceneDocument (SceneDocument)");
      const before = rt.getLastSceneError()?.seq ?? 0;
      const ok = await loader(p.document, p.prefabs === undefined ? {} : { prefabs: p.prefabs });
      const lastError = rt.getLastSceneError();
      return {
        loaded: ok === true,
        sceneId: w.currentSceneId,
        entityCount: w.activeEntityCount,
        error: ok === true || lastError === null || lastError.seq <= before ? null : toJsonSafe(lastError.payload),
      };
    },
  };
}

type SceneDocumentLoader = (document: unknown, options: Record<string, unknown>) => Promise<unknown>;

/** Detecta `WorldApi.loadSceneDocument` (T7) sem depender do tipo em tempo de compilação. */
export function getSceneDocumentLoader(world: unknown): SceneDocumentLoader | null {
  const candidate = (world as { loadSceneDocument?: unknown } | null)?.loadSceneDocument;
  if (typeof candidate !== "function") return null;
  return (document, options) => Promise.resolve((candidate as (...args: unknown[]) => unknown).call(world, document, options));
}
