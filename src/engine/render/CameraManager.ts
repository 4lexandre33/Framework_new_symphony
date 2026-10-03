import * as THREE from "three";
import type {
  CameraMode,
  Vector3D,
  ViewportDimensions,
  PerspectiveCameraOptions,
  OrthographicCameraOptions,
} from "../../contracts/render/types";

export class CameraManager {
  private currentMode: CameraMode = "perspective";

  private readonly perspectiveCamera: THREE.PerspectiveCamera;
  private readonly orthographicCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.Camera;

  // Scratch vectors pré-alocados para evitar instanciação no loop (Zero GC)
  private readonly targetPositionScratch = new THREE.Vector3(0, 0, 0);
  private readonly desiredCameraPositionScratch = new THREE.Vector3(0, 5, 10);
  private readonly currentCameraPositionScratch = new THREE.Vector3(0, 5, 10);
  private readonly defaultOffsetScratch = new THREE.Vector3(0, 8, 12);

  public constructor(viewport: ViewportDimensions) {
    this.perspectiveCamera = new THREE.PerspectiveCamera(
      60,
      viewport.aspectRatio,
      0.1,
      1000
    );
    this.perspectiveCamera.position.set(0, 8, 12);
    this.perspectiveCamera.lookAt(0, 0, 0);

    const size = 10;
    const aspect = viewport.aspectRatio;
    this.orthographicCamera = new THREE.OrthographicCamera(
      -size * aspect,
      size * aspect,
      size,
      -size,
      0.1,
      1000
    );
    this.orthographicCamera.position.set(0, 15, 15);
    this.orthographicCamera.lookAt(0, 0, 0);

    this.activeCamera = this.perspectiveCamera;
  }

  public getActiveCamera(): THREE.Camera {
    return this.activeCamera;
  }

  public getMode(): CameraMode {
    return this.currentMode;
  }

  public setMode(mode: CameraMode, target?: Vector3D): void {
    this.currentMode = mode;

    if (mode === "orthographic") {
      this.activeCamera = this.orthographicCamera;
    } else {
      this.activeCamera = this.perspectiveCamera;
    }

    if (target) {
      this.setTarget(target);
    }
  }

  public setTarget(target: Vector3D): void {
    this.targetPositionScratch.set(target.x, target.y, target.z);
    this.activeCamera.lookAt(this.targetPositionScratch);
  }

  public updateFollowCamera(
    target: Vector3D,
    offset: Vector3D = { x: 0, y: 8, z: 12 },
    lerpFactor: number = 0.1
  ): void {
    if (this.currentMode !== "follow") return;

    this.targetPositionScratch.set(target.x, target.y, target.z);

    this.desiredCameraPositionScratch
      .copy(this.targetPositionScratch)
      .add(this.defaultOffsetScratch.set(offset.x, offset.y, offset.z));

    this.currentCameraPositionScratch.copy(this.activeCamera.position);
    this.currentCameraPositionScratch.lerp(this.desiredCameraPositionScratch, lerpFactor);

    this.activeCamera.position.copy(this.currentCameraPositionScratch);
    this.activeCamera.lookAt(this.targetPositionScratch);
  }

  public updateAspect(viewport: ViewportDimensions): void {
    this.perspectiveCamera.aspect = viewport.aspectRatio;
    this.perspectiveCamera.updateProjectionMatrix();

    const size = 10;
    const aspect = viewport.aspectRatio;
    this.orthographicCamera.left = -size * aspect;
    this.orthographicCamera.right = size * aspect;
    this.orthographicCamera.top = size;
    this.orthographicCamera.bottom = -size;
    this.orthographicCamera.updateProjectionMatrix();
  }

  public configurePerspective(options: Partial<PerspectiveCameraOptions>): void {
    if (options.fov !== undefined) this.perspectiveCamera.fov = options.fov;
    if (options.near !== undefined) this.perspectiveCamera.near = options.near;
    if (options.far !== undefined) this.perspectiveCamera.far = options.far;

    if (options.position) {
      this.perspectiveCamera.position.set(
        options.position.x,
        options.position.y,
        options.position.z
      );
    }

    if (options.target) {
      this.perspectiveCamera.lookAt(
        options.target.x,
        options.target.y,
        options.target.z
      );
    }

    this.perspectiveCamera.updateProjectionMatrix();
  }

  public configureOrthographic(options: Partial<OrthographicCameraOptions>): void {
    if (options.near !== undefined) this.orthographicCamera.near = options.near;
    if (options.far !== undefined) this.orthographicCamera.far = options.far;

    if (options.position) {
      this.orthographicCamera.position.set(
        options.position.x,
        options.position.y,
        options.position.z
      );
    }

    if (options.target) {
      this.orthographicCamera.lookAt(
        options.target.x,
        options.target.y,
        options.target.z
      );
    }

    this.orthographicCamera.updateProjectionMatrix();
  }
}