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
  readonly occlusionFade?: boolean | CameraOcclusionFadeConfig; // G47: `true` (padrões) ou configuração do fade automático.
}
interface CameraOcclusionFadeConfig { // Fade automático de oclusão (G47).
  readonly opacity?: number; // Opacidade alvo 0..1.
  readonly fadeSeconds?: number; // Duração do fade (s).
  readonly meshKeyPrefix?: string; // Prefixo da chave do render.
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
- Sem câmera virtual (ou com `setEnabled(false)`) a câmera do render NÃO é tocada. Com câmera registrada, `game.camera` escreve posição/rotação/fov da câmera ativa no `game.loop.render`.
- Ativa = maior `priority` (no registro ou em `setCameraPriority`), com `game.camera.state-changed`; `setActiveCamera(id, blend?)` força outra (sem blend usa `descriptor.blendDurationSeconds`, padrão 0,5 s; `0` corta).
- Seguir: `followTargetId`/`lookAtTargetId` = ids de corpos físicos (posição lida a cada frame) ou `setFollowTarget(id, pos)`/`setLookAtTarget(id, pos | null)` com números COPIADOS (chame quando o alvo mudar; `clearFollowTarget` volta ao id).
- Sem spring-arm: `position` é fixa; com alvo vira o OFFSET em relação ao alvo. Com `springArmConfig`: câmera atrás do alvo pela `rotation`, a `targetArmLength` (obrigatórios: `targetArmLength`, `probeRadius`, `socketOffset`, `targetOffset`); zoom = `configureSpringArm(id, { targetArmLength })`.
- Colisão do braço: padrão ligada só quando há entidade a ignorar (`followTargetId` ou `collisionIgnoreEntityId`); o raio ignora o alvo e sensores. `enableCollision: false` para câmera isométrica estável.
- Re-registrar o mesmo id substitui o descritor e PRESERVA trauma, alvos e status de ativa (girar 90° = re-registro com nova `rotation`).
- Shake: `addTrauma(0..1)` é GLOBAL (sobrevive a troca/re-registro; usa o `shakeConfig` da ativa); blend e shake congelam com o jogo pausado.
- `detectOcclusion: true` emite `game.camera.occlusion-changed` (ids físicos entre câmera e alvo). Fade automático opcional (G47): `occlusionFade: true | { opacity: 0.3, fadeSeconds: 0.2, meshKeyPrefix: "" }` (implica a detecção); a malha é `render.getMeshFromScene(prefixo + entityId)`, os materiais viram CLONES transparentes (o original/compartilhado não muda) e voltam ao desocluir, trocar de câmera ou no dispose.
- Isométrica: `rotation` = yaw 45° + pitch −35°, braço 25–60, fov ~35 (receita 10-camera).
