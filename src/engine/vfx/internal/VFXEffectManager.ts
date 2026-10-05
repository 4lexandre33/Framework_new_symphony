import type {
  DecalConfig,
  GPUParticleEmitterConfig,
  VFXPresetDescriptor,
} from "../../../contracts/vfx/types";

export interface VFXEffectSink {
  spawnParticleEmitter(
    config:
      GPUParticleEmitterConfig,
  ): void;

  projectDecal(
    config:
      DecalConfig,
  ): void;

  pulseBloom(
    strength:
      number,
    durationSeconds:
      number,
  ): void;

  triggerCameraTrauma(
    traumaAmount:
      number,
  ): void;
}

export class VFXEffectManager {
  public constructor(
    private readonly sink:
      VFXEffectSink,
  ) {}

  public triggerPreset(
    preset:
      VFXPresetDescriptor,
  ): void {
    if (
      preset.particleEmitter !==
      undefined
    ) {
      this.sink
        .spawnParticleEmitter(
          preset.particleEmitter,
        );
    }

    if (
      preset.decal !==
      undefined
    ) {
      this.sink
        .projectDecal(
          preset.decal,
        );
    }

    if (
      preset.postFXPulseBloomStrength !==
        undefined
    ) {
      this.sink
        .pulseBloom(
          preset
            .postFXPulseBloomStrength,
          0.3,
        );
    }

    if (
      preset.screenShakeTrauma !==
        undefined &&
      Number.isFinite(
        preset.screenShakeTrauma,
      ) &&
      preset.screenShakeTrauma >
        0
    ) {
      this.sink
        .triggerCameraTrauma(
          preset.screenShakeTrauma,
        );
    }
  }
}
