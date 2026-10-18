// Plataforma móvel (elevador, balsa, vagão simples): corpo kinematicPositionBased movido a cada tick com
// setNextKinematicTransform — a engine deriva a velocidade e EMPURRA/carrega corpos dinâmicos por contato.
// Personagem: dynamic com rotações travadas (fica em pé); chão por raio que ignora o próprio corpo.
import type { PhysicsApi } from "../../../tokens/physics";

export function createPlatform(physics: PhysicsApi, id: string, x: number, y: number, z: number): () => void {
  physics.createBody(id, { bodyType: "kinematicPositionBased", position: { x, y, z } }, { shapeType: "box", halfExtents: { x: 3, y: 0.25, z: 3 }, friction: 1 });
  // Grade como collider extra do MESMO corpo (move junto, sem joint):
  physics.addCollider(id, { shapeType: "box", halfExtents: { x: 3, y: 0.5, z: 0.05 }, offset: { x: 0, y: 0.75, z: 2.95 } });
  return (): void => {
    physics.removeBody(id);
  };
}

/** No tick: vai e volta em X com amplitude `a` e período `period` (s). Rotação opcional em `yaw` (rad). */
export function movePlatform(physics: PhysicsApi, id: string, baseX: number, y: number, z: number, t: number, a: number, period: number, yaw = 0): void {
  const x = baseX + a * Math.sin((2 * Math.PI * t) / period);
  physics.setNextKinematicTransform(id, {
    position: { x, y, z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
  });
}

export function createPlayer(physics: PhysicsApi, id: string, x: number, y: number, z: number): () => void {
  physics.createBody(
    id,
    { bodyType: "dynamic", position: { x, y, z }, lockRotations: true, canSleep: false, linearDamping: 0.5 },
    { shapeType: "capsule", radius: 0.35, halfHeight: 0.5, friction: 1, restitution: 0 },
  );
  return (): void => {
    physics.removeBody(id);
  };
}

/** Chão sob a cápsula (base = y − halfHeight − radius). Ignora o próprio corpo e sensores. */
export function isGrounded(physics: PhysicsApi, id: string, out: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }): boolean {
  if (!physics.getBodyTransformInto(id, out)) return false;
  const p = out.position;
  return physics.castRay({ origin: { x: p.x, y: p.y, z: p.z }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 0.85 + 0.1, excludeEntityId: id, excludeSensors: true }).hit;
}

/** Movimento horizontal: corrige a velocidade atual rumo à desejada (mantém a componente vertical). */
export function steer(physics: PhysicsApi, id: string, desiredX: number, desiredZ: number, gain = 0.25): void {
  const v = physics.getLinearVelocity(id);
  const m = physics.getBodyMass(id);
  if (v === null || m === null) return;
  physics.applyImpulse(id, { x: m * (desiredX - v.x) * gain, y: 0, z: m * (desiredZ - v.z) * gain });
}
// Teleporte (respawn): physics.setBodyTranslation(id, pos) — vale para qualquer tipo de corpo.
