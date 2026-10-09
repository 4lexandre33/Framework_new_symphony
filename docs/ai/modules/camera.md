# camera — Câmera Dinâmica & SpringArm
capability: game.camera@1.0.0 | category: functional | engine plugin id: game.camera
dependsOn: game.loop, game.physics, game.render
consumes: PhysicsToken, RenderToken
use (from src/projects/<jogo>/**):
  import { CameraToken } from "../../tokens/camera";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/camera.ts
```ts
interface CameraApi {
  registerVirtualCamera(descriptor: VirtualCameraDescriptor): void;
  unregisterVirtualCamera(cameraId: string): boolean;
  setActiveCamera(cameraId: string, blendDurationSeconds?: number): boolean;
  addTrauma(traumaAmount: number): void;
  setFollowTarget(cameraId: string, targetPosition: Vector3Camera): void;
  configureSpringArm(cameraId: string, config: Partial<SpringArmConfig>): void;
  getActiveCameraId(): string | null;
  getCurrentCameraSnapshot(): CameraTransformSnapshot | null;
}
capability CameraToken = "game.camera"@1.0.0 api CameraApi
```
## contract src/contracts/camera/types.ts
```ts
interface Vector3Camera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface QuaternionCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}
interface SpringArmConfig {
  readonly targetArmLength: number;
  readonly probeRadius: number;
  readonly socketOffset: Vector3Camera;
  readonly targetOffset: Vector3Camera;
  readonly smoothTimeSeconds?: number;
  readonly enableCollision?: boolean;
}
interface CameraShakeConfig {
  readonly maxTrauma?: number;
  readonly traumaDecayRate?: number;
  readonly frequencyHz?: number;
  readonly maxTranslationOffset?: Vector3Camera;
  readonly maxPitchYawRollDegrees?: Vector3Camera;
}
interface VirtualCameraDescriptor {
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
interface CameraTransformSnapshot {
  readonly position: Vector3Camera;
  readonly rotation: QuaternionCamera;
  readonly fov: number;
  readonly isColliding: boolean;
  readonly currentArmLength: number;
  readonly currentTrauma: number;
}
interface CameraStateChangedPayload {
  readonly activeCameraId: string;
  readonly previousCameraId: string | null;
  readonly blendDurationSeconds: number;
}
event CameraStateChangedEvent = "game.camera.state-changed" payload CameraStateChangedPayload
interface CameraShakeTriggeredPayload {
  readonly traumaAmount: number;
  readonly currentTotalTrauma: number;
}
event CameraShakeTriggeredEvent = "game.camera.shake-triggered" payload CameraShakeTriggeredPayload
interface CameraCollisionPayload {
  readonly cameraId: string;
  readonly isColliding: boolean;
  readonly targetLength: number;
  readonly actualLength: number;
}
event CameraCollisionEvent = "game.camera.collision-changed" payload CameraCollisionPayload
interface AddCameraTraumaRequest {
  readonly traumaAmount: number;
}
command AddCameraTraumaCommand = "game.camera.add-trauma" request AddCameraTraumaRequest
interface SetActiveVirtualCameraRequest {
  readonly cameraId: string;
  readonly blendDurationSeconds?: number;
}
command SetActiveVirtualCameraCommand = "game.camera.set-active" request SetActiveVirtualCameraRequest
interface SetCameraFollowTargetRequest {
  readonly cameraId: string;
  readonly targetPosition: Vector3Camera;
}
command SetCameraFollowTargetCommand = "game.camera.set-follow-target" request SetCameraFollowTargetRequest
```
## notas verificadas (comportamento)
- `setFollowTarget(cameraId, targetPosition)` apenas guarda a posição alvo na câmera virtual; o jogo deve chamá-lo a cada tick com a posição atual do alvo.

