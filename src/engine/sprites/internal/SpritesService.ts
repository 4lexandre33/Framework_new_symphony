import * as THREE from "three";

import type {
  PluginContext,
} from "@core";

import type {
  SpritesApi,
} from "../../../tokens/sprites";

import {
  AssetsToken,
} from "../../../tokens/assets";

import type {
  AssetsApi,
} from "../../../tokens/assets";

import {
  RenderToken,
} from "../../../tokens/render";

import type {
  Render3DApi,
} from "../../../tokens/render";

import type {
  ParallaxLayerConfig,
  Sprite2DOptions,
  TextureAtlasJSON,
  TilemapLayerDescriptor,
  UVRect,
} from "../../../contracts/sprites/types";

import {
  InstancedTilemapRenderer,
} from "./InstancedTilemapRenderer";

import {
  ParallaxController,
} from "./ParallaxController";

import {
  PixelArtScaler,
} from "./PixelArtScaler";

import {
  Sprite2DRenderer,
} from "./Sprite2DRenderer";

import {
  TextureAtlasParser,
} from "./TextureAtlasParser";

export class SpritesService
  implements SpritesApi {
  private readonly atlasParser =
    new TextureAtlasParser();

  private readonly tilemapRenderer =
    new InstancedTilemapRenderer(
      this.atlasParser,
    );

  private readonly parallaxController =
    new ParallaxController();

  private readonly spriteRenderer =
    new Sprite2DRenderer(
      this.atlasParser,
    );

  private readonly tilemapRenderKeys =
    new Set<string>();

  private readonly parallaxRenderKeys =
    new Set<string>();

  private readonly spriteRenderKeys =
    new Set<string>();

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public parseAtlas(
    atlasKey:
      string,
    json:
      TextureAtlasJSON,
    texture:
      THREE.Texture,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.atlasParser
      .parseAtlas(
        atlasKey,
        json,
        texture,
      );
  }

  public getFrameUV(
    atlasKey:
      string,
    frameName:
      string,
  ): UVRect | null {
    if (
      this.disposed
    ) {
      return null;
    }

    return this.atlasParser
      .getFrameUV(
        atlasKey,
        frameName,
      );
  }

  public renderTilemap(
    descriptor:
      TilemapLayerDescriptor,
  ): THREE.InstancedMesh {
    this.assertActive();

    const key =
      `tilemap_${descriptor.layerId}`;

    const render =
      this.getRender();

    const ownsSceneResource =
      render !==
      null;

    if (
      ownsSceneResource
    ) {
      render
        ?.removeMeshFromScene(
          key,
        );

      this.tilemapRenderer
        .removeTilemap(
          descriptor.layerId,
          false,
        );
    }

    const texture =
      this.getTextureOrFallback(
        descriptor.atlasUrl,
      );

    const mesh =
      this.tilemapRenderer
        .renderTilemap(
          descriptor,
          texture,
        );

    if (
      render !==
      null
    ) {
      render.addMeshToScene(
        key,
        mesh,
      );

      this.tilemapRenderKeys.add(
        key,
      );
    }

    this.ctx.events.emit(
      "game.sprites.tilemap-loaded",
      {
        layerId:
          descriptor.layerId,

        totalTiles:
          mesh.count,

        drawCallCount:
          1,
      },
    );

    return mesh;
  }

  public createParallaxBackground(
    layers:
      ReadonlyArray<
        ParallaxLayerConfig
      >,
  ): void {
    this.assertActive();

    for (
      const config of
      layers
    ) {
      const key =
        `parallax_${config.layerId}`;

      const render =
        this.getRender();

      if (
        render !==
        null
      ) {
        render.removeMeshFromScene(
          key,
        );

        this.parallaxController
          .removeLayer(
            config.layerId,
            false,
          );
      }

      const texture =
        this.getTextureOrFallback(
          config.textureUrl,
        );

      const mesh =
        this.parallaxController
          .createLayer(
            config,
            texture,
          );

      if (
        render !==
        null
      ) {
        render.addMeshToScene(
          key,
          mesh,
        );

        this.parallaxRenderKeys.add(
          key,
        );
      }
    }
  }

  public setParallaxSpeed(
    layerId:
      string,
    factorX:
      number,
    factorY:
      number,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.parallaxController
      .setLayerFactors(
        layerId,
        factorX,
        factorY,
      );
  }

  public updateParallax(
    cameraX:
      number,
    cameraY:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.parallaxController
      .update(
        cameraX,
        cameraY,
      );

    this.ctx.events.emit(
      "game.sprites.parallax-scrolled",
      {
        cameraPosition: {
          x:
            Number.isFinite(
              cameraX,
            )
              ? cameraX
              : 0,

          y:
            Number.isFinite(
              cameraY,
            )
              ? cameraY
              : 0,
        },
      },
    );
  }

  public spawnSprite2D(
    options:
      Sprite2DOptions,
  ): THREE.Mesh {
    this.assertActive();

    const key =
      `sprite_${options.spriteId}`;

    const render =
      this.getRender();

    if (
      render !==
      null
    ) {
      render.removeMeshFromScene(
        key,
      );

      this.spriteRenderer
        .despawnSprite(
          options.spriteId,
          false,
        );
    }

    const texture =
      this.getTextureOrFallback(
        options.atlasUrl,
      );

    const mesh =
      this.spriteRenderer
        .spawnSprite(
          options,
          texture,
        );

    if (
      render !==
      null
    ) {
      render.addMeshToScene(
        key,
        mesh,
      );

      this.spriteRenderKeys.add(
        key,
      );
    }

    return mesh;
  }

  public despawnSprite2D(
    spriteId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const key =
      `sprite_${spriteId}`;

    const render =
      this.getRender();

    if (
      render !==
      null
    ) {
      render.removeMeshFromScene(
        key,
      );

      this.spriteRenderKeys.delete(
        key,
      );

      return this.spriteRenderer
        .despawnSprite(
          spriteId,
          false,
        );
    }

    return this.spriteRenderer
      .despawnSprite(
        spriteId,
        true,
      );
  }

  public setPixelPerfectScaling(
    camera:
      THREE.OrthographicCamera,
    viewportWidth:
      number,
    viewportHeight:
      number,
    designWidth:
      number,
    designHeight:
      number,
  ): number {
    return PixelArtScaler
      .applyPixelPerfectZoom(
        camera,
        viewportWidth,
        viewportHeight,
        designWidth,
        designHeight,
      );
  }

  public clear(): void {
    if (
      this.disposed
    ) {
      return;
    }

    const render =
      this.getRender();

    if (
      render !==
      null
    ) {
      for (
        const key of
        this.tilemapRenderKeys
      ) {
        render.removeMeshFromScene(
          key,
        );
      }

      for (
        const key of
        this.parallaxRenderKeys
      ) {
        render.removeMeshFromScene(
          key,
        );
      }

      for (
        const key of
        this.spriteRenderKeys
      ) {
        render.removeMeshFromScene(
          key,
        );
      }
    }

    const disposeLocally =
      render ===
      null;

    this.tilemapRenderer
      .clear(
        disposeLocally,
      );

    this.parallaxController
      .clear(
        disposeLocally,
      );

    this.spriteRenderer
      .clear(
        disposeLocally,
      );

    this.tilemapRenderKeys
      .clear();

    this.parallaxRenderKeys
      .clear();

    this.spriteRenderKeys
      .clear();

    this.atlasParser
      .clear();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.clear();

    this.disposed =
      true;
  }

  private getAssets():
    AssetsApi | null {
    return (
      this.ctx.caps.get(
        AssetsToken,
      ) ??
      null
    );
  }

  private getRender():
    Render3DApi | null {
    return (
      this.ctx.caps.get(
        RenderToken,
      ) ??
      null
    );
  }

  private getTextureOrFallback(
    url:
      string,
  ): THREE.Texture {
    const texture =
      this.getAssets()
        ?.getAsset<
          THREE.Texture
        >(
          url,
        );

    return (
      texture ??
      new THREE.Texture()
    );
  }

  private assertActive(): void {
    if (
      this.disposed
    ) {
      throw new Error(
        "SpritesService já foi descartado.",
      );
    }
  }
}
