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
  SpriteAnimationDescriptor,
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

/**
 * Os objetos de sprites são DESTE serviço: o render só os coloca/tira da
 * cena (`removeMeshFromScene(key, { disposeResources: false })`) e o
 * descarte (`disposeLocally`) acontece aqui, sem tocar texturas do cache.
 */
const SCENE_ONLY = Object.freeze({
  disposeResources:
    false,
});

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

  private readonly pendingParallaxLoads =
    new Map<
      string,
      number
    >();

  private loadGeneration =
    0;

  private disposed =
    false;

  private readonly onAnimationEnded =
    (
      spriteId:
        string,
      animationName:
        string,
    ): void => {
      this.ctx.events.emit(
        "game.sprites.animation-ended",
        {
          spriteId,
          animationName,
        },
      );
    };

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
        texture ??
          null,
      );

    // Sprites/tilemaps criados antes do atlas aparecem agora.
    const ownedTexture =
      this.atlasParser
        .getAtlasTexture(
          atlasKey,
        );

    this.spriteRenderer
      .rebindAtlas(
        atlasKey,
        ownedTexture,
      );

    for (
      const descriptor of
      this.tilemapRenderer
        .getDescriptorsForAtlas(
          atlasKey,
        )
    ) {
      this.renderTilemap(
        descriptor,
      );
    }
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

  public getAtlasTexture(
    atlasKey:
      string,
  ): THREE.Texture | null {
    return this.atlasParser
      .getAtlasTexture(
        atlasKey,
      );
  }

  public renderTilemap(
    descriptor:
      TilemapLayerDescriptor,
  ): THREE.InstancedMesh {
    this.assertActive();

    const key =
      `tilemap_${descriptor.layerId}`;

    this.detachFromScene(
      key,
      this.tilemapRenderKeys,
    );

    const texture =
      this.atlasParser
        .getAtlasTexture(
          descriptor.atlasUrl,
        );

    if (
      texture ===
      null
    ) {
      this.ctx.log.warn(
        `sprites: atlas "${descriptor.atlasUrl}" sem textura/parse; camada "${descriptor.layerId}" fica invisível até parseAtlas.`,
      );
    }

    const mesh =
      this.tilemapRenderer
        .renderTilemap(
          descriptor,
          texture,
        );

    const missing =
      this.tilemapRenderer
        .getMissingFrameCount(
          descriptor.layerId.trim(),
        );

    if (
      missing >
        0 &&
      texture !==
        null
    ) {
      this.ctx.log.warn(
        `sprites: ${String(missing)} tile(s) sem frame "tile_N" no atlas "${descriptor.atlasUrl}" (camada "${descriptor.layerId}").`,
      );
    }

    this.attachToScene(
      key,
      mesh,
      this.tilemapRenderKeys,
    );

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

  public removeTilemap(
    layerId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    this.detachFromScene(
      `tilemap_${layerId}`,
      this.tilemapRenderKeys,
    );

    return this.tilemapRenderer
      .removeTilemap(
        layerId,
        true,
      );
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

      this.detachFromScene(
        key,
        this.parallaxRenderKeys,
      );

      this.pendingParallaxLoads.delete(
        config.layerId,
      );

      const cached =
        this.getCachedTexture(
          config.textureUrl,
        );

      const mesh =
        this.parallaxController
          .createLayer(
            config,
            cached,
          );

      this.attachToScene(
        key,
        mesh,
        this.parallaxRenderKeys,
      );

      if (
        cached ===
        null
      ) {
        this.loadParallaxTexture(
          config.layerId,
          config.textureUrl,
          mesh,
        );
      }
    }
  }

  public removeParallaxLayer(
    layerId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    this.pendingParallaxLoads.delete(
      layerId,
    );

    this.detachFromScene(
      `parallax_${layerId}`,
      this.parallaxRenderKeys,
    );

    return this.parallaxController
      .removeLayer(
        layerId,
        true,
      );
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
      `sprite_${options.spriteId.trim()}`;

    this.detachFromScene(
      key,
      this.spriteRenderKeys,
    );

    const texture =
      this.atlasParser
        .getAtlasTexture(
          options.atlasUrl,
        );

    const mesh =
      this.spriteRenderer
        .spawnSprite(
          options,
          texture,
        );

    if (
      texture ===
      null
    ) {
      this.ctx.log.warn(
        `sprites: atlas "${options.atlasUrl}" sem textura/parse; sprite "${options.spriteId}" fica invisível até parseAtlas.`,
      );
    } else if (
      this.atlasParser
        .getFrame(
          options.atlasUrl,
          options.frameName,
        ) ===
      null
    ) {
      this.ctx.log.warn(
        `sprites: frame "${options.frameName}" não existe no atlas "${options.atlasUrl}"; sprite invisível.`,
      );
    }

    this.attachToScene(
      key,
      mesh,
      this.spriteRenderKeys,
    );

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

    this.detachFromScene(
      `sprite_${spriteId}`,
      this.spriteRenderKeys,
    );

    return this.spriteRenderer
      .despawnSprite(
        spriteId,
        true,
      );
  }

  public getSprite(
    spriteId:
      string,
  ): THREE.Mesh | null {
    return this.spriteRenderer
      .getSprite(
        spriteId,
      );
  }

  public setSpriteFrame(
    spriteId:
      string,
    frameName:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.spriteRenderer
      .setSpriteFrame(
        spriteId,
        frameName,
      );
  }

  public playSpriteAnimation(
    spriteId:
      string,
    animation:
      SpriteAnimationDescriptor,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.spriteRenderer
      .playAnimation(
        spriteId,
        animation,
      );
  }

  public stopSpriteAnimation(
    spriteId:
      string,
  ): boolean {
    return this.spriteRenderer
      .stopAnimation(
        spriteId,
      );
  }

  public update(
    deltaSeconds:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.spriteRenderer
      .update(
        deltaSeconds,
        this.onAnimationEnded,
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
          SCENE_ONLY,
        );
      }

      for (
        const key of
        this.parallaxRenderKeys
      ) {
        render.removeMeshFromScene(
          key,
          SCENE_ONLY,
        );
      }

      for (
        const key of
        this.spriteRenderKeys
      ) {
        render.removeMeshFromScene(
          key,
          SCENE_ONLY,
        );
      }
    }

    // Sempre descartado aqui (o render não é dono destes recursos).
    const disposeLocally =
      true;

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

    this.pendingParallaxLoads
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

  private attachToScene(
    key:
      string,
    object:
      THREE.Object3D,
    keys:
      Set<string>,
  ): void {
    const render =
      this.getRender();

    if (
      render ===
      null
    ) {
      return;
    }

    render.addMeshToScene(
      key,
      object,
    );

    keys.add(
      key,
    );
  }

  private detachFromScene(
    key:
      string,
    keys:
      Set<string>,
  ): void {
    if (
      !keys.has(
        key,
      )
    ) {
      return;
    }

    this.getRender()
      ?.removeMeshFromScene(
        key,
        SCENE_ONLY,
      );

    keys.delete(
      key,
    );
  }

  private getCachedTexture(
    url:
      string,
  ): THREE.Texture | null {
    const texture =
      this.getAssets()
        ?.getAsset<
          THREE.Texture
        >(
          url,
        );

    return texture instanceof
      THREE.Texture
      ? texture
      : null;
  }

  private loadParallaxTexture(
    layerId:
      string,
    url:
      string,
    mesh:
      THREE.Mesh,
  ): void {
    const assets =
      this.getAssets();

    if (
      assets ===
        null ||
      typeof assets.loadTexture !==
        "function"
    ) {
      this.ctx.log.warn(
        `sprites: textura "${url}" não está no cache e game.assets não está disponível; camada "${layerId}" invisível.`,
      );
      return;
    }

    this.loadGeneration +=
      1;

    const generation =
      this.loadGeneration;

    this.pendingParallaxLoads.set(
      layerId,
      generation,
    );

    void assets
      .loadTexture(
        url,
      )
      .then(
        (
          loaded:
            unknown,
        ): void => {
          if (
            !this.disposed &&
            this.pendingParallaxLoads.get(
              layerId,
            ) ===
              generation &&
            this.parallaxController
              .getLayerMesh(
                layerId,
              ) ===
              mesh &&
            loaded instanceof
              THREE.Texture
          ) {
            this.pendingParallaxLoads.delete(
              layerId,
            );

            // O controller clona: a referência do cache pode ser liberada.
            this.parallaxController
              .setLayerTexture(
                layerId,
                loaded,
              );
          }

          assets.releaseAsset(
            url,
          );
        },
      )
      .catch(
        (
          error:
            unknown,
        ): void => {
          this.ctx.log.warn(
            `sprites: falha ao carregar "${url}".`,
            {
              error:
                String(
                  error,
                ),
            },
          );
        },
      );
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
