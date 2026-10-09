// Corpo rígido + colisão. entityId é qualquer string única do seu jogo.
import type { PluginContext } from "@core";
import { CollisionEnterEvent } from "../../../contracts/physics/types";
import type { CollisionEventPayload } from "../../../contracts/physics/types";
import type { PhysicsApi } from "../../../tokens/physics";

export function spawnCrate(physics: PhysicsApi, id: string): () => void {
  physics.createBody(
    id,
    { bodyType: "dynamic", position: { x: 0, y: 5, z: 0 }, canSleep: true },
    { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, restitution: 0.3, friction: 0.6 },
  );
  physics.applyImpulse(id, { x: 0, y: 3, z: 0 });
  return (): void => {
    physics.removeBody(id); // sempre devolva o dispose
  };
}

export function onCollision(ctx: PluginContext, handler: (a: string, b: string) => void): () => void {
  return ctx.events.on<"game.physics.collision-enter", CollisionEventPayload>(CollisionEnterEvent.type, (env): void => {
    handler(env.payload.entityIdA, env.payload.entityIdB);
  });
}

// baseY = y da BASE do corpo. O raio nasce 0.05 ABAIXO da base (fora do corpo) e desce 0.2: não acerta o próprio corpo.
export function groundCheck(physics: PhysicsApi, x: number, baseY: number, z: number): boolean {
  return physics.castRay({ origin: { x, y: baseY - 0.05, z }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 0.2 }).hit;
}
