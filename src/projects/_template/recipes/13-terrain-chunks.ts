// Terreno: update() da engine é no-op. O jogo pede/descarrega chunks (16x128x16) ao redor de um ponto.
import type { PluginContext } from "@core";
import { ChunkGeneratedEvent } from "../../../contracts/terrain/types";
import type { ChunkGeneratedPayload } from "../../../contracts/terrain/types";
import type { TerrainApi } from "../../../tokens/terrain";

export class ChunkWindow {
  private readonly loaded = new Set<string>();
  public constructor(private readonly terrain: TerrainApi, private readonly radiusChunks: number) {}

  /** Chame quando o centro mudar de chunk (não a cada tick). */
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
        this.terrain.unloadChunk({ x, y: 0, z });
      }
    }
    this.loaded.clear();
    for (const key of wanted) this.loaded.add(key);
  }

  public dispose(): void {
    this.terrain.clear();
    this.loaded.clear();
  }
}

/** Altura da superfície numa coluna (use após chunk-generated; não por tick). */
export function surfaceHeight(terrain: TerrainApi, x: number, z: number): number {
  for (let y = 127; y >= 0; y -= 1) {
    if (terrain.getVoxelBlock({ x, y, z }).id !== 0) return y + 1;
  }
  return 0;
}

export function onChunkReady(ctx: PluginContext, fn: (p: ChunkGeneratedPayload) => void): () => void {
  return ctx.events.on<"game.terrain.chunk-generated", ChunkGeneratedPayload>(ChunkGeneratedEvent.type, (env): void => {
    fn(env.payload);
  });
}
