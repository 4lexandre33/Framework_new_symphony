import * as THREE from "three";

import type {
  Sprite2DOptions,
} from "../../../contracts/sprites/types";

import {
  TextureAtlasParser,
} from "./TextureAtlasParser";

function finiteOr(
  value:
    number | undefined,
  fallback:
    number,
): number {
  return (
    value !==
      undefined &&
    Number.isFinite(
      value,
    )
  )
    ? value
    : fallback;
}

export class Sprite2DRenderer {
  private readonly activeSprites =
    new Map<
      string,
      THREE.Mesh
    >();

  public constructor(
    private readonly atlasParser:
      TextureAtlasParser,
  ) {}

  public spawnSprite(
    options:
      Sprite2DOptions,
    texture:
      THREE.Texture,
  ): THREE.Mesh {
    const normalizedId =
      options.spriteId.trim();

    if (
      normalizedId.length ===
      0
    ) {
      throw new RangeError(
        "spriteId não pode ser vazio.",
      );
    }

    this.despawnSprite(
      normalizedId,
    );

    const uv =
      this.atlasParser
        .getFrameUV(
          options.atlasUrl,
          options.frameName,
        );

    const geometry =
      new THREE.PlaneGeometry(
        1,
        1,
      );

    if (
      uv !==
      null
    ) {
      const uvs =
        geometry.attributes
          .uv;

      if (
        uvs !==
        undefined
      ) {
        uvs.setXY(
          0,
          uv.u,
          uv.v +
            uv.h,
        );

        uvs.setXY(
          1,
          uv.u +
            uv.w,
          uv.v +
            uv.h,
        );

        uvs.setXY(
          2,
          uv.u,
          uv.v,
        );

        uvs.setXY(
          3,
          uv.u +
            uv.w,
          uv.v,
        );

        uvs.needsUpdate =
          true;
      }
    }

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture,
        transparent:
          true,
        side:
          THREE.DoubleSide,
      });

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    mesh.position.set(
      finiteOr(
        options.position.x,
        0,
      ),
      finiteOr(
        options.position.y,
        0,
      ),
      finiteOr(
        options.position.z,
        0,
      ),
    );

    const scaleX =
      finiteOr(
        options.scale?.x,
        1,
      ) *
      (
        options.flipX ===
        true
          ? -1
          : 1
      );

    const scaleY =
      finiteOr(
        options.scale?.y,
        1,
      ) *
      (
        options.flipY ===
        true
          ? -1
          : 1
      );

    mesh.scale.set(
      scaleX,
      scaleY,
      1,
    );

    mesh.rotation.z =
      finiteOr(
        options.rotation,
        0,
      );

    mesh.renderOrder =
      finiteOr(
        options.renderOrder,
        0,
      );

    this.activeSprites.set(
      normalizedId,
      mesh,
    );

    return mesh;
  }

  public hasSprite(
    spriteId:
      string,
  ): boolean {
    return this.activeSprites.has(
      spriteId,
    );
  }

  public despawnSprite(
    spriteId:
      string,
    disposeResources =
      true,
  ): boolean {
    const mesh =
      this.activeSprites.get(
        spriteId,
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
        mesh.material instanceof
        THREE.Material
      ) {
        mesh.material
          .dispose();
      }
    }

    this.activeSprites.delete(
      spriteId,
    );

    return true;
  }

  public clear(
    disposeResources =
      true,
  ): void {
    for (
      const spriteId of
      this.activeSprites.keys()
    ) {
      this.despawnSprite(
        spriteId,
        disposeResources,
      );
    }
  }
}
