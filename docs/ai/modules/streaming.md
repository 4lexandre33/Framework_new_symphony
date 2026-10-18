# streaming — Streaming Espacial, LOD & HLOD
capability: game.streaming@1.0.0 | category: functional | engine plugin id: game.streaming
dependsOn: game.loop, game.camera, game.render, game.assets
consumes: CameraToken, RenderToken, AssetsToken
use (from src/projects/<jogo>/**):
  import { StreamingToken } from "../../tokens/streaming";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/streaming.ts
```ts
interface HLODStats {
  readonly totalClusters: number; // Proxies HLOD construídos (malhas realmente fundidas).
  readonly drawCallsSaved: number; // Malhas de origem − draw calls dos proxies.
  readonly mergedMeshCount: number; // Malhas de origem fundidas.
}
interface StreamingApi {
  registerLODEntity(descriptor: LODEntityDescriptor): void; // Registra (ou substitui) e avalia o nível JÁ (níveis em qualquer ordem).
  unregisterLODEntity(entityId: string): boolean;
  updateStreamingCenter(position: Vector3Streaming): void; // Define o centro do streaming e passa a origem para "explicit" (a câmera deixa de sobrescrever).
  registerSector(descriptor: StreamingSectorDescriptor): void; // Registra (ou atualiza bounds/assets de) um setor.
  loadSector(sectorCoord: SectorCoord, priority?: number): Promise<boolean>; // Carga manual: carrega os `assetUrls` (via game.assets) e emite `sector-loaded`.
  unloadSector(sectorCoord: SectorCoord): boolean; // Descarga manual: a regra de raio não recarrega até o setor sair do raio.
  getActiveSectors(): ReadonlyArray<SectorCoord>;
  getHLODStats(): HLODStats;
  getEntityLODLevel(entityId: string): LODLevel | null;
  update(cameraPosition: Vector3Streaming, deltaSeconds: number): void;
  clear(): void; // Descarrega e remove setores (com `sector-unloaded`), LODs e HLODs.
  unregisterSector(sectorCoord: SectorCoord): boolean; // Remove um setor (descarrega antes, com evento).
  releaseSector(sectorCoord: SectorCoord): boolean; // Devolve o setor à regra de raio (desfaz pin/supressão manual).
  isSectorPinned(sectorCoord: SectorCoord): boolean;
  getSectorState(sectorCoord: SectorCoord): SectorLoadingState;
  getSectorAsset(sectorCoord: SectorCoord, url: string): unknown; // Asset carregado do setor (instância GLTF, textura...), ou null.
  setStreamingRadius(loadRadius: number, hysteresisMargin?: number): void;
  setCenterSource(source: StreamingCenterSource): void;
  getStreamingCenter(): Vector3Streaming;
  setMaxConcurrentLoads(count: number): void;
  updateLODEntityPosition(entityId: string, position: Vector3Streaming): boolean; // Move uma entidade de LOD.
  setLODHysteresis(margin: number): void; // Histerese global de LOD (unidades).
  buildHLOD(sectorCoord: SectorCoord, meshKeys: ReadonlyArray<string>, options?: HLODBuildOptions): HLODBuildResult | null; // HLOD real: funde as malhas da cena (`meshKeys`) do setor num proxy por material.
  buildHLODFromCluster(sectorCoord: SectorCoord, options?: HLODBuildOptions): Promise<HLODBuildResult | null>; // HLOD a partir do `hlodCluster` do setor (combinedMeshUrl ou staticMeshUrls via game.assets).
  removeHLOD(sectorCoord: SectorCoord): boolean;
  isHLODActive(sectorCoord: SectorCoord): boolean;
  getStats(): StreamingStats;
}
capability StreamingToken = "game.streaming"@1.0.0 api StreamingApi
```
## contract src/contracts/streaming/types.ts
```ts
interface Vector3Streaming {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface SectorCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type LODLevel = 0 | 1 | 2 | 3;
interface LODLevelDescriptor {
  readonly level: LODLevel;
  readonly distanceThreshold: number;
  readonly meshUrl: string; // URL de asset OU chave do jogo (G132).
  readonly preload?: boolean; // G132: true força o pré-carregamento de `meshUrl`; false nunca carrega.
  readonly maxScreenSpaceError?: number;
}
interface LODEntityDescriptor {
  readonly entityId: string;
  readonly worldPosition: Vector3Streaming;
  readonly lodLevels: ReadonlyArray<LODLevelDescriptor>; // Qualquer ordem: a engine ordena por `distanceThreshold` (G63).
  readonly currentLevel: LODLevel; // Nível inicial declarado; o real é avaliado JÁ no registro (G63).
  readonly hysteresis?: number; // Histerese (unidades de mundo) desta entidade.
}
interface HLODClusterDescriptor {
  readonly clusterId: string;
  readonly sectorCoord: SectorCoord;
  readonly staticMeshUrls: ReadonlyArray<string>;
  readonly combinedMeshUrl: string;
  readonly boundingCenter: Vector3Streaming;
  readonly boundingRadius: number;
}
export type SectorLoadingState = "unloaded" | "loading" | "loaded" | "unloading";
interface StreamingSectorDescriptor {
  readonly sectorCoord: SectorCoord;
  readonly boundsMin: Vector3Streaming;
  readonly boundsMax: Vector3Streaming;
  readonly assetUrls: ReadonlyArray<string>; // Carregados via `game.assets` (se presente) antes de `sector-loaded` e liberados no unload (G17).
  readonly hlodCluster?: HLODClusterDescriptor;
  readonly priority?: number; // Prioridade de carga (maior primeiro).
}
export type StreamingCenterSource = "camera" | "explicit"; // Origem do centro do streaming (G17).
interface HLODBuildOptions {
  readonly switchDistance?: number; // Distância (do centro ao centro do setor) a partir da qual o proxy aparece.
  readonly maxDistance?: number; // Além disto o proxy também some.
  readonly hideSources?: boolean; // Esconde os originais (chaves de cena) enquanto o proxy está ativo.
}
interface HLODBuildResult {
  readonly sceneKey: string; // Chave de cena do proxy (`hlod_<x>:<y>:<z>`).
  readonly sourceMeshCount: number;
  readonly mergedDrawCalls: number; // Draw calls do proxy (1 por material).
  readonly vertexCount: number;
  readonly skippedMeshCount: number; // Malhas ignoradas (skinned, instanced, multi-material).
}
interface StreamingStats {
  readonly registeredSectors: number;
  readonly loadedSectors: number;
  readonly loadingSectors: number;
  readonly queuedSectors: number;
  readonly pinnedSectors: number;
  readonly lodEntities: number;
  readonly hlodClusters: number;
  readonly activeHLODs: number;
  readonly assetsLoaded: number;
  readonly assetsFailed: number;
  readonly lastLoadTimeMs: number;
  readonly averageLoadTimeMs: number;
  readonly centerSource: StreamingCenterSource;
}
interface SectorLoadedPayload {
  readonly sectorCoord: SectorCoord;
  readonly loadedAssetsCount: number;
  readonly loadTimeMs: number;
  readonly failedAssetsCount?: number; // Assets que falharam (o setor carrega mesmo assim).
  readonly pinned?: boolean; // true se foi pedido à mão (`loadSector`): fica fixo até `releaseSector`/`unloadSector`.
}
event SectorLoadedEvent = "game.streaming.sector-loaded" payload SectorLoadedPayload
interface SectorUnloadedPayload {
  readonly sectorCoord: SectorCoord;
}
event SectorUnloadedEvent = "game.streaming.sector-unloaded" payload SectorUnloadedPayload
interface LODLevelChangedPayload {
  readonly entityId: string;
  readonly previousLevel: LODLevel;
  readonly newLevel: LODLevel;
  readonly meshUrl?: string; // `meshUrl` do novo nível (pré-carregado via `game.assets` só se for URL ou `preload: true`, G132).
}
event LODLevelChangedEvent = "game.streaming.lod-changed" payload LODLevelChangedPayload
interface RequestSectorLoadPayload {
  readonly sectorCoord: SectorCoord;
  readonly priority?: number;
}
command RequestSectorLoadCommand = "game.streaming.request-sector-load" request RequestSectorLoadPayload
interface ForceSectorUnloadPayload {
  readonly sectorCoord: SectorCoord;
}
command ForceSectorUnloadCommand = "game.streaming.force-sector-unload" request ForceSectorUnloadPayload
interface SetStreamingRadiusPayload {
  readonly loadRadius: number;
  readonly hysteresisMargin: number;
}
command SetStreamingRadiusCommand = "game.streaming.set-radius" request SetStreamingRadiusPayload
```
## notas verificadas (comportamento)
- A engine chama `update` no tick. Centro: por padrão a posição da câmera ativa (`game.camera`); `updateStreamingCenter(pos)` passa a origem para "explicit" (a câmera para de sobrescrever); `setCenterSource("camera")` volta. A distância inclui Y.
- Setores: `registerSector({ sectorCoord, boundsMin, boundsMax, assetUrls, priority? })`. Ao entrar no raio os `assetUrls` são carregados via `game.assets` e sai `game.streaming.sector-loaded`; ao sair, liberados + `sector-unloaded`. O jogo cria/remove o conteúdo do setor nesses eventos (`getSectorAsset(coord, url)` dá a instância carregada).
- Raio padrão 100 (+15 de histerese): `setStreamingRadius(load, histerese)`.
- Manual: `loadSector` FIXA o setor (pinned) até `releaseSector`/`unloadSector`; `unloadSector` suprime até ele sair do raio. `unregisterSector` remove com evento; `clear()` descarrega tudo com eventos.
- LOD: `registerLODEntity` avalia o nível JÁ (níveis em qualquer ordem); `updateLODEntityPosition` move; histerese por entidade ou `setLODHysteresis`. `game.streaming.lod-changed` traz `newLevel`. `meshUrl` só é pré-carregado via assets se PARECER URL (esquema http(s)/blob/data/file/asset/tauri, começa com `/`/`./`/`../` ou tem extensão, ex.: `tree_lo.glb`) ou com `preload: true`; chaves do jogo (`"tree-low"`) não carregam e chegam em `meshUrl` do evento; `preload: false` nunca carrega (G132).
- HLOD real: `buildHLOD(coord, chavesDeCena, { switchDistance, hideSources })` funde malhas da cena num proxy por material; `removeHLOD`; `getHLODStats()`.
