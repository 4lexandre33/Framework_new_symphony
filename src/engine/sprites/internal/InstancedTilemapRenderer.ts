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

export class InstancedTilemapRenderer {
  private readonly tilemapMeshes =
    new Map<
      string,
      THREE.InstancedMesh
    >();

  public constructor(
    private readonly atlasParser:
      TextureAtlasParser,
  ) {}

  public renderTilemap(
    descriptor:
      TilemapLayerDescriptor,
    texture:
      THREE.Texture,
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

    const uvOffsets =
      new Float32Array(
        totalTiles *
        4,
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
      });

    texture.magFilter =
      THREE.NearestFilter;

    texture.minFilter =
      THREE.NearestFilter;

    material.onBeforeCompile =
      (
        shader,
      ): void => {
        shader.vertexShader = `
          attribute vec4 aUvOffset;
          varying vec2 vInstancedUv;
          ${shader.vertexShader}
        `;

        shader.vertexShader =
          shader.vertexShader
            .replace(
              "#include <uv_vertex>",
              `
              #include <uv_vertex>
              vInstancedUv = uv * aUvOffset.zw + aUvOffset.xy;
              `,
            );

        shader.fragmentShader = `
          varying vec2 vInstancedUv;
          ${shader.fragmentShader}
        `;

        shader.fragmentShader =
          shader.fragmentShader
            .replace(
              "vec4 texelColor = texture2D( map, vUv );",
              "vec4 texelColor = texture2D( map, vInstancedUv );",
            );
      };

    const instancedMesh =
      new THREE.InstancedMesh(
        geometry,
        material,
        totalTiles,
      );

    instancedMesh.renderOrder =
      Number.isFinite(
        descriptor.renderOrder,
      )
        ? descriptor.renderOrder ??
          0
        : 0;

    const dummy =
      new THREE.Object3D();

    const position =
      descriptor.position ??
      DEFAULT_POSITION;

    let instanceIndex =
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

        const frameUV =
          this.atlasParser
            .getFrameUV(
              descriptor.atlasUrl,
              `tile_${String(tileId)}`,
            );

        const offsetIndex =
          instanceIndex *
          4;

        if (
          frameUV !==
          null
        ) {
          uvOffsets[
            offsetIndex
          ] =
            frameUV.u;

          uvOffsets[
            offsetIndex +
              1
          ] =
            frameUV.v;

          uvOffsets[
            offsetIndex +
              2
          ] =
            frameUV.w;

          uvOffsets[
            offsetIndex +
              3
          ] =
            frameUV.h;
        } else {
          uvOffsets[
            offsetIndex
          ] =
            0;

          uvOffsets[
            offsetIndex +
              1
          ] =
            0;

          uvOffsets[
            offsetIndex +
              2
          ] =
            1;

          uvOffsets[
            offsetIndex +
              3
          ] =
            1;
        }

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
      "aUvOffset",
      new THREE.InstancedBufferAttribute(
        uvOffsets,
        4,
      ),
    );

    this.tilemapMeshes.set(
      normalizedLayerId,
      instancedMesh,
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

  public removeTilemap(
    layerId:
      string,
    disposeResources =
      true,
  ): boolean {
    const mesh =
      this.tilemapMeshes.get(
        layerId,
      );

    if (
      mesh ===
      undefined
    ) {
      return false;
    }

    if (
      disposeResources
    ) {
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
      this.tilemapMeshes.keys()
    ) {
      this.removeTilemap(
        layerId,
        disposeResources,
      );
    }
  }
}
