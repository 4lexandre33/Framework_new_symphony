import { Kernel } from "../core/kernel";
import { SteamToken } from "../tokens/steam";
import { InputToken } from "../tokens/input";
import { AssetsToken } from "../tokens/assets";
import { GameLoopToken } from "../tokens/game-loop";
import { RenderToken } from "../tokens/render";
import { NetworkToken } from "../tokens/net";
import { PhysicsToken } from "../tokens/physics";
import { StorageToken } from "../tokens/storage";
import { WorldToken } from "../tokens/world";
import { UIToken } from "../tokens/ui";
import { AnimationToken } from "../tokens/anim";
import { SpritesToken } from "../tokens/sprites";
import { AudioToken } from "../tokens/audio";
import { CameraToken } from "../tokens/camera";
import { AiToken } from "../tokens/ai";
import { VfxToken } from "../tokens/vfx";
import { TerrainToken } from "../tokens/terrain";
import { ScriptingToken } from "../tokens/scripting";
import { StreamingToken } from "../tokens/streaming";
import { OverlayToken } from "../tokens/overlay";
import { SecurityToken } from "../tokens/security";
import { ModdingToken } from "../tokens/modding";
import { MonetizationToken } from "../tokens/monetization";
import { createEngineServices, type EngineServices } from "./EngineServices";
import { createEnginePlugins } from "./createEnginePlugins";
import { getErrorMessage } from "./errors";
import { DebugHud } from "../debug/hud/DebugHud";
import { HudRenderer } from "../debug/hud/HudRenderer";
import { runSteamDiagnostics } from "../debug/diagnostics/SteamDiagnostics";

export async function bootstrap(): Promise<void> {
  console.log("============================================================");
  console.log("  Iniciando Engine Kernel - Projeto 1 (Tauri 2 + WebGL)     ");
  console.log("============================================================\n");

  const services = createEngineServices();
  const hud = new DebugHud();
  hud.mount();

  const renderer = new HudRenderer(services, hud);
  hud.appendLog("⏳ Criando Microkernel...");

  const kernel = new Kernel();

  try {
    kernel.registerCoreTokens([
      SteamToken,
      InputToken,
      AssetsToken,
      GameLoopToken,
      RenderToken,
      NetworkToken,
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
      MonetizationToken,
    ]);

    hud.appendLog(
      "✅ Core tokens registrados (Steam, Input, Assets, GameLoop, Render, Network, Physics, Storage, World, UI, Anim, Sprites, Audio, Camera, AI, VFX, Terrain, Scripting, Streaming, Overlay, Security, Modding, Monetization)."
    );

    const plugins = createEnginePlugins({
      services,
      appendLog(message: string): void {
        hud.appendLog(message);
      },
      onDispose(): void {
        renderer.dispose();
      },
    });

    hud.appendLog("⏳ Registrando plugins no Kernel...");

    for (const plugin of plugins) {
      kernel.register(plugin);
    }

    hud.appendLog("✅ Plugins registrados.");
    hud.appendLog("⏳ Executando Kernel.boot()...");

    await kernel.boot();

    console.log("[Bootstrap] Kernel inicializado com sucesso.", {
      status: kernel.status,
      bootOrder: kernel.bootOrder,
    });

    hud.appendLog("✅ Kernel e Plugins inicializados com sucesso!");

    validateRequiredServices(services, hud);

    renderer.start();

    await runSteamDiagnostics(services.steam, (message: string): void => {
      hud.appendLog(message);
    });

    hud.appendLog("🎯 Bootstrap concluído.");
  } catch (error: unknown) {
    console.error("[Bootstrap] Erro crítico durante inicialização:", error);
    hud.appendLog(`❌ Erro crítico no Bootstrap: ${getErrorMessage(error)}`);
    renderer.stop();
    hud.setBootFailure();
  }
}

function validateRequiredServices(
  services: EngineServices,
  hud: DebugHud
): void {
  const serviceMap: Array<[keyof EngineServices, string]> = [
    ["steam", "game.steam"],
    ["input", "game.input"],
    ["assets", "game.assets"],
    ["physics", "game.physics"],
    ["storage", "game.storage"],
    ["world", "game.world"],
    ["ui", "game.ui"],
    ["anim", "game.anim"],
    ["sprites", "game.sprites"],
    ["audio", "game.audio"],
    ["camera", "game.camera"],
    ["ai", "game.ai"],
    ["vfx", "game.vfx"],
    ["terrain", "game.terrain"],
    ["scripting", "game.scripting"],
    ["streaming", "game.streaming"],
    ["overlay", "game.overlay"],
    ["security", "game.security"],
    ["modding", "game.modding"],
    ["monetization", "game.monetization"],
  ];

  for (const [key, name] of serviceMap) {
    if (services[key]) {
      hud.appendLog(`✅ Capability [${name}] disponível.`);
    } else {
      hud.appendLog(`⚠️ Capability [${name}] não inicializada.`);
    }
  }
}