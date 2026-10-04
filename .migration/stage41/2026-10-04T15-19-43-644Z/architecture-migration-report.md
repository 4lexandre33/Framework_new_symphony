# Architecture Migration Report — Projeto1 v20

Gerado em: 2026-10-04T15:19:43.663Z

## 1. Resultado executivo

- Arquitetura alvo: **v20**.
- Operações consolidadas: **355**.
- Módulos canônicos: **23**.
- Freeze v20: **ativo e validado**.
- Boundaries: **0 violações**.
- Dependency graph: **0 violações**.
- Architecture smoke: **PASS**.
- Rollback transacional em laboratório: **PASS**.
- Idempotência pós-migração: **PASS**.
- Pendências bloqueantes da migração estrutural: **0**.

## 2. Snapshot pós-migração

- Snapshot de referência fornecido para auditoria: **Projeto1_092**.
- Snapshot SHA-256 local da árvore operacional: `11800a3d0ea26db8fbcfd1d9b34271d98316b614401a6ddf59b519c024581fd1`.
- Arquivos no snapshot SHA-256 local: **452**.
- Evidências Stage 41: `.migration/stage41/2026-10-04T15-19-43-644Z`.
- O snapshot local é derivado de `src/`, `src-tauri/src/`, `src-tauri/capabilities/`, `tests/`, `scripts/architecture/` e arquivos de configuração/journals essenciais.

## 3. Comparação arquitetura antiga → v20

- Baseline Stage 3: `.migration/stage3/2026-10-03T23-03-19Z/architecture-summary.txt`.
- Referências AST inventariadas no baseline: **1062**.
- Imports externos para subpaths de Core no baseline: **89**; no estado atual o boundary checker registra **0 violações**.
- Áreas conceituais ausentes no baseline: **10**; estado atual: **10/10** áreas criadas com somente README.txt.

## 4. Arquivos movidos — Etapa 10

Total: **93**.

