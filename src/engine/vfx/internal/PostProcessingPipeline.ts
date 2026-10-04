import type {
  PostProcessingConfig,
} from "../../../contracts/vfx/types";

interface MutablePostProcessingConfig {
  enableBloom?:
    boolean;

  bloomStrength?:
    number;

  bloomRadius?:
    number;

  bloomThreshold?:
    number;

  enableSSAO?:
    boolean;

  ssaoRadius?:
    number;

  enableColorGrading?:
    boolean;

  lutTextureUrl?:
    string;

  vignetteIntensity?:
    number;

  chromaticAberrationOffset?:
    number;
}

export class PostProcessingPipeline {
  private readonly config:
    MutablePostProcessingConfig = {
      enableBloom:
        true,

      bloomStrength:
        0.8,

      bloomRadius:
        0.4,

      bloomThreshold:
        0.85,

      enableSSAO:
        false,

      ssaoRadius:
        0.5,

      enableColorGrading:
        false,

      vignetteIntensity:
        0.3,

      chromaticAberrationOffset:
        0,
    };

  private bloomPulseTimer =
    0;

  private originalBloomStrength =
    0.8;

  public updateConfig(
    newConfig:
      Partial<PostProcessingConfig>,
  ): void {
    if (
      newConfig.enableBloom !==
      undefined
    ) {
      this.config.enableBloom =
        newConfig.enableBloom;
    }

    if (
      newConfig.bloomStrength !==
      undefined
    ) {
      const strength =
        this.sanitizeNonNegative(
          newConfig.bloomStrength,
        );

      this.config.bloomStrength =
        strength;

      this.originalBloomStrength =
        strength;
    }

    if (
      newConfig.bloomRadius !==
      undefined
    ) {
      this.config.bloomRadius =
        this.sanitizeNonNegative(
          newConfig.bloomRadius,
        );
    }

    if (
      newConfig.bloomThreshold !==
      undefined
    ) {
      this.config.bloomThreshold =
        this.sanitizeUnitInterval(
          newConfig.bloomThreshold,
        );
    }

    if (
      newConfig.enableSSAO !==
      undefined
    ) {
      this.config.enableSSAO =
        newConfig.enableSSAO;
    }

    if (
      newConfig.ssaoRadius !==
      undefined
    ) {
      this.config.ssaoRadius =
        this.sanitizeNonNegative(
          newConfig.ssaoRadius,
        );
    }

    if (
      newConfig.enableColorGrading !==
      undefined
    ) {
      this.config.enableColorGrading =
        newConfig
          .enableColorGrading;
    }

    if (
      newConfig.lutTextureUrl !==
      undefined
    ) {
      this.config.lutTextureUrl =
        newConfig.lutTextureUrl;
    }

    if (
      newConfig.vignetteIntensity !==
      undefined
    ) {
      this.config.vignetteIntensity =
        this.sanitizeNonNegative(
          newConfig
            .vignetteIntensity,
        );
    }

    if (
      newConfig
        .chromaticAberrationOffset !==
      undefined
    ) {
      this.config
        .chromaticAberrationOffset =
          this.sanitizeNonNegative(
            newConfig
              .chromaticAberrationOffset,
          );
    }
  }

  public triggerBloomPulse(
    strength: number,
    durationSeconds: number,
  ): void {
    const safeStrength =
      this.sanitizeNonNegative(
        strength,
      );

    const safeDuration =
      this.sanitizeNonNegative(
        durationSeconds,
      );

    if (
      safeDuration <=
      0
    ) {
      this.config.bloomStrength =
        this.originalBloomStrength;

      this.bloomPulseTimer =
        0;

      return;
    }

    this.config.bloomStrength =
      safeStrength;

    this.bloomPulseTimer =
      safeDuration;
  }

  public update(
    deltaSeconds: number,
  ): void {
    if (
      this.bloomPulseTimer <=
      0
    ) {
      return;
    }

    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    if (
      safeDelta <=
      0
    ) {
      return;
    }

    this.bloomPulseTimer -=
      safeDelta;

    if (
      this.bloomPulseTimer >
      0
    ) {
      return;
    }

    this.bloomPulseTimer =
      0;

    this.config.bloomStrength =
      this.originalBloomStrength;
  }

  public getConfig():
    Readonly<PostProcessingConfig> {
    return this.config;
  }

  public reset(): void {
    this.config.enableBloom =
      true;

    this.config.bloomStrength =
      0.8;

    this.config.bloomRadius =
      0.4;

    this.config.bloomThreshold =
      0.85;

    this.config.enableSSAO =
      false;

    this.config.ssaoRadius =
      0.5;

    this.config.enableColorGrading =
      false;

    delete this.config
      .lutTextureUrl;

    this.config.vignetteIntensity =
      0.3;

    this.config
      .chromaticAberrationOffset =
        0;

    this.originalBloomStrength =
      0.8;

    this.bloomPulseTimer =
      0;
  }

  private sanitizeDelta(
    deltaSeconds: number,
  ): number {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return 0;
    }

    return Math.min(
      deltaSeconds,
      0.25,
    );
  }

  private sanitizeNonNegative(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      value,
    );
  }

  private sanitizeUnitInterval(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.min(
      1,
      Math.max(
        0,
        value,
      ),
    );
  }
}