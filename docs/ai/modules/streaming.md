# streaming — Streaming Espacial, LOD & HLOD
capability: game.streaming@1.0.0 | category: functional | engine plugin id: game.streaming
dependsOn: game.loop, game.camera
consumes: CameraToken
use (from src/projects/<jogo>/**):
  import { StreamingToken } from "../../tokens/streaming";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/streaming.ts
```ts
interface HLODStats {
  readonly totalClusters: number;
  readonly drawCallsSaved: number;
  readonly mergedMeshCount: number;
}
interface StreamingApi {
  registerLODEntity(descriptor: LODEntityDescriptor): void;
  unregisterLODEntity(entityId: string): boolean;
  updateStreamingCenter(position: Vector3Streaming): void;
  registerSector(descriptor: StreamingSectorDescriptor): void;
  loadSector(sectorCoord: SectorCoord): Promise<boolean>;
  unloadSector(sectorCoord: SectorCoord): boolean;
  getActiveSectors(): ReadonlyArray<SectorCoord>;
  getHLODStats(): HLODStats;
  getEntityLODLevel(entityId: string): LODLevel | null;
  update(cameraPosition: Vector3Streaming, deltaSeconds: number): void;
  clear(): void;
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
  readonly meshUrl: string;
  readonly maxScreenSpaceError?: number;
}
interface LODEntityDescriptor {
  readonly entityId: string;
  readonly worldPosition: Vector3Streaming;
  readonly lodLevels: ReadonlyArray<LODLevelDescriptor>;
  readonly currentLevel: LODLevel;
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
  readonly assetUrls: ReadonlyArray<string>;
  readonly hlodCluster?: HLODClusterDescriptor;
}
interface SectorLoadedPayload {
  readonly sectorCoord: SectorCoord;
  readonly loadedAssetsCount: number;
  readonly loadTimeMs: number;
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
- A engine atualiza no tick usando a POSIÇÃO DA CÂMERA ativa (`game.camera`) como centro; `updateStreamingCenter` é sobrescrito por isso quando há câmera.
- Setores: `registerSector` (bounds definem o centro). Ao entrar/sair do raio, saem `game.streaming.sector-loaded`/`sector-unloaded`. `assetUrls` é ignorado (nada é baixado): o jogo reage aos eventos e cria/remove o conteúdo do setor (ex.: pedir chunks de terreno).
- Raio padrão 100 (+15 de histerese). Mudar: comando `game.streaming.set-radius` `{loadRadius, hysteresisMargin}` (não há método no token). A distância inclui Y: com câmera alta use raio maior.
- LOD: `registerLODEntity` + `game.streaming.lod-changed`; `meshUrl` não é carregado, o jogo troca o detalhe ao receber o evento.
