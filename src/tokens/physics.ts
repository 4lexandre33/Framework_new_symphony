import { defineCapability } from "../core/contracts/capability-token";
import type {
  RigidBodyDescriptor,
  ColliderDescriptor,
  Vector3DTO,
  QuaternionDTO,
  RaycastRequest,
  RaycastHit,
  PhysicsStats,
} from "../contracts/physics/types";

export interface PhysicsApi {
  /**
   * Avança a simulação física em um intervalo de tempo fixo.
   */
  step(deltaTimeSeconds: number): void;

  /**
   * Cria e registra um corpo rígido no mundo físico associado a uma entidade.
   */
  createBody(entityId: string, bodyDesc: RigidBodyDescriptor, colliderDesc?: ColliderDescriptor): boolean;

  /**
   * Remove um corpo rígido do mundo físico.
   */
  removeBody(entityId: string): boolean;

  /**
   * Aplica um impulso vetorial em um corpo rígido dinâmico.
   */
  applyImpulse(entityId: string, impulse: Vector3DTO): boolean;

  /**
   * Aplica uma força contínua em um corpo rígido.
   */
  applyForce(entityId: string, force: Vector3DTO): boolean;

  /**
   * Executa uma consulta de raio (Raycast) no espaço 3D.
   */
  castRay(request: RaycastRequest): RaycastHit;

  /**
   * Retorna a posição e rotação atuais de um corpo rígido.
   */
  getBodyTransform(entityId: string): { position: Vector3DTO; rotation: QuaternionDTO } | null;

  /**
   * Sincroniza a posição e rotação de uma malha 3D com o corpo físico.
   */
  syncMeshTransform(entityId: string, targetMesh: { position: Vector3DTO; quaternion: QuaternionDTO }): boolean;

  /**
   * Define o vetor de aceleração da gravidade global.
   */
  setGravity(gravity: Vector3DTO): void;

  /**
   * Retorna métricas de desempenho e contagem de entidades físicas ativas.
   */
  getStats(): PhysicsStats;
}

export const PhysicsToken = defineCapability<PhysicsApi>("game.physics", "1.0.0");