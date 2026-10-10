import * as THREE from "three";

import type {
  TilemapLayerDescriptor,
} from "../../../contracts/sprites/types";

import {
  TextureAtlasParser,
} from "./TextureAtlasParser";

const DEFAULT_POSITION =
  Object.freeze({
    x:
      0,
    y:
      0,
    z:
      0,
  });

function positiveInteger(
  value:
    number,
  label:
    string,
): number {
  if (
    !Number.isInteger(
      value,
    ) ||
    value <=
      0
  ) {
    throw new RangeError(
      `${label} precisa ser inteiro e > 0.`,
    );
  }

  return value;
}

/**
 * G93: UV por instância calculado no VERTEX shader e escrito em `vMapUv`
 * (o varying que o `map_fragment` do three r170 amostra). Antes o código
 * substituía uma linha do fragment que não existe no r170 e cada tile
 * mostrava o atlas inteiro.
 *
 * aUvA = (origem.u, origem.v, eixoS.u, eixoS.v); aUvB = (eixoT.u, eixoT.v)
 * uv_tile = origem + uv.x * eixoS + uv.y * eixoT (suporta frames girados).
 */
export const TILEMAP_UV_VERTEX_CHUNK = `
  #include <uv_vertex>
  #ifdef USE_MAP
    vec2 engineTileUv = aUvA.xy + uv.x * aUvA.zw + uv.y * aUvB;
    vMapUv = ( mapTransform * vec3( engineTileUv, 1.0 ) ).xy;
  #endif
`;

function patchTilemapShader(
  shader:
    THREE.WebGLProgramParametersWithUniforms,
): void {
  if (
    !shader.vertexShader.includes(
      "#include <uv_vertex>",
    )
  ) {
    throw new Error(
      "Tilemap: chunk <uv_vertex> ausente no shader do three.",
    );
  }

  shader.vertexShader =
    "attribute vec4 aUvA;\nattribute vec2 aUvB;\n" +
    shader.vertexShader.replace(
      "#include <uv_vertex>",
      TILEMAP_UV_VERTEX_CHUNK,
    );
}

const TILEMAP_PROGRAM_KEY =
  "engine-instanced-tilemap-v2";

interface TilemapLayerState {
  readonly mesh: THREE.InstancedMesh;
  readonly descriptor: TilemapLayerDescriptor;
  readonly missingFrames: number;
}

export class InstancedTilemapRenderer {
  private readonly tilemapMeshes =
    new Map<
      string,
      TilemapLayerState
    >();

  public constructor(
    private readonly atlasParser:
      TextureAtlasParser,
  ) {}

