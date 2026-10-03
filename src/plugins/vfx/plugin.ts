import * as THREE from "three";
import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { VfxToken, type VfxApi } from "../../tokens/vfx";
import { RenderToken, type Render3DApi } from "../../tokens/render";
import { AssetsToken, type AssetsApi } from "../../tokens/assets";
import {
  VFXSpawnedEvent,
  DecalProjectedEvent,
  PostFXStateChangedEvent,
  SpawnParticleEmitterCommand,
  ProjectDecalCommand,
  SetPostFXConfigCommand,
  TriggerVFXPresetCommand,
  type GPUParticleEmitterConfig,
  type DecalConfig,
  type PostProcessingConfig,
  type VFXPresetDescriptor,
} from "../../contracts/vfx/types";
import { GPUParticleSystem } from "../../engine/vfx/GPUParticleSystem";
import { DecalManager } from "../../engine/vfx/DecalManager";
import { PostProcessingPipeline } from "../../engine/vfx/PostProcessingPipeline";
import { VFXEffectManager } from "../../engine/vfx/VFXEffectManager";

export const vfxManifest: Plugin["manifest"] = {
  id: "game.vfx",
  name: "GPU Particle System, Decals & PostProcessing Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [VfxToken.id, RenderToken.id, AssetsToken.id],
    events: [
      "game.vfx.spawned",
      "game.vfx.decal-projected",
      "game.vfx.postfx-changed",
      "game.loop.render",
    ],
  },
  capabilities: {
    provides: [
      {
        id: VfxToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: RenderToken.id,
        range: "^1.0.0",
      },
      {
        id: AssetsToken.id,
        range: "^1.0.0",
      },
    ],
  },
};

export class VFXService implements VfxApi {
  private readonly particleSystem = new GPUParticleSystem();
  private readonly decalManager = new DecalManager();
  private readonly postProcessing = new PostProcessingPipeline();
  private readonly effectManager: VFXEffectManager;

  public constructor(private readonly ctx: PluginContext) {
    this.effectManager = new VFXEffectManager(
      this.particleSystem,
      this.decalManager,
      this.postProcessing
    );
  }

  public spawnParticleEmitter(config: GPUParticleEmitterConfig): void {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;

    const texture = config.textureUrl && assets
      ? assets.getAsset<THREE.Texture>(config.textureUrl)
      : null;

    const pointsMesh = this.particleSystem.spawnEmitter(config, texture);

    if (render) {
      render.addMeshToScene(`vfx_emitter_${config.emitterId}`, pointsMesh);
    }

    this.ctx.events.emit("game.vfx.spawned", {
      emitterId: config.emitterId,
      position: config.position,
      totalActiveParticles: this.particleSystem.getTotalActiveParticles(),
    });
  }

  public stopParticleEmitter(emitterId: string): boolean {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    if (render) {
      render.removeMeshFromScene(`vfx_emitter_${emitterId}`);
    }
    return this.particleSystem.stopEmitter(emitterId);
  }

  public projectDecal(config: DecalConfig): void {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;

    if (!render) return;

    const texture = assets?.getAsset<THREE.Texture>(config.textureUrl) || new THREE.Texture();
    this.decalManager.projectDecal(config, texture, render.getScene());

    this.ctx.events.emit("game.vfx.decal-projected", {
      decalId: config.decalId,
      position: config.position,
    });
  }

  public clearDecals(): void {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    this.decalManager.clear(render?.getScene());
  }

  public configurePostProcessing(config: Partial<PostProcessingConfig>): void {
    this.postProcessing.updateConfig(config);
    this.ctx.events.emit("game.vfx.postfx-changed", {
      activePasses: ["bloom", "ssao"],
      isBloomActive: config.enableBloom ?? true,
      isSSAOActive: config.enableSSAO ?? false,
    });
  }

  public triggerVFXPreset(preset: VFXPresetDescriptor): void {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    this.effectManager.triggerPreset(preset, render?.getScene());
  }

  public pulseBloom(strength: number, durationSeconds: number): void {
    this.postProcessing.triggerBloomPulse(strength, durationSeconds);
  }

  public getActiveParticleCount(): number {
    return this.particleSystem.getTotalActiveParticles();
  }

  public getActiveDecalCount(): number {
    return this.decalManager.getActiveDecalCount();
  }

  public update(deltaSeconds: number): void {
    this.particleSystem.update(deltaSeconds);
    this.postProcessing.update(deltaSeconds);
  }

  public clear(): void {
    this.particleSystem.clear();
    this.clearDecals();
  }
}

export function createVFXPlugin(): Plugin {
  return {
    manifest: vfxManifest,

    setup(ctx: PluginContext) {
      const vfxService = new VFXService(ctx);

      ctx.caps.provide(VfxToken, vfxService);

      ctx.events.define(VFXSpawnedEvent);
      ctx.events.define(DecalProjectedEvent);
      ctx.events.define(PostFXStateChangedEvent);

      ctx.commands.define(SpawnParticleEmitterCommand);
      ctx.commands.define(ProjectDecalCommand);
      ctx.commands.define(SetPostFXConfigCommand);
      ctx.commands.define(TriggerVFXPresetCommand);

      const unbindRender = ctx.events.on("game.loop.render", (env) => {
        const payload = env.payload as { deltaSeconds: number };
        vfxService.update(payload.deltaSeconds || 0.016);
      });

      const unbindSpawnEmitter = ctx.commands.handle("game.vfx.spawn-emitter", (env) => {
        const p = env.payload as { config: GPUParticleEmitterConfig };
        vfxService.spawnParticleEmitter(p.config);
      });

      const unbindProjectDecal = ctx.commands.handle("game.vfx.project-decal", (env) => {
        const p = env.payload as { config: DecalConfig };
        vfxService.projectDecal(p.config);
      });

      const unbindSetPostFX = ctx.commands.handle("game.vfx.set-postfx-config", (env) => {
        const p = env.payload as { config: Partial<PostProcessingConfig> };
        vfxService.configurePostProcessing(p.config);
      });

      const unbindPreset = ctx.commands.handle("game.vfx.trigger-preset", (env) => {
        const p = env.payload as { preset: VFXPresetDescriptor };
        vfxService.triggerVFXPreset(p.preset);
      });

      ctx.lifecycle.onDispose(() => {
        unbindRender();
        unbindSpawnEmitter();
        unbindProjectDecal();
        unbindSetPostFX();
        unbindPreset();
        vfxService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}