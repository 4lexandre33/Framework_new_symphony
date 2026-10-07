import * as THREE from "three";

import type { CameraApi } from "../../../tokens/camera";

const CAMERA_ID =
  "example.physics-sandbox.orbit";

const MIN_DISTANCE = 5;
const MAX_DISTANCE = 30;

const MIN_PITCH = 0.12;
const MAX_PITCH = 1.35;

const ORBIT_SPEED = 0.008;
const ZOOM_SPEED = 0.001;

/**
 * Adapter de input do PROJETO consumidor.
 *
 * Responsabilidades:
 * - traduz PointerEvent/WheelEvent/KeyboardEvent para intenções do projeto;
 * - publica a câmera exclusivamente através da CameraApi pública;
 * - não acessa CameraService, VirtualCameraStack ou outros internals;
 * - não cria RAF/game loop próprio;
 * - não contém lógica da engine.
 *
 * O listener usa Window em vez do canvas porque a aplicação pode possuir
 * HUDs/UI transparentes acima do WebGL. Assim o projeto não depende da
 * topologia concreta das camadas DOM do renderer.
 */
export class OrbitCameraInput {
  private readonly eye =
    new THREE.Vector3();

  private readonly focus =
    new THREE.Vector3(
      0,
      1.5,
      0,
    );

  private readonly up =
    new THREE.Vector3(
      0,
      1,
      0,
    );

  private readonly lookAtMatrix =
    new THREE.Matrix4();

  private readonly quaternion =
    new THREE.Quaternion();

  private distance = 14;

  private yaw = 0.4;

  private pitch = 0.42;

  private pointerId:
    number | null = null;

  private lastPointerX = 0;

  private lastPointerY = 0;

  private started = false;

  private disposed = false;

  private previousCameraId:
    string | null = null;

  public constructor(
    private readonly camera:
      CameraApi,

    private readonly host:
      Window,

    private readonly onJump:
      () => void,
  ) {}

  public start(): void {
    if (
      this.disposed ||
      this.started
    ) {
      return;
    }

    this.previousCameraId =
      this.camera
        .getActiveCameraId();

    this.publishCamera();

    const activated =
      this.camera
        .setActiveCamera(
          CAMERA_ID,
          0,
        );

    if (!activated) {
      this.camera
        .unregisterVirtualCamera(
          CAMERA_ID,
        );

      throw new Error(
        "Não foi possível ativar a câmera orbital do projeto.",
      );
    }

    this.started = true;

    this.host.addEventListener(
      "pointerdown",
      this.onPointerDown,
      true,
    );

    this.host.addEventListener(
      "pointermove",
      this.onPointerMove,
      true,
    );

    this.host.addEventListener(
      "pointerup",
      this.onPointerUp,
      true,
    );

    this.host.addEventListener(
      "pointercancel",
      this.onPointerUp,
      true,
    );

    this.host.addEventListener(
      "wheel",
      this.onWheel,
      {
        passive: false,
        capture: true,
      },
    );

    this.host.addEventListener(
      "keydown",
      this.onKeyDown,
    );

    this.host.addEventListener(
      "blur",
      this.onBlur,
    );
  }

  private publishCamera(): void {
    const horizontal =
      this.distance *
      Math.cos(
        this.pitch,
      );

    this.eye.set(
      this.focus.x +
        horizontal *
          Math.sin(
            this.yaw,
          ),

      this.focus.y +
        this.distance *
          Math.sin(
            this.pitch,
          ),

      this.focus.z +
        horizontal *
          Math.cos(
            this.yaw,
          ),
    );

    this.lookAtMatrix.lookAt(
      this.eye,
      this.focus,
      this.up,
    );

    this.quaternion
      .setFromRotationMatrix(
        this.lookAtMatrix,
      );

    this.camera
      .registerVirtualCamera({
        id:
          CAMERA_ID,

        priority:
          100,

        fov:
          60,

        position: {
          x:
            this.eye.x,

          y:
            this.eye.y,

          z:
            this.eye.z,
        },

        rotation: {
          x:
            this.quaternion.x,

          y:
            this.quaternion.y,

          z:
            this.quaternion.z,

          w:
            this.quaternion.w,
        },
      });
  }

