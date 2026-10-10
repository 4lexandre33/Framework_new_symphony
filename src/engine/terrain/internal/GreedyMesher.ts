import type {
  ChunkDataMatrix,
  CompiledChunkMeshBuffers,
} from "../../../contracts/terrain/types";

import {
  BLOCK_CLASS_OPAQUE,
  BLOCK_CLASS_TRANSPARENT,
} from "./BlockPalette";

type AxisVector = [number, number, number];

/**
 * Fatias de blocos VIZINHOS ao chunk (fora dele), para não gerar faces
 * escondidas nas bordas (G59). Layouts:
 * - negX/posX: índice = y * sizeZ + z (x = -1 / x = sizeX)
 * - negZ/posZ: índice = y * sizeX + x (z = -1 / z = sizeZ)
 * - negY/posY: índice = z * sizeX + x (y = -1 / y = sizeY)
 * Ausente = ar.
 */
export interface ChunkBorderSlabs {
  readonly negX?: Uint8Array;
  readonly posX?: Uint8Array;
  readonly negY?: Uint8Array;
  readonly posY?: Uint8Array;
  readonly negZ?: Uint8Array;
  readonly posZ?: Uint8Array;
}

/** Subconjunto de `BlockPalette` usado pelo mesher. */
export interface MesherPalette {
  readonly colors: Float32Array;
  readonly opacity: Float32Array;
  readonly classes: Uint8Array;
  readonly solid: Uint8Array;
  readonly tint: Uint8Array;
  collisionDiffersFromOpaque(presence: Uint8Array): boolean;
}

export interface GreedyMeshOptions {
  /** Sem paleta: todo id != 0 é opaco e não há cores (comportamento legado). */
  readonly palette?: MesherPalette;
  readonly borders?: ChunkBorderSlabs;
  /** Tom RGB por vértice de coluna: (sizeX + 1) * (sizeZ + 1) * 3, índice (z * (sizeX + 1) + x) * 3. */
  readonly tintGrid?: Float32Array;
  /** Gera também a malha de colisão (blocos `solid`). */
  readonly collision?: boolean;
}

const MODE_OPAQUE = 0;
const MODE_TRANSPARENT = 1;
const MODE_SOLID = 2;

const LEGACY_CLASSES = (() => {
  const table = new Uint8Array(256);
  table.fill(BLOCK_CLASS_OPAQUE);
  table[0] = 0;
  return table;
})();

const LEGACY_SOLID = (() => {
  const table = new Uint8Array(256);
  table.fill(1);
  table[0] = 0;
  return table;
})();

interface QuadSink {
  readonly positions: number[];
  readonly normals: number[] | null;
  readonly uvs: number[] | null;
  readonly colors: number[] | null;
  readonly indices: number[];
  readonly colorStride: 0 | 3 | 4;
  vertexCount: number;
}

function createSink(withAttributes: boolean, colorStride: 0 | 3 | 4): QuadSink {
  return {
    positions: [],
    normals: withAttributes ? [] : null,
    uvs: withAttributes ? [] : null,
    colors: colorStride > 0 ? [] : null,
    indices: [],
    colorStride,
    vertexCount: 0,
  };
}

/**
 * Greedy mesher com paleta (cores por bloco e tom de bioma), malha
 * transparente separada (água/vidro), malha de colisão e vizinhos de borda.
 */
export class GreedyMesher {
  public static compileChunkMesh(
    chunk: ChunkDataMatrix,
    options: GreedyMeshOptions = {},
  ): CompiledChunkMeshBuffers {
    const { sizeX, sizeY, sizeZ, blocks, coord } = chunk;

    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0 || blocks.length < sizeX * sizeY * sizeZ) {
      return {
        chunkCoord: coord,
        positions: new Float32Array(),
        normals: new Float32Array(),
        uvs: new Float32Array(),
        indices: new Uint32Array(),
      };
    }

    const palette = options.palette;
    const classes = palette?.classes ?? LEGACY_CLASSES;
    const solid = palette?.solid ?? LEGACY_SOLID;

    // Faixa vertical ocupada + presença de ids (pula o ar acima do relevo).
    const presence = new Uint8Array(256);
    let maxY = -1;
    const layer = sizeX * sizeZ;

