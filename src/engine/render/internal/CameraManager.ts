import * as THREE from "three";

import type {
  CameraMode,
  OrthographicCameraOptions,
  PerspectiveCameraOptions,
  Vector3D,
  ViewportDimensions,
} from "../../../contracts/render/types";

const DEFAULT_FOLLOW_LERP = 0.1;
const DEFAULT_ORTHOGRAPHIC_HALF_SIZE = 10;

function assertFiniteVector(
  value: Vector3D,
  label: string,
): void {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.z)
  ) {
    throw new RangeError(`${label} precisa conter componentes finitos.`);
  }
}

function normalizePositiveFinite(
  value: number,
  fallback: number,
): number {
  return Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeLerpFactor(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FOLLOW_LERP;
  }

  return Math.min(1, Math.max(0, value));
}

export class CameraManager {
  private currentMode: CameraMode = "perspective";

  private readonly perspectiveCamera: THREE.PerspectiveCamera;
  private readonly orthographicCamera: THREE.OrthographicCamera;
  private activeCamera: THREE.Camera;

  private orthographicHalfSize = DEFAULT_ORTHOGRAPHIC_HALF_SIZE;

  // Scratch state pré-alocado. Nenhum Vector3 é criado em updateFollowCamera().
  private readonly targetPositionScratch = new THREE.Vector3(0, 0, 0);
  private readonly desiredCameraPositionScratch = new THREE.Vector3(0, 5, 10);
  private readonly currentCameraPositionScratch = new THREE.Vector3(0, 5, 10);
  private readonly defaultFollowOffsetScratch = new THREE.Vector3(0, 8, 12);
  private readonly appliedFollowOffsetScratch = new THREE.Vector3(0, 8, 12);

  public constructor(viewport: ViewportDimensions) {
    const aspect = normalizePositiveFinite(viewport.aspectRatio, 1);

    this.perspectiveCamera = new THREE.PerspectiveCamera(
      60,
      aspect,
      0.1,
      1000,
    );
    this.perspectiveCamera.position.set(0, 8, 12);
    this.perspectiveCamera.lookAt(0, 0, 0);

    this.orthographicCamera = new THREE.OrthographicCamera(
      -this.orthographicHalfSize * aspect,
      this.orthographicHalfSize * aspect,
      this.orthographicHalfSize,
      -this.orthographicHalfSize,
      0.1,
      1000,
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
    if (
      mode !== "perspective" &&
      mode !== "orthographic" &&
      mode !== "follow"
    ) {
      throw new RangeError(`CameraMode inválido: ${String(mode)}.`);
    }

    this.currentMode = mode;

    this.activeCamera =
      mode === "orthographic"
        ? this.orthographicCamera
        : this.perspectiveCamera;

    if (target !== undefined) {
      this.setTarget(target);
    }
  }

  public setTarget(target: Vector3D): void {
    assertFiniteVector(target, "target");

    this.targetPositionScratch.set(
      target.x,
      target.y,
      target.z,
    );

    this.activeCamera.lookAt(this.targetPositionScratch);
  }

  public updateFollowCamera(
    target: Vector3D,
    offset?: Vector3D,
    lerpFactor = DEFAULT_FOLLOW_LERP,
  ): void {
    if (this.currentMode !== "follow") {
      return;
    }

    assertFiniteVector(target, "target");

    this.targetPositionScratch.set(
      target.x,
      target.y,
      target.z,
    );

    if (offset === undefined) {
      this.appliedFollowOffsetScratch.copy(
        this.defaultFollowOffsetScratch,
      );
    } else {
      assertFiniteVector(offset, "offset");

      this.appliedFollowOffsetScratch.set(
        offset.x,
        offset.y,
        offset.z,
      );
    }

    this.desiredCameraPositionScratch
      .copy(this.targetPositionScratch)
      .add(this.appliedFollowOffsetScratch);

    this.currentCameraPositionScratch.copy(
      this.activeCamera.position,
    );

    this.currentCameraPositionScratch.lerp(
      this.desiredCameraPositionScratch,
      normalizeLerpFactor(lerpFactor),
    );

    this.activeCamera.position.copy(
      this.currentCameraPositionScratch,
    );

    this.activeCamera.lookAt(
      this.targetPositionScratch,
    );
  }

  public updateAspect(viewport: ViewportDimensions): void {
    const aspect = normalizePositiveFinite(viewport.aspectRatio, 1);

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    this.orthographicCamera.left =
      -this.orthographicHalfSize * aspect;
    this.orthographicCamera.right =
      this.orthographicHalfSize * aspect;
    this.orthographicCamera.top =
      this.orthographicHalfSize;
    this.orthographicCamera.bottom =
      -this.orthographicHalfSize;

    this.orthographicCamera.updateProjectionMatrix();
  }

  public configurePerspective(
    options: Partial<PerspectiveCameraOptions>,
  ): void {
    const nextNear =
      options.near === undefined
        ? this.perspectiveCamera.near
        : normalizePositiveFinite(
            options.near,
            this.perspectiveCamera.near,
          );

    const nextFar =
      options.far === undefined
        ? this.perspectiveCamera.far
        : normalizePositiveFinite(
            options.far,
            this.perspectiveCamera.far,
          );

    if (nextFar <= nextNear) {
      throw new RangeError("Perspective far precisa ser maior que near.");
    }

    if (options.fov !== undefined) {
      if (
        !Number.isFinite(options.fov) ||
        options.fov <= 0 ||
        options.fov >= 180
      ) {
        throw new RangeError("Perspective fov precisa estar entre 0 e 180.");
      }

      this.perspectiveCamera.fov = options.fov;
    }

    this.perspectiveCamera.near = nextNear;
    this.perspectiveCamera.far = nextFar;

    if (options.position !== undefined) {
      assertFiniteVector(options.position, "position");

      this.perspectiveCamera.position.set(
        options.position.x,
        options.position.y,
        options.position.z,
      );
    }

    if (options.target !== undefined) {
      assertFiniteVector(options.target, "target");

      this.perspectiveCamera.lookAt(
        options.target.x,
        options.target.y,
        options.target.z,
      );
    }

    this.perspectiveCamera.updateProjectionMatrix();
  }

  public configureOrthographic(
    options: Partial<OrthographicCameraOptions>,
  ): void {
    const nextNear =
      options.near === undefined
        ? this.orthographicCamera.near
        : normalizePositiveFinite(
            options.near,
            this.orthographicCamera.near,
          );

    const nextFar =
      options.far === undefined
        ? this.orthographicCamera.far
        : normalizePositiveFinite(
            options.far,
            this.orthographicCamera.far,
          );

    if (nextFar <= nextNear) {
      throw new RangeError("Orthographic far precisa ser maior que near.");
    }

    if (options.size !== undefined) {
      this.orthographicHalfSize =
        normalizePositiveFinite(
          options.size,
          this.orthographicHalfSize,
        );
    }

    this.orthographicCamera.near = nextNear;
    this.orthographicCamera.far = nextFar;

    if (options.position !== undefined) {
      assertFiniteVector(options.position, "position");

      this.orthographicCamera.position.set(
        options.position.x,
        options.position.y,
        options.position.z,
      );
    }

    if (options.target !== undefined) {
      assertFiniteVector(options.target, "target");

      this.orthographicCamera.lookAt(
        options.target.x,
        options.target.y,
        options.target.z,
      );
    }

    this.updateAspect({
      width: 1,
      height: 1,
      aspectRatio:
        this.perspectiveCamera.aspect,
      pixelRatio: 1,
    });
  }
}
