import * as THREE from "three";
import type { TilemapLayerDescriptor } from "../../contracts/sprites/types";
import { TextureAtlasParser } from "./TextureAtlasParser";

export class InstancedTilemapRenderer {
  private readonly tilemapMeshes = new Map<string, THREE.InstancedMesh>();

  public constructor(private readonly atlasParser: TextureAtlasParser) {}

  public renderTilemap(
    descriptor: TilemapLayerDescriptor,
    texture: THREE.Texture
  ): THREE.InstancedMesh {
    this.removeTilemap(descriptor.layerId);

    const { width, height, tileSize, tiles } = descriptor.tileMatrix;
    const totalTiles = width * height;

    const geometry = new THREE.PlaneGeometry(tileSize, tileSize);
    geometry.translate(tileSize / 2, -tileSize / 2, 0); // Origem no canto superior esquerdo

    // Atributo customizado para armazenar UV Offset de cada tile
    const uvOffsets = new Float32Array(totalTiles * 4);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
    });

    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    // Sobrescreve Shaders para aplicar o atributo aUvOffset de cada instância
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute vec4 aUvOffset;
        varying vec2 vInstancedUv;
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        `#include <uv_vertex>`,
        `
        #include <uv_vertex>
        vInstancedUv = uv * aUvOffset.zw + aUvOffset.xy;
        `
      );

      shader.fragmentShader = `
        varying vec2 vInstancedUv;
        ${shader.fragmentShader}
      `;

      shader.fragmentShader = shader.fragmentShader.replace(
        `vec4 texelColor = texture2D( map, vUv );`,
        `vec4 texelColor = texture2D( map, vInstancedUv );`
      );
    };

    const instancedMesh = new THREE.InstancedMesh(geometry, material, totalTiles);
    instancedMesh.renderOrder = descriptor.renderOrder || 0;

    const dummy = new THREE.Object3D();
    const pos = descriptor.position || { x: 0, y: 0, z: 0 };
    let instanceIdx = 0;

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const tileId = tiles[row * width + col];

        if (tileId !== undefined && tileId >= 0) {
          dummy.position.set(
            pos.x + col * tileSize,
            pos.y - row * tileSize,
            pos.z
          );
          dummy.updateMatrix();
          instancedMesh.setMatrixAt(instanceIdx, dummy.matrix);

          const frameUV = this.atlasParser.getFrameUV(
            descriptor.atlasUrl,
            `tile_${tileId}`
          );

          if (frameUV) {
            uvOffsets[instanceIdx * 4 + 0] = frameUV.u;
            uvOffsets[instanceIdx * 4 + 1] = frameUV.v;
            uvOffsets[instanceIdx * 4 + 2] = frameUV.w;
            uvOffsets[instanceIdx * 4 + 3] = frameUV.h;
          } else {
            uvOffsets[instanceIdx * 4 + 0] = 0;
            uvOffsets[instanceIdx * 4 + 1] = 0;
            uvOffsets[instanceIdx * 4 + 2] = 1;
            uvOffsets[instanceIdx * 4 + 3] = 1;
          }

          instanceIdx++;
        }
      }
    }

    instancedMesh.count = instanceIdx;
    instancedMesh.instanceMatrix.needsUpdate = true;

    geometry.setAttribute(
      "aUvOffset",
      new THREE.InstancedBufferAttribute(uvOffsets, 4)
    );

    this.tilemapMeshes.set(descriptor.layerId, instancedMesh);
    return instancedMesh;
  }

  public removeTilemap(layerId: string): boolean {
    const mesh = this.tilemapMeshes.get(layerId);
    if (!mesh) return false;

    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else {
      mesh.material.dispose();
    }

    this.tilemapMeshes.delete(layerId);
    return true;
  }

  public clear(): void {
    for (const layerId of this.tilemapMeshes.keys()) {
      this.removeTilemap(layerId);
    }
  }
}