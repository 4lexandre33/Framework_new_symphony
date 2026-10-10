/**
 * Verificação visual em WebGL REAL (Chromium/SwiftShader) dos gaps de
 * render, câmera, vfx e sprites. Empacotado por esbuild e injetado na
 * página por `tests/browser/render-vfx-sprites.mjs`. Não roda no vitest.
 */
import * as THREE from "three";

import { Kernel, type Plugin, type PluginContext } from "@core";

import { ThreeRenderEngine } from "../../src/engine/render/internal/ThreeRenderEngine";
import { createRenderPlugin } from "../../src/plugins/render/plugin";
import { GPUParticleEmitter } from "../../src/engine/vfx/internal/GPUParticleSystem";
import { PostFXComposer } from "../../src/engine/vfx/internal/PostFXComposer";
import { PostProcessingPipeline } from "../../src/engine/vfx/internal/PostProcessingPipeline";
import { DecalManager } from "../../src/engine/vfx/internal/DecalManager";
import { TextureAtlasParser } from "../../src/engine/sprites/internal/TextureAtlasParser";
import { InstancedTilemapRenderer } from "../../src/engine/sprites/internal/InstancedTilemapRenderer";
import { Sprite2DRenderer } from "../../src/engine/sprites/internal/Sprite2DRenderer";
import { ParallaxController } from "../../src/engine/sprites/internal/ParallaxController";
import { CameraService } from "../../src/engine/camera/internal/CameraService";
import type { Render3DApi } from "../../src/tokens/render";
import type { PhysicsApi } from "../../src/tokens/physics";

type Result = Record<string, unknown>;

// about:blank (setContent) não é contexto seguro: sem crypto.randomUUID, que o Kernel usa.
if (typeof crypto.randomUUID !== "function") {
  (crypto as unknown as { randomUUID: () => string }).randomUUID = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
type Pixel = [number, number, number, number];

const SIZE = 64;

function makeRenderer(size = SIZE): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.debug.checkShaderErrors = true;
  return renderer;
}

function readPixel(renderer: THREE.WebGLRenderer, x: number, y: number): Pixel {
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
}

function programErrors(renderer: THREE.WebGLRenderer): number {
  let errors = 0;
  for (const program of renderer.info.programs ?? []) {
    const diag = (program as unknown as { diagnostics?: { runnable: boolean } }).diagnostics;
    if (diag !== undefined && !diag.runnable) errors += 1;
  }
  return errors;
}

function captureConsole(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(" ").slice(0, 300));
  };
  return { errors, restore: (): void => { console.error = original; } };
}

const isRed = (p: Pixel): boolean => p[0] > 200 && p[1] < 60 && p[2] < 60;
const isGreen = (p: Pixel): boolean => p[1] > 200 && p[0] < 60 && p[2] < 60;
const isBlue = (p: Pixel): boolean => p[2] > 200 && p[0] < 60 && p[1] < 60;

function check(name: string, ok: boolean, details: Result): Result {
  return { name, ok, ...details };
}

