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
}

export interface DecalConfig {
  readonly decalId: string;
  readonly textureUrl: string;
  readonly position: Vector3VFX;
  readonly orientationNormal: Vector3VFX;
  readonly size: Vector3VFX;
  readonly lifetimeSeconds?: number;
  readonly fadeDurationSeconds?: number;
}

export interface PostProcessingConfig {
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
}

export interface VFXPresetDescriptor {
  readonly presetId: string;
  readonly particleEmitter?: GPUParticleEmitterConfig;
  readonly decal?: DecalConfig;
  readonly screenShakeTrauma?: number;
  readonly postFXPulseBloomStrength?: number;
}

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