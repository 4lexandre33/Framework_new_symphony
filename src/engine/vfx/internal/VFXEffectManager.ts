import type { VFXPresetDescriptor } from "../../../contracts/vfx/types";
import { GPUParticleSystem } from "./GPUParticleSystem";
import { DecalManager } from "./DecalManager";
import { PostProcessingPipeline } from "./PostProcessingPipeline";

export class VFXEffectManager {
  public constructor(
    private readonly particles: GPUParticleSystem,
    private readonly decals: DecalManager,
    private readonly postProcessing: PostProcessingPipeline
  ) {}

  public triggerPreset(preset: VFXPresetDescriptor, scene?: any, texture?: any): void {
    if (preset.particleEmitter) {
      this.particles.spawnEmitter(preset.particleEmitter, texture);
    }

    if (preset.decal && scene && texture) {
      this.decals.projectDecal(preset.decal, texture, scene);
    }

    if (preset.postFXPulseBloomStrength) {
      this.postProcessing.triggerBloomPulse(preset.postFXPulseBloomStrength, 0.3);
    }
  }
}