    for (let y = sizeY - 1; y >= 0 && maxY < 0; y -= 1) {
      const base = y * layer;

      for (let i = 0; i < layer; i += 1) {
        if (blocks[base + i] !== 0) {
          maxY = y;
          break;
        }
      }
    }

    for (let i = 0, end = (maxY + 1) * layer; i < end; i += 1) {
      presence[blocks[i] as number] = 1;
    }

    // Vizinho acima (posY) ainda pode gerar faces de baixo se o chunk estiver vazio no topo.
    const effectiveSizeY = Math.min(sizeY, maxY + 1);
    let hasTransparent = false;

    for (let id = 1; id < 256; id += 1) {
      if (presence[id] === 1 && classes[id] === BLOCK_CLASS_TRANSPARENT) {
        hasTransparent = true;
        break;
      }
    }

    const opaqueSink = createSink(true, palette ? 3 : 0);
    const mesher = new GreedyPassRunner(chunk, effectiveSizeY, classes, solid, options);

    if (maxY >= 0) {
      mesher.run(MODE_OPAQUE, 0, opaqueSink);
    }

    let transparentSink: QuadSink | null = null;

    if (hasTransparent) {
      transparentSink = createSink(true, palette ? 4 : 0);
      mesher.run(MODE_TRANSPARENT, 1, transparentSink);
      mesher.run(MODE_TRANSPARENT, -1, transparentSink);
    }

    let collisionPositions: Float32Array | undefined;
    let collisionIndices: Uint32Array | undefined;

    if (options.collision === true) {
      const differs = palette ? palette.collisionDiffersFromOpaque(presence) : false;

      if (!differs) {
        collisionPositions = new Float32Array(opaqueSink.positions);
        collisionIndices = new Uint32Array(opaqueSink.indices);
      } else {
        const collisionSink = createSink(false, 0);

        if (maxY >= 0) {
          mesher.run(MODE_SOLID, 0, collisionSink);
        }

        collisionPositions = new Float32Array(collisionSink.positions);
        collisionIndices = new Uint32Array(collisionSink.indices);
      }
    }

    const result: {
      -readonly [K in keyof CompiledChunkMeshBuffers]: CompiledChunkMeshBuffers[K];
    } = {
      chunkCoord: coord,
      positions: new Float32Array(opaqueSink.positions),
      normals: new Float32Array(opaqueSink.normals ?? []),
      uvs: new Float32Array(opaqueSink.uvs ?? []),
      indices: new Uint32Array(opaqueSink.indices),
    };

    if (opaqueSink.colors) {
      result.colors = new Float32Array(opaqueSink.colors);
    }

    if (transparentSink && transparentSink.positions.length > 0) {
      result.transparentPositions = new Float32Array(transparentSink.positions);
      result.transparentNormals = new Float32Array(transparentSink.normals ?? []);
      result.transparentUvs = new Float32Array(transparentSink.uvs ?? []);
      result.transparentIndices = new Uint32Array(transparentSink.indices);

      if (transparentSink.colors) {
        result.transparentColors = new Float32Array(transparentSink.colors);
      }
    }

    if (collisionPositions && collisionIndices) {
      result.collisionPositions = collisionPositions;
      result.collisionIndices = collisionIndices;
    }

    return result;
  }
}

class GreedyPassRunner {
  private readonly dims: AxisVector;
  private readonly mask: Int32Array;
  private readonly position: AxisVector = [0, 0, 0];
  private readonly widthVector: AxisVector = [0, 0, 0];
  private readonly heightVector: AxisVector = [0, 0, 0];

  public constructor(
    private readonly chunk: ChunkDataMatrix,
    effectiveSizeY: number,
    private readonly classes: Uint8Array,
    private readonly solid: Uint8Array,
    private readonly options: GreedyMeshOptions,
  ) {
    this.dims = [chunk.sizeX, Math.max(0, effectiveSizeY), chunk.sizeZ];
    const { sizeX, sizeY, sizeZ } = chunk;
    this.mask = new Int32Array(Math.max(sizeX * sizeY, sizeY * sizeZ, sizeX * sizeZ));
  }

