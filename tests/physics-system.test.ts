import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PhysicsWorld } from "../src/engine/physics/internal/PhysicsWorld";
import type { RigidBodyDescriptor, ColliderDescriptor } from "../src/contracts/physics/types";

describe("Camada de Física - Rapier WASM (PhysicsWorld)", () => {
  let physicsWorld: PhysicsWorld;

  beforeEach(async () => {
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();
  });

  afterEach(() => {
    physicsWorld.dispose();
  });

  it("deve inicializar o motor de física e relatar status do WASM", () => {
    const stats = physicsWorld.getStats();
    expect(stats.isWasmLoaded).toBe(true);
    expect(stats.rigidBodyCount).toBe(0);
  });

  it("deve criar um corpo rígido dinâmico com colisor de caixa e simular a queda por gravidade", () => {
    const bodyDesc: RigidBodyDescriptor = {
      bodyType: "dynamic",
      position: { x: 0, y: 10, z: 0 },
    };

    const colliderDesc: ColliderDescriptor = {
      shapeType: "box",
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    };

    const created = physicsWorld.createBody("cube_1", bodyDesc, colliderDesc);
    expect(created).toBe(true);

    const initialTransform = physicsWorld.getBodyTransform("cube_1");
    expect(initialTransform).not.toBeNull();
    expect(initialTransform?.position.y).toBe(10);

    for (let i = 0; i < 10; i++) {
      physicsWorld.step(0.0166);
    }

    const updatedTransform = physicsWorld.getBodyTransform("cube_1");
    expect(updatedTransform?.position.y).toBeLessThan(10);
  });

  it("deve disparar e detectar um Raycast contra um colisor estático", () => {
    const groundDesc: RigidBodyDescriptor = {
      bodyType: "fixed",
      position: { x: 0, y: 0, z: 0 },
    };

    const groundCollider: ColliderDescriptor = {
      shapeType: "box",
      halfExtents: { x: 10, y: 0.1, z: 10 },
    };

    physicsWorld.createBody("ground", groundDesc, groundCollider);

    // Avança o tick da física para atualizar a árvore de aceleração espacial (BVH) do Rapier com os novos colisores
    physicsWorld.step(0.0166);

    const hit = physicsWorld.castRay({
      origin: { x: 0, y: 5, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 10,
    });

    expect(hit.hit).toBe(true);
    expect(hit.entityId).toBe("ground");
    expect(hit.distance).toBeCloseTo(4.9, 1);
  });
});