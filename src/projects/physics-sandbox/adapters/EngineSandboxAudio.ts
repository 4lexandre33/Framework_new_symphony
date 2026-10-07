import type {
  AssetsApi,
} from "../../../tokens/assets";

import type {
  AudioApi,
} from "../../../tokens/audio";

import type {
  PhysicsSandboxAudioPort,
} from "../ports/PhysicsSandboxAudioPort";

const JUMP_SOUND_URL =
  "/projects/physics-sandbox/audio/jump.wav";

const IMPACT_SOUND_URL =
  "/projects/physics-sandbox/audio/impact.wav";

/**
 * Adapter entre as intenções de áudio do projeto e as APIs públicas
 * fornecidas pela engine.
 *
 * Regras:
 * - não acessa internals concretos da engine;
 * - não acessa plugins concretos;
 * - não cria AudioContext próprio;
 * - não cria cache paralelo;
 * - ownership dos assets carregados permanece explícito;
 * - dispose() libera somente os assets que este adapter reteve.
 */
export class EngineSandboxAudio
implements PhysicsSandboxAudioPort {
  private jumpRetained =
    false;

  private impactRetained =
    false;

  private initialized =
    false;

  private disposed =
    false;

  public constructor(
    private readonly assets:
      AssetsApi,

    private readonly audio:
      AudioApi,
  ) {}

  public async initialize():
    Promise<void> {
    if (
      this.disposed
    ) {
      throw new Error(
        "EngineSandboxAudio já foi descartado.",
      );
    }

    if (
      this.initialized
    ) {
      return;
    }

    try {
      await this.assets
        .loadAudio(
          JUMP_SOUND_URL,
        );

      this.jumpRetained =
        true;

      await this.assets
        .loadAudio(
          IMPACT_SOUND_URL,
        );

      this.impactRetained =
        true;

      this.audio
        .setChannelVolume(
          "sfx",
          0.8,
          false,
        );

      this.initialized =
        true;
    } catch (
      error:
        unknown
    ) {
      this.releaseAssets();

      throw error;
    }
  }

  public playJump(): void {
    if (
      !this.initialized ||
      this.disposed
    ) {
      return;
    }

    this.audio.playSound(
      JUMP_SOUND_URL,
      "sfx",
      0.55,
      false,
    );
  }

  public playImpact(): void {
    if (
      !this.initialized ||
      this.disposed
    ) {
      return;
    }

    this.audio.playSound(
      IMPACT_SOUND_URL,
      "sfx",
      0.7,
      false,
    );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.releaseAssets();

    this.initialized =
      false;
  }

  private releaseAssets(): void {
    if (
      this.impactRetained
    ) {
      this.assets.releaseAsset(
        IMPACT_SOUND_URL,
      );

      this.impactRetained =
        false;
    }

    if (
      this.jumpRetained
    ) {
      this.assets.releaseAsset(
        JUMP_SOUND_URL,
      );

      this.jumpRetained =
        false;
    }
  }
}