- `src/engine/ai/AIAgentManager.ts` → `src/engine/ai/internal/AIAgentManager.ts`
- `src/engine/ai/BehaviorTree.ts` → `src/engine/ai/internal/BehaviorTree.ts`
- `src/engine/ai/NavMeshQuery.ts` → `src/engine/ai/internal/NavMeshQuery.ts`
- `src/engine/ai/PerceptionSystem.ts` → `src/engine/ai/internal/PerceptionSystem.ts`
- `src/engine/ai/SteeringBehaviors.ts` → `src/engine/ai/internal/SteeringBehaviors.ts`
- `src/engine/anim/AnimationEventManager.ts` → `src/engine/anim/internal/AnimationEventManager.ts`
- `src/engine/anim/AnimationState.ts` → `src/engine/anim/internal/AnimationState.ts`
- `src/engine/anim/AnimationStateMachine.ts` → `src/engine/anim/internal/AnimationStateMachine.ts`
- `src/engine/anim/SkeletalAnimationDriver.ts` → `src/engine/anim/internal/SkeletalAnimationDriver.ts`
- `src/engine/anim/Sprite2DAnimationDriver.ts` → `src/engine/anim/internal/Sprite2DAnimationDriver.ts`
- `src/engine/assets/AssetCache.ts` → `src/engine/assets/internal/AssetCache.ts`
- `src/engine/assets/AudioLoaderService.ts` → `src/engine/assets/internal/AudioLoaderService.ts`
- `src/engine/assets/GLTFLoaderService.ts` → `src/engine/assets/internal/GLTFLoaderService.ts`
- `src/engine/assets/TextureLoaderService.ts` → `src/engine/assets/internal/TextureLoaderService.ts`
- `src/engine/audio/AudioListenerBridge.ts` → `src/engine/audio/internal/AudioListenerBridge.ts`
- `src/engine/audio/AudioMixer.ts` → `src/engine/audio/internal/AudioMixer.ts`
- `src/engine/audio/MusicCrossfader.ts` → `src/engine/audio/internal/MusicCrossfader.ts`
- `src/engine/audio/PositionalAudio3D.ts` → `src/engine/audio/internal/PositionalAudio3D.ts`
- `src/engine/camera/CameraOcclusionDetector.ts` → `src/engine/camera/internal/CameraOcclusionDetector.ts`
- `src/engine/camera/SpringArm3D.ts` → `src/engine/camera/internal/SpringArm3D.ts`
- `src/engine/camera/TraumaCameraShake.ts` → `src/engine/camera/internal/TraumaCameraShake.ts`
- `src/engine/camera/VirtualCameraStack.ts` → `src/engine/camera/internal/VirtualCameraStack.ts`
- `src/engine/input/GamepadDriver.ts` → `src/engine/input/internal/GamepadDriver.ts`
- `src/engine/input/InputManager.ts` → `src/engine/input/internal/InputManager.ts`
- `src/engine/input/KeyboardMouseDriver.ts` → `src/engine/input/internal/KeyboardMouseDriver.ts`
- `src/engine/modding/AssetOverrideRegistry.ts` → `src/engine/modding/internal/AssetOverrideRegistry.ts`
- `src/engine/modding/DynamicPluginLoader.ts` → `src/engine/modding/internal/DynamicPluginLoader.ts`
- `src/engine/modding/ScriptSandbox.ts` → `src/engine/modding/internal/ScriptSandbox.ts`
- `src/engine/modding/SteamWorkshopDriver.ts` → `src/engine/modding/internal/SteamWorkshopDriver.ts`
- `src/engine/modding/TauriModdingDriver.ts` → `src/engine/modding/internal/TauriModdingDriver.ts`
- `src/engine/monetization/InventoryReceiptValidator.ts` → `src/engine/monetization/internal/InventoryReceiptValidator.ts`
- `src/engine/monetization/SteamMicroTxnBridge.ts` → `src/engine/monetization/internal/SteamMicroTxnBridge.ts`
- `src/engine/monetization/StoreCatalogRegistry.ts` → `src/engine/monetization/internal/StoreCatalogRegistry.ts`
- `src/engine/monetization/TauriMonetizationDriver.ts` → `src/engine/monetization/internal/TauriMonetizationDriver.ts`
- `src/engine/monetization/VirtualCurrencyWallet.ts` → `src/engine/monetization/internal/VirtualCurrencyWallet.ts`
- `src/engine/net/NetworkTransport.ts` → `src/engine/net/internal/NetworkTransport.ts`
- `src/engine/net/StateReplicator.ts` → `src/engine/net/internal/StateReplicator.ts`
- `src/engine/net/SteamP2PTransport.ts` → `src/engine/net/internal/SteamP2PTransport.ts`
- `src/engine/net/WebSocketTransport.ts` → `src/engine/net/internal/WebSocketTransport.ts`
- `src/engine/overlay/OverlayWindowManager.ts` → `src/engine/overlay/internal/OverlayWindowManager.ts`
- `src/engine/overlay/RaycastHitTestPassthrough.ts` → `src/engine/overlay/internal/RaycastHitTestPassthrough.ts`
- `src/engine/overlay/TauriOverlayDriver.ts` → `src/engine/overlay/internal/TauriOverlayDriver.ts`
- `src/engine/physics/CollisionEventManager.ts` → `src/engine/physics/internal/CollisionEventManager.ts`
- `src/engine/physics/PhysicsWorld.ts` → `src/engine/physics/internal/PhysicsWorld.ts`
- `src/engine/physics/RaycasterQueries.ts` → `src/engine/physics/internal/RaycasterQueries.ts`
- `src/engine/physics/RigidBodyFactory.ts` → `src/engine/physics/internal/RigidBodyFactory.ts`
- `src/engine/render/CameraManager.ts` → `src/engine/render/internal/CameraManager.ts`
- `src/engine/render/SceneGraphManager.ts` → `src/engine/render/internal/SceneGraphManager.ts`
- `src/engine/render/ThreeRenderEngine.ts` → `src/engine/render/internal/ThreeRenderEngine.ts`
- `src/engine/render/ViewportManager.ts` → `src/engine/render/internal/ViewportManager.ts`
- `src/engine/scripting/CutsceneTimeline.ts` → `src/engine/scripting/internal/CutsceneTimeline.ts`
- `src/engine/scripting/DialogueTreeParser.ts` → `src/engine/scripting/internal/DialogueTreeParser.ts`
- `src/engine/scripting/QuestManager.ts` → `src/engine/scripting/internal/QuestManager.ts`
- `src/engine/scripting/TriggerZoneManager.ts` → `src/engine/scripting/internal/TriggerZoneManager.ts`
- `src/engine/security/CrashReportDumper.ts` → `src/engine/security/internal/CrashReportDumper.ts`
- `src/engine/security/FrameProfiler.ts` → `src/engine/security/internal/FrameProfiler.ts`
- `src/engine/security/MemoryIntegrityGuard.ts` → `src/engine/security/internal/MemoryIntegrityGuard.ts`
- `src/engine/security/TauriSecurityDriver.ts` → `src/engine/security/internal/TauriSecurityDriver.ts`
- `src/engine/sprites/InstancedTilemapRenderer.ts` → `src/engine/sprites/internal/InstancedTilemapRenderer.ts`
- `src/engine/sprites/ParallaxController.ts` → `src/engine/sprites/internal/ParallaxController.ts`
- `src/engine/sprites/PixelArtScaler.ts` → `src/engine/sprites/internal/PixelArtScaler.ts`
- `src/engine/sprites/Sprite2DRenderer.ts` → `src/engine/sprites/internal/Sprite2DRenderer.ts`
- `src/engine/sprites/TextureAtlasParser.ts` → `src/engine/sprites/internal/TextureAtlasParser.ts`
- `src/engine/storage/CloudDatabaseDriver.ts` → `src/engine/storage/internal/CloudDatabaseDriver.ts`
- `src/engine/storage/LocalDatabaseDriver.ts` → `src/engine/storage/internal/LocalDatabaseDriver.ts`
- `src/engine/storage/SteamCloudDriver.ts` → `src/engine/storage/internal/SteamCloudDriver.ts`
- `src/engine/streaming/DistanceLODManager.ts` → `src/engine/streaming/internal/DistanceLODManager.ts`
- `src/engine/streaming/HLODBuilder.ts` → `src/engine/streaming/internal/HLODBuilder.ts`
- `src/engine/streaming/streaming.worker.ts` → `src/engine/streaming/internal/streaming.worker.ts`
- `src/engine/streaming/StreamingWorkerPool.ts` → `src/engine/streaming/internal/StreamingWorkerPool.ts`
- `src/engine/streaming/WorldStreamingSectorManager.ts` → `src/engine/streaming/internal/WorldStreamingSectorManager.ts`
- `src/engine/terrain/BiomeEvaluator.ts` → `src/engine/terrain/internal/BiomeEvaluator.ts`
- `src/engine/terrain/GreedyMesher.ts` → `src/engine/terrain/internal/GreedyMesher.ts`
- `src/engine/terrain/PerlinNoiseService.ts` → `src/engine/terrain/internal/PerlinNoiseService.ts`
- `src/engine/terrain/ProceduralWorkerPool.ts` → `src/engine/terrain/internal/ProceduralWorkerPool.ts`
- `src/engine/terrain/terrain.worker.ts` → `src/engine/terrain/internal/terrain.worker.ts`
- `src/engine/terrain/VoxelChunkManager.ts` → `src/engine/terrain/internal/VoxelChunkManager.ts`
- `src/engine/ui/DOMEventListenerBridge.ts` → `src/engine/ui/internal/DOMEventListenerBridge.ts`
- `src/engine/ui/HUDDataBinder.ts` → `src/engine/ui/internal/HUDDataBinder.ts`
- `src/engine/ui/LocalizationEngine.ts` → `src/engine/ui/internal/LocalizationEngine.ts`
- `src/engine/ui/UIManager.ts` → `src/engine/ui/internal/UIManager.ts`
- `src/engine/ui/UITemplateRegistry.ts` → `src/engine/ui/internal/UITemplateRegistry.ts`
- `src/engine/vfx/CustomShaderLibrary.ts` → `src/engine/vfx/internal/CustomShaderLibrary.ts`
- `src/engine/vfx/DecalManager.ts` → `src/engine/vfx/internal/DecalManager.ts`
- `src/engine/vfx/GPUParticleSystem.ts` → `src/engine/vfx/internal/GPUParticleSystem.ts`
- `src/engine/vfx/PostProcessingPipeline.ts` → `src/engine/vfx/internal/PostProcessingPipeline.ts`
- `src/engine/vfx/VFXEffectManager.ts` → `src/engine/vfx/internal/VFXEffectManager.ts`
- `src/engine/world/EntityManager.ts` → `src/engine/world/internal/EntityManager.ts`
- `src/engine/world/OctreeManager.ts` → `src/engine/world/internal/OctreeManager.ts`
- `src/engine/world/SaveSystem.ts` → `src/engine/world/internal/SaveSystem.ts`
- `src/engine/world/SceneManager.ts` → `src/engine/world/internal/SceneManager.ts`
- `src/engine/world/SpatialGrid.ts` → `src/engine/world/internal/SpatialGrid.ts`
- `src/engine/world/WorldStateSerializer.ts` → `src/engine/world/internal/WorldStateSerializer.ts`

