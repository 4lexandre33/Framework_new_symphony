import { defineCapability } from "@core";
import type {
  VirtualCameraDescriptor,
  SpringArmConfig,
  Vector3Camera,
  CameraTransformSnapshot,
} from "../contracts/camera/types";

export interface CameraApi {
  registerVirtualCamera(descriptor: VirtualCameraDescriptor): void;
  unregisterVirtualCamera(cameraId: string): boolean;
  setActiveCamera(cameraId: string, blendDurationSeconds?: number): boolean;
  addTrauma(traumaAmount: number): void;
  setFollowTarget(cameraId: string, targetPosition: Vector3Camera): void;
  configureSpringArm(cameraId: string, config: Partial<SpringArmConfig>): void;
  getActiveCameraId(): string | null;
  getCurrentCameraSnapshot(): CameraTransformSnapshot | null;
}

export const CameraToken = defineCapability<CameraApi>("game.camera", "1.0.0");