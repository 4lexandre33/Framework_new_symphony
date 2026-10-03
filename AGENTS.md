# Diretivas Arquiteturais e Invariantes do Projeto (AGENTS.md)

Este documento define os limites de autoridade para agentes de IA, assistentes de código e scripts de automação que operam neste repositório.

## Módulos Congelados (FROZEN MODULES - DO NOT MODIFY WHILE LOCKED)

### Camada 1 — Steamworks & P2P
- `src-tauri/src/steam.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src/contracts/steam/net-types.ts`
- `src/tokens/steam.ts`
- `src/tokens/steam-net.ts`
- `src/plugins/steam/plugin.ts`
- `steam_appid.txt`
- `src-tauri/steam_appid.txt`
- `tests/steam-integration.test.ts`
- `tests/steam-p2p-smoke.mjs`

### Camada 2 — Input Manager
- `src/contracts/input/types.ts`
- `src/tokens/input.ts`
- `src/engine/input/KeyboardMouseDriver.ts`
- `src/engine/input/GamepadDriver.ts`
- `src/engine/input/InputManager.ts`
- `src/plugins/input/plugin.ts`
- `tests/input-system.test.ts`
- `tests/input-smoke-test.mjs`

### Camada 3 — Asset Pipeline & VRAM Cache
- `src/contracts/assets/types.ts`
- `src/tokens/assets.ts`
- `src/engine/assets/AssetCache.ts`
- `src/engine/assets/GLTFLoaderService.ts`
- `src/engine/assets/TextureLoaderService.ts`
- `src/engine/assets/AudioLoaderService.ts`
- `src/plugins/assets/plugin.ts`
- `tests/assets-pipeline.test.ts`
- `tests/assets-smoke-test.mjs`

### Camada 4 — Motor de Física (Rapier WASM)
- `src/contracts/physics/types.ts`
- `src/tokens/physics.ts`
- `src/engine/physics/PhysicsWorld.ts`
- `src/engine/physics/RigidBodyFactory.ts`
- `src/engine/physics/RaycasterQueries.ts`
- `src/engine/physics/CollisionEventManager.ts`
- `src/plugins/physics/plugin.ts`
- `tests/physics-system.test.ts`
- `tests/physics-smoke-test.mjs`

### Camada 5 — Persistência & Banco de Dados (game.storage)
- `src/contracts/storage/types.ts`
- `src/tokens/storage.ts`
- `src/engine/storage/SteamCloudDriver.ts`
- `src/engine/storage/LocalDatabaseDriver.ts`
- `src/engine/storage/CloudDatabaseDriver.ts`
- `src/plugins/storage/plugin.ts`
- `tests/storage-system.test.ts`
- `tests/storage-smoke-test.mjs`

### Camada 6 — Gerenciador de Mundo, Cenas & ECS (game.world)
- `src/contracts/world/types.ts`
- `src/tokens/world.ts`
- `src/engine/world/SceneManager.ts`
- `src/engine/world/EntityManager.ts`
- `src/engine/world/SpatialGrid.ts`
- `src/engine/world/OctreeManager.ts`
- `src/engine/world/WorldStateSerializer.ts`
- `src/engine/world/SaveSystem.ts`
- `src/plugins/world/plugin.ts`
- `tests/world-system.test.ts`
- `tests/world-smoke-test.mjs`

### Camada 7 — Interface de Usuário & HUD (game.ui)
- `src/contracts/ui/types.ts`
- `src/tokens/ui.ts`
- `src/styles/ui.css`
- `src/engine/ui/UIManager.ts`
- `src/engine/ui/HUDDataBinder.ts`
- `src/engine/ui/LocalizationEngine.ts`
- `src/engine/ui/UITemplateRegistry.ts`
- `src/engine/ui/DOMEventListenerBridge.ts`
- `src/plugins/ui/plugin.ts`
- `tests/ui-system.test.ts`
- `tests/ui-smoke-test.mjs`

