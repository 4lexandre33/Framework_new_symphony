// @vitest-environment jsdom

import * as THREE from "three";
import { beforeEach, describe, expect, it } from "vitest";

import { Kernel, type Plugin, type PluginContext } from "@core";
import type { SpriteAnimationEndedPayload, TextureAtlasJSON } from "../src/contracts/sprites/types";
import { ThreeRenderEngine } from "../src/engine/render/internal/ThreeRenderEngine";
import { InstancedTilemapRenderer, TILEMAP_UV_VERTEX_CHUNK } from "../src/engine/sprites/internal/InstancedTilemapRenderer";
import { Sprite2DRenderer } from "../src/engine/sprites/internal/Sprite2DRenderer";
import { TextureAtlasParser } from "../src/engine/sprites/internal/TextureAtlasParser";
import { createRenderPlugin } from "../src/plugins/render/plugin";
import { createSpritesPlugin, spritesManifest } from "../src/plugins/sprites/plugin";
import { AssetsToken, type AssetsApi } from "../src/tokens/assets";
import { RenderToken, type Render3DApi } from "../src/tokens/render";
import { SpritesToken, type SpritesApi } from "../src/tokens/sprites";

function frame(x: number, y: number, w: number, h: number, extra: Partial<TextureAtlasJSON["frames"] extends Record<string, infer F> ? F : never> = {}) {
  return {
    filename: "",
    frame: { x, y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
    ...extra,
  };
}

const ATLAS: TextureAtlasJSON = {
  frames: {
    tile_0: frame(0, 0, 16, 16),
    tile_1: frame(16, 0, 16, 16),
    run_0: frame(0, 16, 16, 32),
    run_1: frame(16, 16, 16, 32),
    run_2: frame(32, 16, 16, 32),
    // 10x20 girado: ocupa 20x10 no atlas a partir de (32,0)
    rot: frame(32, 0, 10, 20, { rotated: true }),
    // recortado: original 32x32, área 10x8 a partir de (4,2) no original
    trim: frame(48, 0, 10, 8, { trimmed: true, spriteSourceSize: { x: 4, y: 2, w: 10, h: 8 }, sourceSize: { w: 32, h: 32 } }),
  },
  meta: { image: "atlas.png", size: { w: 64, h: 64 }, scale: "1" },
};

describe("sprites gaps (G92–G95)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("G92: spawn/despawn/tilemap/parallax/clear funcionam pelo token e comandos com render+assets", async () => {
    const atlasTexture = new THREE.Texture();
    const bgTexture = new THREE.Texture();
    const assetsCache = new Map<string, THREE.Texture>([["atlas.png", atlasTexture], ["bg.png", bgTexture]]);
    const assetsPlugin: Plugin = {
      manifest: {
        id: "test.assets",
        name: "assets",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [AssetsToken.id] },
        capabilities: { provides: [{ id: AssetsToken.id, version: "1.0.0" }] },
      },
      setup(ctx: PluginContext): void {
        ctx.caps.provide(AssetsToken, {
          getAsset: (url: string) => assetsCache.get(url) ?? null,
          loadTexture: async () => null,
          releaseAsset: () => {},
        } as unknown as AssetsApi);
        ctx.lifecycle.ready();
      },
    };
    const holder: { sprites?: SpritesApi; render?: Render3DApi; send?: PluginContext["commands"]["send"] } = {};
    const game: Plugin = {
      manifest: {
        id: "test.sprites.game",
        name: "game",
        version: "1.0.0",
        kind: "preloaded",
        dependsOn: [{ id: "game.sprites", range: "^1.0.0" }],
        permissions: { capabilities: [SpritesToken.id, RenderToken.id] },
        capabilities: { consumes: [{ id: SpritesToken.id, range: "^1.0.0" }, { id: RenderToken.id, range: "^1.0.0" }] },
        lifecycleHooks: {
          onBoot: (ctx: PluginContext): void => {
            holder.sprites = ctx.caps.require(SpritesToken);
            holder.render = ctx.caps.require(RenderToken);
            holder.send = ctx.commands.send.bind(ctx.commands);
          },
        },
      },
      setup(ctx: PluginContext): void {
        ctx.lifecycle.ready();
      },
    };
    const fakeRenderer = {
      shadowMap: { enabled: false, type: 0 },
      renderLists: { dispose: (): void => {} },
      outputColorSpace: "",
      setPixelRatio: (): void => {},
      setSize: (): void => {},
      render: (): void => {},
      resetState: (): void => {},
      setAnimationLoop: (): void => {},
      dispose: (): void => {},
    };
    const kernel = new Kernel();
    kernel.register(createRenderPlugin(() => new ThreeRenderEngine(undefined, { hostWindow: window, hostDocument: document, rendererFactory: () => fakeRenderer as unknown as THREE.WebGLRenderer })));
    kernel.register(assetsPlugin);
    kernel.register(createSpritesPlugin());
    kernel.register(game);
    await kernel.boot();

    expect(spritesManifest.capabilities?.consumes?.map((c) => c.id).sort()).toEqual([AssetsToken.id, RenderToken.id].sort());
    const sprites = holder.sprites as SpritesApi;
    const render = holder.render as Render3DApi;
    sprites.parseAtlas("atlas.png", ATLAS, atlasTexture);
    const sprite = sprites.spawnSprite2D({ spriteId: "hero", atlasUrl: "atlas.png", frameName: "run_0", position: { x: 1, y: 2 } });
    expect(render.getMeshFromScene("sprite_hero")).toBe(sprite);
    const tilemap = sprites.renderTilemap({ layerId: "ground", atlasUrl: "atlas.png", tileMatrix: { width: 2, height: 1, tileSize: 1, tiles: [0, 1] } });
    expect(render.getMeshFromScene("tilemap_ground")).toBe(tilemap);
    sprites.createParallaxBackground([{ layerId: "sky", textureUrl: "bg.png", factorX: 0.2, factorY: 0 }]);
    expect(render.getMeshFromScene("parallax_sky")).not.toBeNull();

    await holder.send?.("game.sprites.spawn-sprite", { options: { spriteId: "cmd", atlasUrl: "atlas.png", frameName: "tile_0", position: { x: 0, y: 0 } } });
    await holder.send?.("game.sprites.load-tilemap", { descriptor: { layerId: "cmdmap", atlasUrl: "atlas.png", tileMatrix: { width: 1, height: 1, tileSize: 1, tiles: [1] } } });
    expect(render.getMeshFromScene("sprite_cmd")).not.toBeNull();
    expect(render.getMeshFromScene("tilemap_cmdmap")).not.toBeNull();

    expect(sprites.despawnSprite2D("hero")).toBe(true);
    expect(render.getMeshFromScene("sprite_hero")).toBeNull();
    sprites.clear();
    expect(render.getMeshFromScene("tilemap_ground")).toBeNull();
    expect(render.getMeshFromScene("parallax_sky")).toBeNull();
    await kernel.stop();
  });

  it("G93: cada instância do tilemap carrega o UV do seu tile e o shader escreve vMapUv", () => {
    const parser = new TextureAtlasParser();
    parser.parseAtlas("a", ATLAS, new THREE.Texture());
    const tilemap = new InstancedTilemapRenderer(parser);
    const mesh = tilemap.renderTilemap({ layerId: "l", atlasUrl: "a", tileMatrix: { width: 3, height: 1, tileSize: 1, tiles: [1, -1, 0] } }, parser.getAtlasTexture("a"));
    expect(mesh.count).toBe(2);
    const uvA = mesh.geometry.getAttribute("aUvA");
    // tile_1 em x=16 → u=0.25; tile_0 em x=0 → u=0
    expect(uvA.getX(0)).toBeCloseTo(16 / 64, 6);
    expect(uvA.getZ(0)).toBeCloseTo(16 / 64, 6);
    expect(uvA.getX(1)).toBeCloseTo(0, 6);
    const shader = { vertexShader: "void main(){\n#include <uv_vertex>\n}", fragmentShader: "" } as THREE.WebGLProgramParametersWithUniforms;
    (mesh.material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("attribute vec4 aUvA;");
    expect(shader.vertexShader).toContain("vMapUv = ( mapTransform * vec3( engineTileUv, 1.0 ) ).xy;");
    expect(TILEMAP_UV_VERTEX_CHUNK).toContain("#include <uv_vertex>");

    // Tile sem frame não aparece (não mostra o atlas inteiro).
    const missing = tilemap.renderTilemap({ layerId: "m", atlasUrl: "a", tileMatrix: { width: 1, height: 1, tileSize: 1, tiles: [99] } }, parser.getAtlasTexture("a"));
    expect(missing.count).toBe(0);
    expect(tilemap.getMissingFrameCount("m")).toBe(1);
    tilemap.clear();
    parser.clear();
  });

  it("G94: animação de sprite (loop, fim com callback, pausa)", () => {
    const parser = new TextureAtlasParser();
    parser.parseAtlas("a", ATLAS, new THREE.Texture());
    const sprites = new Sprite2DRenderer(parser);
    sprites.spawnSprite({ spriteId: "s", atlasUrl: "a", frameName: "run_0", position: { x: 0, y: 0 } }, parser.getAtlasTexture("a"));
    const ended: string[] = [];
    const onEnded = (id: string, name: string): void => {
      ended.push(`${id}:${name}`);
    };
    sprites.playAnimation("s", { name: "run", frames: ["run_0", "run_1", "run_2"], frameRate: 10, loop: true });
    sprites.update(0.1, onEnded);
    expect(sprites.getSpriteFrameName("s")).toBe("run_1");
    sprites.update(0, onEnded); // pausado
    expect(sprites.getSpriteFrameName("s")).toBe("run_1");
    sprites.update(0.2, onEnded);
    expect(sprites.getSpriteFrameName("s")).toBe("run_0"); // deu a volta
    const uv = (sprites.getSprite("s") as THREE.Mesh).geometry.getAttribute("uv");
    expect(uv.getX(0)).toBeCloseTo(0, 6);

    sprites.playAnimation("s", { name: "once", frames: ["run_1", "run_2"], frameRate: 10 });
    sprites.update(0.1, onEnded);
    expect(ended).toEqual([]);
    sprites.update(0.1, onEnded);
    expect(ended).toEqual(["s:once"]);
    expect(sprites.getSpriteFrameName("s")).toBe("run_2");
    expect(sprites.isAnimating("s")).toBe(false);
    expect(() => sprites.playAnimation("s", { name: "bad", frames: [], frameRate: 10 })).toThrow(RangeError);
    sprites.clear();
  });

  it("G94: tamanho pelo frame, trimmed, rotated e frame inexistente", () => {
    const parser = new TextureAtlasParser();
    parser.parseAtlas("a", ATLAS, new THREE.Texture());
    const sprites = new Sprite2DRenderer(parser);
    const tall = sprites.spawnSprite({ spriteId: "tall", atlasUrl: "a", frameName: "run_0", position: { x: 0, y: 0 }, pixelsPerUnit: 16 }, parser.getAtlasTexture("a"));
    tall.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    tall.geometry.boundingBox?.getSize(size);
    expect([size.x, size.y]).toEqual([1, 2]);

    // Sem pixelsPerUnit: altura 1, largura proporcional.
    const unit = sprites.spawnSprite({ spriteId: "unit", atlasUrl: "a", frameName: "run_0", position: { x: 0, y: 0 } }, parser.getAtlasTexture("a"));
    unit.geometry.computeBoundingBox();
    unit.geometry.boundingBox?.getSize(size);
    expect([size.x, size.y]).toEqual([0.5, 1]);

    // Trimmed: quad 10x8 deslocado; centro da área = (4+5-16, -(2+4-16)) = (-7, 10) px.
    const trimmed = sprites.spawnSprite({ spriteId: "trim", atlasUrl: "a", frameName: "trim", position: { x: 0, y: 0 }, pixelsPerUnit: 1 }, parser.getAtlasTexture("a"));
    trimmed.geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    trimmed.geometry.boundingBox?.getCenter(center);
    expect([center.x, center.y]).toEqual([-7, 10]);

    // Rotated: canto inferior esquerdo do sprite (vértice 2) = canto superior esquerdo da região.
    const rotated = sprites.spawnSprite({ spriteId: "rot", atlasUrl: "a", frameName: "rot", position: { x: 0, y: 0 } }, parser.getAtlasTexture("a"));
    const uv = rotated.geometry.getAttribute("uv");
    expect(uv.getX(2)).toBeCloseTo(32 / 64, 6);
    expect(uv.getY(2)).toBeCloseTo(1, 6);
    // canto inferior direito do sprite (vértice 3, s=1,t=0) desce 10px na região
    expect(uv.getX(3)).toBeCloseTo(32 / 64, 6);
    expect(uv.getY(3)).toBeCloseTo(1 - 10 / 64, 6);
    expect(parser.getFrameUV("a", "rot")).toMatchObject({ w: 20 / 64, h: 10 / 64, rotated: true });

    const missing = sprites.spawnSprite({ spriteId: "missing", atlasUrl: "a", frameName: "nope", position: { x: 0, y: 0 } }, parser.getAtlasTexture("a"));
    expect((missing.material as THREE.Material).visible).toBe(false);
    expect(sprites.setSpriteFrame("missing", "tile_0")).toBe(true);
    expect((missing.material as THREE.Material).visible).toBe(true);
    sprites.clear();
  });

  it("G95: parseAtlas não altera a textura compartilhada e sprite sem atlas aparece após parseAtlas", () => {
    const shared = new THREE.Texture();
    shared.magFilter = THREE.LinearFilter;
    shared.wrapS = THREE.ClampToEdgeWrapping;
    const parser = new TextureAtlasParser();
    parser.parseAtlas("a", ATLAS, shared);
    expect(shared.magFilter).toBe(THREE.LinearFilter);
    const owned = parser.getAtlasTexture("a") as THREE.Texture;
    expect(owned).not.toBe(shared);
    expect(owned.magFilter).toBe(THREE.NearestFilter);

    const sprites = new Sprite2DRenderer(new TextureAtlasParser());
    const lateParser = new TextureAtlasParser();
    const late = new Sprite2DRenderer(lateParser);
    const mesh = late.spawnSprite({ spriteId: "x", atlasUrl: "later", frameName: "tile_1", position: { x: 0, y: 0 } }, null);
    expect((mesh.material as THREE.Material).visible).toBe(false);
    lateParser.parseAtlas("later", ATLAS, shared);
    late.rebindAtlas("later", lateParser.getAtlasTexture("later"));
    expect((mesh.material as THREE.Material).visible).toBe(true);
    expect((mesh.material as THREE.MeshBasicMaterial).map).toBe(lateParser.getAtlasTexture("later"));
    sprites.clear();
    late.clear();

    let disposedOwned = false;
    owned.addEventListener("dispose", () => {
      disposedOwned = true;
    });
    parser.clear();
    expect(disposedOwned).toBe(true);
    expect(shared.version).toBe(0); // nunca marcada para re-upload
  });

  it("animation-ended chega como evento pelo plugin", async () => {
    const events: SpriteAnimationEndedPayload[] = [];
    const holder: { sprites?: SpritesApi; emitFrame?: (delta: number) => Promise<void> } = {};
    const game: Plugin = {
      manifest: {
        id: "test.sprites.anim",
        name: "anim",
        version: "1.0.0",
        kind: "preloaded",
        dependsOn: [{ id: "game.sprites", range: "^1.0.0" }],
        permissions: { capabilities: [SpritesToken.id], events: ["game.loop.render"] },
        capabilities: { consumes: [{ id: SpritesToken.id, range: "^1.0.0" }] },
        lifecycleHooks: {
          onBoot: (ctx: PluginContext): void => {
            holder.sprites = ctx.caps.require(SpritesToken);
          },
        },
      },
      setup(ctx: PluginContext): void {
        ctx.events.on<"game.sprites.animation-ended", SpriteAnimationEndedPayload>("game.sprites.animation-ended", (e) => {
          events.push(e.payload);
        });
        holder.emitFrame = (delta: number) =>
          ctx.events.emitAsync("game.loop.render", { alphaInterpolation: 0, deltaSeconds: delta, realDeltaSeconds: delta, isPaused: delta === 0 });
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(createSpritesPlugin());
    kernel.register(game);
    await kernel.boot();
    const sprites = holder.sprites as SpritesApi;
    sprites.parseAtlas("a", ATLAS, new THREE.Texture());
    sprites.spawnSprite2D({ spriteId: "p", atlasUrl: "a", frameName: "run_0", position: { x: 0, y: 0 } });
    sprites.playSpriteAnimation("p", { name: "hit", frames: ["run_0", "run_1"], frameRate: 20 });
    await holder.emitFrame?.(0); // pausado
    await holder.emitFrame?.(0.06);
    await holder.emitFrame?.(0.06);
    await kernel.__internal().state.emitQueue.drain();
    expect(events).toEqual([{ spriteId: "p", animationName: "hit" }]);
    await kernel.stop();
  });
});
