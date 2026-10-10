import { defineCapability } from "@core";
import type {
  Vector3Chunk,
  VoxelBlockData,
  BiomeDescriptor,
  VoxelModificationRequest,
  TerrainBlockDefinition,
  TerrainConfigOptions,
  TerrainEditsSnapshot,
  TerrainStats,
} from "../contracts/terrain/types";

export interface TerrainApi {
  /**
   * Troca de mundo. Se havia chunks ou edições, descarta tudo e emite
   * `game.terrain.reset` (reason "seed-changed").
   */
  setSeed(seed: number): void;
  getSeed(): number;
  /**
   * Pede um chunk (16×256×16; use coord.y = 0). Idempotente: repetir não
   * remonta nem reemite `chunk-generated`. Chunks pedidos aqui ficam FIXOS
   * (o streaming automático não os descarrega).
   */
  requestChunk(chunkCoord: Vector3Chunk): void;
  /** Descarrega malha, collider e voxels (as edições persistem). Emite `chunk-unloaded`. */
  unloadChunk(chunkCoord: Vector3Chunk): boolean;
  getVoxelBlock(worldPos: Vector3Chunk): VoxelBlockData;
  /** Edita um voxel (remonta o chunk na hora). Para muitos use `modifyVoxelBlocks`. */
  modifyVoxelBlock(request: VoxelModificationRequest): boolean;
  getBiomeAt(worldPos: Vector3Chunk): BiomeDescriptor;
  getActiveChunkCount(): number;
  /**
   * A engine chama no tick: streaming automático (se ligado), colliders
   * pendentes e montagem de malhas dentro do orçamento. `playerPosition`
   * (opcional) atualiza o centro do streaming.
   */
  update(deltaSeconds: number, playerPosition?: Vector3Chunk): void;
  /**
   * Descarrega todos os chunks e emite `game.terrain.reset` (reason "clear").
   * As edições persistentes continuam (use `clearEdits`).
   */
  clear(): void;

  // ── Adições (G3/G18/G54–G59) ────────────────────────────────────────────

  /** Paleta, tons de bioma, streaming, colliders, orçamento de malha, geração (água/cavernas). */
  configure(options: TerrainConfigOptions): void;
  setBlockDefinition(blockId: number, definition: TerrainBlockDefinition): boolean;
  getBlockDefinition(blockId: number): TerrainBlockDefinition | null;
  /** Lote: uma remontagem por chunk afetado. Retorna quantas escritas valeram. */
  modifyVoxelBlocks(requests: ReadonlyArray<VoxelModificationRequest>): number;
  /** Centro do streaming automático (posição de mundo). */
  setStreamingCenter(position: Vector3Chunk): void;
  /** Dados prontos e malha/collider montados. */
  isChunkReady(chunkCoord: Vector3Chunk): boolean;
  /** Y do bloco sólido mais alto da coluna (edições incluídas se carregado). */
  getSurfaceHeight(worldX: number, worldZ: number): number;
  /** Edições persistentes, para salvar. */
  exportEdits(): TerrainEditsSnapshot;
  /** Restaura edições (validação atômica; troca de seed se preciso). */
  importEdits(snapshot: TerrainEditsSnapshot, options?: { readonly replace?: boolean }): boolean;
  /** Apaga as edições persistentes e regera os chunks carregados. Retorna quantas apagou. */
  clearEdits(): number;
  /** Monta malhas pendentes dentro do orçamento (a engine chama no tick e em frames pausados). */
  processMeshQueue(): number;
  getStats(): TerrainStats;
}

export const TerrainToken = defineCapability<TerrainApi>("game.terrain", "1.0.0");
