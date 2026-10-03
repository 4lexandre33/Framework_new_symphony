import * as THREE from "three";
import type { Sprite2DOptions } from "../../contracts/sprites/types";
import { TextureAtlasParser } from "./TextureAtlasParser";

export class Sprite2DRenderer {
  private readonly activeSprites = new Map<string, THREE.Mesh>();

  public constructor(private readonly atlasParser: TextureAtlasParser) {}

  public spawnSprite(
    options: Sprite2DOptions,
    texture: THREE.Texture
  ): THREE.Mesh {
    this.despawnSprite(options.spriteId);

    const uv = this.atlasParser.getFrameUV(options.atlasUrl, options.frameName);
    const geometry = new THREE.PlaneGeometry(1, 1);

    if (uv) {
      const uvs = geometry.attributes.uv;
      if (uvs) {
        uvs.setXY(0, uv.u, uv.v + uv.h);
        uvs.setXY(1, uv.u + uv.w, uv.v + uv.h);
        uvs.setXY(2, uv.u, uv.v);
        uvs.setXY(3, uv.u + uv.w, uv.v);
        uvs.needsUpdate = true;
      }
    }

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      options.position.x,
      options.position.y,
      options.position.z || 0
    );

    const scaleX = (options.scale?.x || 1) * (options.flipX ? -1 : 1);
    const scaleY = (options.scale?.y || 1) * (options.flipY ? -1 : 1);
    mesh.scale.set(scaleX, scaleY, 1);

    if (options.rotation) {
      mesh.rotation.z = options.rotation;
    }

    mesh.renderOrder = options.renderOrder || 0;
    this.activeSprites.set(options.spriteId, mesh);

    return mesh;
  }

  public despawnSprite(spriteId: string): boolean {
    const mesh = this.activeSprites.get(spriteId);
    if (!mesh) return false;

    mesh.geometry.dispose();
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose();
    }

    this.activeSprites.delete(spriteId);
    return true;
  }

  public clear(): void {
    for (const spriteId of this.activeSprites.keys()) {
      this.despawnSprite(spriteId);
    }
  }
}