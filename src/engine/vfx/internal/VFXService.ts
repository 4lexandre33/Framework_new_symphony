import * as THREE from "three";
import type { PluginContext } from "@core";
import { type VfxApi } from "../../../tokens/vfx";
import { RenderToken, type Render3DApi } from "../../../tokens/render";
import { AssetsToken, type AssetsApi } from "../../../tokens/assets";
import { type GPUParticleEmitterConfig, type DecalConfig, type PostProcessingConfig, type VFXPresetDescriptor } from "../../../contracts/vfx/types";
import { GPUParticleSystem } from "./GPUParticleSystem";
import { DecalManager } from "./DecalManager";
import { PostProcessingPipeline } from "./PostProcessingPipeline";
import { VFXEffectManager } from "./VFXEffectManager";

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
