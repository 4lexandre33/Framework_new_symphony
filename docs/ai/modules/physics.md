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
  addCollider(entityId: string, colliderDesc: ColliderDescriptor): boolean; // Anexa um collider adicional (compound shape) a um corpo existente.
  removeBody(entityId: string): boolean; // Remove um corpo rígido do mundo físico.
  hasBody(entityId: string): boolean;
  applyImpulse(entityId: string, impulse: Vector3DTO): boolean; // Aplica um impulso vetorial em um corpo rígido dinâmico.
  applyForce(entityId: string, force: Vector3DTO): boolean; // Aplica uma força contínua em um corpo rígido.
  applyTorqueImpulse(entityId: string, torqueImpulse: Vector3DTO): boolean; // Impulso angular (dynamic).
  resetForces(entityId: string): boolean; // Zera forças e torques persistentes de um corpo dinâmico.
  castRay(request: RaycastRequest): RaycastHit; // Executa uma consulta de raio (Raycast) no espaço 3D.
  castShape(request: ShapeCastRequest): ShapeCastHit; // Varre uma forma ao longo de uma direção e retorna o primeiro impacto.
  queryOverlap(request: OverlapQueryRequest): string[]; // Retorna os ids das entidades cujos colliders sobrepõem a forma (sem duplicatas).
  getBodyTransform(entityId: string): { position: Vector3DTO; rotation: QuaternionDTO } | null; // Retorna a posição e rotação atuais de um corpo rígido como um objeto NOVO (seguro para guardar).
  getBodyTransformInto(entityId: string, out: MutableBodyTransformDTO): boolean; // Escreve o transform atual em `out` sem alocar.
  setBodyTranslation(entityId: string, position: Vector3DTO, wakeUp?: boolean): boolean; // Teleporta um corpo (qualquer tipo, inclusive `fixed`).
  setBodyRotation(entityId: string, rotation: QuaternionDTO, wakeUp?: boolean): boolean; // Define a rotação de um corpo (teleporte angular).
  setBodyTransform(entityId: string, transform: Partial<BodyTransformDTO>, wakeUp?: boolean): boolean; // Teleporta posição e/ou rotação.
  setNextKinematicTransform(entityId: string, target: KinematicTargetDTO): boolean; // Define o alvo do próximo step de um `kinematicPositionBased` (a velocidade é derivada e corpos dinâmicos são …
  getLinearVelocity(entityId: string): Vector3DTO | null; // Velocidade linear atual (objeto novo) ou null.
  setLinearVelocity(entityId: string, velocity: Vector3DTO, wakeUp?: boolean): boolean; // Define a velocidade linear (dynamic / kinematicVelocityBased).
  getAngularVelocity(entityId: string): Vector3DTO | null; // Velocidade angular atual em rad/s (objeto novo) ou null.
  setAngularVelocity(entityId: string, velocity: Vector3DTO, wakeUp?: boolean): boolean; // Define a velocidade angular (dynamic / kinematicVelocityBased).
  setEnabledRotations(entityId: string, axes: AxisFlagsDTO, wakeUp?: boolean): boolean; // Habilita/desabilita rotação por eixo em tempo de execução.
  lockRotations(entityId: string, locked: boolean, wakeUp?: boolean): boolean; // Trava/destrava todas as rotações.
  getBodyMass(entityId: string): number | null; // Massa total do corpo (kg) ou null.
  isBodySleeping(entityId: string): boolean | null; // true se o corpo está dormindo.
  wakeBody(entityId: string): boolean; // Acorda um corpo dormindo.
  setCollisionGroups(entityId: string, groups: CollisionGroupsDTO): boolean; // Redefine os grupos de colisão de TODOS os colliders da entidade.
  createJoint(jointId: string, desc: JointDescriptor): boolean; // Cria um joint entre dois corpos existentes.
  removeJoint(jointId: string): boolean;
  hasJoint(jointId: string): boolean;
  setJointMotor(jointId: string, motor: JointMotorDTO): boolean; // Configura motor de joint revolute/prismatic.
  syncMeshTransform(entityId: string, targetMesh: { position: Vector3DTO; quaternion: QuaternionDTO }): boolean; // Sincroniza a posição e rotação de uma malha 3D com o corpo físico.
  setGravity(gravity: Vector3DTO): void; // Define o vetor de aceleração da gravidade global e acorda todos os corpos.
  getGravity(): Vector3DTO; // Gravidade atual (objeto novo).
  getStats(): PhysicsStats; // Retorna métricas de desempenho e contagem de entidades físicas ativas (objeto novo).
}
capability PhysicsToken = "game.physics"@1.0.0 api PhysicsApi
```
## contract src/contracts/physics/types.ts
```ts
export type RigidBodyType = "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";
export type ColliderShapeType = | "box" | "sphere" | "capsule" | "trimesh" | "cylinder" | "cone" | "convexHull" | "heightfield";
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
  readonly lockRotations?: boolean; // Trava TODAS as rotações (personagens em pé).
  readonly enabledRotations?: AxisFlagsDTO; // Habilita rotação por eixo (ex.: { x: false, y: true, z: false } = só gira em Y).
  readonly lockTranslations?: boolean; // Trava todas as translações (o corpo só gira).
  readonly linearVelocity?: Vector3DTO; // Velocidade linear inicial (dynamic / kinematicVelocityBased).
  readonly angularVelocity?: Vector3DTO; // Velocidade angular inicial em rad/s (dynamic / kinematicVelocityBased).
  readonly ccd?: boolean; // Continuous collision detection para corpos rápidos (projéteis).
  readonly additionalMass?: number; // Massa adicional somada à massa derivada da densidade dos colliders.
}
interface AxisFlagsDTO {
  readonly x: boolean;
  readonly y: boolean;
  readonly z: boolean;
}
interface CollisionGroupsDTO { // Grupos de colisão (16 bits cada).
  readonly memberships: number;
  readonly filter: number;
}
interface ColliderDescriptor {
  readonly shapeType: ColliderShapeType;
  readonly halfExtents?: Vector3DTO;
  readonly radius?: number;
  readonly halfHeight?: number;
  readonly vertices?: Float32Array;
  readonly indices?: Uint32Array;
  readonly heights?: Float32Array; // Heightfield: alturas em ordem column-major ((rows+1) * (cols+1) valores).
  readonly rows?: number; // Heightfield: número de subdivisões em Z (linhas).
  readonly cols?: number; // Heightfield: número de subdivisões em X (colunas).
  readonly scale?: Vector3DTO; // Heightfield: tamanho total (x, z) e multiplicador de altura (y).
  readonly friction?: number;
  readonly restitution?: number; // >= 0.
  readonly isSensor?: boolean;
  readonly density?: number;
  readonly offset?: Vector3DTO; // Translação local do collider relativa ao corpo (compound shapes, pés do personagem).
  readonly rotationOffset?: QuaternionDTO; // Rotação local do collider relativa ao corpo.
  readonly collisionGroups?: CollisionGroupsDTO; // Grupos de colisão/filtro deste collider.
  readonly contactForceThreshold?: number; // Quando definido (>= 0), emite `game.physics.contact-force` sempre que a força total de contato deste collider…
}
interface PhysicsQueryFilter { // Filtro comum a raycast, shape-cast e overlap.
  readonly excludeEntityId?: string; // Ignora todos os colliders desta entidade (ex.: o próprio personagem).
  readonly excludeSensors?: boolean; // Ignora sensores/triggers.
  readonly collisionGroups?: CollisionGroupsDTO; // Considera só colliders compatíveis com estes grupos.
}
interface RaycastRequest extends PhysicsQueryFilter {
  readonly origin: Vector3DTO;
  readonly direction: Vector3DTO;
  readonly maxDistance: number;
  readonly solid?: boolean;
}
interface QueryShapeDescriptor { // Forma usada em consultas (shape-cast / overlap).
  readonly shapeType: "box" | "sphere" | "capsule" | "cylinder" | "cone";
  readonly halfExtents?: Vector3DTO;
  readonly radius?: number;
  readonly halfHeight?: number;
}
interface ShapeCastRequest extends PhysicsQueryFilter {
  readonly shape: QueryShapeDescriptor;
  readonly position: Vector3DTO;
  readonly rotation?: QuaternionDTO;
  readonly direction: Vector3DTO; // Direção do movimento (não precisa ser normalizada).
  readonly maxDistance: number;
}
interface ShapeCastHit {
  readonly hit: boolean;
  readonly distance: number; // Distância percorrida pela forma até o primeiro contato.
  readonly point: Vector3DTO; // Ponto de contato no collider atingido (mundo).
  readonly normal: Vector3DTO; // Normal da superfície atingida (mundo).
  readonly entityId?: string;
}
interface OverlapQueryRequest extends PhysicsQueryFilter {
  readonly shape: QueryShapeDescriptor;
  readonly position: Vector3DTO;
  readonly rotation?: QuaternionDTO;
}
interface BodyTransformDTO {
  readonly position: Vector3DTO;
  readonly rotation: QuaternionDTO;
}
interface MutableBodyTransformDTO { // Destino mutável para leituras sem alocação (`getBodyTransformInto`).
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number; w: number };
}
interface KinematicTargetDTO {
  readonly position?: Vector3DTO;
  readonly rotation?: QuaternionDTO;
}
export type JointType = "fixed" | "revolute" | "spherical" | "prismatic" | "rope" | "spring";
interface JointLimitsDTO {
  readonly min: number;
  readonly max: number;
}
interface JointDescriptor {
  readonly type: JointType;
  readonly entityIdA: string;
  readonly entityIdB: string;
  readonly anchorA?: Vector3DTO; // Ponto de ancoragem no espaço local do corpo A.
  readonly anchorB?: Vector3DTO; // Ponto de ancoragem no espaço local do corpo B.
  readonly axis?: Vector3DTO; // Eixo (local) de revolute/prismatic.
  readonly frameA?: QuaternionDTO; // Orientação relativa (fixed).
  readonly frameB?: QuaternionDTO;
  readonly limits?: JointLimitsDTO; // Limites (rad para revolute, unidades para prismatic).
  readonly length?: number; // rope: comprimento máximo; spring: comprimento de repouso.
  readonly stiffness?: number; // spring
  readonly damping?: number; // spring
  readonly collideConnected?: boolean; // Se os corpos ligados colidem entre si.
}
interface JointMotorDTO {
  readonly targetPosition?: number;
  readonly targetVelocity?: number;
  readonly stiffness?: number;
  readonly damping?: number;
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
  readonly removed?: boolean; // true quando o exit foi gerado porque um dos corpos foi removido/recriado.
}
interface ContactForceEventPayload {
  readonly entityIdA: string;
  readonly entityIdB: string;
  readonly totalForceMagnitude: number; // Módulo da soma das forças de contato do par neste step (N).
  readonly maxForceMagnitude: number; // Maior força individual de contato do par neste step (N).
  readonly totalForce: Vector3DTO;
}
event ContactForceEvent = "game.physics.contact-force" payload ContactForceEventPayload // Emitido quando a força de contato de um par excede o `contactForceThreshold` de um dos colliders (intensidade…
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
