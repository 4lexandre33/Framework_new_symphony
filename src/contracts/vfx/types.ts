import { defineEvent, defineCommand } from "@core";

export interface Vector3VFX {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ColorVFX {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

/**
 * Emissor de partículas (GPU, `THREE.Points` + `ShaderMaterial`).
 *
 * - Partículas nascem em `position` (mundo) e seguem independentes; mova o
 *   emissor com `setEmitterPosition` (G19).
 * - `startSize`/`endSize` em unidades de mundo (diâmetro do ponto).
 * - `gravityScale` multiplica 9,81 m/s² (padrão 1; 0 = sem gravidade) (G91).
 * - `durationSeconds`: para de emitir depois disso; quando a última
 *   partícula morre o emissor é removido sozinho e `game.vfx.emitter-finished`
 *   é emitido (G28). Sem duração emite até `stopParticleEmitter`.
 * - `burstCount`: partículas emitidas de uma vez no primeiro frame.
 * - `textureUrl`: textura do cache de `game.assets` (carregada se faltar).
 * - O tempo do emissor usa o delta do frame: com o jogo pausado congela.
 */
export interface GPUParticleEmitterConfig {
  readonly emitterId: string;
  readonly maxParticles: number;
  readonly spawnRatePerSecond: number;
  readonly particleLifetimeSeconds: number;
  readonly startSize: number;
  readonly endSize: number;
  readonly startColor: ColorVFX;
  readonly endColor: ColorVFX;
  readonly position: Vector3VFX;
  readonly velocityBase: Vector3VFX;
  readonly velocityVariance: Vector3VFX;
  readonly gravityScale?: number;
  readonly textureUrl?: string;
  readonly blendingMode?: "additive" | "normal";
  readonly durationSeconds?: number;
  readonly burstCount?: number;
}

/**
 * Decal projetado (G90): a textura é PROJETADA sobre as malhas da cena que
 * cruzam a caixa `size` (x/y = área, z = profundidade da projeção) centrada
 * em `position`, orientada por `orientationNormal`. Sem malha na caixa vira
 * um quad plano. O resultado é estático (não segue a malha se ela se mover).
 * `decalId` identifica: reprojetar com o mesmo id substitui; `removeDecal(id)`.
 * Sem `lifetimeSeconds` o decal é permanente até `removeDecal`/`clearDecals`
 * ou até ser reciclado pelo limite (`setMaxDecals`, padrão 200, o mais antigo sai).
 * A textura vem do cache de `game.assets`; se faltar, é carregada e o decal
 * aparece quando ela chegar.
 */
export interface DecalConfig {
  readonly decalId: string;
  readonly textureUrl: string;
  readonly position: Vector3VFX;
  readonly orientationNormal: Vector3VFX;
  readonly size: Vector3VFX;
  readonly lifetimeSeconds?: number;
  readonly fadeDurationSeconds?: number;
}

/**
 * Pós-processamento (G9), desenhado por EffectComposer instalado no
 * `game.render` (RenderPass → SSAO → Bloom → OutputPass → LUT → vinheta/
 * aberração cromática). Fica DESLIGADO até a primeira chamada de
 * `configurePostProcessing` (que liga, salvo `enabled: false`); os valores
 * padrão então valem (bloom 0,8/raio 0,4/limiar 0,85, vinheta 0,3).
 * `lutTextureUrl`: LUT 2D em tira (largura N·N, altura N; vermelho cresce
 * em x dentro de cada fatia, verde em y, azul = índice da fatia).
 */
export interface PostProcessingConfig {
  readonly enabled?: boolean;
  readonly enableBloom?: boolean;
  readonly bloomStrength?: number;
  readonly bloomRadius?: number;
  readonly bloomThreshold?: number;
  readonly enableSSAO?: boolean;
  readonly ssaoRadius?: number;
  readonly enableColorGrading?: boolean;
  readonly lutTextureUrl?: string;
  readonly vignetteIntensity?: number;
  readonly chromaticAberrationOffset?: number;
  /** Mistura do LUT 0..1 (padrão 1). */
  readonly colorGradingIntensity?: number;
}

/**
 * Preset composto (G91). `presetId` identifica o preset no registro
 * (`registerVFXPreset` / `triggerVFXPresetById`); `triggerVFXPreset` com um
 * descritor só com `presetId` dispara o registrado.
 */
export interface VFXPresetDescriptor {
  readonly presetId: string;
  readonly particleEmitter?: GPUParticleEmitterConfig;
  readonly decal?: DecalConfig;
  readonly screenShakeTrauma?: number;
  readonly postFXPulseBloomStrength?: number;
  /** Duração do pulso de bloom (padrão 0,3 s). */
  readonly postFXPulseDurationSeconds?: number;
}

export interface VFXPresetTriggerOptions {
  /** Desloca emissor e decal para esta posição. */
  readonly position?: Vector3VFX;
  /** Sufixo dos ids gerados (padrão: contador). Mesmo sufixo substitui a instância. */
  readonly instanceId?: string;
}

export interface VFXPresetInstance {
  readonly presetId: string;
  readonly emitterId: string | null;
  readonly decalId: string | null;
}

export interface StopParticleEmitterOptions {
  /** true = para de emitir e deixa as vivas terminarem (remove sozinho depois). */
  readonly graceful?: boolean;
}

export interface VFXEmitterFinishedPayload {
  readonly emitterId: string;
}

export const VFXEmitterFinishedEvent = defineEvent<
  "game.vfx.emitter-finished",
  VFXEmitterFinishedPayload
>("game.vfx.emitter-finished");

// ── EVENTOS DE VISUAL EFFECTS ───────────────────────────────────────────────

export interface VFXSpawnedPayload {
  readonly emitterId: string;
  readonly position: Vector3VFX;
  readonly totalActiveParticles: number;
}

export const VFXSpawnedEvent = defineEvent<
  "game.vfx.spawned",
  VFXSpawnedPayload
>("game.vfx.spawned");

export interface DecalProjectedPayload {
  readonly decalId: string;
  readonly position: Vector3VFX;
  readonly targetEntityId?: string;
}

export const DecalProjectedEvent = defineEvent<
  "game.vfx.decal-projected",
  DecalProjectedPayload
>("game.vfx.decal-projected");

export interface PostFXStateChangedPayload {
  readonly activePasses: ReadonlyArray<string>;
  readonly isBloomActive: boolean;
  readonly isSSAOActive: boolean;
}

export const PostFXStateChangedEvent = defineEvent<
  "game.vfx.postfx-changed",
  PostFXStateChangedPayload
>("game.vfx.postfx-changed");

// ── COMANDOS DE VISUAL EFFECTS ───────────────────────────────────────────────

export interface SpawnParticleEmitterRequest {
  readonly config: GPUParticleEmitterConfig;
}

export const SpawnParticleEmitterCommand = defineCommand<
  "game.vfx.spawn-emitter",
  SpawnParticleEmitterRequest
>("game.vfx.spawn-emitter");

export interface ProjectDecalRequest {
  readonly config: DecalConfig;
}

export const ProjectDecalCommand = defineCommand<
  "game.vfx.project-decal",
  ProjectDecalRequest
>("game.vfx.project-decal");

export interface SetPostFXConfigRequest {
  readonly config: Partial<PostProcessingConfig>;
}

export const SetPostFXConfigCommand = defineCommand<
  "game.vfx.set-postfx-config",
  SetPostFXConfigRequest
>("game.vfx.set-postfx-config");

export interface TriggerVFXPresetRequest {
  readonly preset: VFXPresetDescriptor;
}

export const TriggerVFXPresetCommand = defineCommand<
  "game.vfx.trigger-preset",
  TriggerVFXPresetRequest
>("game.vfx.trigger-preset");