import type { EngineServices } from "../../app/EngineServices";
import { getErrorMessage } from "../../app/errors";
import { DebugHud } from "./DebugHud";
import { FpsMonitor } from "./FpsMonitor";
import { InputDiagnostics } from "./InputDiagnostics";

const DIAGNOSTIC_REFRESH_INTERVAL_MS = 500;

export class HudRenderer {
  private animationFrameId: number | null = null;
  private eventsBound = false;
  private lastDiagnosticRefreshMs = 0;
  private readonly lastDiagnosticMessages = new Map<string, string>();

  private unbindPointerLockButton: (() => void) | null = null;
  private unbindClearVramButton: (() => void) | null = null;

  private readonly fpsMonitor = new FpsMonitor(500);
  private readonly inputDiagnostics: InputDiagnostics;

  public constructor(
    private readonly services: EngineServices,
    private readonly hud: DebugHud
  ) {
    this.inputDiagnostics = new InputDiagnostics((message: string): void => {
      this.hud.appendLog(message);
    });
  }

  public start(): void {
    if (this.animationFrameId !== null) return;

    this.bindEvents();
    this.inputDiagnostics.reset();
    this.lastDiagnosticMessages.clear();
    this.lastDiagnosticRefreshMs = 0;
    this.fpsMonitor.reset(performance.now());

    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  }