  private getBlock(x: number, y: number, z: number): number {
    const { sizeX, sizeY, sizeZ, blocks } = this.chunk;
    const borders = this.options.borders;

    if (x < 0) {
      return borders?.negX?.[y * sizeZ + z] ?? 0;
    }

    if (x >= sizeX) {
      return borders?.posX?.[y * sizeZ + z] ?? 0;
    }

    if (z < 0) {
      return borders?.negZ?.[y * sizeX + x] ?? 0;
    }

    if (z >= sizeZ) {
      return borders?.posZ?.[y * sizeX + x] ?? 0;
    }

    if (y < 0) {
      return borders?.negY?.[z * sizeX + x] ?? 0;
    }

    if (y >= sizeY) {
      return borders?.posY?.[z * sizeX + x] ?? 0;
    }

    return blocks[x + sizeX * (z + sizeZ * y)] ?? 0;
  }

  private includes(mode: number, id: number): boolean {
    if (id === 0) {
      return false;
    }

    if (mode === MODE_OPAQUE) {
      return this.classes[id] === BLOCK_CLASS_OPAQUE;
    }

    if (mode === MODE_TRANSPARENT) {
      return this.classes[id] === BLOCK_CLASS_TRANSPARENT;
    }

    return this.solid[id] === 1;
  }

  /** true se o vizinho `neighbor` esconde a face de `cell`. */
  private hides(mode: number, cell: number, neighbor: number): boolean {
    if (neighbor === 0) {
      return false;
    }

    if (mode === MODE_OPAQUE) {
      return this.classes[neighbor] === BLOCK_CLASS_OPAQUE;
    }

    if (mode === MODE_TRANSPARENT) {
      return neighbor === cell || this.classes[neighbor] === BLOCK_CLASS_OPAQUE;
    }

    return this.solid[neighbor] === 1;
  }

  /** signFilter: 0 = ambos (modos opacos), 1 = só faces +eixo, -1 = só faces -eixo. */
  public run(mode: number, signFilter: number, sink: QuadSink): void {
    const dims = this.dims;
    const mask = this.mask;
    const position = this.position;

    for (let axis = 0; axis < 3; axis += 1) {
      const horizontalAxis = (axis + 1) % 3;
      const verticalAxis = (axis + 2) % 3;
      const dimH = dims[horizontalAxis] as number;
      const dimV = dims[verticalAxis] as number;

      if (dimH === 0 || dimV === 0) {
        continue;
      }

      position[0] = 0;
      position[1] = 0;
      position[2] = 0;

      const realSize = axis === 0 ? this.chunk.sizeX : axis === 1 ? this.chunk.sizeY : this.chunk.sizeZ;

      for (position[axis] = -1; position[axis] < dims[axis]; ) {
        let maskIndex = 0;
        // Faces só pertencem a células DENTRO do chunk (as da borda são do vizinho).
        const currentInside = position[axis] >= 0;
        const adjacentInside = position[axis] + 1 < realSize;

        for (position[verticalAxis] = 0; position[verticalAxis] < dimV; position[verticalAxis] += 1) {
          for (position[horizontalAxis] = 0; position[horizontalAxis] < dimH; position[horizontalAxis] += 1) {
            const x = position[0];
            const y = position[1];
            const z = position[2];
            const current = this.getBlock(x, y, z);
            const adjacent = this.getBlock(
              x + (axis === 0 ? 1 : 0),
              y + (axis === 1 ? 1 : 0),
              z + (axis === 2 ? 1 : 0),
            );
            let value = 0;

            if (
              signFilter >= 0 &&
              currentInside &&
              this.includes(mode, current) &&
              !this.hides(mode, current, adjacent)
            ) {
              value = current;
            } else if (
              signFilter <= 0 &&
              adjacentInside &&
              this.includes(mode, adjacent) &&
              !this.hides(mode, adjacent, current)
            ) {
              value = -adjacent;
            }

            mask[maskIndex] = value;
            maskIndex += 1;
          }
        }

        position[axis] += 1;
        maskIndex = 0;

        for (let vertical = 0; vertical < dimV; vertical += 1) {
          for (let horizontal = 0; horizontal < dimH; ) {
            const maskValue = mask[maskIndex] ?? 0;

            if (maskValue === 0) {
              horizontal += 1;
              maskIndex += 1;
              continue;
            }

            let width = 1;

            while (horizontal + width < dimH && mask[maskIndex + width] === maskValue) {
              width += 1;
            }

            let height = 1;

            heightSearch:
            while (vertical + height < dimV) {
              for (let offset = 0; offset < width; offset += 1) {
                if (mask[maskIndex + offset + height * dimH] !== maskValue) {
                  break heightSearch;
                }
              }

              height += 1;
            }

            position[horizontalAxis] = horizontal;
            position[verticalAxis] = vertical;
            this.widthVector[0] = 0;
            this.widthVector[1] = 0;
            this.widthVector[2] = 0;
            this.heightVector[0] = 0;
            this.heightVector[1] = 0;
            this.heightVector[2] = 0;
            this.widthVector[horizontalAxis] = width;
            this.heightVector[verticalAxis] = height;

            this.appendQuad(
              sink,
              axis,
              maskValue > 0 ? 1 : -1,
              maskValue > 0 ? maskValue : -maskValue,
              width,
              height,
            );

            for (let row = 0; row < height; row += 1) {
              for (let column = 0; column < width; column += 1) {
                mask[maskIndex + column + row * dimH] = 0;
              }
            }

            horizontal += width;
            maskIndex += width;
          }
        }
      }
    }
  }