function dataTexture(pixels: number[], width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(pixels), width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

// ── VFX ──────────────────────────────────────────────────────────────────

function particles(): Result {
  const renderer = makeRenderer();
  const cap = captureConsole();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  const emitter = new GPUParticleEmitter({
    emitterId: "check", maxParticles: 64, spawnRatePerSecond: 0, burstCount: 64,
    particleLifetimeSeconds: 10, startSize: 1, endSize: 1,
    startColor: { r: 1, g: 0, b: 0, a: 1 }, endColor: { r: 1, g: 0, b: 0, a: 1 },
    position: { x: 0, y: 0, z: 0 }, velocityBase: { x: 0, y: 0, z: 0 }, velocityVariance: { x: 0, y: 0, z: 0 }, gravityScale: 0,
  });
  emitter.update(0.016);
  scene.add(emitter.mesh);
  renderer.render(scene, camera);
  const center = readPixel(renderer, 32, 32);
  // Move o emissor: novas partículas nascem em x=+1.5 (lado direito da tela).
  emitter.setPosition(1.5, 0, 0);
  emitter.burst(64);
  emitter.update(0.016);
  renderer.render(scene, camera);
  const right = readPixel(renderer, 32 + 15, 32);
  const errors = programErrors(renderer);
  emitter.dispose();
  renderer.dispose();
  cap.restore();
  return check("G88/G19 partículas visíveis e emissor móvel", isRed(center) && isRed(right) && errors === 0 && cap.errors.length === 0, { center, right, programErrors: errors, consoleErrors: cap.errors });
}

function postFx(config: Record<string, unknown>, lut: THREE.Texture | null = null): { pixels: Record<string, Pixel>; passes: string[]; errors: number } {
  const renderer = makeRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const pipeline = new PostProcessingPipeline();
  pipeline.updateConfig(config);
  const composer = new PostFXComposer(pipeline, () => lut);
  composer.setSize(SIZE, SIZE, 1);
  composer.render(renderer, scene, camera, 0.016);
  const pixels = { center: readPixel(renderer, 32, 32), nearEdge: readPixel(renderer, 32, 44), corner: readPixel(renderer, 1, 1), mid: readPixel(renderer, 32, 52) };
  const passes = composer.getBuiltPassNames();
  const errors = programErrors(renderer);
  composer.dispose();
  renderer.dispose();
  return { pixels, passes, errors };
}

function postProcessing(): Result[] {
  const cap = captureConsole();
  const none = postFx({ enableBloom: false, vignetteIntensity: 0 });
  const bloom = postFx({ enableBloom: true, bloomStrength: 2, bloomThreshold: 0, bloomRadius: 0.5, vignetteIntensity: 0 });
  const grey = postFx({ enableBloom: false, vignetteIntensity: 0 });
  const vignette = postFx({ enableBloom: false, vignetteIntensity: 1 });
  const ssao = postFx({ enableBloom: false, vignetteIntensity: 0, enableSSAO: true });
  const n = 16;
  const lutData: number[] = [];
  for (let i = 0; i < n * n * n; i += 1) lutData.push(255, 0, 0, 255);
  const lut = postFx({ enableBloom: false, vignetteIntensity: 0, enableColorGrading: true, lutTextureUrl: "lut" }, dataTexture(lutData, n * n, n));
  const aberration = postFx({ enableBloom: false, vignetteIntensity: 0, chromaticAberrationOffset: 0.05 });
  cap.restore();
  const brightness = (p: Pixel): number => p[0] + p[1] + p[2];
  return [
    check("G9 sem passes = imagem base", isWhiteish(none.pixels.center) && brightness(none.pixels.nearEdge) === 0, { ...none }),
    check("G9 bloom espalha luz para fora do cubo", bloom.passes.includes("bloom") && brightness(bloom.pixels.nearEdge) > brightness(none.pixels.nearEdge) + 30 && bloom.errors === 0, { bloomNearEdge: bloom.pixels.nearEdge, baseNearEdge: none.pixels.nearEdge, passes: bloom.passes }),
    check("G9 vinheta escurece só os cantos", vignette.passes.includes("vignette") && isWhiteish(vignette.pixels.center) && brightness(vignette.pixels.corner) <= brightness(grey.pixels.corner), { center: vignette.pixels.center, corner: vignette.pixels.corner }),
    check("G9 SSAO roda sem erro de shader", ssao.passes.includes("ssao") && ssao.errors === 0 && isWhiteish(ssao.pixels.center), { passes: ssao.passes, center: ssao.pixels.center, errors: ssao.errors }),
    check("G9 color grading por LUT (LUT todo vermelho)", lut.passes.includes("color-grading") && isRed(lut.pixels.center) && lut.errors === 0, { center: lut.pixels.center, passes: lut.passes }),
    check("G9 aberração cromática compila e desenha", aberration.passes.includes("vignette") && aberration.errors === 0, { center: aberration.pixels.center }),
    check("G9 sem erros no console", cap.errors.length === 0, { consoleErrors: cap.errors }),
  ];
}

function isWhiteish(p: Pixel): boolean {
  return p[0] > 200 && p[1] > 200 && p[2] > 200;
}

function decal(): Result {
  const renderer = makeRenderer();
  const cap = captureConsole();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: 0x222222 })));
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  const decals = new DecalManager();
  decals.projectDecal(
    { decalId: "hit", textureUrl: "x", position: { x: 0, y: 0, z: 1 }, orientationNormal: { x: 0, y: 0, z: 1 }, size: { x: 0.5, y: 0.5, z: 1 } },
    dataTexture([255, 255, 0, 255], 1, 1),
    scene,
  );
  renderer.render(scene, camera);
  const center = readPixel(renderer, 32, 32);
  const outside = readPixel(renderer, 32, 32 + 12); // na face, fora do decal
  const projected = decals.getDecal("hit")?.projected === true;
  decals.clear(scene);
  const errors = programErrors(renderer);
  renderer.dispose();
  cap.restore();
  return check("G90 decal projetado na face do cubo", projected && center[0] > 200 && center[1] > 200 && center[2] < 60 && outside[0] < 80 && errors === 0, { center, outside, projected, errors });
}

// ── SPRITES ──────────────────────────────────────────────────────────────

