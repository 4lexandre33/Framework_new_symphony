# physics — Motor de Física (Rapier WASM)
capability: game.physics@1.0.0 | category: functional | engine plugin id: game.physics
use (from src/projects/<jogo>/**):
  import { PhysicsToken } from "../../tokens/physics";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/physics.ts
```ts
interface PhysicsApi {
  step(deltaTimeSeconds: number): void; // Avança a simulação física em um intervalo de tempo fixo.
  createBody(entityId: string, bodyDesc: RigidBodyDescriptor, colliderDesc?: ColliderDescriptor): boolean; // Cria e registra um corpo rígido no mundo físico associado a uma entidade.
  removeBody(entityId: string): boolean; // Remove um corpo rígido do mundo físico.
  applyImpulse(entityId: string, impulse: Vector3DTO): boolean; // Aplica um impulso vetorial em um corpo rígido dinâmico.
  applyForce(entityId: string, force: Vector3DTO): boolean; // Aplica uma força contínua em um corpo rígido.
  castRay(request: RaycastRequest): RaycastHit; // Executa uma consulta de raio (Raycast) no espaço 3D.
  getBodyTransform(entityId: string): { position: Vector3DTO; rotation: QuaternionDTO } | null; // Retorna a posição e rotação atuais de um corpo rígido.
  syncMeshTransform(entityId: string, targetMesh: { position: Vector3DTO; quaternion: QuaternionDTO }): boolean; // Sincroniza a posição e rotação de uma malha 3D com o corpo físico.
  setGravity(gravity: Vector3DTO): void; // Define o vetor de aceleração da gravidade global.
  getStats(): PhysicsStats; // Retorna métricas de desempenho e contagem de entidades físicas ativas.
}
capability PhysicsToken = "game.physics"@1.0.0 api PhysicsApi
```
## contract src/contracts/physics/types.ts
```ts
export type RigidBodyType = "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";
export type ColliderShapeType = "box" | "sphere" | "capsule" | "trimesh";
interface Vector3DTO {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface QuaternionDTO {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}
interface RigidBodyDescriptor {
  readonly bodyType: RigidBodyType;
  readonly position?: Vector3DTO;
  readonly rotation?: QuaternionDTO;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly gravityScale?: number;
  readonly canSleep?: boolean;
}
interface ColliderDescriptor {
  readonly shapeType: ColliderShapeType;
  readonly halfExtents?: Vector3DTO;
  readonly radius?: number;
  readonly halfHeight?: number;
  readonly vertices?: Float32Array;
  readonly indices?: Uint32Array;
  readonly friction?: number;
  readonly restitution?: number;
  readonly isSensor?: boolean;
  readonly density?: number;
}
interface RaycastRequest {
  readonly origin: Vector3DTO;
  readonly direction: Vector3DTO;
  readonly maxDistance: number;
  readonly solid?: boolean;
}
interface RaycastHit {
  readonly hit: boolean;
  readonly distance: number;
  readonly point: Vector3DTO;
  readonly normal: Vector3DTO;
  readonly entityId?: string;
}
interface PhysicsStats {
  readonly rigidBodyCount: number;
  readonly colliderCount: number;
  readonly stepTimeMs: number;
  readonly isWasmLoaded: boolean;
}
interface CollisionEventPayload {
  readonly entityIdA: string;
  readonly entityIdB: string;
  readonly isStarted: boolean;
  readonly isTrigger: boolean;
}
event CollisionEnterEvent = "game.physics.collision-enter" payload CollisionEventPayload
event CollisionExitEvent = "game.physics.collision-exit" payload CollisionEventPayload
event TriggerEnterEvent = "game.physics.trigger-enter" payload CollisionEventPayload
event TriggerExitEvent = "game.physics.trigger-exit" payload CollisionEventPayload
interface CreateBodyRequest {
  readonly entityId: string;
  readonly bodyDesc: RigidBodyDescriptor;
  readonly colliderDesc?: ColliderDescriptor;
}
command CreateBodyCommand = "game.physics.create-body" request CreateBodyRequest
interface RemoveBodyRequest {
  readonly entityId: string;
}
command RemoveBodyCommand = "game.physics.remove-body" request RemoveBodyRequest
interface ApplyImpulseRequest {
  readonly entityId: string;
  readonly impulse: Vector3DTO;
}
command ApplyImpulseCommand = "game.physics.apply-impulse" request ApplyImpulseRequest
interface CastRayRequest {
  readonly ray: RaycastRequest;
}
command CastRayCommand = "game.physics.cast-ray" request CastRayRequest
```
## notas verificadas (comportamento)
- A engine já avança a física no `game.loop.tick` (`stepForGameLoop`). NÃO chame `step()` no jogo. A ordem entre o seu listener de tick e o step não é garantida: não dependa dela.
- Gravidade padrão: (0, −9,81, 0). `applyImpulse` acorda o corpo.
- Só corpos `dynamic` recebem `applyImpulse`/`applyForce`; nos outros retorna false.
- `applyForce` é persistente (não há reset automático): aplique a cada tick só enquanto quiser a força.
- LACUNA: não há como MOVER um corpo `fixed`/`kinematic*` depois de criado (sem setTranslation/setNextKinematic*) nem ler/definir velocidade. Para plataformas móveis, simule num referencial local parado (ver `docs/ai/GAPS.md`). Velocidade: estime pela diferença de `getBodyTransform` entre ticks.
- LACUNA: não há trava de rotação. Personagem como cápsula/caixa `dynamic` tomba. Use esfera `dynamic` e desenhe o modelo em pé usando só a posição.
- Eventos de colisão trazem o par `entityIdA`/`entityIdB` (ordem não garantida); `isTrigger` true apenas com collider `isSensor`.
- `castRay` parte de `origin`: se o raio nascer dentro do próprio corpo ele o acerta. Comece abaixo/além da base do corpo.
- `syncMeshTransform(id, mesh)` MUTA `mesh.position` e `mesh.quaternion` (copia do corpo para a malha).
- O terreno voxel (`game.terrain`) NÃO cria colisores: o chão físico é responsabilidade do jogo.
- `getBodyTransform` devolve SEMPRE o mesmo objeto (G33): copie os números na hora. Remover corpo não emite `collision-exit`/`trigger-exit` (G34). `restitution` > 1 lança (G37).
