# vfx — Partículas GPU, Decals & Pós-Processamento
capability: game.vfx@1.0.0 | category: functional | engine plugin id: game.vfx
consumes: RenderToken, AssetsToken
use (from src/projects/<jogo>/**):
  import { VfxToken } from "../../tokens/vfx";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/vfx.ts
```ts
interface VfxApi {
  spawnParticleEmitter( config: GPUParticleEmitterConfig, ): void; // Cria ou substitui um emissor de partículas.
  stopParticleEmitter( emitterId: string, ): boolean; // Encerra e remove um emissor ativo.
  projectDecal( config: DecalConfig, ): void; // Projeta um decal na cena.
  clearDecals(): void; // Remove todos os decals ativos.
  configurePostProcessing( config: Partial<PostProcessingConfig>, ): void; // Atualiza as configurações globais de pós-processamento.
  triggerVFXPreset( preset: VFXPresetDescriptor, ): void; // Executa um preset composto de VFX.
  pulseBloom( strength: number, durationSeconds: number, ): void; // Gera um pulso temporário de bloom.
  getActiveParticleCount(): number; // Retorna a quantidade total de slots de partículas atualmente registrados.
  getActiveDecalCount(): number; // Retorna a quantidade de decals ativos.
  update( deltaSeconds: number, ): void; // Atualiza os sistemas temporais da camada.
}
capability VfxToken = "game.vfx"@1.0.0 api VfxApi
```
## contract src/contracts/vfx/types.ts
```ts
interface Vector3VFX {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface ColorVFX {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}
interface GPUParticleEmitterConfig {
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
interface DecalConfig {
  readonly decalId: string;
  readonly textureUrl: string;
  readonly position: Vector3VFX;
  readonly orientationNormal: Vector3VFX;
  readonly size: Vector3VFX;
  readonly lifetimeSeconds?: number;
  readonly fadeDurationSeconds?: number;
}
interface PostProcessingConfig {
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
interface VFXPresetDescriptor {
  readonly presetId: string;
  readonly particleEmitter?: GPUParticleEmitterConfig;
  readonly decal?: DecalConfig;
  readonly screenShakeTrauma?: number;
  readonly postFXPulseBloomStrength?: number;
}
interface VFXSpawnedPayload {
  readonly emitterId: string;
  readonly position: Vector3VFX;
  readonly totalActiveParticles: number;
}
event VFXSpawnedEvent = "game.vfx.spawned" payload VFXSpawnedPayload
interface DecalProjectedPayload {
  readonly decalId: string;
  readonly position: Vector3VFX;
  readonly targetEntityId?: string;
}
event DecalProjectedEvent = "game.vfx.decal-projected" payload DecalProjectedPayload
interface PostFXStateChangedPayload {
  readonly activePasses: ReadonlyArray<string>;
  readonly isBloomActive: boolean;
  readonly isSSAOActive: boolean;
}
event PostFXStateChangedEvent = "game.vfx.postfx-changed" payload PostFXStateChangedPayload
interface SpawnParticleEmitterRequest {
  readonly config: GPUParticleEmitterConfig;
}
command SpawnParticleEmitterCommand = "game.vfx.spawn-emitter" request SpawnParticleEmitterRequest
interface ProjectDecalRequest {
  readonly config: DecalConfig;
}
command ProjectDecalCommand = "game.vfx.project-decal" request ProjectDecalRequest
interface SetPostFXConfigRequest {
  readonly config: Partial<PostProcessingConfig>;
}
command SetPostFXConfigCommand = "game.vfx.set-postfx-config" request SetPostFXConfigRequest
interface TriggerVFXPresetRequest {
  readonly preset: VFXPresetDescriptor;
}
command TriggerVFXPresetCommand = "game.vfx.trigger-preset" request TriggerVFXPresetRequest
```
## notas verificadas (comportamento)
- BUG GRAVE (G88): as partículas da engine NÃO aparecem no navegador (shader inválido); em testes parecem funcionar. Parar/substituir emissor vaza GPU (G89). Não use `spawnParticleEmitter`/`triggerVFXPreset` com emissor para efeitos visíveis: faça partículas no jogo (`InstancedMesh` de cubos ou `THREE.Points` via `addMeshToScene`).
- Decals funcionam como caixa texturizada (G90): textura precisa estar no cache (`loadTexture` antes), use `size.z` ≈ 0,01, sempre `lifetimeSeconds`; `decalId` não identifica (duplica); `clearDecals()` no dispose.
- Pós-processamento não é desenhado (G9). `gravityScale` é aceleração absoluta (G91).
- A engine chama `update(dt)` no `game.loop.render`.