  private appendQuad(
    sink: QuadSink,
    normalAxis: number,
    normalDirection: number,
    blockId: number,
    uvWidth: number,
    uvHeight: number,
  ): void {
    const origin = this.position;
    const w = this.widthVector;
    const h = this.heightVector;
    const x0 = origin[0];
    const y0 = origin[1];
    const z0 = origin[2];
    const x1 = x0 + w[0];
    const y1 = y0 + w[1];
    const z1 = z0 + w[2];
    const x2 = x1 + h[0];
    const y2 = y1 + h[1];
    const z2 = z1 + h[2];
    const x3 = x0 + h[0];
    const y3 = y0 + h[1];
    const z3 = z0 + h[2];
    const positions = sink.positions;

    if (normalDirection > 0) {
      positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3);
      this.appendColor(sink, blockId, x0, z0);
      this.appendColor(sink, blockId, x1, z1);
      this.appendColor(sink, blockId, x2, z2);
      this.appendColor(sink, blockId, x3, z3);
    } else {
      positions.push(x0, y0, z0, x3, y3, z3, x2, y2, z2, x1, y1, z1);
      this.appendColor(sink, blockId, x0, z0);
      this.appendColor(sink, blockId, x3, z3);
      this.appendColor(sink, blockId, x2, z2);
      this.appendColor(sink, blockId, x1, z1);
    }

    if (sink.normals && sink.uvs) {
      const nx = normalAxis === 0 ? normalDirection : 0;
      const ny = normalAxis === 1 ? normalDirection : 0;
      const nz = normalAxis === 2 ? normalDirection : 0;

      for (let vertex = 0; vertex < 4; vertex += 1) {
        sink.normals.push(nx, ny, nz);
      }

      sink.uvs.push(0, 0, uvWidth, 0, uvWidth, uvHeight, 0, uvHeight);
    }

    const base = sink.vertexCount;
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    sink.vertexCount += 4;
  }

  private appendColor(sink: QuadSink, blockId: number, localX: number, localZ: number): void {
    const colors = sink.colors;
    const palette = this.options.palette;

    if (!colors || !palette) {
      return;
    }

    let r = palette.colors[blockId * 3] as number;
    let g = palette.colors[blockId * 3 + 1] as number;
    let b = palette.colors[blockId * 3 + 2] as number;
    const tintGrid = this.options.tintGrid;

    if (tintGrid && palette.tint[blockId] === 1) {
      const sizeX = this.chunk.sizeX;
      const sizeZ = this.chunk.sizeZ;
      const gx = localX < 0 ? 0 : localX > sizeX ? sizeX : localX;
      const gz = localZ < 0 ? 0 : localZ > sizeZ ? sizeZ : localZ;
      const index = (gz * (sizeX + 1) + gx) * 3;
      r *= (tintGrid[index] as number) * 1.6;
      g *= (tintGrid[index + 1] as number) * 1.6;
      b *= (tintGrid[index + 2] as number) * 1.6;
    }

    colors.push(Math.min(1, r), Math.min(1, g), Math.min(1, b));

    if (sink.colorStride === 4) {
      colors.push(palette.opacity[blockId] as number);
    }
  }
}
