import type {
  TerrainEditsSnapshot,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

interface ChunkEdits {
  readonly coord: Vector3Chunk;
  /** índice local → blockId | (metadata << 8) */
  readonly edits: Map<number, number>;
}

/**
 * Camada de edições persistentes (G56): sobrevive a unload/reload do chunk e
 * é reaplicada sobre o terreno gerado. Exportável/importável para saves.
 */
export class TerrainEditStore {
  private readonly chunks = new Map<string, ChunkEdits>();
  private total = 0;

  public record(key: string, coord: Vector3Chunk, localIndex: number, blockId: number, metadata: number): void {
    let entry = this.chunks.get(key);

    if (!entry) {
      entry = { coord: { x: coord.x, y: coord.y, z: coord.z }, edits: new Map<number, number>() };
      this.chunks.set(key, entry);
    }

    if (!entry.edits.has(localIndex)) {
      this.total += 1;
    }

    entry.edits.set(localIndex, (blockId & 0xff) | ((metadata & 0xff) << 8));
  }

  public hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  public get(key: string, localIndex: number): number | undefined {
    return this.chunks.get(key)?.edits.get(localIndex);
  }

  /** Aplica as edições do chunk em `blocks` (e `metadata`, se dado). Retorna quantas aplicou. */
  public applyTo(key: string, blocks: Uint8Array, metadata: Uint8Array | null): number {
    const entry = this.chunks.get(key);

    if (!entry) {
      return 0;
    }

    for (const [index, packed] of entry.edits) {
      if (index >= 0 && index < blocks.length) {
        blocks[index] = packed & 0xff;

        if (metadata) {
          metadata[index] = (packed >> 8) & 0xff;
        }
      }
    }

    return entry.edits.size;
  }

  public chunkHasMetadata(key: string): boolean {
    const entry = this.chunks.get(key);

    if (!entry) {
      return false;
    }

    for (const packed of entry.edits.values()) {
      if (packed >> 8 !== 0) {
        return true;
      }
    }

    return false;
  }

  public get size(): number {
    return this.total;
  }

  public clear(): number {
    const discarded = this.total;
    this.chunks.clear();
    this.total = 0;
    return discarded;
  }

  public export(seed: number): TerrainEditsSnapshot {
    const chunks: Array<{ coord: Vector3Chunk; edits: number[] }> = [];

    for (const entry of this.chunks.values()) {
      const edits: number[] = [];

      for (const [index, packed] of entry.edits) {
        edits.push(index, packed & 0xff, (packed >> 8) & 0xff);
      }

      chunks.push({ coord: { x: entry.coord.x, y: entry.coord.y, z: entry.coord.z }, edits });
    }

    return { version: 1, seed, chunks };
  }

  /** Valida TUDO antes de aplicar; retorna null se inválido. */
  public static validate(
    snapshot: unknown,
    chunkVolume: number,
    keyOf: (coord: Vector3Chunk) => string,
  ): Array<{ key: string; coord: Vector3Chunk; edits: ReadonlyArray<number> }> | null {
    if (typeof snapshot !== "object" || snapshot === null) {
      return null;
    }

    const candidate = snapshot as Partial<TerrainEditsSnapshot>;

    if (candidate.version !== 1 || !Number.isFinite(candidate.seed) || !Array.isArray(candidate.chunks)) {
      return null;
    }

    const result: Array<{ key: string; coord: Vector3Chunk; edits: ReadonlyArray<number> }> = [];

    for (const chunk of candidate.chunks) {
      const coord = (chunk as { coord?: Vector3Chunk } | null)?.coord;
      const edits = (chunk as { edits?: unknown } | null)?.edits;

      if (
        !coord ||
        !Number.isInteger(coord.x) ||
        !Number.isInteger(coord.y) ||
        !Number.isInteger(coord.z) ||
        !Array.isArray(edits) ||
        edits.length % 3 !== 0
      ) {
        return null;
      }

      for (let i = 0; i < edits.length; i += 3) {
        const index = edits[i];
        const id = edits[i + 1];
        const meta = edits[i + 2];

        if (
          !Number.isInteger(index) || (index as number) < 0 || (index as number) >= chunkVolume ||
          !Number.isInteger(id) || (id as number) < 0 || (id as number) > 255 ||
          !Number.isInteger(meta) || (meta as number) < 0 || (meta as number) > 255
        ) {
          return null;
        }
      }

      result.push({ key: keyOf(coord), coord: { x: coord.x, y: coord.y, z: coord.z }, edits: edits as number[] });
    }

    return result;
  }
}
