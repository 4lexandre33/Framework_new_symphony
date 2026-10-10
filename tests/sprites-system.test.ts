import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { TextureAtlasParser } from "../src/engine/sprites/internal/TextureAtlasParser";
import { PixelArtScaler } from "../src/engine/sprites/internal/PixelArtScaler";
import { ParallaxController } from "../src/engine/sprites/internal/ParallaxController";
import type { TextureAtlasJSON } from "../src/contracts/sprites/types";

describe("Camada de Sprites 2D, Tilemaps & Pixel Art (game.sprites)", () => {
  let atlasParser: TextureAtlasParser;
  let parallaxController: ParallaxController;

  beforeEach(() => {
    atlasParser = new TextureAtlasParser();
    parallaxController = new ParallaxController();
  });

  it("deve mapear coordenadas UV normalizadas a partir de um atlas JSON", () => {
    const mockJson: TextureAtlasJSON = {
      frames: {
        tile_0: {
          filename: "tile_0",
          frame: { x: 0, y: 0, w: 16, h: 16 },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: 16, h: 16 },
          sourceSize: { w: 16, h: 16 },
        },
      },
      meta: {
        image: "tileset.png",
        size: { w: 256, h: 256 },
        scale: "1",
      },
    };

    const mockTexture = new THREE.Texture();
    atlasParser.parseAtlas("tileset_01", mockJson, mockTexture);

    const uv = atlasParser.getFrameUV("tileset_01", "tile_0");
    expect(uv).not.toBeNull();
    expect(uv?.w).toBeCloseTo(16 / 256, 3);
    expect(uv?.h).toBeCloseTo(16 / 256, 3);
  });

  it("deve calcular o fator de zoom inteiro (Integer Scaling) para Pixel Art", () => {
    const scale1 = PixelArtScaler.calculateIntegerScale(1920, 1080, 320, 180);
    expect(scale1).toBe(6);

    const scale2 = PixelArtScaler.calculateIntegerScale(1280, 720, 320, 180);
    expect(scale2).toBe(4);
  });

  it("deve mover camadas de fundo em velocidades diferenciais no Parallax", () => {
    const mockTexture = new THREE.Texture();

    const layerMesh = parallaxController.createLayer(
      { layerId: "bg_mountains", textureUrl: "bg.png", factorX: 0.5, factorY: 0.2 },
      mockTexture
    );

    parallaxController.update(100, 50);

    // G94: X com repeat (padrão) — o quad segue a câmera e só a textura rola;
    // o conteúdo anda câmera·(1−fator) = 50 (antes rolava em dobro).
    const map = (layerMesh.material as THREE.MeshBasicMaterial).map as THREE.Texture;
    expect(layerMesh.position.x).toBeCloseTo(100, 1);
    expect(layerMesh.position.x - map.offset.x * 100).toBeCloseTo(50, 1);
    // Y sem repeat: o quad se move câmera·(1−fator).
    expect(layerMesh.position.y).toBeCloseTo(40, 1);
    expect(map).not.toBe(mockTexture); // clone próprio (G95)

    parallaxController.clear();
  });
});