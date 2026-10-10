// @vitest-environment jsdom

import * as THREE from "three";

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  Kernel,
  type Plugin,
  type PluginContext,
} from "@core";

import type {
  RenderContextPayload,
  ViewportDimensions,
} from "../src/contracts/render/types";
import { ThreeRenderEngine } from "../src/engine/render/internal/ThreeRenderEngine";
import { SceneGraphManager } from "../src/engine/render/internal/SceneGraphManager";
import { createRenderPlugin } from "../src/plugins/render/plugin";
import { RenderToken, type RenderFrameRenderer } from "../src/tokens/render";

class FakeRenderer {
  public readonly shadowMap = { enabled: false, type: 0 };
  public readonly renderLists = { dispose: (): void => {} };
  public outputColorSpace: unknown = null;
  public renderCalls = 0;
  public disposeCalls = 0;
  public lastSize: [number, number] = [0, 0];
  public viewport: [number, number, number, number] | null = null;
  public scissorTest = false;
  public onRender: ((scene: THREE.Scene, camera: THREE.Camera) => void) | null = null;

  public constructor(public readonly domElement: HTMLCanvasElement) {}
  public setPixelRatio(): void {}
  public setSize(width: number, height: number): void {
    this.lastSize = [width, height];
  }
  public setViewport(x: number, y: number, w: number, h: number): void {
    this.viewport = [x, y, w, h];
  }
  public setScissor(): void {}
  public setScissorTest(value: boolean): void {
    this.scissorTest = value;
  }
  public render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderCalls += 1;
    this.onRender?.(scene, camera);
  }
  public resetState(): void {}
  public setAnimationLoop(): void {}
  public dispose(): void {
    this.disposeCalls += 1;
  }
}

function setWindowMetric(key: "innerWidth" | "innerHeight" | "devicePixelRatio", value: number): void {
  Object.defineProperty(window, key, { configurable: true, value });
}

function createEngine(): { engine: ThreeRenderEngine; renderer: FakeRenderer } {
  let renderer: FakeRenderer | null = null;
  const engine = new ThreeRenderEngine(undefined, {
    hostWindow: window,
    hostDocument: document,
    rendererFactory: (canvas): THREE.WebGLRenderer => {
      renderer = new FakeRenderer(canvas);
      return renderer as unknown as THREE.WebGLRenderer;
    },
  });
  if (renderer === null) throw new Error("renderer");
  return { engine, renderer };
}