## 5. Extrações de implementação — Etapa 12

Total: **21** extrações plugin → internal.

- `src/plugins/steam/plugin.ts` → `src/engine/steam/internal/SteamBridgeService.ts`
- `src/plugins/assets/plugin.ts` → `src/engine/assets/internal/AssetsManagerService.ts`
- `src/plugins/physics/plugin.ts` → `src/engine/physics/internal/PhysicsService.ts`
- `src/plugins/storage/plugin.ts` → `src/engine/storage/internal/StorageService.ts`
- `src/plugins/world/plugin.ts` → `src/engine/world/internal/WorldService.ts`
- `src/plugins/ui/plugin.ts` → `src/engine/ui/internal/UIService.ts`
- `src/plugins/anim/plugin.ts` → `src/engine/anim/internal/AnimationService.ts`
- `src/plugins/sprites/plugin.ts` → `src/engine/sprites/internal/SpritesService.ts`
- `src/plugins/audio/plugin.ts` → `src/engine/audio/internal/AudioService.ts`
- `src/plugins/camera/plugin.ts` → `src/engine/camera/internal/CameraService.ts`
- `src/plugins/ai/plugin.ts` → `src/engine/ai/internal/AIService.ts`
- `src/plugins/vfx/plugin.ts` → `src/engine/vfx/internal/VFXService.ts`
- `src/plugins/terrain/plugin.ts` → `src/engine/terrain/internal/TerrainService.ts`
- `src/plugins/scripting/plugin.ts` → `src/engine/scripting/internal/ScriptingService.ts`
- `src/plugins/streaming/plugin.ts` → `src/engine/streaming/internal/StreamingService.ts`
- `src/plugins/overlay/plugin.ts` → `src/engine/overlay/internal/OverlayService.ts`
- `src/plugins/security/plugin.ts` → `src/engine/security/internal/SecurityService.ts`
- `src/plugins/modding/plugin.ts` → `src/engine/modding/internal/ModdingService.ts`
- `src/plugins/monetization/plugin.ts` → `src/engine/monetization/internal/MonetizationService.ts`
- `src/plugins/game-loop/plugin.ts` → `src/engine/game-loop/internal/DeterministicGameLoop.ts`
- `src/plugins/net/plugin.ts` → `src/engine/net/internal/NetworkService.ts`