const ATLAS_RG = {
  frames: {
    tile_0: { filename: "tile_0", frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 }, sourceSize: { w: 1, h: 1 } },
    tile_1: { filename: "tile_1", frame: { x: 1, y: 0, w: 1, h: 1 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 }, sourceSize: { w: 1, h: 1 } },
  },
  meta: { image: "atlas.png", size: { w: 2, h: 1 }, scale: "1" },
};

function ortho(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  return camera;
}

function tilemap(): Result {
  const renderer = makeRenderer();
  const cap = captureConsole();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 1);
  const atlas = dataTexture([255, 0, 0, 255, 0, 255, 0, 255], 2, 1);
  atlas.magFilter = THREE.LinearFilter;
  const parser = new TextureAtlasParser();
  parser.parseAtlas("atlas", ATLAS_RG, atlas);
  const tiles = new InstancedTilemapRenderer(parser);
  scene.add(tiles.renderTilemap({ layerId: "ground", atlasUrl: "atlas", tileMatrix: { width: 2, height: 1, tileSize: 1, tiles: [0, 1] }, position: { x: -1, y: 0.5, z: 0 } }, parser.getAtlasTexture("atlas")));
  renderer.render(scene, ortho());
  const left = readPixel(renderer, 16, 32);
  const right = readPixel(renderer, 48, 32);
  const above = readPixel(renderer, 32, 60);
  const errors = programErrors(renderer);
  tiles.clear();
  parser.clear();
  renderer.dispose();
  cap.restore();
  return check("G93 cada tile mostra o seu frame (G95: filtro do atlas original intacto)", isRed(left) && isGreen(right) && isBlue(above) && atlas.magFilter === THREE.LinearFilter && errors === 0, { left, right, above, errors, consoleErrors: cap.errors });
}

function spriteRotatedAndAnimated(): Result {
  const renderer = makeRenderer();
  const cap = captureConsole();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 1);
  // Atlas 2x2; linha de cima = [vermelho, verde]. Sprite 1x2 girado ocupa essa linha.
  const atlas = dataTexture([0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255], 2, 2);
  const parser = new TextureAtlasParser();
  parser.parseAtlas("atlas", {
    frames: {
      hero: { filename: "hero", frame: { x: 0, y: 0, w: 1, h: 2 }, rotated: true, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 1, h: 2 }, sourceSize: { w: 1, h: 2 } },
      red: { filename: "red", frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 }, sourceSize: { w: 1, h: 1 } },
      green: { filename: "green", frame: { x: 1, y: 0, w: 1, h: 1 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 }, sourceSize: { w: 1, h: 1 } },
    },
    meta: { image: "atlas.png", size: { w: 2, h: 2 }, scale: "1" },
  }, atlas);
  const sprites = new Sprite2DRenderer(parser);
  // Altura 2 (pixelsPerUnit 1): preenche a tela verticalmente.
  scene.add(sprites.spawnSprite({ spriteId: "hero", atlasUrl: "atlas", frameName: "hero", position: { x: 0, y: 0 }, pixelsPerUnit: 1 }, parser.getAtlasTexture("atlas")));
  renderer.render(scene, ortho());
  const top = readPixel(renderer, 32, 48);
  const bottom = readPixel(renderer, 32, 16);
  const sideOfNarrowSprite = readPixel(renderer, 4, 32);

  sprites.spawnSprite({ spriteId: "hero", atlasUrl: "atlas", frameName: "red", position: { x: 0, y: 0 }, pixelsPerUnit: 0.5 }, parser.getAtlasTexture("atlas"));
  const anim = sprites.getSprite("hero") as THREE.Mesh;
  scene.add(anim);
  sprites.playAnimation("hero", { name: "blink", frames: ["red", "green"], frameRate: 10, loop: true });
  renderer.render(scene, ortho());
  const frame0 = readPixel(renderer, 32, 32);
  sprites.update(0.1, null);
  renderer.render(scene, ortho());
  const frame1 = readPixel(renderer, 32, 32);
  sprites.update(0, null); // pausado
  renderer.render(scene, ortho());
  const paused = readPixel(renderer, 32, 32);
  const errors = programErrors(renderer);
  sprites.clear();
  parser.clear();
  renderer.dispose();
  cap.restore();
  return check(
    "G94 frame girado desvirado, tamanho pelo frame e animação (pausa congela)",
    isGreen(top) && isRed(bottom) && isBlue(sideOfNarrowSprite) && isRed(frame0) && isGreen(frame1) && isGreen(paused) && errors === 0,
    { top, bottom, sideOfNarrowSprite, frame0, frame1, paused, errors },
  );
}

