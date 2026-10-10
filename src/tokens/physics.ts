import { defineCapability } from "@core";
import type {
  RigidBodyDescriptor,
  ColliderDescriptor,
  Vector3DTO,
  QuaternionDTO,
  RaycastRequest,
  RaycastHit,
  PhysicsStats,
  AxisFlagsDTO,
  BodyTransformDTO,
  MutableBodyTransformDTO,
  KinematicTargetDTO,
  ShapeCastRequest,
  ShapeCastHit,
  OverlapQueryRequest,
  JointDescriptor,
  JointMotorDTO,
  CollisionGroupsDTO,
} from "../contracts/physics/types";

export interface PhysicsApi {
  /**
   * Avança a simulação física em um intervalo de tempo fixo.
   * A engine já chama isto no `game.loop.tick`; jogos normalmente não chamam.
   */
  step(deltaTimeSeconds: number): void;

  /**
   * Cria e registra um corpo rígido no mundo físico associado a uma entidade.
   * Recriar com o mesmo id remove o corpo anterior (emitindo os exits pendentes).
   */
  createBody(entityId: string, bodyDesc: RigidBodyDescriptor, colliderDesc?: ColliderDescriptor): boolean;

  /**
   * Anexa um collider adicional (compound shape) a um corpo existente.
   * Use `offset`/`rotationOffset` no descritor para posicioná-lo.
   */
  addCollider(entityId: string, colliderDesc: ColliderDescriptor): boolean;

  /**
   * Remove um corpo rígido do mundo físico. Emite `collision-exit`/`trigger-exit`
   * (com `removed: true`) para todo contato ativo do corpo e remove os joints ligados.
   */
  removeBody(entityId: string): boolean;

  hasBody(entityId: string): boolean;

  /**
   * Aplica um impulso vetorial em um corpo rígido dinâmico.
   */
  applyImpulse(entityId: string, impulse: Vector3DTO): boolean;

  /**
   * Aplica uma força contínua em um corpo rígido. A força é PERSISTENTE
   * até `resetForces`.
   */
  applyForce(entityId: string, force: Vector3DTO): boolean;

  /** Impulso angular (dynamic). */
  applyTorqueImpulse(entityId: string, torqueImpulse: Vector3DTO): boolean;

  /** Zera forças e torques persistentes de um corpo dinâmico. */
  resetForces(entityId: string): boolean;

  /**
   * Executa uma consulta de raio (Raycast) no espaço 3D.
   * Aceita filtros (`excludeEntityId`, `excludeSensors`, `collisionGroups`).
   * Corpos criados/movidos antes do step já são considerados.
   */
  castRay(request: RaycastRequest): RaycastHit;

  /** Varre uma forma ao longo de uma direção e retorna o primeiro impacto. */
  castShape(request: ShapeCastRequest): ShapeCastHit;

  /** Retorna os ids das entidades cujos colliders sobrepõem a forma (sem duplicatas). */
  queryOverlap(request: OverlapQueryRequest): string[];

  /**
   * Retorna a posição e rotação atuais de um corpo rígido como um objeto NOVO
   * (seguro para guardar). Para leitura sem alocação use `getBodyTransformInto`.
   */
  getBodyTransform(entityId: string): { position: Vector3DTO; rotation: QuaternionDTO } | null;

  /** Escreve o transform atual em `out` sem alocar. Retorna false se o corpo não existe. */
  getBodyTransformInto(entityId: string, out: MutableBodyTransformDTO): boolean;

  /**
   * Teleporta um corpo (qualquer tipo, inclusive `fixed`). Para mover um
   * `kinematicPositionBased` empurrando corpos dinâmicos use `setNextKinematicTransform`.
   */
  setBodyTranslation(entityId: string, position: Vector3DTO, wakeUp?: boolean): boolean;

  /** Define a rotação de um corpo (teleporte angular). */
  setBodyRotation(entityId: string, rotation: QuaternionDTO, wakeUp?: boolean): boolean;

  /** Teleporta posição e/ou rotação. */
  setBodyTransform(entityId: string, transform: Partial<BodyTransformDTO>, wakeUp?: boolean): boolean;

  /**
   * Define o alvo do próximo step de um `kinematicPositionBased` (a velocidade
   * é derivada e corpos dinâmicos são empurrados). Retorna false para outros tipos.
   */
  setNextKinematicTransform(entityId: string, target: KinematicTargetDTO): boolean;

  /** Velocidade linear atual (objeto novo) ou null. */
  getLinearVelocity(entityId: string): Vector3DTO | null;

  /** Define a velocidade linear (dynamic / kinematicVelocityBased). */
  setLinearVelocity(entityId: string, velocity: Vector3DTO, wakeUp?: boolean): boolean;

  /** Velocidade angular atual em rad/s (objeto novo) ou null. */
  getAngularVelocity(entityId: string): Vector3DTO | null;

  /** Define a velocidade angular (dynamic / kinematicVelocityBased). */
  setAngularVelocity(entityId: string, velocity: Vector3DTO, wakeUp?: boolean): boolean;

  /** Habilita/desabilita rotação por eixo em tempo de execução. */
  setEnabledRotations(entityId: string, axes: AxisFlagsDTO, wakeUp?: boolean): boolean;

  /** Trava/destrava todas as rotações. */
  lockRotations(entityId: string, locked: boolean, wakeUp?: boolean): boolean;

  /** Massa total do corpo (kg) ou null. Corpos não dinâmicos retornam a massa calculada (pode ser 0). */
  getBodyMass(entityId: string): number | null;

  /** true se o corpo está dormindo. null se não existe. */
  isBodySleeping(entityId: string): boolean | null;

  /** Acorda um corpo dormindo. */
  wakeBody(entityId: string): boolean;

  /** Redefine os grupos de colisão de TODOS os colliders da entidade. */
  setCollisionGroups(entityId: string, groups: CollisionGroupsDTO): boolean;

  /**
   * Cria um joint entre dois corpos existentes. `jointId` é escolhido pelo jogo;
   * recriar com o mesmo id substitui. O joint some junto com qualquer um dos corpos.
   */
  createJoint(jointId: string, desc: JointDescriptor): boolean;

  removeJoint(jointId: string): boolean;

  hasJoint(jointId: string): boolean;

  /** Configura motor de joint revolute/prismatic. */
  setJointMotor(jointId: string, motor: JointMotorDTO): boolean;

  /**
   * Sincroniza a posição e rotação de uma malha 3D com o corpo físico.
   * MUTA `targetMesh.position` e `targetMesh.quaternion`.
   */
  syncMeshTransform(entityId: string, targetMesh: { position: Vector3DTO; quaternion: QuaternionDTO }): boolean;

  /**
   * Define o vetor de aceleração da gravidade global e acorda todos os corpos.
   */
  setGravity(gravity: Vector3DTO): void;

  /** Gravidade atual (objeto novo). */
  getGravity(): Vector3DTO;

  /**
   * Retorna métricas de desempenho e contagem de entidades físicas ativas (objeto novo).
   */
  getStats(): PhysicsStats;
}

export const PhysicsToken = defineCapability<PhysicsApi>("game.physics", "1.0.0");