## 6. Imports reescritos — Etapa 13

- Arquivos reescritos: **108**.
- Rewrites de specifier registrados: **163**.
- Worker URLs validados conforme journal da Etapa 13.
- Referências relativas não resolvidas pós-Etapa 13: **0**, conforme journal.

## 7. Fachadas públicas — Etapa 14

- Fachadas `public/index.ts` criadas: **23**.
- Fachadas expõem contracts/tokens e não implementações concretas.

## 8. Alias público @core — Etapas 15 e 16

- Configurações de alias: **2**.
- Operações de migração de consumidores externos: **104**.
- Rewrites de imports para `@core`: **103** operações.
- Promoções explícitas de símbolo público: **1**.
- Edits registrados pela Etapa 16: **108**.
- Símbolos promovidos: `satisfies`.

## 9. API leaks corrigidos — Etapa 17

Total: **4**.

- `src/contracts/net/types.ts` — public-contract-interface
- `src/tokens/net.ts` — capability-api-return-type
- `src/engine/net/internal/StateReplicator.ts` — internal-interface-implementation
- `src/engine/net/internal/NetworkService.ts` — internal-service-return-type

## 10. Diretórios conceituais

Total validado: **10**.

- `src/domain/ports/README.txt`
- `src/domain/entities/README.txt`
- `src/domain/economy/README.txt`
- `src/domain/mechanics/README.txt`
- `src/domain/narrative/README.txt`
- `src/domain/evaluation/README.txt`
- `src/services/ui/README.txt`
- `src/services/usecases/README.txt`
- `src/services/diagnostics/README.txt`
- `src/app/flows/README.txt`

