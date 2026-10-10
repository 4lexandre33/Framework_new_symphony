import * as THREE from "three";

import type {
  Render3DApi,
  RenderFrameRenderer,
} from "../../../tokens/render";
import type {
  AmbientLightConfig,
  CameraMode,
  DirectionalLightConfig,
  OrthographicCameraOptions,
  PerspectiveCameraOptions,
  RemoveMeshOptions,
  RenderCameraSettings,
  SceneLightConfig,
  Vector3D,
  ViewportDimensions,
  ViewportOptions,
  ViewportRect,
} from "../../../contracts/render/types";

import { CameraManager } from "./CameraManager";
import { SceneGraphManager } from "./SceneGraphManager";
import { TransformInterpolator } from "./TransformInterpolator";
import {
  ViewportManager,
  type ViewportResizeCallback,
} from "./ViewportManager";

export interface ThreeRenderEngineDependencies {
  readonly hostWindow?: Window;
  readonly hostDocument?: Document;
  readonly rendererFactory?: (
    canvas: HTMLCanvasElement,
  ) => THREE.WebGLRenderer;
}

interface CanvasResolution {
  readonly canvas: HTMLCanvasElement;
  readonly ownedByEngine: boolean;
}

const NOOP_DISPOSER = (): void => {};

/** true = contexto perdido; false = restaurado. */
export type RenderContextChangeCallback = (contextLost: boolean) => void;

interface MutableViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function assertUnitRect(rect: ViewportRect): void {
  const values = [rect.x, rect.y, rect.width, rect.height];

  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError("ViewportRect precisa conter valores finitos.");
    }
  }

  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1.000001 ||
    rect.y + rect.height > 1.000001
  ) {
    throw new RangeError(
      "ViewportRect é normalizado: 0 <= x,y; width,height > 0; x+width <= 1; y+height <= 1.",
    );
  }
}

function createWebGLRenderer(
  canvas: HTMLCanvasElement,
): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
    preserveDrawingBuffer: false,
  });
}

