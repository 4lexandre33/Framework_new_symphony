/**
 * Plugin de ferramenta (só DEV) que dá ao DevBridge um PluginContext: escuta
 * todos os eventos (`events.onAny`), envia comandos (`commands.request`) e
 * resolve `game.loop`/`game.render` (que não estão em EngineServices).
 */
import type { Plugin, PluginContext } from "@core";
import type { GameLoopApi } from "../../tokens/game-loop";
import type { Render3DApi } from "../../tokens/render";
import type { WorldApi } from "../../tokens/world";
import type { CameraApi } from "../../tokens/camera";
import type { EventCapture } from "./capture";

export const DEVBRIDGE_PLUGIN_ID = "debug.devbridge";
export const SCENE_DOCUMENT_ERROR_EVENT = "game.world.scene-document-error";

export interface DevBridgePluginHandle {
  readonly plugin: Plugin;
  getLoop(): GameLoopApi | null;
  getRender(): Render3DApi | null;
  /** Envia um command (null se o plugin ainda não passou pelo setup). */
  request(type: string, payload: unknown): Promise<unknown>;
  getFollowTargetId(): string | null;
  setFollowTargetId(entityId: string | null): void;
  /** Último `game.world.scene-document-error` visto (seq crescente). */
  getLastSceneError(): { seq: number; payload: unknown } | null;
  onDispose(fn: () => void): void;
}

export interface DevBridgePluginOptions {
  readonly events: EventCapture;
  readonly getWorld: () => WorldApi | null;
  readonly getCamera: () => CameraApi | null;
}

export function createDevBridgePlugin(options: DevBridgePluginOptions): DevBridgePluginHandle {
  let ctx: PluginContext | null = null;
  let loop: GameLoopApi | null = null;
  let render: Render3DApi | null = null;
  let followTargetId: string | null = null;
  let lastSceneError: { seq: number; payload: unknown } | null = null;
  let sceneErrorSeq = 0;
  const disposers: (() => void)[] = [];

  const followPosition = { x: 0, y: 0, z: 0 };
  const updateFollow = (): void => {
    if (followTargetId === null) return;
    try {
      const world = options.getWorld();
      const camera = options.getCamera();
      const activeId = camera?.getActiveCameraId() ?? null;
      const state = world?.getEntityState(followTargetId) ?? null;
      if (camera === null || activeId === null || state === null) return;
      followPosition.x = state.position.x;
      followPosition.y = state.position.y;
      followPosition.z = state.position.z;
      camera.setFollowTarget(activeId, followPosition);
    } catch {
      // nunca quebrar o frame do jogo
    }
  };

  const plugin: Plugin = {
    manifest: {
      id: DEVBRIDGE_PLUGIN_ID,
      name: "DevBridge (ferramenta MCP, só DEV)",
      version: "1.0.0",
      kind: "preloaded",
      authority: "debug",
      description: "Ponte de depuração com o servidor MCP local. Não existe em produção.",
      capabilities: {
        provides: [],
        consumes: [
          { id: "game.loop", range: "^1.0.0", optional: true },
          { id: "game.render", range: "^1.0.0", optional: true },
        ],
        conflicts: [],
      },
      lifecycleHooks: {
        onBoot(bootCtx: PluginContext): void {
          loop = (bootCtx.caps.getById("game.loop") as GameLoopApi | undefined) ?? null;
          render = (bootCtx.caps.getById("game.render") as Render3DApi | undefined) ?? null;
        },
      },
    },
    setup(setupCtx: PluginContext): void {
      ctx = setupCtx;
      const offAny = setupCtx.events.onAny((env) => {
        if (env.kind !== "event") return;
        if (env.type === "game.loop.render") {
          updateFollow();
        } else if (env.type === SCENE_DOCUMENT_ERROR_EVENT) {
          sceneErrorSeq += 1;
          lastSceneError = { seq: sceneErrorSeq, payload: env.payload };
        }
        options.events.onEnvelope(env);
      });
      setupCtx.lifecycle.onDispose(() => {
        offAny();
        ctx = null;
        loop = null;
        render = null;
        for (const fn of disposers.splice(0)) {
          try {
            fn();
          } catch {
            // ignora
          }
        }
      });
      setupCtx.lifecycle.ready();
    },
  };

  return {
    plugin,
    getLoop: () => loop ?? ((ctx?.caps.getById("game.loop") as GameLoopApi | undefined) ?? null),
    getRender: () => render ?? ((ctx?.caps.getById("game.render") as Render3DApi | undefined) ?? null),
    request(type: string, payload: unknown): Promise<unknown> {
      if (ctx === null) return Promise.reject(new Error("plugin do DevBridge não está ativo"));
      return ctx.commands.request(type, payload);
    },
    getFollowTargetId: () => followTargetId,
    setFollowTargetId(entityId: string | null): void {
      followTargetId = entityId;
      updateFollow();
    },
    getLastSceneError: () => lastSceneError,
    onDispose(fn: () => void): void {
      disposers.push(fn);
    },
  };
}
