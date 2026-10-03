import { defineEvent, defineCommand } from "../../core/contracts";

export type CameraMode = "perspective" | "orthographic" | "follow";

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface PerspectiveCameraOptions {
  fov: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}

export interface OrthographicCameraOptions {
  size: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}

export interface ViewportDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  pixelRatio: number;
}

export interface AmbientLightConfig {
  color: number | string;
  intensity: number;
}

export interface DirectionalLightConfig {
  color: number | string;
  intensity: number;
  position: Vector3D;
  castShadow: boolean;
}

export interface RenderFramePayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
}

export const RenderFrameEvent = defineEvent<"game.render.frame", RenderFramePayload>(
  "game.render.frame"
);

export interface ViewportResizePayload {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly pixelRatio: number;
}

export const ViewportResizeEvent = defineEvent<"game.render.resize", ViewportResizePayload>(
  "game.render.resize"
);

export interface SetCameraModeRequest {
  readonly mode: CameraMode;
  readonly target?: Vector3D;
}

export const SetCameraModeCommand = defineCommand<"game.render.set-camera-mode", SetCameraModeRequest>(
  "game.render.set-camera-mode"
);