  /**
   * Cria a camada. `texture` deve ser a textura PRÓPRIA do atlas
   * (`TextureAtlasParser.getAtlasTexture`); não é alterada nem descartada
   * aqui (G95). null = camada invisível até `rebindAtlas`.
   */
  public renderTilemap(
    descriptor:
      TilemapLayerDescriptor,
    texture:
      THREE.Texture | null,
  ): THREE.InstancedMesh {
    const normalizedLayerId =
      descriptor.layerId.trim();

    if (
      normalizedLayerId.length ===
      0
    ) {
      throw new RangeError(
        "layerId não pode ser vazio.",
      );
    }

    this.removeTilemap(
      normalizedLayerId,
    );

    const width =
      positiveInteger(
        descriptor.tileMatrix
          .width,
        "tilemap width",
      );

    const height =
      positiveInteger(
        descriptor.tileMatrix
          .height,
        "tilemap height",
      );

    const tileSize =
      descriptor.tileMatrix
        .tileSize;

    if (
      !Number.isFinite(
        tileSize,
      ) ||
      tileSize <=
        0
    ) {
      throw new RangeError(
        "tileSize precisa ser finito e > 0.",
      );
    }

    const tiles =
      descriptor.tileMatrix
        .tiles;

    const totalTiles =
      width *
      height;

    if (
      tiles.length <
      totalTiles
    ) {
      throw new RangeError(
        "TileDataMatrix.tiles não cobre width * height.",
      );
    }

    const geometry =
      new THREE.PlaneGeometry(
        tileSize,
        tileSize,
      );

    geometry.translate(
      tileSize /
        2,
      -tileSize /
        2,
      0,
    );

    const uvA =
      new Float32Array(
        totalTiles *
        4,
      );

    const uvB =
      new Float32Array(
        totalTiles *
        2,
      );

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture,
        transparent:
          true,
        alphaTest:
          0.05,
        side:
          THREE.DoubleSide,
        visible:
          texture !==
          null,
      });

    material.onBeforeCompile =
      patchTilemapShader;

    material.customProgramCacheKey =
      (): string =>
        TILEMAP_PROGRAM_KEY;

    const instancedMesh =
      new THREE.InstancedMesh(
        geometry,
        material,
        totalTiles,
      );

    instancedMesh.name =
      `tilemap_${normalizedLayerId}`;

    instancedMesh.renderOrder =
      Number.isFinite(
        descriptor.renderOrder,
      )
        ? descriptor.renderOrder ??
          0
        : 0;

    // O raio de culling padrão da InstancedMesh não cobre o mapa todo.
    instancedMesh.frustumCulled =
      false;

    const dummy =
      new THREE.Object3D();

    const position =
      descriptor.position ??
      DEFAULT_POSITION;

    let instanceIndex =
      0;

    let missingFrames =
      0;

    for (
      let row =
        0;
      row <
      height;
      row +=
        1
    ) {
      for (
        let column =
          0;
        column <
        width;
        column +=
          1
      ) {
        const tileId =
          tiles[
            row *
              width +
            column
          ];

        if (
          tileId ===
            undefined ||
          tileId <
            0
        ) {
          continue;
        }

        const frame =
          this.atlasParser
            .getFrame(
              descriptor.atlasUrl,
              `tile_${String(tileId)}`,
            );

        if (
          frame ===
          null
        ) {
          // G94/G93: sem frame o tile não aparece (nunca o atlas inteiro).
          missingFrames +=
            1;
          continue;
        }

        dummy.position.set(
          position.x +
            column *
              tileSize,
          position.y -
            row *
              tileSize,
          position.z,
        );

        dummy.updateMatrix();

        instancedMesh.setMatrixAt(
          instanceIndex,
          dummy.matrix,
        );

        const a =
          instanceIndex *
          4;

        uvA[a] =
          frame.originU;
        uvA[a + 1] =
          frame.originV;
        uvA[a + 2] =
          frame.axisUx;
        uvA[a + 3] =
          frame.axisUy;

        const b =
          instanceIndex *
          2;

        uvB[b] =
          frame.axisVx;
        uvB[b + 1] =
          frame.axisVy;

        instanceIndex +=
          1;
      }
    }

    instancedMesh.count =
      instanceIndex;

    instancedMesh
      .instanceMatrix
      .needsUpdate =
        true;

    geometry.setAttribute(
      "aUvA",
      new THREE.InstancedBufferAttribute(
        uvA,
        4,
      ),
    );

    geometry.setAttribute(
      "aUvB",
      new THREE.InstancedBufferAttribute(
        uvB,
        2,
      ),
    );

    this.tilemapMeshes.set(
      normalizedLayerId,
      {
        mesh:
          instancedMesh,
        descriptor,
        missingFrames,
      },
    );

    return instancedMesh;
  }

  public hasTilemap(
    layerId:
      string,
  ): boolean {
    return this.tilemapMeshes.has(
      layerId,
    );
  }

  public getTilemap(
    layerId:
      string,
  ): THREE.InstancedMesh | null {
    return this.tilemapMeshes.get(
      layerId,
    )?.mesh ??
      null;
  }

  public getMissingFrameCount(
    layerId:
      string,
  ): number {
    return this.tilemapMeshes.get(
      layerId,
    )?.missingFrames ??
      0;
  }

  /** Descritores das camadas que usam o atlas (para reconstruir após parseAtlas). */
  public getDescriptorsForAtlas(
    atlasKey:
      string,
  ): TilemapLayerDescriptor[] {
    const result:
      TilemapLayerDescriptor[] =
        [];

    for (
      const state of
      this.tilemapMeshes.values()
    ) {
      if (
        state.descriptor.atlasUrl ===
        atlasKey
      ) {
        result.push(
          state.descriptor,
        );
      }
    }

    return result;
  }

  public removeTilemap(
    layerId:
      string,
    disposeResources =
      true,
  ): boolean {
    const state =
      this.tilemapMeshes.get(
        layerId,
      );

    if (
      state ===
      undefined
    ) {
      return false;
    }

    const mesh =
      state.mesh;

    mesh.removeFromParent();

    if (
      disposeResources
    ) {
      // A textura pertence ao atlas: não é descartada aqui.
      mesh.geometry
        .dispose();

      if (
        Array.isArray(
          mesh.material,
        )
      ) {
        for (
          const material of
          mesh.material
        ) {
          material.dispose();
        }
      } else {
        mesh.material
          .dispose();
      }

      mesh.dispose();
    }

    this.tilemapMeshes.delete(
      layerId,
    );

    return true;
  }

  public clear(
    disposeResources =
      true,
  ): void {
    for (
      const layerId of
      [...this.tilemapMeshes.keys()]
    ) {
      this.removeTilemap(
        layerId,
        disposeResources,
      );
    }
  }
}