### Camada 8 — Pipeline de Animações & State Machines (game.anim)
- `src/contracts/anim/types.ts`
- `src/tokens/anim.ts`
- `src/engine/anim/AnimationState.ts`
- `src/engine/anim/AnimationStateMachine.ts`
- `src/engine/anim/SkeletalAnimationDriver.ts`
- `src/engine/anim/Sprite2DAnimationDriver.ts`
- `src/engine/anim/AnimationEventManager.ts`
- `src/plugins/anim/plugin.ts`
- `tests/anim-system.test.ts`
- `tests/anim-smoke-test.mjs`

### Camada 9 — Motor 2D, Tilemaps & Pixel Art (game.sprites)
- `src/contracts/sprites/types.ts`
- `src/tokens/sprites.ts`
- `src/engine/sprites/TextureAtlasParser.ts`
- `src/engine/sprites/InstancedTilemapRenderer.ts`
- `src/engine/sprites/ParallaxController.ts`
- `src/engine/sprites/PixelArtScaler.ts`
- `src/engine/sprites/Sprite2DRenderer.ts`
- `src/plugins/sprites/plugin.ts`
- `tests/sprites-system.test.ts`
- `tests/sprites-smoke-test.mjs`

### Camada 10 — Mixer de Áudio Espacial 3D (game.audio)
- `src/contracts/audio/types.ts`
- `src/tokens/audio.ts`
- `src/engine/audio/AudioMixer.ts`
- `src/engine/audio/PositionalAudio3D.ts`
- `src/engine/audio/MusicCrossfader.ts`
- `src/engine/audio/AudioListenerBridge.ts`
- `src/plugins/audio/plugin.ts`
- `tests/audio-system.test.ts`
- `tests/audio-smoke-test.mjs`

### Camada 11 — Câmera Dinâmica & SpringArm (game.camera)
- `src/contracts/camera/types.ts`
- `src/tokens/camera.ts`
- `src/engine/camera/SpringArm3D.ts`
- `src/engine/camera/TraumaCameraShake.ts`
- `src/engine/camera/VirtualCameraStack.ts`
- `src/engine/camera/CameraOcclusionDetector.ts`
- `src/plugins/camera/plugin.ts`
- `tests/camera-system.test.ts`
- `tests/camera-smoke-test.mjs`

### Camada 12 — Inteligência Artificial & NavMesh (game.ai)
- `src/contracts/ai/types.ts`
- `src/tokens/ai.ts`
- `src/engine/ai/NavMeshQuery.ts`
- `src/engine/ai/BehaviorTree.ts`
- `src/engine/ai/PerceptionSystem.ts`
- `src/engine/ai/SteeringBehaviors.ts`
- `src/engine/ai/AIAgentManager.ts`
- `src/plugins/ai/plugin.ts`
- `tests/ai-system.test.ts`
- `tests/ai-smoke-test.mjs`

### Camada 13 — Partículas GPU, Decals & Pós-Processamento (game.vfx)
- `src/contracts/vfx/types.ts`
- `src/tokens/vfx.ts`
- `src/engine/vfx/GPUParticleSystem.ts`
- `src/engine/vfx/DecalManager.ts`
- `src/engine/vfx/PostProcessingPipeline.ts`
- `src/engine/vfx/CustomShaderLibrary.ts`
- `src/engine/vfx/VFXEffectManager.ts`
- `src/plugins/vfx/plugin.ts`
- `tests/vfx-system.test.ts`
- `tests/vfx-smoke-test.mjs`

### Camada 14 — Terreno Procedural, Biomas & Voxels (game.terrain)
- `src/contracts/terrain/types.ts`
- `src/tokens/terrain.ts`
- `src/engine/terrain/PerlinNoiseService.ts`
- `src/engine/terrain/BiomeEvaluator.ts`
- `src/engine/terrain/GreedyMesher.ts`
- `src/engine/terrain/VoxelChunkManager.ts`
- `src/engine/terrain/ProceduralWorkerPool.ts`
- `src/engine/terrain/terrain.worker.ts`
- `src/plugins/terrain/plugin.ts`
- `tests/terrain-system.test.ts`
- `tests/terrain-smoke-test.mjs`

