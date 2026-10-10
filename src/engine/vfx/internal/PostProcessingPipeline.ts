import type {
  PostProcessingConfig,
} from "../../../contracts/vfx/types";

interface MutablePostProcessingConfig {
  enabled?:
    boolean;

  colorGradingIntensity?:
    number;

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
      // G9: desligado até a primeira configuração explícita.
      enabled:
        false,

      colorGradingIntensity:
        1,

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
    // Configurar liga o pipeline, salvo `enabled: false` explícito.
    this.config.enabled =
      newConfig.enabled !==
      false;

    if (
      newConfig.colorGradingIntensity !==
      undefined
    ) {
      this.config.colorGradingIntensity =
        this.sanitizeUnitInterval(
          newConfig.colorGradingIntensity,
        );
    }

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

  public get isEnabled():
    boolean {
    return this.config.enabled ===
      true;
  }

  public get isBloomPulseActive():
    boolean {
    return this.bloomPulseTimer >
      0;
  }

  /** Bloom deve ser desenhado agora (configurado ou pulso em andamento). */
  public get isBloomEffective():
    boolean {
    return (
      this.isBloomPulseActive ||
      (
        this.isEnabled &&
        this.config.enableBloom ===
          true &&
        (this.config.bloomStrength ?? 0) >
          0
      )
    );
  }

  public get isSSAOEffective():
    boolean {
    return this.isEnabled &&
      this.config.enableSSAO ===
        true;
  }

  /** Color grading pedido (o desenho ainda depende do LUT carregado). */
  public get isColorGradingRequested():
    boolean {
    return (
      this.isEnabled &&
      this.config.enableColorGrading ===
        true &&
      this.config.lutTextureUrl !==
        undefined &&
      (this.config.colorGradingIntensity ?? 1) >
        0
    );
  }

  public get isVignetteEffective():
    boolean {
    return this.isEnabled &&
      (this.config.vignetteIntensity ?? 0) >
        0;
  }

  public get isChromaticAberrationEffective():
    boolean {
    return this.isEnabled &&
      (this.config.chromaticAberrationOffset ?? 0) >
        0;
  }

  /** Algum passe precisa ser desenhado neste frame. */
  public get isActive():
    boolean {
    return (
      this.isBloomEffective ||
      this.isSSAOEffective ||
      this.isColorGradingRequested ||
      this.isVignetteEffective ||
      this.isChromaticAberrationEffective
    );
  }

  public reset(): void {
    this.config.enabled =
      false;

    this.config.colorGradingIntensity =
      1;

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