export class ThreeRenderEngine implements Render3DApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly viewportManager: ViewportManager;
  private readonly cameraManager: CameraManager;
  private readonly sceneGraphManager: SceneGraphManager;

  private readonly canvas: HTMLCanvasElement;
  private readonly ownsCanvas: boolean;

  private contextLost = false;
  private disposed = false;

  private readonly interpolator = new TransformInterpolator();
  private frameRenderer: RenderFrameRenderer | null = null;
  private readonly contextCallbacks = new Set<RenderContextChangeCallback>();

  // G43: sub-retângulo normalizado do canvas (null = canvas inteiro).
  private viewportRect: MutableViewportRect | null = null;
  private readonly effectiveDimensions: ViewportDimensions = {
    width: 1,
    height: 1,
    aspectRatio: 1,
    pixelRatio: 1,
  };

  private readonly contextLostHandler = (event: Event): void => {
    if (this.disposed) {
      return;
    }

    event.preventDefault();
    this.contextLost = true;
    this.notifyContextChange(true);
  };

  private readonly contextRestoredHandler = (): void => {
    if (this.disposed) {
      return;
    }

    this.contextLost = false;
    this.renderer.resetState();

    this.handleResize(
      this.viewportManager.getDimensions(),
    );
    this.notifyContextChange(false);
  };

  public constructor(
    canvasElement?: HTMLCanvasElement,
    dependencies: ThreeRenderEngineDependencies = {},
  ) {
    const hostWindow =
      dependencies.hostWindow ??
      this.requireWindow();

    const hostDocument =
      dependencies.hostDocument ??
      this.requireDocument();

    const resolution =
      this.resolveCanvas(
        canvasElement,
        hostDocument,
      );

    this.canvas = resolution.canvas;
    this.ownsCanvas = resolution.ownedByEngine;

    this.viewportManager = new ViewportManager(
      this.canvas,
      hostWindow,
    );

    const dimensions =
      this.viewportManager.getDimensions();

    const rendererFactory =
      dependencies.rendererFactory ??
      createWebGLRenderer;

    this.renderer =
      rendererFactory(this.canvas);

    this.renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.cameraManager =
      new CameraManager(
        dimensions,
      );

    this.sceneGraphManager =
      new SceneGraphManager();

    this.handleResize(dimensions);

    this.viewportManager.onResize(
      (updatedDimensions): void => {
        this.handleResize(
          updatedDimensions,
        );
      },
    );

    this.viewportManager.attachResizeListener();
    this.attachContextHandlers();
  }

  public render(
    alphaInterpolation: number,
    deltaSeconds: number,
  ): void {
    if (
      this.disposed ||
      this.contextLost
    ) {
      return;
    }

    const activeCamera =
      this.cameraManager.getActiveCamera();
    const scene =
      this.sceneGraphManager.getScene();

    // G40: transforms interpolados só durante o desenho.
    this.interpolator.apply(
      alphaInterpolation,
    );

    try {
      if (this.frameRenderer !== null) {
        this.frameRenderer.render(
          this.renderer,
          scene,
          activeCamera,
          deltaSeconds,
        );
      } else {
        this.renderer.render(
          scene,
          activeCamera,
        );
      }
    } finally {
      this.interpolator.restore();
    }
  }

  public resize(
    width: number,
    height: number,
    pixelRatio?: number,
  ): void {
    if (this.disposed) {
      return;
    }

    this.viewportManager.setManualSize(
      width,
      height,
      pixelRatio,
    );
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  public getActiveCamera(): THREE.Camera {
    return this.cameraManager.getActiveCamera();
  }

  public getScene(): THREE.Scene {
    return this.sceneGraphManager.getScene();
  }

  public getViewportDimensions(): ViewportDimensions {
    return this.viewportManager.getDimensions();
  }

  public setCameraMode(
    mode: CameraMode,
    target?: Vector3D,
  ): void {
    if (this.disposed) {
      return;
    }

    this.cameraManager.setMode(
      mode,
      target,
    );
  }

  public updateCameraTarget(
    target: Vector3D,
    offset?: Vector3D,
  ): void {
    if (this.disposed) {
      return;
    }

    this.cameraManager.updateFollowCamera(
      target,
      offset,
    );
  }

  public setAmbientLight(
    config: AmbientLightConfig,
  ): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.setAmbientLight(
      config,
    );
  }

  public setDirectionalLight(
    config: DirectionalLightConfig,
  ): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.setDirectionalLight(
      config,
    );
  }

  public setShadowFocus(center: Vector3D): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.setShadowFocus(center);
  }

  public addLight(
    lightId: string,
    config: SceneLightConfig,
  ): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.addLight(
      lightId,
      config,
    );
  }

  public removeLight(lightId: string): boolean {
    if (this.disposed) {
      return false;
    }

    return this.sceneGraphManager.removeLight(lightId);
  }

  public addMeshToScene(
    key: string,
    object: THREE.Object3D,
  ): void {
    if (this.disposed) {
      return;
    }

    const previous =
      this.sceneGraphManager.getMesh(key);

    this.sceneGraphManager.addMesh(
      key,
      object,
    );

    if (
      previous !== null &&
      previous !== object
    ) {
      this.interpolator.remove(previous);
    }
  }

  public removeMeshFromScene(
    key: string,
    options?: RemoveMeshOptions,
  ): void {
    if (this.disposed) {
      return;
    }

    const object =
      this.sceneGraphManager.getMesh(key);

    if (object !== null) {
      this.interpolator.remove(object);
    }

    this.sceneGraphManager.removeMesh(
      key,
      options?.disposeResources !== false,
    );
  }

  public getMeshFromScene(key: string): THREE.Object3D | null {
    return this.sceneGraphManager.getMesh(key);
  }

  public setInterpolated(
    key: string,
    enabled: boolean,
  ): boolean {
    if (this.disposed) {
      return false;
    }

    const object =
      this.sceneGraphManager.getMesh(key);

    if (object === null) {
      return false;
    }

    if (enabled) {
      this.interpolator.add(object);
    } else {
      this.interpolator.remove(object);
    }

    return true;
  }

  public snapInterpolation(key: string): void {
    const object =
      this.sceneGraphManager.getMesh(key);

    if (object !== null) {
      this.interpolator.snap(object);
    }
  }

  public captureInterpolationState(): void {
    if (this.disposed) {
      return;
    }

    this.interpolator.capture();
  }

  public configurePerspectiveCamera(
    options: Partial<PerspectiveCameraOptions>,
  ): void {
    if (this.disposed) {
      return;
    }

    this.cameraManager.configurePerspective(options);
  }

  public configureOrthographicCamera(
    options: Partial<OrthographicCameraOptions>,
  ): void {
    if (this.disposed) {
      return;
    }

    this.cameraManager.configureOrthographic(options);
  }

  public getCameraSettings(): RenderCameraSettings {
    return this.cameraManager.getSettings();
  }

  public setViewportOptions(options: ViewportOptions): void {
    if (this.disposed) {
      return;
    }

    if (options.rect !== undefined) {
      if (options.rect === null) {
        this.viewportRect = null;
        this.renderer.setScissorTest(false);
      } else {
        assertUnitRect(options.rect);
        this.viewportRect = {
          x: options.rect.x,
          y: options.rect.y,
          width: options.rect.width,
          height: options.rect.height,
        };
      }
    }

    // Reaplica tamanho/limites e notifica `game.render.resize`.
    this.viewportManager.setOptions(
      options.autoResize,
      options.maxPixelRatio,
    );
  }

  public getViewportRect(): ViewportRect | null {
    return this.viewportRect === null
      ? null
      : {
          x: this.viewportRect.x,
          y: this.viewportRect.y,
          width: this.viewportRect.width,
          height: this.viewportRect.height,
        };
  }

  public setFrameRenderer(
    frameRenderer: RenderFrameRenderer | null,
  ): void {
    if (this.disposed) {
      return;
    }

    this.frameRenderer = frameRenderer;

    if (frameRenderer !== null) {
      this.syncFrameRendererSize();
    }
  }

  public getFrameRenderer(): RenderFrameRenderer | null {
    return this.frameRenderer;
  }

  public isContextLost(): boolean {
    return this.contextLost;
  }

  /** Assina perda/restauração de contexto WebGL (G44). */
  public onContextChange(
    callback: RenderContextChangeCallback,
  ): () => void {
    if (this.disposed) {
      return NOOP_DISPOSER;
    }

    this.contextCallbacks.add(callback);

    return (): void => {
      this.contextCallbacks.delete(callback);
    };
  }

  public onViewportResize(
    callback: ViewportResizeCallback,
  ): () => void {
    if (this.disposed) {
      return NOOP_DISPOSER;
    }

    return this.viewportManager.onResize(
      callback,
    );
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    this.frameRenderer = null;
    this.contextCallbacks.clear();
    this.interpolator.clear();
    this.detachContextHandlers();
    this.viewportManager.dispose();
    this.sceneGraphManager.dispose();

    this.renderer.setAnimationLoop(null);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();

    if (
      this.ownsCanvas &&
      this.canvas.parentNode !== null
    ) {
      this.canvas.parentNode.removeChild(
        this.canvas,
      );
    }
  }

  private handleResize(
    dimensions: Readonly<ViewportDimensions>,
  ): void {
    if (this.disposed) {
      return;
    }

    this.renderer.setPixelRatio(
      dimensions.pixelRatio,
    );

    this.renderer.setSize(
      dimensions.width,
      dimensions.height,
      false,
    );

    const effective =
      this.effectiveDimensions;

    effective.pixelRatio = dimensions.pixelRatio;

    if (this.viewportRect === null) {
      effective.width = dimensions.width;
      effective.height = dimensions.height;
      effective.aspectRatio = dimensions.aspectRatio;
    } else {
      const rect = this.viewportRect;
      const x = Math.floor(rect.x * dimensions.width);
      const y = Math.floor(rect.y * dimensions.height);

      effective.width = Math.max(1, Math.floor(rect.width * dimensions.width));
      effective.height = Math.max(1, Math.floor(rect.height * dimensions.height));
      effective.aspectRatio = effective.width / effective.height;

      // setSize redefine o viewport para o canvas inteiro; reaplica o recorte.
      this.renderer.setViewport(x, y, effective.width, effective.height);
      this.renderer.setScissor(x, y, effective.width, effective.height);
      this.renderer.setScissorTest(true);
    }

    this.cameraManager.updateAspect(
      effective,
    );

    this.syncFrameRendererSize();
  }

  private syncFrameRendererSize(): void {
    const frameRenderer = this.frameRenderer;

    if (
      frameRenderer === null ||
      frameRenderer.setSize === undefined
    ) {
      return;
    }

    const effective =
      this.viewportRect === null
        ? this.viewportManager.getDimensions()
        : this.effectiveDimensions;

    frameRenderer.setSize(
      effective.width,
      effective.height,
      effective.pixelRatio,
    );
  }

  private notifyContextChange(contextLost: boolean): void {
    for (const callback of this.contextCallbacks) {
      callback(contextLost);
    }
  }

  private attachContextHandlers(): void {
    this.canvas.addEventListener(
      "webglcontextlost",
      this.contextLostHandler,
      false,
    );

    this.canvas.addEventListener(
      "webglcontextrestored",
      this.contextRestoredHandler,
      false,
    );
  }

  private detachContextHandlers(): void {
    this.canvas.removeEventListener(
      "webglcontextlost",
      this.contextLostHandler,
      false,
    );

    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.contextRestoredHandler,
      false,
    );
  }

  private resolveCanvas(
    canvasElement: HTMLCanvasElement | undefined,
    hostDocument: Document,
  ): CanvasResolution {
    if (canvasElement !== undefined) {
      return {
        canvas: canvasElement,
        ownedByEngine: false,
      };
    }

    const existing =
      hostDocument.getElementById(
        "three-canvas",
      );

    if (
      existing !== null &&
      existing.tagName.toLowerCase() === "canvas"
    ) {
      return {
        canvas:
          existing as HTMLCanvasElement,
        ownedByEngine:
          false,
      };
    }

    const canvas =
      hostDocument.createElement(
        "canvas",
      );

    canvas.id = "three-canvas";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = "0";

    const appContainer =
      hostDocument.getElementById(
        "app",
      ) ??
      hostDocument.body;

    appContainer.appendChild(canvas);

    return {
      canvas,
      ownedByEngine: true,
    };
  }

  private requireWindow(): Window {
    if (
      typeof window ===
      "undefined"
    ) {
      throw new Error(
        "ThreeRenderEngine requer Window em runtime desktop/browser.",
      );
    }

    return window;
  }

  private requireDocument(): Document {
    if (
      typeof document ===
      "undefined"
    ) {
      throw new Error(
        "ThreeRenderEngine requer Document em runtime desktop/browser.",
      );
    }

    return document;
  }
}
