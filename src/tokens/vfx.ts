import {
  defineCapability,
} from "../core/contracts/capability-token";

import type {
  DecalConfig,
  GPUParticleEmitterConfig,
  PostProcessingConfig,
  VFXPresetDescriptor,
} from "../contracts/vfx/types";

export interface VfxApi {
  /**
   * Cria ou substitui um emissor de partículas.
   */
  spawnParticleEmitter(
    config:
      GPUParticleEmitterConfig,
  ): void;

  /**
   * Encerra e remove um emissor ativo.
   */
  stopParticleEmitter(
    emitterId: string,
  ): boolean;

  /**
   * Projeta um decal na cena.
   */
  projectDecal(
    config:
      DecalConfig,
  ): void;

  /**
   * Remove todos os decals ativos.
   */
  clearDecals(): void;

  /**
   * Atualiza as configurações globais
   * de pós-processamento.
   */
  configurePostProcessing(
    config:
      Partial<PostProcessingConfig>,
  ): void;

  /**
   * Executa um preset composto de VFX.
   */
  triggerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void;

  /**
   * Gera um pulso temporário de bloom.
   */
  pulseBloom(
    strength: number,
    durationSeconds: number,
  ): void;

  /**
   * Retorna a quantidade total de slots
   * de partículas atualmente registrados.
   */
  getActiveParticleCount():
    number;

  /**
   * Retorna a quantidade de decals ativos.
   */
  getActiveDecalCount():
    number;

  /**
   * Atualiza os sistemas temporais da camada.
   */
  update(
    deltaSeconds: number,
  ): void;
}

export const VfxToken =
  defineCapability<VfxApi>(
    "game.vfx",
    "1.0.0",
  );