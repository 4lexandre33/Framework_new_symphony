import type { Plugin } from "@core";
import { createSteamPlugin } from "../plugins/steam/plugin";
import { createInputPlugin } from "../plugins/input/plugin";
import { createAssetsPlugin } from "../plugins/assets/plugin";
import { createGameLoopPlugin } from "../plugins/game-loop/plugin";
import { createRenderPlugin } from "../plugins/render/plugin";
import { createNetworkPlugin } from "../plugins/net/plugin";
import { createPhysicsPlugin } from "../plugins/physics/plugin";
import { createStoragePlugin } from "../plugins/storage/plugin";
import { createWorldPlugin } from "../plugins/world/plugin";
import { createUIPlugin } from "../plugins/ui/plugin";
import { createAnimationPlugin } from "../plugins/anim/plugin";
import { createSpritesPlugin } from "../plugins/sprites/plugin";
import { createAudioPlugin } from "../plugins/audio/plugin";
import { createCameraPlugin } from "../plugins/camera/plugin";
import { createAIPlugin } from "../plugins/ai/plugin";
import { createVFXPlugin } from "../plugins/vfx/plugin";
import { createTerrainPlugin } from "../plugins/terrain/plugin";
import { createScriptingPlugin } from "../plugins/scripting/plugin";
import { createStreamingPlugin } from "../plugins/streaming/plugin";
import { createOverlayPlugin } from "../plugins/overlay/plugin";
import { createSecurityPlugin } from "../plugins/security/plugin";
import { createModdingPlugin } from "../plugins/modding/plugin";
import { createMonetizationPlugin } from "../plugins/monetization/plugin";

import {
  createDebugOverlayPlugin,
  type DebugOverlayPluginOptions,
} from "../plugins/debug/plugin";

export function createEnginePlugins(
  debugOptions: DebugOverlayPluginOptions
): readonly Plugin[] {
  return [
    createSteamPlugin(),
    createInputPlugin(),
    createAssetsPlugin(),
    createGameLoopPlugin(),
    createRenderPlugin(),
    createNetworkPlugin(),
    createPhysicsPlugin(),
    createStoragePlugin(),
    createWorldPlugin(),
    createUIPlugin(),
    createAnimationPlugin(),
    createSpritesPlugin(),
    createAudioPlugin(),
    createCameraPlugin(),
    createAIPlugin(),
    createVFXPlugin(),
    createTerrainPlugin(),
    createScriptingPlugin(),
    createStreamingPlugin(),
    createOverlayPlugin(),
    createSecurityPlugin(),
    createModdingPlugin(),
    createMonetizationPlugin(),
    createDebugOverlayPlugin(debugOptions),
  ];
}