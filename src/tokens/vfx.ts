import {
  defineCapability,
} from "@core";

import type {
  DecalConfig,
  GPUParticleEmitterConfig,
  PostProcessingConfig,
  StopParticleEmitterOptions,
  Vector3VFX,
  VFXPresetDescriptor,
  VFXPresetInstance,
  VFXPresetTriggerOptions,
} from "../contracts/vfx/types";

/**
 * Efeitos visuais. A engine chama `update` em cada `game.loop.render` com o
 * `deltaSeconds` do frame: com o jogo pausado (delta 0) partículas, decals
 * com tempo de vida e pulsos de bloom congelam; o pós-processamento continua
 * sendo desenhado.
 */
export interface VfxApi {
  /**
   * Cria ou substitui um emissor de partículas (o anterior com o mesmo id é
   * liberado: geometria, material e textura própria, G89).
   */
  spawnParticleEmitter(
    config:
      GPUParticleEmitterConfig,
  ): void;

  /**
   * Encerra e remove um emissor ativo (libera GPU). Com `graceful: true`
   * apenas para de emitir; o emissor é removido quando a última partícula
   * morrer (`game.vfx.emitter-finished`).
   */
  stopParticleEmitter(
    emitterId: string,
    options?: StopParticleEmitterOptions,
  ): boolean;

  /** Move o ponto de nascimento das próximas partículas (G19). */
  setEmitterPosition(
    emitterId: string,
    position: Vector3VFX,
  ): boolean;

  /** Emite `count` partículas extras no próximo frame. */
  burstParticles(
    emitterId: string,
    count: number,
  ): boolean;

  hasParticleEmitter(
    emitterId: string,
  ): boolean;

  /**
   * Projeta um decal na cena (ver `DecalConfig`; G90).
   */
  projectDecal(
    config:
      DecalConfig,
  ): void;

  /** Remove o decal `decalId` (libera GPU). */
  removeDecal(
    decalId: string,
  ): boolean;

  /** Limite de decals simultâneos (padrão 200); o mais antigo é reciclado. */
  setMaxDecals(
    maxDecals: number,
  ): void;

  /**
   * Remove todos os decals ativos.
   */
  clearDecals(): void;

  /**
   * Atualiza as configurações globais de pós-processamento e o liga
   * (salvo `enabled: false`). Ver `PostProcessingConfig` (G9).
   */
  configurePostProcessing(
    config:
      Partial<PostProcessingConfig>,
  ): void;

  /** true se o pós-processamento está sendo desenhado neste momento. */
  isPostProcessingActive(): boolean;

  /**
   * Executa um preset composto de VFX. Um descritor apenas com `presetId`
   * dispara o preset registrado com esse id (G91).
   */
  triggerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void;

  /** Registra (ou substitui) um preset reutilizável. */
  registerVFXPreset(
    preset:
      VFXPresetDescriptor,
  ): void;

  unregisterVFXPreset(
    presetId: string,
  ): boolean;

  /**
   * Dispara um preset registrado. Gera ids únicos por instância
   * (`<emitterId>@<instanceId>`, `<decalId>@<instanceId>`) para disparos
   * simultâneos; retorna os ids gerados ou null se o preset não existe.
   * Dê `durationSeconds` ao emissor do preset para ele se remover sozinho.
   */
  triggerVFXPresetById(
    presetId: string,
    options?: VFXPresetTriggerOptions,
  ): VFXPresetInstance | null;

  /**
   * Gera um pulso temporário de bloom (desenhado mesmo com o
   * pós-processamento desligado, só enquanto dura o pulso).
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
   * Atualiza os sistemas temporais da camada (a engine já chama no render).
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
