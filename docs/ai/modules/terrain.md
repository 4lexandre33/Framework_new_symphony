# terrain — Terreno Procedural, Biomas & Voxels
capability: game.terrain@1.0.0 | category: functional | engine plugin id: game.terrain
dependsOn: game.loop, game.render
consumes: RenderToken
use (from src/projects/<jogo>/**):
  import { TerrainToken } from "../../tokens/terrain";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/terrain.ts
```ts
interface TerrainApi {
  setSeed(seed: number): void;
  getSeed(): number;
  requestChunk(chunkCoord: Vector3Chunk): void;
  unloadChunk(chunkCoord: Vector3Chunk): boolean;
  getVoxelBlock(worldPos: Vector3Chunk): VoxelBlockData;
  modifyVoxelBlock(request: VoxelModificationRequest): boolean;
  getBiomeAt(worldPos: Vector3Chunk): BiomeDescriptor;
  getActiveChunkCount(): number;
  update(deltaSeconds: number, playerPosition?: Vector3Chunk): void;
  clear(): void;
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
  readonly metadata?: number;
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
  readonly blocks: Uint8Array;
}
interface VoxelModificationRequest {
  readonly worldPosition: Vector3Chunk;
  readonly newBlockId: number;
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
interface RequestChunkLoadPayload {
  readonly chunkCoord: Vector3Chunk;
  readonly seed: number;
}
command RequestChunkLoadCommand = "game.terrain.request-chunk" request RequestChunkLoadPayload
interface ModifyVoxelBlockPayload {
  readonly request: VoxelModificationRequest;
}
command ModifyVoxelBlockCommand = "game.terrain.modify-block" request ModifyVoxelBlockPayload
```
## notas verificadas (comportamento)
- `update()` é NO-OP (a engine chama no tick, mas não carrega nada). O jogo decide quais chunks existem: `requestChunk(coord)` e `unloadChunk(coord)`.
- Chunk = 16×128×16 voxels; a malha fica em (coord.x×16, coord.y×128, coord.z×16). Use `coord.y = 0`.
- Geração assíncrona (worker): espere `game.terrain.chunk-generated` antes de consultar voxels daquele chunk. A malha é adicionada à cena automaticamente; `unloadChunk`/`clear` remove.
- Biomas (por `getBiomeAt`): `desert` (bloco 4, alt. 10–40), `forest` (bloco 3/1, 20–80), `tundra` (5/2, 60–120), `mountains` (2, 80–200). Mesma seed → mesmo terreno.
- LACUNA: todos os blocos usam a MESMA cor (verde) e não há colisores de terreno. Altura da superfície: varra `getVoxelBlock` de y=127 para baixo até `id !== 0` (faça na geração, não por tick).
- CUSTO: cada `modifyVoxelBlock` que muda o bloco remonta a malha do chunk inteiro (síncrono). Limite a poucas modificações por tick (≤ 8) e nunca escave corredores longos.