### Camada 15 — Cutscenes, Diálogos & Quests (game.scripting)
- `src/contracts/scripting/types.ts`
- `src/tokens/scripting.ts`
- `src/engine/scripting/CutsceneTimeline.ts`
- `src/engine/scripting/DialogueTreeParser.ts`
- `src/engine/scripting/QuestManager.ts`
- `src/engine/scripting/TriggerZoneManager.ts`
- `src/plugins/scripting/plugin.ts`
- `tests/scripting-system.test.ts`
- `tests/scripting-smoke-test.mjs`

### Camada 16 — Streaming Espacial, LOD & HLOD (game.streaming)
- `src/contracts/streaming/types.ts`
- `src/tokens/streaming.ts`
- `src/engine/streaming/DistanceLODManager.ts`
- `src/engine/streaming/WorldStreamingSectorManager.ts`
- `src/engine/streaming/HLODBuilder.ts`
- `src/engine/streaming/StreamingWorkerPool.ts`
- `src/engine/streaming/streaming.worker.ts`
- `src/plugins/streaming/plugin.ts`
- `tests/streaming-system.test.ts`
- `tests/streaming-smoke-test.mjs`

### Camada 17 — Desktop Overlay, Ancoragem na Barra de Tarefas & Raycast Click Passthrough (game.overlay)
- `src/contracts/overlay/types.ts`
- `src/tokens/overlay.ts`
- `src/engine/overlay/RaycastHitTestPassthrough.ts`
- `src/engine/overlay/OverlayWindowManager.ts`
- `src/engine/overlay/TauriOverlayDriver.ts`
- `src-tauri/src/overlay.rs`
- `src/plugins/overlay/plugin.ts`
- `tests/overlay-system.test.ts`
- `tests/overlay-smoke-test.mjs`

### Camada 18 — Profiler de Performance, Anti-cheat & Crash Dumper (game.security)
- `src/contracts/security/types.ts`
- `src/tokens/security.ts`
- `src/engine/security/FrameProfiler.ts`
- `src/engine/security/MemoryIntegrityGuard.ts`
- `src/engine/security/CrashReportDumper.ts`
- `src/engine/security/TauriSecurityDriver.ts`
- `src-tauri/src/security.rs`
- `src/plugins/security/plugin.ts`
- `tests/security-system.test.ts`
- `tests/security-smoke-test.mjs`

### Camada 19 — Steam Workshop, Dynamic Loading & Asset Override (game.modding)
- `src/contracts/modding/types.ts`
- `src/tokens/modding.ts`
- `src/engine/modding/AssetOverrideRegistry.ts`
- `src/engine/modding/DynamicPluginLoader.ts`
- `src/engine/modding/ScriptSandbox.ts`
- `src/engine/modding/SteamWorkshopDriver.ts`
- `src/engine/modding/TauriModdingDriver.ts`
- `src-tauri/src/modding.rs`
- `src/plugins/modding/plugin.ts`
- `tests/modding-system.test.ts`
- `tests/modding-smoke-test.mjs`

### Camada 20 — Microtransações Steam & Steam Inventory Service (game.monetization)
- `src/contracts/monetization/types.ts`
- `src/tokens/monetization.ts`
- `src/engine/monetization/StoreCatalogRegistry.ts`
- `src/engine/monetization/InventoryReceiptValidator.ts`
- `src/engine/monetization/VirtualCurrencyWallet.ts`
- `src/engine/monetization/SteamMicroTxnBridge.ts`
- `src/engine/monetization/TauriMonetizationDriver.ts`
- `src-tauri/src/monetization.rs`
- `src/plugins/monetization/plugin.ts`
- `tests/monetization-system.test.ts`
- `tests/monetization-smoke-test.mjs`