# vfx — Partículas GPU, Decals & Pós-Processamento
capability: game.vfx@1.0.0 | category: functional | engine plugin id: game.vfx
consumes: RenderToken, AssetsToken
use (from src/projects/<jogo>/**):
  import { VfxToken } from "../../tokens/vfx";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/vfx.ts
```ts
interface VfxApi { // Efeitos visuais.
  spawnParticleEmitter( config: GPUParticleEmitterConfig, ): void; // Cria ou substitui um emissor de partículas (o anterior com o mesmo id é liberado: geometria, material e textu…
  stopParticleEmitter( emitterId: string, options?: StopParticleEmitterOptions, ): boolean; // Encerra e remove um emissor ativo (libera GPU).
  setEmitterPosition( emitterId: string, position: Vector3VFX, ): boolean; // Move o ponto de nascimento das próximas partículas (G19).
  burstParticles( emitterId: string, count: number, ): boolean; // Emite `count` partículas extras no próximo frame.
  hasParticleEmitter( emitterId: string, ): boolean;
  projectDecal( config: DecalConfig, ): void; // Projeta um decal na cena (ver `DecalConfig`; G90).
  removeDecal( decalId: string, ): boolean; // Remove o decal `decalId` (libera GPU).
  setMaxDecals( maxDecals: number, ): void; // Limite de decals simultâneos (padrão 200); o mais antigo é reciclado.
  clearDecals(): void; // Remove todos os decals ativos.
  configurePostProcessing( config: Partial<PostProcessingConfig>, ): void; // Atualiza as configurações globais de pós-processamento e o liga (salvo `enabled: false`).
  isPostProcessingActive(): boolean; // true se o pós-processamento está sendo desenhado neste momento.
  triggerVFXPreset( preset: VFXPresetDescriptor, ): void; // Executa um preset composto de VFX.
  registerVFXPreset( preset: VFXPresetDescriptor, ): void; // Registra (ou substitui) um preset reutilizável.
  unregisterVFXPreset( presetId: string, ): boolean;
  triggerVFXPresetById( presetId: string, options?: VFXPresetTriggerOptions, ): VFXPresetInstance | null; // Dispara um preset registrado.
  pulseBloom( strength: number, durationSeconds: number, ): void; // Gera um pulso temporário de bloom (desenhado mesmo com o pós-processamento desligado, só enquanto dura o puls…
  getActiveParticleCount(): number; // Retorna a quantidade total de slots de partículas atualmente registrados.
  getActiveDecalCount(): number; // Retorna a quantidade de decals ativos.
  update( deltaSeconds: number, ): void; // Atualiza os sistemas temporais da camada (a engine já chama no render).
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
interface GPUParticleEmitterConfig { // Emissor de partículas (GPU, `THREE.Points` + `ShaderMaterial`).
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
interface DecalConfig { // Decal projetado (G90): a textura é PROJETADA sobre as malhas da cena que cruzam a caixa `size` (x/y = área, z…
  readonly decalId: string;
  readonly textureUrl: string;
  readonly position: Vector3VFX;
  readonly orientationNormal: Vector3VFX;
  readonly size: Vector3VFX;
  readonly lifetimeSeconds?: number;
  readonly fadeDurationSeconds?: number;
}
interface PostProcessingConfig { // Pós-processamento (G9), desenhado por EffectComposer instalado no `game.render` (RenderPass → SSAO → Bloom → …
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
  readonly colorGradingIntensity?: number; // Mistura do LUT 0..1 (padrão 1).
}
interface VFXPresetDescriptor { // Preset composto (G91).
  readonly presetId: string;
  readonly particleEmitter?: GPUParticleEmitterConfig;
  readonly decal?: DecalConfig;
  readonly screenShakeTrauma?: number;
  readonly postFXPulseBloomStrength?: number;
  readonly postFXPulseDurationSeconds?: number; // Duração do pulso de bloom (padrão 0,3 s).
}
interface VFXPresetTriggerOptions {
  readonly position?: Vector3VFX; // Desloca emissor e decal para esta posição.
  readonly instanceId?: string; // Sufixo dos ids gerados (padrão: contador).
}
interface VFXPresetInstance {
  readonly presetId: string;
  readonly emitterId: string | null;
  readonly decalId: string | null;
}
interface StopParticleEmitterOptions {
  readonly graceful?: boolean; // true = para de emitir e deixa as vivas terminarem (remove sozinho depois).
}
interface VFXEmitterFinishedPayload {
  readonly emitterId: string;
}
event VFXEmitterFinishedEvent = "game.vfx.emitter-finished" payload VFXEmitterFinishedPayload
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
