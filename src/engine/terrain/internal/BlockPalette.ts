import type {
  TerrainBlockDefinition,
} from "../../../contracts/terrain/types";

/** Classes usadas pelo mesher. */
export const BLOCK_CLASS_EMPTY = 0;
export const BLOCK_CLASS_OPAQUE = 1;
export const BLOCK_CLASS_TRANSPARENT = 2;

const DEFAULT_DEFINITIONS: Readonly<Record<number, TerrainBlockDefinition>> = Object.freeze({
  1: { name: "dirt", color: 0x8b5a2b },
  2: { name: "stone", color: 0x8a8a8a },
  3: { name: "grass", color: 0xa8d878, tintByBiome: true },
  4: { name: "sand", color: 0xe2d39a },
  5: { name: "snow", color: 0xf4f7fb },
  6: { name: "wood", color: 0x8b6a3a },
  7: { name: "water", color: 0x3a7bd5, transparent: true, opacity: 0.6, solid: false },
  8: { name: "glass", color: 0xd6ecff, transparent: true, opacity: 0.35, solid: true },
});

/**
 * Paleta id → aparência/física (G3). Tabelas planas indexadas por id para o
 * mesher (sem alocação por voxel).
 */
export class BlockPalette {
  /** RGB 0–1 por id. */
  public readonly colors = new Float32Array(256 * 3);
  public readonly opacity = new Float32Array(256);
  /** BLOCK_CLASS_* por id. */
  public readonly classes = new Uint8Array(256);
  /** 1 = entra no collider. */
  public readonly solid = new Uint8Array(256);
  /** 1 = multiplica pelo tom do bioma. */
  public readonly tint = new Uint8Array(256);
  private readonly definitions: Array<TerrainBlockDefinition | null> = new Array<TerrainBlockDefinition | null>(256).fill(null);
  private revision = 0;

  public constructor() {
    this.reset();
  }

  public getRevision(): number {
    return this.revision;
  }

  public reset(): void {
    for (let id = 1; id < 256; id += 1) {
      this.applyDefinition(id, DEFAULT_DEFINITIONS[id] ?? null);
    }

    this.classes[0] = BLOCK_CLASS_EMPTY;
    this.solid[0] = 0;
    this.revision += 1;
  }

  public setDefinition(id: number, definition: TerrainBlockDefinition): boolean {
    if (!Number.isInteger(id) || id <= 0 || id > 255 || !Number.isFinite(definition.color)) {
      return false;
    }

    this.applyDefinition(id, definition);
    this.revision += 1;
    return true;
  }

  public getDefinition(id: number): TerrainBlockDefinition | null {
    if (!Number.isInteger(id) || id <= 0 || id > 255) {
      return null;
    }

    const definition = this.definitions[id];
    return definition ? { ...definition } : null;
  }

  /** true se existe id em `presence` cujo comportamento de colisão difere do de renderização opaca. */
  public collisionDiffersFromOpaque(presence: Uint8Array): boolean {
    for (let id = 1; id < 256; id += 1) {
      if (presence[id] === 0) {
        continue;
      }

      const opaque = this.classes[id] === BLOCK_CLASS_OPAQUE ? 1 : 0;

      if (opaque !== this.solid[id]) {
        return true;
      }
    }

    return false;
  }

  private applyDefinition(id: number, definition: TerrainBlockDefinition | null): void {
    const resolved = definition ?? { color: fallbackColor(id) };
    this.definitions[id] = definition ? { ...definition } : null;
    const color = Math.trunc(resolved.color) & 0xffffff;
    this.colors[id * 3] = ((color >> 16) & 0xff) / 255;
    this.colors[id * 3 + 1] = ((color >> 8) & 0xff) / 255;
    this.colors[id * 3 + 2] = (color & 0xff) / 255;
    const transparent = resolved.transparent === true;
    this.classes[id] = transparent ? BLOCK_CLASS_TRANSPARENT : BLOCK_CLASS_OPAQUE;
    const opacity = resolved.opacity;
    this.opacity[id] = transparent
      ? Math.min(1, Math.max(0, typeof opacity === "number" && Number.isFinite(opacity) ? opacity : 0.6))
      : 1;
    this.solid[id] = resolved.solid === false ? 0 : 1;
    this.tint[id] = resolved.tintByBiome === true ? 1 : 0;
  }
}

/** Cor determinística (cinza-azulado variado) para ids sem definição. */
function fallbackColor(id: number): number {
  const hash = Math.imul(id ^ 0x9e37, 0x85ebca6b) >>> 0;
  const r = 96 + (hash & 0x5f);
  const g = 96 + ((hash >> 8) & 0x5f);
  const b = 96 + ((hash >> 16) & 0x5f);
  return (r << 16) | (g << 8) | b;
}