function parallax(): Result {
  const renderer = makeRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 1);
  // Textura 2x1: metade esquerda vermelha, direita verde; camada 2x2 com repeat.
  const texture = dataTexture([255, 0, 0, 255, 0, 255, 0, 255], 2, 1);
  const controller = new ParallaxController();
  const layer = controller.createLayer({ layerId: "bg", textureUrl: "x", factorX: 0.5, factorY: 0, width: 2, height: 2, depthZ: -1 }, texture);
  scene.add(layer);
  const camera = ortho();
  controller.update(0, 0);
  renderer.render(scene, camera);
  const before = readPixel(renderer, 16, 32);
  // Câmera anda 2 unidades: com fator 0,5 o conteúdo anda 1 (meia tela) → lado esquerdo vira verde.
  camera.position.x = 2;
  controller.update(2, 0);
  renderer.render(scene, camera);
  const after = readPixel(renderer, 16, 32);
  controller.clear();
  renderer.dispose();
  return check("G94 parallax rola uma vez (fator 0,5) com textura repetida", isRed(before) && isGreen(after) && texture.wrapS === THREE.ClampToEdgeWrapping, { before, after });
}

// ── RENDER (engine real) ─────────────────────────────────────────────────

function createEngine(): { engine: ThreeRenderEngine; renderer: THREE.WebGLRenderer } {
  let created: THREE.WebGLRenderer | null = null;
  const engine = new ThreeRenderEngine(undefined, {
    rendererFactory: (canvas) => {
      created = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });
      return created;
    },
  });
  engine.setViewportOptions({ autoResize: "none" });
  engine.resize(SIZE, SIZE, 1);
  engine.setAmbientLight({ color: 0xffffff, intensity: 1 });
  engine.setDirectionalLight({ color: 0xffffff, intensity: 0, position: { x: 1, y: 1, z: 1 }, castShadow: false });
  const scene = engine.getScene();
  scene.background = new THREE.Color(0, 0, 1);
  engine.configurePerspectiveCamera({ position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 } });
  return { engine, renderer: created as unknown as THREE.WebGLRenderer };
}

function redBox(size = 1): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
}

function interpolation(): Result {
  const { engine, renderer } = createEngine();
  const box = redBox(0.5);
  engine.addMeshToScene("box", box);
  engine.setInterpolated("box", true);
  box.position.set(-2, 0, 0);
  engine.captureInterpolationState();
  box.position.set(2, 0, 0);
  engine.render(0.5, 1 / 60); // metade: no centro
  const center = readPixel(renderer, 32, 32);
  const authoritative = box.position.x;
  engine.dispose();
  return check("G40 interpolação desenha no meio do caminho e restaura", isRed(center) && authoritative === 2, { center, authoritative });
}

async function drawAfterHandlers(): Promise<Result> {
  const holder: { engine?: ThreeRenderEngine; renderer?: THREE.WebGLRenderer; emit?: () => Promise<void> } = {};
  const box = redBox(0.5);
  const game: Plugin = {
    manifest: { id: "browser.game", name: "g", version: "1.0.0", kind: "preloaded", dependsOn: [{ id: "game.render", range: "^1.0.0" }], permissions: { events: ["game.loop.render"] } },
    setup(ctx: PluginContext): void {
      ctx.events.on("game.loop.render", (): void => {
        box.position.set(0, 0, 0); // move no handler do frame
      });
      holder.emit = (): Promise<void> => ctx.events.emitAsync("game.loop.render", { alphaInterpolation: 0, deltaSeconds: 0.016, realDeltaSeconds: 0.016, isPaused: false });
      ctx.lifecycle.ready();
    },
  };
  const kernel = new Kernel();
  kernel.register(createRenderPlugin(() => {
    const created = createEngine();
    holder.engine = created.engine;
    holder.renderer = created.renderer;
    return created.engine;
  }));
  kernel.register(game);
  await kernel.boot();
  box.position.set(3, 0, 0);
  holder.engine?.addMeshToScene("box", box);
  await holder.emit?.();
  const center = readPixel(holder.renderer as THREE.WebGLRenderer, 32, 32);
  await kernel.stop();
  return check("G41 mudança feita no handler de render aparece no MESMO frame", isRed(center), { center });
}

