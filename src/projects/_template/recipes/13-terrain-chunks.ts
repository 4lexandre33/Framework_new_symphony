// Terreno: chunks de 16x256x16. Opção A (mais simples): streaming da engine em volta da câmera ou de um centro.
// Opção B: ChunkWindow abaixo, para formas próprias (corredor, rota). Chunks pedidos à mão ficam fixos até unloadChunk.
import type { PluginContext } from "@core";
import { ChunkGeneratedEvent } from "../../../contracts/terrain/types";
import type { ChunkGeneratedPayload } from "../../../contracts/terrain/types";
import type { TerrainApi } from "../../../tokens/terrain";

/** Opção A. Também desliga água e colliders quando o terreno é só cenário (padrões: seaLevel 16, colliders ligados). */
export function startTerrain(terrain: TerrainApi, seed: number, visualOnly: boolean): void {
  terrain.setSeed(seed);
  terrain.configure({
    streaming: { enabled: true, radiusChunks: 4, centerSource: "camera" },
    ...(visualOnly ? { colliders: { enabled: false }, generation: { seaLevel: -1 } } : {}),
  });
}

export class ChunkWindow {
  private readonly loaded = new Set<string>();
  public constructor(private readonly terrain: TerrainApi, private readonly radiusChunks: number) {}

  /** Chame quando o centro mudar de chunk (não a cada tick). requestChunk é idempotente. */
  public recenter(worldX: number, worldZ: number): void {
    const cx = Math.floor(worldX / 16), cz = Math.floor(worldZ / 16);
    const wanted = new Set<string>();
    for (let dx = -this.radiusChunks; dx <= this.radiusChunks; dx += 1) {
      for (let dz = -this.radiusChunks; dz <= this.radiusChunks; dz += 1) {
        const key = `${cx + dx}:${cz + dz}`;
        wanted.add(key);
        if (!this.loaded.has(key)) this.terrain.requestChunk({ x: cx + dx, y: 0, z: cz + dz });
      }
    }
    for (const key of this.loaded) {
      if (!wanted.has(key)) {
        const [x, z] = key.split(":").map(Number);
        this.terrain.unloadChunk({ x, y: 0, z }); // edições persistem e voltam no próximo requestChunk
      }
    }
    this.loaded.clear();
    for (const key of wanted) this.loaded.add(key);
  }

  public dispose(): void {
    for (const key of this.loaded) {
      const [x, z] = key.split(":").map(Number);
      this.terrain.unloadChunk({ x, y: 0, z });
    }
    this.loaded.clear();
  }
}

/** Altura logo acima da superfície. Funciona até para colunas não carregadas (amostra o gerador, determinístico). */
export function surfaceHeight(terrain: TerrainApi, x: number, z: number): number {
  return terrain.getSurfaceHeight(x, z) + 1;
}

/** Muitas edições de uma vez (bomba, escavação): uma remontagem por chunk afetado. */
export function blast(terrain: TerrainApi, cx: number, cy: number, cz: number, radius: number): number {
  const requests: Array<{ worldPosition: { x: number; y: number; z: number }; newBlockId: number }> = [];
  for (let x = -radius; x <= radius; x += 1)
    for (let y = -radius; y <= radius; y += 1)
      for (let z = -radius; z <= radius; z += 1) requests.push({ worldPosition: { x: cx + x, y: cy + y, z: cz + z }, newBlockId: 0 });
  return terrain.modifyVoxelBlocks(requests);
}

export function onChunkReady(ctx: PluginContext, fn: (p: ChunkGeneratedPayload) => void): () => void {
  return ctx.events.on<"game.terrain.chunk-generated", ChunkGeneratedPayload>(ChunkGeneratedEvent.type, (env): void => {
    fn(env.payload);
  });
}
