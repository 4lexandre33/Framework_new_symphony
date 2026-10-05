import * as THREE from "three";

import type { Render3DApi } from "../../../tokens/render";
import type {
  AmbientLightConfig,
  CameraMode,
  DirectionalLightConfig,
  Vector3D,
  ViewportDimensions,
} from "../../../contracts/render/types";

import { CameraManager } from "./CameraManager";
import { SceneGraphManager } from "./SceneGraphManager";
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

  private readonly contextLostHandler = (event: Event): void => {
    if (this.disposed) {
      return;
    }

    event.preventDefault();
    this.contextLost = true;
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
    _alphaInterpolation: number,
    _deltaSeconds: number,
  ): void {
    if (
      this.disposed ||
      this.contextLost
    ) {
      return;
    }

    const activeCamera =
      this.cameraManager.getActiveCamera();

    this.renderer.render(
      this.sceneGraphManager.getScene(),
      activeCamera,
    );
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

  public addMeshToScene(
    key: string,
    object: THREE.Object3D,
  ): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.addMesh(
      key,
      object,
    );
  }

  public removeMeshFromScene(key: string): void {
    if (this.disposed) {
      return;
    }

    this.sceneGraphManager.removeMesh(key);
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

    this.cameraManager.updateAspect(
      dimensions,
    );
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
