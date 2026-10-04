import { defineEvent, defineCommand } from "@core";

export interface Vector3Camera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuaternionCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface SpringArmConfig {
  readonly targetArmLength: number;
  readonly probeRadius: number;
  readonly socketOffset: Vector3Camera;
  readonly targetOffset: Vector3Camera;
  readonly smoothTimeSeconds?: number;
  readonly enableCollision?: boolean;
}

export interface CameraShakeConfig {
  readonly maxTrauma?: number;
  readonly traumaDecayRate?: number;
  readonly frequencyHz?: number;
  readonly maxTranslationOffset?: Vector3Camera;
  readonly maxPitchYawRollDegrees?: Vector3Camera;
}

export interface VirtualCameraDescriptor {
  readonly id: string;
  readonly priority: number;
  readonly fov: number;
  readonly position: Vector3Camera;
  readonly rotation: QuaternionCamera;
  readonly followTargetId?: string;
  readonly lookAtTargetId?: string;
  readonly springArmConfig?: SpringArmConfig;
  readonly shakeConfig?: CameraShakeConfig;
  readonly blendDurationSeconds?: number;
}

export interface CameraTransformSnapshot {
  readonly position: Vector3Camera;
  readonly rotation: QuaternionCamera;
  readonly fov: number;
  readonly isColliding: boolean;
  readonly currentArmLength: number;
  readonly currentTrauma: number;
}

// ── EVENTOS DE CÂMERA ───────────────────────────────────────────────────────

export interface CameraStateChangedPayload {
  readonly activeCameraId: string;
  readonly previousCameraId: string | null;
  readonly blendDurationSeconds: number;
}

export const CameraStateChangedEvent = defineEvent<
  "game.camera.state-changed",
  CameraStateChangedPayload
>("game.camera.state-changed");

export interface CameraShakeTriggeredPayload {
  readonly traumaAmount: number;
  readonly currentTotalTrauma: number;
}

export const CameraShakeTriggeredEvent = defineEvent<
  "game.camera.shake-triggered",
  CameraShakeTriggeredPayload
>("game.camera.shake-triggered");

export interface CameraCollisionPayload {
  readonly cameraId: string;
  readonly isColliding: boolean;
  readonly targetLength: number;
  readonly actualLength: number;
}

export const CameraCollisionEvent = defineEvent<
  "game.camera.collision-changed",
  CameraCollisionPayload
>("game.camera.collision-changed");

// ── COMANDOS DE CÂMERA ──────────────────────────────────────────────────────

export interface AddCameraTraumaRequest {
  readonly traumaAmount: number;
}

export const AddCameraTraumaCommand = defineCommand<
  "game.camera.add-trauma",
  AddCameraTraumaRequest
>("game.camera.add-trauma");

export interface SetActiveVirtualCameraRequest {
  readonly cameraId: string;
  readonly blendDurationSeconds?: number;
}

export const SetActiveVirtualCameraCommand = defineCommand<
  "game.camera.set-active",
  SetActiveVirtualCameraRequest
>("game.camera.set-active");

export interface SetCameraFollowTargetRequest {
  readonly cameraId: string;
  readonly targetPosition: Vector3Camera;
}

export const SetCameraFollowTargetCommand = defineCommand<
  "game.camera.set-follow-target",
  SetCameraFollowTargetRequest
>("game.camera.set-follow-target");