Nenhum placeholder `.ts/.tsx/.js` vazio foi introduzido nessas áreas.

## 11. Testes e validações executados

| Validação | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS — Etapa 31 |
| `npx vitest run` | PASS — 32 files / 195 tests na Etapa 31 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS — Etapa 32 |
| `npm run build` | PASS — Etapa 33 |
| `npm run tauri dev` | PASS manual — Etapa 34 |
| Stage 35 old-path audit | PASS |
| Stage 36 conceptual directories | PASS |
| Stage 37 idempotência pós-migração | PASS |
| Stage 38 rollback transacional temp | PASS |
| Stage 40 freeze/guardrails | PASS |
| `node agents.mjs` | PASS |
| `check-boundaries.mjs` | PASS — 0 violações |
| `check-dependencies.mjs` | PASS — 0 violações |
| `architecture-smoke-test.mjs` | PASS |

## 12. Hashes e evidências

- Tree digest Stage 41: `11800a3d0ea26db8fbcfd1d9b34271d98316b614401a6ddf59b519c024581fd1`.
- Freeze lock SHA-256: `fd1027b8ded14d6b945c56665c506d26bd2ccb24d62b4fc9f16f5f924d4f99b2`.
- Journal global SHA-256: `61073f9bd5a16e3a84f16b62fe36a1e4b0a2eeb21c559ec71542ee0d3c1f8618`.
- Module map SHA-256: `2a3b98dc51ea88d115540eab43bc86edc99981d300c6f2e5d6d9f557839d8a4b`.
- Boundary checker SHA-256: `24c0adc3e28a04a912b4adc3591985bcc9dd4b64405bf08e76124bd1b25ccfe7`.
- Dependency checker SHA-256: `ce15f65357e0bae081537b843c5742409424d95e7a019a3d977ec48c89dac07a`.

## 13. Pendências

- **Nenhuma pendência bloqueante da migração v20.**
- Limpeza de caches/backups temporários redundantes pertence à **Etapa 42**.
- Integração permanente de `arch:check`, `arch:dependencies` e scripts npm pertence à **Etapa 43**.
- Implementações reais de Domain/Services/App flows pertencem à **Etapa 44**.

## 14. Comandos de verificação Stage 41

```bash
node agents.mjs
node scripts/architecture/check-boundaries.mjs
node scripts/architecture/check-dependencies.mjs
node tests/architecture-smoke-test.mjs
```

## 15. Resultado da Etapa 41

**ETAPA 41: PASS**

O estado pós-migração v20 foi documentado com snapshot SHA-256 local, relatório de movimentos/rewrites/leaks/diretórios, guardrails verdes e hashes de evidência.