describe("render gaps (G22, G40–G44)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    setWindowMetric("innerWidth", 800);
    setWindowMetric("innerHeight", 600);
    setWindowMetric("devicePixelRatio", 1);
  });

  it("G40: interpola objetos marcados entre o tick anterior e o atual e restaura o transform", () => {
    const { engine, renderer } = createEngine();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    engine.addMeshToScene("cube", mesh);
    expect(engine.setInterpolated("cube", true)).toBe(true);
    expect(engine.setInterpolated("missing", true)).toBe(false);

    mesh.position.set(0, 0, 0);
    engine.captureInterpolationState(); // início do tick
    mesh.position.set(10, 0, 0); // o jogo move no tick

    let seenX = Number.NaN;
    renderer.onRender = (): void => {
      seenX = mesh.position.x;
    };
    engine.render(0.25, 1 / 60);
    expect(seenX).toBeCloseTo(2.5, 6);
    expect(mesh.position.x).toBe(10); // autoritativo restaurado

    engine.snapInterpolation("cube");
    engine.render(0.25, 1 / 60);
    expect(seenX).toBe(10);

    engine.setInterpolated("cube", false);
    engine.captureInterpolationState();
    mesh.position.set(20, 0, 0);
    engine.render(0.5, 1 / 60);
    expect(seenX).toBe(20);
    engine.dispose();
  });

  it("G41: o desenho acontece depois dos handlers síncronos de game.loop.render", async () => {
    const order: string[] = [];
    const state: { emit?: () => Promise<void>; value: number } = { value: 0 };
    const fakeEngine = {
      render: (): void => {
        order.push(`draw:${String(state.value)}`);
      },
      onViewportResize: (): (() => void) => () => {},
      onContextChange: (): (() => void) => () => {},
      getViewportDimensions: (): ViewportDimensions => ({ width: 1, height: 1, aspectRatio: 1, pixelRatio: 1 }),
      captureInterpolationState: (): void => {},
      setCameraMode: (): void => {},
      dispose: (): void => {},
    };
    const game: Plugin = {
      manifest: {
        id: "test.g41.game",
        name: "g41",
        version: "1.0.0",
        kind: "preloaded",
        dependsOn: [{ id: "game.render", range: "^1.0.0" }],
        permissions: { events: ["game.loop.render"] },
      },
      setup(ctx: PluginContext): void {
        ctx.events.on("game.loop.render", (): void => {
          state.value += 1; // ex.: câmera/jogo movendo a cena neste frame
          order.push(`handler:${String(state.value)}`);
        });
        state.emit = (): Promise<void> =>
          ctx.events.emitAsync("game.loop.render", { alphaInterpolation: 0, deltaSeconds: 0.016, realDeltaSeconds: 0.016, isPaused: false });
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(createRenderPlugin(() => fakeEngine as unknown as ThreeRenderEngine));
    kernel.register(game);
    await kernel.boot();
    await state.emit?.();
    expect(order).toEqual(["handler:1", "draw:1"]);
    await kernel.stop();
  });

  it("G42: libera Points/Line/Sprite, preserva recursos compartilhados e respeita renderRetain/disposeResources:false", () => {
    const graph = new SceneGraphManager();
    const disposed = new Set<string>();
    const track = <T extends { dispose(): void }>(name: string, resource: T): T => {
      const original = resource.dispose.bind(resource);
      resource.dispose = (): void => {
        disposed.add(name);
        original();
      };
      return resource;
    };

    const pointsGeometry = track("pointsGeometry", new THREE.BufferGeometry());
    const pointsMaterial = track("pointsMaterial", new THREE.PointsMaterial());
    graph.addMesh("points", new THREE.Points(pointsGeometry, pointsMaterial));
    const lineGeometry = track("lineGeometry", new THREE.BufferGeometry());
    graph.addMesh("line", new THREE.Line(lineGeometry, track("lineMaterial", new THREE.LineBasicMaterial())));
    const spriteMap = track("spriteMap", new THREE.Texture());
    const sprite = new THREE.Sprite(track("spriteMaterial", new THREE.SpriteMaterial({ map: spriteMap })));
    const sharedSpriteGeometry = track("sharedSpriteGeometry", sprite.geometry);
    graph.addMesh("sprite", sprite);

    const sharedGeometry = track("sharedGeometry", new THREE.BoxGeometry());
    const sharedMaterial = track("sharedMaterial", new THREE.MeshBasicMaterial());
    graph.addMesh("a", new THREE.Mesh(sharedGeometry, sharedMaterial));
    graph.addMesh("b", new THREE.Mesh(sharedGeometry, sharedMaterial));

    const cachedGeometry = track("cachedGeometry", new THREE.BoxGeometry());
    cachedGeometry.userData.renderRetain = true;
    graph.addMesh("cached", new THREE.Mesh(cachedGeometry, track("cachedOwnMaterial", new THREE.MeshBasicMaterial())));
    const keptGeometry = track("keptGeometry", new THREE.BoxGeometry());
    graph.addMesh("kept", new THREE.Mesh(keptGeometry, new THREE.MeshBasicMaterial()));

    graph.removeMesh("points");
    graph.removeMesh("line");
    graph.removeMesh("sprite");
    expect(disposed).toEqual(new Set(["pointsGeometry", "pointsMaterial", "lineGeometry", "lineMaterial", "spriteMaterial", "spriteMap"]));
    expect(disposed.has("sharedSpriteGeometry")).toBe(false);
    void sharedSpriteGeometry;

    graph.removeMesh("a");
    expect(disposed.has("sharedGeometry")).toBe(false);
    expect(disposed.has("sharedMaterial")).toBe(false);
    graph.removeMesh("b");
    expect(disposed.has("sharedGeometry")).toBe(true);
    expect(disposed.has("sharedMaterial")).toBe(true);

    graph.removeMesh("cached");
    expect(disposed.has("cachedGeometry")).toBe(false);
    expect(disposed.has("cachedOwnMaterial")).toBe(true);

    graph.removeMesh("kept", false);
    expect(disposed.has("keptGeometry")).toBe(false);
    graph.dispose();
  });

  it("G42: InstancedMesh libera buffers de instância", () => {
    const graph = new SceneGraphManager();
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4);
    let instanceDisposed = false;
    instanced.addEventListener("dispose", () => {
      instanceDisposed = true;
    });
    graph.addMesh("inst", instanced);
    graph.removeMesh("inst");
    expect(instanceDisposed).toBe(true);
    graph.dispose();
  });

  it("G43: near/far/fov/ortho size persistem entre resizes; viewport rect e autoResize", () => {
    const { engine, renderer } = createEngine();
    engine.configurePerspectiveCamera({ fov: 45, near: 0.5, far: 5000 });
    engine.configureOrthographicCamera({ size: 3, near: 1, far: 200 });
    window.dispatchEvent(new Event("resize"));
    let settings = engine.getCameraSettings();
    expect(settings.perspective).toMatchObject({ fov: 45, near: 0.5, far: 5000 });
    expect(settings.orthographic).toMatchObject({ size: 3, near: 1, far: 200 });
    expect(() => engine.configurePerspectiveCamera({ near: 10, far: 5 })).toThrow(RangeError);

    engine.setCameraMode("orthographic");
    const ortho = engine.getActiveCamera() as THREE.OrthographicCamera;
    expect(ortho.top).toBe(3);
    expect(ortho.right).toBeCloseTo(3 * (800 / 600), 6);

    // Sub-retângulo: metade esquerda do canvas → aspect 400/600.
    engine.setViewportOptions({ rect: { x: 0, y: 0, width: 0.5, height: 1 } });
    expect(renderer.viewport).toEqual([0, 0, 400, 600]);
    expect(renderer.scissorTest).toBe(true);
    settings = engine.getCameraSettings();
    expect(settings.perspective.aspect).toBeCloseTo(400 / 600, 6);
    expect(() => engine.setViewportOptions({ rect: { x: 0.8, y: 0, width: 0.5, height: 1 } })).toThrow(RangeError);

    // autoResize none: resize da janela não sobrescreve o tamanho manual.
    engine.setViewportOptions({ autoResize: "none", maxPixelRatio: 3 });
    engine.resize(320, 240, 3);
    setWindowMetric("innerWidth", 1920);
    window.dispatchEvent(new Event("resize"));
    expect(engine.getViewportDimensions()).toMatchObject({ width: 320, height: 240, pixelRatio: 3 });

    engine.setViewportOptions({ rect: null, autoResize: "window" });
    expect(renderer.scissorTest).toBe(false);
    expect(engine.getViewportDimensions().width).toBe(1920);
    engine.dispose();
  });

  it("G43: game.render.resize é emitido no boot", async () => {
    const resizes: ViewportDimensions[] = [];
    const listener: Plugin = {
      manifest: {
        id: "test.g43.listener",
        name: "g43",
        version: "1.0.0",
        kind: "preloaded",
        dependsOn: [{ id: "game.render", range: "^1.0.0" }],
      },
      setup(ctx: PluginContext): void {
        ctx.events.on<"game.render.resize", ViewportDimensions>("game.render.resize", (event): void => {
          resizes.push(event.payload);
        });
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(createRenderPlugin(() => createEngine().engine));
    kernel.register(listener);
    await kernel.boot();
    await kernel.__internal().state.emitQueue.drain();
    expect(resizes).toEqual([{ width: 800, height: 600, aspectRatio: 800 / 600, pixelRatio: 1 }]);
    await kernel.stop();
  });

  it("G44: dispose pelo token é no-op e perda de contexto vira evento", async () => {
    const created: { engine?: ThreeRenderEngine; renderer?: FakeRenderer } = {};
    const lost: RenderContextPayload[] = [];
    const restored: RenderContextPayload[] = [];
    const consumer: { api?: ReturnType<PluginContext["caps"]["require"]> } = {};
    const game: Plugin = {
      manifest: {
        id: "test.g44.game",
        name: "g44",
        version: "1.0.0",
        kind: "preloaded",
        dependsOn: [{ id: "game.render", range: "^1.0.0" }],
        permissions: { capabilities: [RenderToken.id] },
        capabilities: { consumes: [{ id: RenderToken.id, range: "^1.0.0" }] },
        lifecycleHooks: {
          onBoot: (ctx: PluginContext): void => {
            consumer.api = ctx.caps.require(RenderToken);
          },
        },
      },
      setup(ctx: PluginContext): void {
        ctx.events.on<"game.render.context-lost", RenderContextPayload>("game.render.context-lost", (event): void => {
          lost.push(event.payload);
        });
        ctx.events.on<"game.render.context-restored", RenderContextPayload>("game.render.context-restored", (event): void => {
          restored.push(event.payload);
        });
        ctx.lifecycle.ready();
      },
    };
    const kernel = new Kernel();
    kernel.register(
      createRenderPlugin(() => {
        const result = createEngine();
        created.engine = result.engine;
        created.renderer = result.renderer;
        return result.engine;
      }),
    );
    kernel.register(game);
    await kernel.boot();
    const api = consumer.api as unknown as { dispose(): void; render(a: number, d: number): void; isContextLost(): boolean };
    api.dispose();
    expect(created.renderer?.disposeCalls).toBe(0);
    api.render(0, 0);
    expect(created.renderer?.renderCalls).toBe(1);

    const canvas = created.engine?.getCanvas() as HTMLCanvasElement;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(api.isContextLost()).toBe(true);
    api.render(0, 0);
    expect(created.renderer?.renderCalls).toBe(1);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    await kernel.__internal().state.emitQueue.drain();
    expect(lost).toEqual([{ contextLost: true }]);
    expect(restored).toEqual([{ contextLost: false }]);

    await kernel.stop();
    expect(created.renderer?.disposeCalls).toBe(1);
  });

  it("G22: luz direcional com alvo/área de sombra, foco de sombra e luzes extras", () => {
    const graph = new SceneGraphManager();
    graph.setDirectionalLight({
      color: 0xffffff,
      intensity: 1,
      position: { x: 10, y: 20, z: 10 },
      castShadow: true,
      target: { x: 0, y: 0, z: 0 },
      shadowAreaSize: 60,
      shadowMapSize: 2048,
      shadowFar: 200,
    });
    const light = graph.getDirectionalLight();
    expect(light.shadow.camera.right).toBe(60);
    expect(light.shadow.camera.far).toBe(200);
    expect(light.shadow.mapSize.x).toBe(2048);
    expect(graph.getScene().children).toContain(light.target);

    graph.setShadowFocus({ x: 500, y: 0, z: -300 });
    expect(light.target.position.toArray()).toEqual([500, 0, -300]);
    expect(light.position.toArray()).toEqual([510, 20, -290]);

    graph.addLight("lamp", { type: "point", position: { x: 1, y: 2, z: 3 }, intensity: 5, distance: 10 });
    graph.addLight("sun2", { type: "spot", target: { x: 0, y: -1, z: 0 }, castShadow: true, shadowMapSize: 512 });
    expect(graph.getScene().children.filter((c) => c instanceof THREE.PointLight)).toHaveLength(1);
    expect(graph.removeLight("lamp")).toBe(true);
    expect(graph.removeLight("lamp")).toBe(false);
    expect(() => graph.addLight("bad", { type: "nope" as "point" })).toThrow(RangeError);
    graph.dispose();
  });

  it("frame renderer substitui o desenho e recebe o tamanho", () => {
    const { engine, renderer } = createEngine();
    const calls: string[] = [];
    const frameRenderer: RenderFrameRenderer = {
      render: (_r, _s, _c, delta): void => {
        calls.push(`render:${delta.toFixed(3)}`);
      },
      setSize: (w, h, pr): void => {
        calls.push(`size:${String(w)}x${String(h)}@${String(pr)}`);
      },
    };
    engine.setFrameRenderer(frameRenderer);
    engine.render(0, 0.016);
    expect(renderer.renderCalls).toBe(0);
    expect(calls).toEqual(["size:800x600@1", "render:0.016"]);
    engine.setFrameRenderer(null);
    engine.render(0, 0.016);
    expect(renderer.renderCalls).toBe(1);
    engine.dispose();
  });
});
