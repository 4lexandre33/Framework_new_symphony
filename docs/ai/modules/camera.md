# camera — Câmera Dinâmica & SpringArm
capability: game.camera@1.0.0 | category: functional | engine plugin id: game.camera
dependsOn: game.loop, game.physics, game.render
consumes: PhysicsToken, RenderToken
use (from src/projects/<jogo>/**):
  import { CameraToken } from "../../tokens/camera";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/camera.ts
```ts
interface CameraApi { // Câmeras virtuais que dirigem a câmera do `game.render`.
  registerVirtualCamera(descriptor: VirtualCameraDescriptor): void; // Registra (ou substitui, mesmo id) uma câmera.
  unregisterVirtualCamera(cameraId: string): boolean;
  setActiveCamera(cameraId: string, blendDurationSeconds?: number): boolean; // Ativa a câmera.
  addTrauma(traumaAmount: number): void; // Trauma GLOBAL (G48): sobrevive à troca/re-registro de câmeras; o ruído usa o `shakeConfig` da câmera ativa.
  setFollowTarget(cameraId: string, targetPosition: Vector3Camera): void; // Alvo de seguimento manual (os números são COPIADOS; G48).
  configureSpringArm(cameraId: string, config: Partial<SpringArmConfig>): void;
  getActiveCameraId(): string | null;
  getCurrentCameraSnapshot(): CameraTransformSnapshot | null;
  clearFollowTarget(cameraId: string): boolean; // Remove o alvo manual (volta a usar `followTargetId`, se houver).
  setLookAtTarget(cameraId: string, targetPosition: Vector3Camera | null): boolean; // Ponto para onde a câmera olha (copiado); sobrescreve `rotation`.
  setCameraPriority(cameraId: string, priority: number): boolean; // Muda a prioridade e reavalia qual câmera fica ativa (G46).
  setEnabled(enabled: boolean): void; // Liga/desliga a escrita na câmera do render (G4).
  isEnabled(): boolean;
  getTrauma(): number; // Trauma global atual (0..maxTrauma).
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
  readonly enableCollision?: boolean; // Raio de colisão do braço (G45).
  readonly collisionIgnoreEntityId?: string; // Entidade física ignorada pelo raio do braço (normalmente o personagem seguido).
}
interface CameraShakeConfig {
  readonly maxTrauma?: number;
  readonly traumaDecayRate?: number;
  readonly frequencyHz?: number;
  readonly maxTranslationOffset?: Vector3Camera;
  readonly maxPitchYawRollDegrees?: Vector3Camera;
}
interface VirtualCameraDescriptor { // Câmera virtual.
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
  readonly detectOcclusion?: boolean;
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
interface CameraOcclusionPayload {
  readonly cameraId: string;
  readonly occludedEntityIds: ReadonlyArray<string>; // Entidades (físicas) entre a câmera e o alvo neste momento.
}
event CameraOcclusionChangedEvent = "game.camera.occlusion-changed" payload CameraOcclusionPayload
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
- IMPORTANTE: `game.camera` escreve posição/rotação (e fov se perspectiva) na câmera ativa do render A CADA FRAME. Sem câmera virtual registrada, ela força posição (0,5,10) e rotação identidade. Logo `RenderApi.setCameraMode`/`updateCameraTarget` não têm efeito visível: controle a câmera SÓ por `game.camera`.
- `registerVirtualCamera` com um id existente SUBSTITUI a câmera e zera o shake (trauma). Use re-registro só para mudanças raras (ex.: girar 90°). Para seguir/zoom use spring-arm.
- `setFollowTarget(cameraId, pos)` só guarda o alvo; chame a cada tick com a posição atual.
- Câmera SEM `springArmConfig`: posição é sempre `descriptor.position` (fixa); `followTarget` não a move.
- COM `springArmConfig` + `setFollowTarget`: posição = alvo + `targetOffset` + (0,0,1) girado pela `rotation` da câmera × comprimento do braço (a câmera fica "atrás" e olha para o alvo). `fov` inválido cai para 60.
- Campos obrigatórios do spring-arm: `targetArmLength`, `probeRadius`, `socketOffset`, `targetOffset`. `configureSpringArm(id, {targetArmLength})` muda o zoom SEM zerar o shake.
- `addTrauma(0..1)` sacode a câmera ativa (decai sozinho).
- Isométrica: `rotation` = quaternion de yaw 45° e pitch −35°; spring-arm com braço 25–60; zoom = `configureSpringArm`. Receita: `docs/ai/RECIPES.md` (10-camera).
- Spring-arm com colisão LIGADA por padrão (G45): sempre `enableCollision: false` salvo se o socket estiver fora de qualquer collider.
- `priority` é ignorada (G46): chame `setActiveCamera(id, 0)` logo após registrar e `setFollowTarget` logo em seguida. `setFollowTarget` guarda a referência do objeto: passe um objeto dedicado (G48).