  private readonly onPointerDown =
    (
      event:
        PointerEvent,
    ): void => {
      if (
        this.disposed ||
        this.pointerId !==
          null ||
        event.button !==
          0 ||
        this.isInteractiveUi(
          event.target,
        )
      ) {
        return;
      }

      this.pointerId =
        event.pointerId;

      this.lastPointerX =
        event.clientX;

      this.lastPointerY =
        event.clientY;

      event.preventDefault();
    };

  private readonly onPointerMove =
    (
      event:
        PointerEvent,
    ): void => {
      if (
        this.disposed ||
        this.pointerId !==
          event.pointerId
      ) {
        return;
      }

      const deltaX =
        event.clientX -
        this.lastPointerX;

      const deltaY =
        event.clientY -
        this.lastPointerY;

      this.lastPointerX =
        event.clientX;

      this.lastPointerY =
        event.clientY;

      if (
        deltaX === 0 &&
        deltaY === 0
      ) {
        return;
      }

      this.yaw =
        (
          this.yaw -
          deltaX *
            ORBIT_SPEED
        ) %
        (
          Math.PI *
          2
        );

      this.pitch =
        THREE.MathUtils.clamp(
          this.pitch +
            deltaY *
              ORBIT_SPEED,

          MIN_PITCH,
          MAX_PITCH,
        );

      this.publishCamera();

      event.preventDefault();
    };

  private readonly onPointerUp =
    (
      event:
        PointerEvent,
    ): void => {
      if (
        this.pointerId ===
        event.pointerId
      ) {
        this.pointerId =
          null;
      }
    };

  private readonly onWheel =
    (
      event:
        WheelEvent,
    ): void => {
      if (
        this.disposed ||
        this.isInteractiveUi(
          event.target,
        )
      ) {
        return;
      }

      event.preventDefault();

      const magnitude =
        event.deltaMode ===
          WheelEvent.DOM_DELTA_LINE
          ? event.deltaY *
            16
          : event.deltaY;

      this.distance =
        THREE.MathUtils.clamp(
          this.distance *
            Math.exp(
              magnitude *
                ZOOM_SPEED,
            ),

          MIN_DISTANCE,
          MAX_DISTANCE,
        );

      this.publishCamera();
    };

  private readonly onKeyDown =
    (
      event:
        KeyboardEvent,
    ): void => {
      if (
        this.disposed ||
        event.code !==
          "Space" ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        this.isTextInput(
          event.target,
        )
      ) {
        return;
      }

      event.preventDefault();

      this.onJump();
    };

  private readonly onBlur =
    (): void => {
      this.pointerId =
        null;
    };

  private isInteractiveUi(
    target:
      EventTarget | null,
  ): boolean {
    if (
      !(target instanceof Element)
    ) {
      return false;
    }

    return (
      target.closest(
        "#engine-debug-overlay, button, input, textarea, select, a",
      ) !==
      null
    );
  }

  private isTextInput(
    target:
      EventTarget | null,
  ): boolean {
    if (
      !(target instanceof HTMLElement)
    ) {
      return false;
    }

    return (
      target.isContentEditable ||
      target instanceof
        HTMLInputElement ||
      target instanceof
        HTMLTextAreaElement
    );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed = true;

    if (
      !this.started
    ) {
      return;
    }

    this.started = false;

    this.pointerId =
      null;

    this.host.removeEventListener(
      "pointerdown",
      this.onPointerDown,
      true,
    );

    this.host.removeEventListener(
      "pointermove",
      this.onPointerMove,
      true,
    );

    this.host.removeEventListener(
      "pointerup",
      this.onPointerUp,
      true,
    );

    this.host.removeEventListener(
      "pointercancel",
      this.onPointerUp,
      true,
    );

    this.host.removeEventListener(
      "wheel",
      this.onWheel,
      true,
    );

    this.host.removeEventListener(
      "keydown",
      this.onKeyDown,
    );

    this.host.removeEventListener(
      "blur",
      this.onBlur,
    );

    this.camera
      .unregisterVirtualCamera(
        CAMERA_ID,
      );

    if (
      this.previousCameraId !==
      null
    ) {
      this.camera
        .setActiveCamera(
          this.previousCameraId,
          0,
        );
    }
  }
}