  public stop(): void {
    if (this.animationFrameId === null) return;

    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  public dispose(): void {
    this.stop();
    this.unbindEvents();
  }

  private readonly renderFrame = (now: number): void => {
    if (this.fpsMonitor.update(now)) {
      const fps = this.fpsMonitor.getSnapshot();
      this.hud.setFps(fps.fps, fps.frameTimeMs, fps.totalFrames);
    }

    this.updateInputHud();

    if (now - this.lastDiagnosticRefreshMs >= DIAGNOSTIC_REFRESH_INTERVAL_MS) {
      this.lastDiagnosticRefreshMs = now;

      this.updateSteamHud();
      this.updateAssetsHud();
      this.updatePhysicsHud();
      this.updateStorageHud();
      this.updateWorldHud();
      this.updateUIHud();
      this.updateAudioHud();
      this.updateCameraHud();
      this.updateAiHud();
      this.updateVfxHud();
      this.updateTerrainHud();
      this.updateScriptingHud();
      this.updateStreamingHud();
      this.updateOverlayHud();
      this.updateSecurityHud();
      this.updateModdingHud();
      this.updateMonetizationHud();
    }

    this.animationFrameId = requestAnimationFrame(this.renderFrame);
  };

  private updateSteamHud(): void {
    const steam = this.services.steam;
    if (!steam) {
      this.hud.setSteamStatus("Steam: Capability indisponível", "error");
      return;
    }

    if (steam.isAvailable) {
      this.hud.setSteamStatus("Steam: ● Online (AppID 480)", "ok");
    } else {
      this.hud.setSteamStatus("Steam: ○ Offline / Fallback", "warning");
    }
  }

  private updateInputHud(): void {
    const input = this.services.input;
    if (!input) {
      this.hud.setInputStatus("Input: Capability indisponível", "error");
      this.hud.setMouseDelta(0, 0);
      return;
    }

    const snapshot = this.inputDiagnostics.update(input);
    this.hud.setInputStatus(
      `Input: ${snapshot.activeDevice} | Lock: ${snapshot.pointerLocked ? "SIM" : "NÃO"} | W/S: ${snapshot.moveForward.toFixed(0)} | A/D: ${snapshot.moveRight.toFixed(0)}`,
      "ok"
    );
    this.hud.setMouseDelta(snapshot.mouseDeltaX, snapshot.mouseDeltaY);
  }

  private updateAssetsHud(): void {
    if (!this.services.assets) {
      this.hud.setAssetsStatus("Assets: Capability indisponível", "error");
      return;
    }
    this.hud.setAssetsStatus("Assets Cache: ● Ativo", "ok");
  }

  private updatePhysicsHud(): void {
    const physics = this.services.physics;
    if (!physics) return;

    const stats = physics.getStats();
    if (stats.isWasmLoaded) {
      this.logDiagnosticIfChanged(
        "physics",
        `[HUD Physics] Rapier WASM | 60 Ticks/s | Corpos: ${stats.rigidBodyCount} | Colisores: ${stats.colliderCount}`
      );
    }
  }

  private updateStorageHud(): void {
    const storage = this.services.storage;
    if (!storage) return;

    this.logDiagnosticIfChanged(
      "storage",
      `[HUD Storage] Driver Ativo: ${storage.activeDriver}`
    );
  }

  private updateWorldHud(): void {
    const world = this.services.world;
    if (!world) return;

    this.logDiagnosticIfChanged(
      "world",
      `[HUD World] Cena: ${world.currentSceneId || "Nenhuma"} | Entidades ECS: ${world.activeEntityCount}`
    );
  }

  private updateUIHud(): void {
    const ui = this.services.ui;
    if (!ui) return;

    this.logDiagnosticIfChanged(
      "ui",
      `[HUD UI] Tela: ${ui.currentScreen} | Modais: ${ui.activeModalCount} | Idioma: ${ui.currentLocale}`
    );
  }

  private updateAudioHud(): void {
    const audio = this.services.audio;
    if (!audio) return;

    const master = audio.getChannelVolume("master");
    this.logDiagnosticIfChanged(
      "audio",
      `[HUD Audio] Master: ${(master * 100).toFixed(0)}%`
    );
  }

  private updateCameraHud(): void {
    const camera = this.services.camera;
    if (!camera) return;

    const snapshot = camera.getCurrentCameraSnapshot();
    if (snapshot) {
      this.logDiagnosticIfChanged(
        "camera",
        `[HUD Camera] Ativa: ${camera.getActiveCameraId() || "Nenhuma"} | Haste: ${snapshot.currentArmLength.toFixed(2)}m`
      );
    }
  }

  private updateAiHud(): void {
    if (this.services.ai) {
      this.logDiagnosticIfChanged(
        "ai",
        "[HUD AI] NavMesh & Behavior Trees | Status: Ativo"
      );
    }
  }

  private updateVfxHud(): void {
    const vfx = this.services.vfx;
    if (!vfx) return;

    this.logDiagnosticIfChanged(
      "vfx",
      `[HUD VFX] Partículas: ${vfx.getActiveParticleCount()} | Decals: ${vfx.getActiveDecalCount()}`
    );
  }

  private updateTerrainHud(): void {
    const terrain = this.services.terrain;
    if (!terrain) return;

    this.logDiagnosticIfChanged(
      "terrain",
      `[HUD Terrain] Chunks Voxels: ${terrain.getActiveChunkCount()} | Seed: ${terrain.getSeed()}`
    );
  }

  private updateScriptingHud(): void {
    const scripting = this.services.scripting;
    if (!scripting) return;

    this.logDiagnosticIfChanged(
      "scripting",
      `[HUD Scripting] Cutscene: ${scripting.isCutscenePlaying() ? "EM EXECUÇÃO" : "Inativa"}`
    );
  }

  private updateStreamingHud(): void {
    const streaming = this.services.streaming;
    if (!streaming) return;

    const active = streaming.getActiveSectors().length;
    const hlod = streaming.getHLODStats();
    this.logDiagnosticIfChanged(
      "streaming",
      `[HUD Streaming] Setores VRAM: ${active} | HLOD Saved Calls: ${hlod.drawCallsSaved}`
    );
  }

  private updateOverlayHud(): void {
    const overlay = this.services.overlay;
    if (!overlay) return;

    this.logDiagnosticIfChanged(
      "overlay",
      `[HUD Overlay] Modo: ${overlay.currentMode} | Passthrough: ${overlay.isPassthroughActive ? "SIM" : "NÃO"}`
    );
  }

  private updateSecurityHud(): void {
    const security = this.services.security;
    if (!security) return;

    const metrics = security.getProfilerSnapshot();
    this.logDiagnosticIfChanged(
      "security",
      `[HUD Security/Profiler] FPS Medido: ${metrics.fps} | Frame: ${metrics.totalFrameTimeMs.toFixed(2)}ms | Subsistemas: ${metrics.subsystems.length}`
    );
  }

  private updateModdingHud(): void {
    const modding = this.services.modding;
    if (!modding) return;

    const loaded = modding.getLoadedMods().length;
    this.logDiagnosticIfChanged(
      "modding",
      `[HUD Modding/Steam Workshop] Mods Ativos: ${loaded} | Override Engine Status: Pronta`
    );
  }

  private updateMonetizationHud(): void {
    const monetization = this.services.monetization;
    if (!monetization) return;

    const wallet = monetization.getWalletSnapshot();
    const gold = wallet.currencies["gold"] ?? 0;
    const invCount = monetization.getSteamInventory().length;
    this.logDiagnosticIfChanged(
      "monetization",
      `[HUD Monetization/Steam MicroTxn] Ouro: ${gold} | Inventário Steam: ${invCount} item(ns)`
    );
  }

  private logDiagnosticIfChanged(
    key: string,
    message: string
  ): void {
    if (this.lastDiagnosticMessages.get(key) === message) return;

    this.lastDiagnosticMessages.set(key, message);
    this.hud.appendLog(message);
  }

  private bindEvents(): void {
    if (this.eventsBound) return;

    this.unbindPointerLockButton = this.hud.onPointerLockClick(
      this.handlePointerLockRequest
    );
    this.unbindClearVramButton = this.hud.onClearVramClick(
      this.handleClearVram
    );

    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    this.eventsBound = true;
  }

  private unbindEvents(): void {
    if (!this.eventsBound) return;

    if (this.unbindPointerLockButton) {
      this.unbindPointerLockButton();
      this.unbindPointerLockButton = null;
    }

    if (this.unbindClearVramButton) {
      this.unbindClearVramButton();
      this.unbindClearVramButton = null;
    }

    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    this.eventsBound = false;
  }

  private readonly handlePointerLockRequest = async (): Promise<void> => {
    const input = this.services.input;
    if (!input) {
      this.hud.appendLog("❌ Erro: Capability InputToken não vinculada!");
      return;
    }

    try {
      const success = await input.requestPointerLock(document.body);
      this.hud.appendLog(
        success ? "✅ Pointer Lock concedido!" : "⚠️️ Pointer Lock recusado."
      );
    } catch (error: unknown) {
      this.hud.appendLog(`❌ Erro no Pointer Lock: ${getErrorMessage(error)}`);
    }
  };

  private readonly handleClearVram = (): void => {
    const assets = this.services.assets;
    if (!assets) {
      this.hud.appendLog("❌ Erro: Capability AssetsToken não vinculada!");
      return;
    }

    try {
      assets.clearCache();
      this.hud.appendLog("🧹 Cache de assets / VRAM liberado com sucesso!");
    } catch (error: unknown) {
      this.hud.appendLog(`❌ Erro ao limpar cache: ${getErrorMessage(error)}`);
    }
  };

  private readonly handlePointerLockChange = (): void => {
    const isLocked = document.pointerLockElement !== null;
    this.hud.appendLog(
      `🖱️ Estado Pointer Lock: ${isLocked ? "LOCKED (Ativo)" : "UNLOCKED (Livre)"}`
    );
  };
}