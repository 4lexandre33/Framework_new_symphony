import * as THREE from "three";
import type { Render3DApi } from "../../tokens/render";
import type {
  CameraMode,
  Vector3D,
  ViewportDimensions,
  AmbientLightConfig,
  DirectionalLightConfig,
} from "../../contracts/render/types";
import { ViewportManager } from "./ViewportManager";
import { CameraManager } from "./CameraManager";
import { SceneGraphManager } from "./SceneGraphManager";

export class ThreeRenderEngine implements Render3DApi {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly viewportManager: ViewportManager;
  private readonly cameraManager: CameraManager;
  private readonly sceneGraphManager: SceneGraphManager;

  private isContextLost = false;

  public constructor(canvasElement?: HTMLCanvasElement) {
    const canvas = canvasElement || this.createDefaultCanvas();

    this.viewportManager = new ViewportManager(canvas);
    const dimensions = this.viewportManager.getDimensions();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
      preserveDrawingBuffer: false,
    });

    this.renderer.setSize(dimensions.width, dimensions.height, false);
    this.renderer.setPixelRatio(dimensions.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    
    // Configuração atualizada do ShadowMap para Three.js r160+
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.cameraManager = new CameraManager(dimensions);
    this.sceneGraphManager = new SceneGraphManager();

    this.viewportManager.attachResizeListener();
    this.viewportManager.onResize((updatedDimensions) => {
      this.handleResize(updatedDimensions);
    });

    this.setupContextLossHandlers(canvas);
  }

  public render(_alphaInterpolation: number, _deltaSeconds: number): void {
    if (this.isContextLost) return;

    const activeCamera = this.cameraManager.getActiveCamera();
    this.renderer.render(this.sceneGraphManager.getScene(), activeCamera);
  }

  public resize(width: number, height: number, pixelRatio?: number): void {
    this.viewportManager.setManualSize(width, height, pixelRatio);
  }

  public getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
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

  public setCameraMode(mode: CameraMode, target?: Vector3D): void {
    this.cameraManager.setMode(mode, target);
  }

  public updateCameraTarget(target: Vector3D, offset?: Vector3D): void {
    this.cameraManager.updateFollowCamera(target, offset);
  }

  public setAmbientLight(config: AmbientLightConfig): void {
    this.sceneGraphManager.setAmbientLight(config);
  }

  public setDirectionalLight(config: DirectionalLightConfig): void {
    this.sceneGraphManager.setDirectionalLight(config);
  }

  public addMeshToScene(key: string, object: THREE.Object3D): void {
    this.sceneGraphManager.addMesh(key, object);
  }

  public removeMeshFromScene(key: string): void {
    this.sceneGraphManager.removeMesh(key);
  }

  public dispose(): void {
    this.viewportManager.dispose();
    this.sceneGraphManager.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement && this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  private handleResize(dimensions: ViewportDimensions): void {
    this.renderer.setSize(dimensions.width, dimensions.height, false);
    this.renderer.setPixelRatio(dimensions.pixelRatio);
    this.cameraManager.updateAspect(dimensions);
  }

  private setupContextLossHandlers(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.isContextLost = true;
      console.warn("[ThreeRenderEngine] ⚠️ Contexto WebGL perdido!");
    });

    canvas.addEventListener("webglcontextrestored", () => {
      this.isContextLost = false;
      console.log("[ThreeRenderEngine] ✅ Contexto WebGL restaurado!");
      const dimensions = this.viewportManager.getDimensions();
      this.handleResize(dimensions);
    });
  }

  private createDefaultCanvas(): HTMLCanvasElement {
    let canvas = document.getElementById("three-canvas") as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "three-canvas";
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.zIndex = "0";

      const appContainer = document.getElementById("app") || document.body;
      appContainer.appendChild(canvas);
    }
    return canvas;
  }
}