# terrain — Terreno Procedural, Biomas & Voxels
capability: game.terrain@1.0.0 | category: functional | engine plugin id: game.terrain
dependsOn: game.loop, game.render, game.physics, game.camera
consumes: RenderToken, PhysicsToken, CameraToken
use (from src/projects/<jogo>/**):
  import { TerrainToken } from "../../tokens/terrain";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/terrain.ts
```ts
interface TerrainApi {
  setSeed(seed: number): void; // Troca de mundo.
  getSeed(): number;
  requestChunk(chunkCoord: Vector3Chunk): void; // Pede um chunk (16×256×16; use coord.y = 0).
  unloadChunk(chunkCoord: Vector3Chunk): boolean; // Descarrega malha, collider e voxels (as edições persistem).
  getVoxelBlock(worldPos: Vector3Chunk): VoxelBlockData;
  modifyVoxelBlock(request: VoxelModificationRequest): boolean; // Edita um voxel (remonta o chunk na hora).
  getBiomeAt(worldPos: Vector3Chunk): BiomeDescriptor;
  getActiveChunkCount(): number;
  update(deltaSeconds: number, playerPosition?: Vector3Chunk): void; // A engine chama no tick: streaming automático (se ligado), colliders pendentes e montagem de malhas dentro do …
  clear(): void; // Descarrega todos os chunks e emite `game.terrain.reset` (reason "clear").
  configure(options: TerrainConfigOptions): void; // Paleta, tons de bioma, streaming, colliders, orçamento de malha, geração (água/cavernas).
  setBlockDefinition(blockId: number, definition: TerrainBlockDefinition): boolean;
  getBlockDefinition(blockId: number): TerrainBlockDefinition | null;
  modifyVoxelBlocks(requests: ReadonlyArray<VoxelModificationRequest>): number; // Lote: uma remontagem por chunk afetado.
  setStreamingCenter(position: Vector3Chunk): void; // Centro do streaming automático (posição de mundo).
  isChunkReady(chunkCoord: Vector3Chunk): boolean; // Dados prontos e malha/collider montados.
  getSurfaceHeight(worldX: number, worldZ: number): number; // Y do bloco sólido mais alto da coluna (edições incluídas se carregado).
  exportEdits(): TerrainEditsSnapshot; // Edições persistentes, para salvar.
  importEdits(snapshot: TerrainEditsSnapshot, options?: { readonly replace?: boolean }): boolean; // Restaura edições (validação atômica; troca de seed se preciso).
  clearEdits(): number; // Apaga as edições persistentes e regera os chunks carregados.
  processMeshQueue(): number; // Monta malhas pendentes dentro do orçamento (a engine chama no tick e em frames pausados).
  getStats(): TerrainStats;
}
capability TerrainToken = "game.terrain"@1.0.0 api TerrainApi
```
## contract src/contracts/terrain/types.ts
```ts
interface Vector3Chunk {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface VoxelBlockData {
  readonly id: number;
  readonly metadata?: number; // Byte livre por voxel (0–255) definido pelo jogo (`modifyVoxelBlock({ newMetadata })`).
}
interface BiomeDescriptor {
  readonly biomeId: string;
  readonly name: string;
  readonly surfaceBlockId: number;
  readonly subSurfaceBlockId: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly temperature: number;
  readonly moisture: number;
}
interface ChunkDataMatrix {
  readonly coord: Vector3Chunk;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly blocks: Uint8Array; // Índice = x + sizeX * (z + sizeZ * y).
}
const TERRAIN_CHUNK_SIZE_X = 16; // Dimensões reais de um chunk (G59): 16 × 256 × 16; a malha fica em (x*16, y*256, z*16).
const TERRAIN_CHUNK_SIZE_Y = 256;
const TERRAIN_CHUNK_SIZE_Z = 16;
const TerrainBlockIds; // Ids de bloco da paleta padrão.
interface VoxelModificationRequest {
  readonly worldPosition: Vector3Chunk;
  readonly newBlockId: number;
  readonly newMetadata?: number; // Metadata (0–255) do voxel.
}
interface TerrainBlockDefinition { // Aparência/física de um id de bloco (paleta).
  readonly name?: string;
  readonly color: number; // Cor RGB (0xRRGGBB).
  readonly transparent?: boolean; // Desenhado na malha transparente (água, vidro).
  readonly opacity?: number; // Opacidade (0–1) quando `transparent`.
  readonly solid?: boolean; // Entra no collider físico.
  readonly tintByBiome?: boolean; // Multiplica a cor pelo tom do bioma (grama/folhas).
}
interface TerrainStreamingOptions {
  readonly enabled?: boolean; // Liga o carregamento automático de chunks em volta do centro.
  readonly radiusChunks?: number; // Raio em chunks (distância XZ entre colunas).
  readonly unloadMarginChunks?: number; // Margem extra (chunks) antes de descarregar (histerese).
  readonly verticalChunks?: ReadonlyArray<number>; // Camadas verticais (coord.y) carregadas por coluna.
  readonly maxRequestsPerUpdate?: number; // Máximo de chunks novos pedidos por update.
  readonly centerSource?: "explicit" | "camera"; // "explicit" = `setStreamingCenter`/`update(dt, pos)`; "camera" = câmera ativa de `game.camera`.
}
interface TerrainColliderOptions {
  readonly enabled?: boolean; // Cria colliders (trimesh por chunk) quando `game.physics` existe.
  readonly friction?: number;
  readonly collisionGroups?: { readonly memberships: number; readonly filter: number };
}
interface TerrainGenerationOptions {
  readonly seaLevel?: number; // Água preenche o ar até esta altura (inclusive).
  readonly caves?: boolean; // Cavernas por ruído 3D.
  readonly caveThreshold?: number; // Limiar do ruído de caverna (maior = menos cavernas).
}
interface TerrainMeshingOptions {
  readonly maxMeshesPerUpdate?: number; // Máximo de malhas montadas por update/frame.
  readonly budgetMs?: number; // Orçamento de tempo (ms) por update/frame para montagem (sempre monta ao menos 1).
}
interface TerrainConfigOptions {
  readonly generation?: TerrainGenerationOptions;
  readonly streaming?: TerrainStreamingOptions;
  readonly colliders?: TerrainColliderOptions;
  readonly meshing?: TerrainMeshingOptions;
  readonly palette?: Readonly<Record<number, TerrainBlockDefinition>>; // Paleta parcial: id → definição (mesclada à atual).
  readonly biomeTints?: Readonly<Record<string, number>>; // Tom por bioma (0xRRGGBB) para blocos `tintByBiome`.
}
interface TerrainEditsSnapshot { // Edições persistentes (G56): sobrevivem a unload/reload e podem ser salvas.
  readonly version: 1;
  readonly seed: number;
  readonly chunks: ReadonlyArray<{ readonly coord: Vector3Chunk; readonly edits: ReadonlyArray<number>; }>; // Cada chunk: coord + triplas planas [índiceLocal, blockId, metadata, ...].
}
interface TerrainStats {
  readonly loadedChunks: number;
  readonly renderedChunks: number;
  readonly pendingGenerations: number;
  readonly queuedMeshes: number;
  readonly colliders: number;
  readonly editedVoxels: number;
  readonly streamingEnabled: boolean;
}
interface CompiledChunkMeshBuffers {
  readonly chunkCoord: Vector3Chunk;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly transparentPositions?: Float32Array;
  readonly transparentNormals?: Float32Array;
  readonly transparentUvs?: Float32Array;
  readonly transparentIndices?: Uint32Array;
  readonly colors?: Float32Array; // RGB por vértice da malha opaca (quando há paleta).
  readonly transparentColors?: Float32Array; // RGBA por vértice da malha transparente.
  readonly collisionPositions?: Float32Array; // Malha de colisão (só blocos `solid`), coordenadas locais do chunk.
  readonly collisionIndices?: Uint32Array;
}
interface ChunkGeneratedPayload {
  readonly chunkCoord: Vector3Chunk;
  readonly totalVertices: number;
  readonly generationTimeMs: number;
}
event ChunkGeneratedEvent = "game.terrain.chunk-generated" payload ChunkGeneratedPayload
interface BlockModifiedPayload {
  readonly worldPosition: Vector3Chunk;
  readonly oldBlockId: number;
  readonly newBlockId: number;
}
event BlockModifiedEvent = "game.terrain.block-modified" payload BlockModifiedPayload
interface ChunkUnloadedPayload {
  readonly chunkCoord: Vector3Chunk;
}
event ChunkUnloadedEvent = "game.terrain.chunk-unloaded" payload ChunkUnloadedPayload
interface TerrainResetPayload {
  readonly reason: "seed-changed" | "clear" | "edits-imported";
  readonly previousSeed: number;
  readonly seed: number;
  readonly unloadedChunks: number;
  readonly discardedEdits: number;
}
event TerrainResetEvent = "game.terrain.reset" payload TerrainResetPayload // Emitido quando o mundo inteiro é descartado (G55: nunca mais em silêncio).
interface RequestChunkLoadPayload {
  readonly chunkCoord: Vector3Chunk;
  readonly seed?: number; // Seed esperada.
}
command RequestChunkLoadCommand = "game.terrain.request-chunk" request RequestChunkLoadPayload
interface ModifyVoxelBlockPayload {
  readonly request?: VoxelModificationRequest;
  readonly requests?: ReadonlyArray<VoxelModificationRequest>; // Lote: uma remontagem por chunk afetado (G18).
}
command ModifyVoxelBlockCommand = "game.terrain.modify-block" request ModifyVoxelBlockPayload
```
## notas verificadas (comportamento)
- Chunk = 16×256×16 voxels (`TERRAIN_CHUNK_SIZE_*`); malha em (x·16, y·256, z·16). Use `coord.y = 0` (0..255 cobre todos os biomas).
- A engine chama `update` no tick (e monta malhas em frames pausados): streaming automático (se ligado), colliders e montagem de malhas dentro do orçamento (`meshing: { maxMeshesPerUpdate: 2, budgetMs: 4 }`).
- Quem carrega chunks: (a) streaming da engine — `configure({ streaming: { enabled: true, radiusChunks, centerSource: "camera" | "explicit" } })` + `setStreamingCenter(pos)`; ou (b) o jogo — `requestChunk` (idempotente; chunk pedido à mão fica FIXO) / `unloadChunk`. Espere `game.terrain.chunk-generated` (ou `isChunkReady`) antes de ler voxels.
- `getSurfaceHeight(x, z)` = Y do bloco sólido mais alto; funciona também para colunas NÃO carregadas (amostra o gerador, síncrono, determinístico pela seed; edições só contam se carregado).
- Colliders trimesh por chunk são criados por padrão (`colliders: { enabled }`); água/blocos `solid: false` ficam fora. Terreno só visual: desligue (GAPS G133).
- Padrão de geração: água até `seaLevel` 16 (desligue com `-1`), sem cavernas. Biomas (`getBiomeAt`): desert 10–40, forest 20–80, tundra 60–120, mountains 80–200, com transição suave. Mesma seed ⇒ mesmo terreno.
- Cores: paleta por id (`TerrainBlockIds`, `setBlockDefinition`, `configure({ palette, biomeTints })`).
- Edições: `modifyVoxelBlock` remonta o chunk na hora; para muitas use `modifyVoxelBlocks` (uma remontagem por chunk). Edições PERSISTEM após unload; salve com `exportEdits`/`importEdits`.
- `setSeed` com chunks/edições descarta tudo e emite `game.terrain.reset`; `clear()` também emite (as edições ficam, use `clearEdits`).
