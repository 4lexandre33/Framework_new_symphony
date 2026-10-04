import type {
  Plugin,
  PluginContext,
} from "@core";
import type { CapabilityToken } from "@core";
import type { EngineServices } from "../../app/EngineServices";
import { clearEngineServices } from "../../app/EngineServices";
import { getErrorMessage } from "../../app/errors";
import { SteamToken } from "../../tokens/steam";
import { InputToken } from "../../tokens/input";
import { AssetsToken } from "../../tokens/assets";
import { PhysicsToken } from "../../tokens/physics";
import { StorageToken } from "../../tokens/storage";
import { WorldToken } from "../../tokens/world";
import { UIToken } from "../../tokens/ui";
import { AnimationToken } from "../../tokens/anim";
import { SpritesToken } from "../../tokens/sprites";
import { AudioToken } from "../../tokens/audio";
import { CameraToken } from "../../tokens/camera";
import { AiToken } from "../../tokens/ai";
import { VfxToken } from "../../tokens/vfx";
import { TerrainToken } from "../../tokens/terrain";
import { ScriptingToken } from "../../tokens/scripting";
import { StreamingToken } from "../../tokens/streaming";
import { OverlayToken } from "../../tokens/overlay";
import { SecurityToken } from "../../tokens/security";
import { ModdingToken } from "../../tokens/modding";

export interface DebugOverlayPluginOptions {
  services: EngineServices;
  appendLog(message: string): void;
  onDispose?(): void;
}

const CONSUMED_CAPABILITIES = [
  SteamToken,
  InputToken,
  AssetsToken,
  PhysicsToken,
  StorageToken,
  WorldToken,
  UIToken,
  AnimationToken,
  SpritesToken,
  AudioToken,
  CameraToken,
  AiToken,
  VfxToken,
  TerrainToken,
  ScriptingToken,
  StreamingToken,
  OverlayToken,
  SecurityToken,
  ModdingToken,
] as const;

export function createDebugOverlayPlugin(
  options: DebugOverlayPluginOptions,
): Plugin {
  return {
    manifest: {
      id: "game.debug",
      name: "Core Engine Debug Overlay Plugin",
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      permissions: {
        capabilities: CONSUMED_CAPABILITIES.map((token) => token.id),
        events: [],
      },
      capabilities: {
        consumes: CONSUMED_CAPABILITIES.map((token) => ({
          id: token.id,
          range: "^1.0.0",
          optional: false,
        })),
        conflicts: [],
      },
      lifecycleHooks: {
        onBoot(ctx: PluginContext): void {
          resolveCapabilities(ctx, options);
        },
      },
    },

    setup(ctx: PluginContext): void {
      ctx.lifecycle.onDispose((): void => {
        clearEngineServices(options.services);
        options.appendLog("♻️ game.debug liberado pelo Kernel.");
        options.onDispose?.();
      });

      ctx.lifecycle.ready();
    },
  };
}

function resolveCapabilities(
  ctx: PluginContext,
  options: DebugOverlayPluginOptions,
): void {
  resolveCapability(ctx, options, SteamToken, (value): void => {
    options.services.steam = value;
  });
  resolveCapability(ctx, options, InputToken, (value): void => {
    options.services.input = value;
  });
  resolveCapability(ctx, options, AssetsToken, (value): void => {
    options.services.assets = value;
  });
  resolveCapability(ctx, options, PhysicsToken, (value): void => {
    options.services.physics = value;
  });
  resolveCapability(ctx, options, StorageToken, (value): void => {
    options.services.storage = value;
  });
  resolveCapability(ctx, options, WorldToken, (value): void => {
    options.services.world = value;
  });
  resolveCapability(ctx, options, UIToken, (value): void => {
    options.services.ui = value;
  });
  resolveCapability(ctx, options, AnimationToken, (value): void => {
    options.services.anim = value;
  });
  resolveCapability(ctx, options, SpritesToken, (value): void => {
    options.services.sprites = value;
  });
  resolveCapability(ctx, options, AudioToken, (value): void => {
    options.services.audio = value;
  });
  resolveCapability(ctx, options, CameraToken, (value): void => {
    options.services.camera = value;
  });
  resolveCapability(ctx, options, AiToken, (value): void => {
    options.services.ai = value;
  });
  resolveCapability(ctx, options, VfxToken, (value): void => {
    options.services.vfx = value;
  });
  resolveCapability(ctx, options, TerrainToken, (value): void => {
    options.services.terrain = value;
  });
  resolveCapability(ctx, options, ScriptingToken, (value): void => {
    options.services.scripting = value;
  });
  resolveCapability(ctx, options, StreamingToken, (value): void => {
    options.services.streaming = value;
  });
  resolveCapability(ctx, options, OverlayToken, (value): void => {
    options.services.overlay = value;
  });
  resolveCapability(ctx, options, SecurityToken, (value): void => {
    options.services.security = value;
  });
  resolveCapability(ctx, options, ModdingToken, (value): void => {
    options.services.modding = value;
  });

  options.appendLog("🚀 game.debug lifecycleHooks.onBoot concluído.");
}

function resolveCapability<T>(
  ctx: PluginContext,
  options: DebugOverlayPluginOptions,
  token: CapabilityToken<T>,
  assign: (value: T | null) => void,
): void {
  try {
    const value = ctx.caps.require(token);
    assign(value);
    options.appendLog(`✅ Capability [${token.id}] vinculada ao game.debug.`);
  } catch (error: unknown) {
    assign(null);
    console.error(`[game.debug] Falha ao resolver ${token.id}:`, error);
    options.appendLog(
      `❌ Falha ao resolver [${token.id}]: ${getErrorMessage(error)}`,
    );
  }
}