function cameraParams(): Result {
  const { engine, renderer } = createEngine();
  const box = redBox(1);
  box.position.set(0, 0, -20); // distância 25 da câmera
  engine.addMeshToScene("far", box);
  engine.configurePerspectiveCamera({ far: 10 });
  engine.render(0, 0);
  const clipped = readPixel(renderer, 32, 32);
  engine.configurePerspectiveCamera({ far: 100, fov: 10 });
  engine.render(0, 0);
  const visibleNarrowFov = readPixel(renderer, 32, 32);
  const nearEdgeNarrow = readPixel(renderer, 32, 37); // fov 10 → cubo ~15px na tela (fov 60 daria ~2px)
  box.position.set(0, 0, 0);
  engine.configurePerspectiveCamera({ fov: 60 });
  renderer.setClearColor(0x000000, 1);
  renderer.clear(); // limpa o canvas inteiro antes de recortar
  engine.setViewportOptions({ rect: { x: 0, y: 0, width: 0.5, height: 1 } });
  engine.render(0, 0);
  const leftHalfCenter = readPixel(renderer, 16, 32);
  const rightHalf = readPixel(renderer, 48, 32);
  engine.setViewportOptions({ rect: null });
  engine.setCameraMode("orthographic");
  engine.configureOrthographicCamera({ size: 0.25, position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 } });
  engine.render(0, 0);
  const orthoZoomedCorner = readPixel(renderer, 2, 2); // meia altura 0,25 < meio cubo → tela toda vermelha
  engine.dispose();
  return check(
    "G43 far/fov/viewport rect/ortho size têm efeito real",
    isBlue(clipped) && isRed(visibleNarrowFov) && isRed(nearEdgeNarrow) && isRed(leftHalfCenter) && rightHalf[0] < 30 && rightHalf[2] < 30 && isRed(orthoZoomedCorner),
    { clipped, visibleNarrowFov, nearEdgeNarrow, leftHalfCenter, rightHalf, orthoZoomedCorner },
  );
}

function engineFrameRenderer(): Result {
  const { engine, renderer } = createEngine();
  engine.addMeshToScene("box", redBox(0.6));
  const pipeline = new PostProcessingPipeline();
  pipeline.updateConfig({ enableBloom: true, bloomStrength: 2, bloomThreshold: 0, vignetteIntensity: 0 });
  const composer = new PostFXComposer(pipeline);
  engine.setFrameRenderer(composer);
  engine.render(0, 0.016);
  const nearEdge = readPixel(renderer, 32, 46);
  engine.setFrameRenderer(null);
  engine.render(0, 0.016);
  const nearEdgeNoFx = readPixel(renderer, 32, 46);
  composer.dispose();
  engine.dispose();
  return check("G9 composer instalado no ThreeRenderEngine desenha o bloom", nearEdge[0] > nearEdgeNoFx[0] + 30, { nearEdge, nearEdgeNoFx });
}

function cameraFollowsEntity(): Result {
  const { engine, renderer } = createEngine();
  const box = redBox(0.5);
  box.position.set(10, 0, 0);
  engine.addMeshToScene("box", box);
  const events: string[] = [];
  const ctx = { events: { emit: (type: string): void => { events.push(type); } } } as unknown as PluginContext;
  const physics = {
    castRay: () => ({ hit: false, distance: 0 }),
    getBodyTransformInto: (id: string, out: { position: { x: number; y: number; z: number } }): boolean => {
      if (id !== "hero") return false;
      out.position.x = 10; out.position.y = 0; out.position.z = 0;
      return true;
    },
  } as unknown as PhysicsApi;
  const camera = new CameraService(ctx);
  camera.bindDependencies(physics, engine as unknown as Render3DApi);
  camera.registerVirtualCamera({ id: "follow", priority: 0, fov: 60, position: { x: 0, y: 0, z: 5 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, followTargetId: "hero", lookAtTargetId: "hero" });
  camera.render(1 / 60);
  engine.render(0, 0);
  const center = readPixel(renderer, 32, 32);
  engine.dispose();
  return check("G47 câmera segue/olha a entidade por id", isRed(center) && events.includes("game.camera.state-changed"), { center, events });
}

(window as unknown as { runChecks: () => Promise<Result[]> }).runChecks = async (): Promise<Result[]> => {
  const results: Result[] = [];
  const syncChecks: Array<() => Result | Result[]> = [particles, postProcessing, decal, tilemap, spriteRotatedAndAnimated, parallax, interpolation, cameraParams, engineFrameRenderer, cameraFollowsEntity];
  for (const fn of syncChecks) {
    try {
      const value = fn();
      if (Array.isArray(value)) results.push(...value);
      else results.push(value);
    } catch (error) {
      results.push({ name: fn.name, ok: false, thrown: String(error), stack: (error as Error).stack?.slice(0, 600) });
    }
  }
  try {
    results.push(await drawAfterHandlers());
  } catch (error) {
    results.push({ name: "drawAfterHandlers", ok: false, thrown: String(error) });
  }
  return results;
};
