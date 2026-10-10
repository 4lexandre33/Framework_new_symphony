// @vitest-environment node

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { PluginContext } from "@core";

import { PhysicsService } from "../src/engine/physics/internal/PhysicsService";
import { PhysicsWorld } from "../src/engine/physics/internal/PhysicsWorld";
import { RigidBodyFactory } from "../src/engine/physics/internal/RigidBodyFactory";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function createFakeContext(
  emitted: Emitted[],
): PluginContext {
  return {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
      async emitAsync(type: string, payload: Record<string, unknown>): Promise<void> {
        emitted.push({ type, payload });
      },
    },
  } as unknown as PluginContext;
}

const DT = 1 / 60;

describe("physics gaps (G1, G2, G33–G37)", () => {
  let emitted: Emitted[];
  let service: PhysicsService;

  beforeEach(async () => {
    emitted = [];
    service = new PhysicsService(
      createFakeContext(emitted),
      new PhysicsWorld(),
    );
    expect(await service.initialize()).toBe(true);
  });

  afterEach(() => {
    service.dispose();
  });

  function stepN(count: number): void {
    for (let index = 0; index < count; index += 1) {
      service.step(DT);
    }
  }

  function addGround(): void {
    service.createBody(
      "ground",
      { bodyType: "fixed", position: { x: 0, y: -0.5, z: 0 } },
      { shapeType: "box", halfExtents: { x: 50, y: 0.5, z: 50 } },
    );
  }

  it("G1: teleporta corpo fixed e move kinematic com setNextKinematicTransform", () => {
    service.createBody(
      "wall",
      { bodyType: "fixed", position: { x: 0, y: 0, z: 0 } },
      { shapeType: "box" },
    );

    expect(service.setBodyTranslation("wall", { x: 5, y: 1, z: 2 })).toBe(true);
    expect(service.getBodyTransform("wall")?.position).toEqual({ x: 5, y: 1, z: 2 });

    const quarterTurn = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    expect(service.setBodyRotation("wall", quarterTurn)).toBe(true);
    expect(service.getBodyTransform("wall")?.rotation.y).toBeCloseTo(Math.SQRT1_2, 5);

    expect(service.setBodyTransform("wall", { position: { x: -1, y: 0, z: 0 } })).toBe(true);
    expect(service.getBodyTransform("wall")?.position.x).toBe(-1);

    // Consultas enxergam o teleporte sem step (G36).
    const hit = service.castRay({
      origin: { x: -1, y: 5, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 10,
    });
    expect(hit.entityId).toBe("wall");

    service.createBody(
      "platform",
      { bodyType: "kinematicPositionBased", position: { x: 0, y: 0, z: 0 } },
      { shapeType: "box" },
    );
    expect(service.setNextKinematicTransform("platform", { position: { x: 1, y: 0, z: 0 } })).toBe(true);
    stepN(1);
    expect(service.getBodyTransform("platform")?.position.x).toBeCloseTo(1, 5);
    // A velocidade derivada do movimento kinematic é exposta.
    expect(service.getLinearVelocity("platform")?.x).toBeCloseTo(60, 1);

    // setNextKinematicTransform só vale para kinematicPositionBased.
    expect(service.setNextKinematicTransform("wall", { position: { x: 0, y: 0, z: 0 } })).toBe(false);
    expect(service.setBodyTranslation("missing", { x: 0, y: 0, z: 0 })).toBe(false);
  });

  it("G1: lê e define velocidade linear/angular", () => {
    service.setGravity({ x: 0, y: 0, z: 0 });
    service.createBody(
      "ball",
      { bodyType: "dynamic", linearVelocity: { x: 2, y: 0, z: 0 } },
      { shapeType: "sphere", radius: 0.5 },
    );

    expect(service.getLinearVelocity("ball")).toEqual({ x: 2, y: 0, z: 0 });
    expect(service.setLinearVelocity("ball", { x: 0, y: 0, z: 3 })).toBe(true);
    stepN(60);
    expect(service.getBodyTransform("ball")?.position.z).toBeCloseTo(3, 1);

    expect(service.setAngularVelocity("ball", { x: 0, y: 1, z: 0 })).toBe(true);
    expect(service.getAngularVelocity("ball")?.y).toBeCloseTo(1, 5);

    service.createBody("static", { bodyType: "fixed" }, { shapeType: "box" });
    expect(service.setLinearVelocity("static", { x: 1, y: 0, z: 0 })).toBe(false);
    expect(service.getLinearVelocity("missing")).toBeNull();
  });

  it("G2: lockRotations mantém o personagem em pé", () => {
    addGround();
    service.createBody(
      "hero",
      { bodyType: "dynamic", position: { x: 0, y: 1, z: 0 }, lockRotations: true },
      { shapeType: "capsule", halfHeight: 0.5, radius: 0.3 },
    );
    service.applyTorqueImpulse("hero", { x: 5, y: 0, z: 5 });
    service.applyImpulse("hero", { x: 3, y: 0, z: 0 });
    stepN(120);

    const rotation = service.getBodyTransform("hero")?.rotation;
    expect(Math.abs(rotation?.x ?? 1)).toBeLessThan(1e-6);
    expect(Math.abs(rotation?.z ?? 1)).toBeLessThan(1e-6);

    // Só em Y: aceita giro em Y via API runtime.
    expect(service.lockRotations("hero", false)).toBe(true);
    expect(service.setEnabledRotations("hero", { x: false, y: true, z: false })).toBe(true);
    expect(service.setAngularVelocity("hero", { x: 0, y: 2, z: 0 })).toBe(true);
    stepN(10);
    const yawed = service.getBodyTransform("hero")?.rotation;
    expect(Math.abs(yawed?.y ?? 0)).toBeGreaterThan(0.01);
    expect(Math.abs(yawed?.x ?? 1)).toBeLessThan(1e-6);
  });

  it("G1/G2: massa, sono e acordar", () => {
    service.createBody(
      "crate",
      { bodyType: "dynamic", additionalMass: 2 },
      { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, density: 1 },
    );
    expect(service.getBodyMass("crate")).toBeCloseTo(3, 4);
    expect(service.isBodySleeping("crate")).toBe(false);
    expect(service.wakeBody("crate")).toBe(true);
    expect(service.getBodyMass("missing")).toBeNull();
  });

  it("G33: getBodyTransform devolve objeto novo; getBodyTransformInto não aloca", () => {
    service.createBody("a", { bodyType: "fixed", position: { x: 1, y: 2, z: 3 } });
    const first = service.getBodyTransform("a");
    const second = service.getBodyTransform("a");
    expect(first).not.toBe(second);
    service.setBodyTranslation("a", { x: 9, y: 9, z: 9 });
    expect(first?.position).toEqual({ x: 1, y: 2, z: 3 });

    const out = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    expect(service.getBodyTransformInto("a", out)).toBe(true);
    expect(out.position).toEqual({ x: 9, y: 9, z: 9 });
    expect(service.getBodyTransformInto("missing", out)).toBe(false);

    const stats = service.getStats();
    expect(stats).not.toBe(service.getStats());
  });

  it("G34: removeBody emite collision-exit e trigger-exit com removed=true", () => {
    addGround();
    service.createBody(
      "zone",
      { bodyType: "fixed", position: { x: 0, y: 1, z: 0 } },
      { shapeType: "box", halfExtents: { x: 2, y: 2, z: 2 }, isSensor: true },
    );
    service.createBody(
      "box",
      { bodyType: "dynamic", position: { x: 0, y: 0.5, z: 0 } },
      { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
    );
    stepN(10);

    expect(emitted.some((event) => event.type === "game.physics.collision-enter")).toBe(true);
    expect(emitted.some((event) => event.type === "game.physics.trigger-enter")).toBe(true);
    emitted.length = 0;

    expect(service.removeBody("box")).toBe(true);

    const collisionExit = emitted.find((event) => event.type === "game.physics.collision-exit");
    const triggerExit = emitted.find((event) => event.type === "game.physics.trigger-exit");
    expect(collisionExit?.payload.removed).toBe(true);
    expect(triggerExit?.payload.removed).toBe(true);
    expect(
      [collisionExit?.payload.entityIdA, collisionExit?.payload.entityIdB].sort(),
    ).toEqual(["box", "ground"]);

    // Rapier reporta o fim do contato no próximo step: não duplica.
    emitted.length = 0;
    stepN(2);
    expect(emitted.filter((event) => event.type.endsWith("-exit"))).toHaveLength(0);
  });

  it("G34: recriar o corpo com o mesmo id também emite exits", () => {
    addGround();
    service.createBody(
      "box",
      { bodyType: "dynamic", position: { x: 0, y: 0.5, z: 0 } },
      { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 } },
    );
    stepN(3);
    emitted.length = 0;
    service.createBody("box", { bodyType: "dynamic", position: { x: 0, y: 20, z: 0 } }, { shapeType: "sphere" });
    expect(emitted.some((event) => event.type === "game.physics.collision-exit")).toBe(true);
  });

  it("G35: collider offset, compound, grupos e novas formas", () => {
    service.createBody(
      "compound",
      { bodyType: "fixed", position: { x: 0, y: 0, z: 0 } },
      { shapeType: "box", halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, offset: { x: 10, y: 0, z: 0 } },
    );
    expect(
      service.addCollider("compound", { shapeType: "cylinder", halfHeight: 1, radius: 0.5, offset: { x: -10, y: 0, z: 0 } }),
    ).toBe(true);
    expect(service.getStats().colliderCount).toBe(2);

    const right = service.castRay({ origin: { x: 10, y: 5, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 });
    expect(right.entityId).toBe("compound");
    expect(right.distance).toBeCloseTo(4.5, 3);
    const center = service.castRay({ origin: { x: 0, y: 5, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 });
    expect(center.hit).toBe(false);
    const left = service.castRay({ origin: { x: -10, y: 5, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 });
    expect(left.distance).toBeCloseTo(4, 3);

    // Grupos: o raio filtrado por grupo 2 não vê o collider no grupo 1.
    expect(service.setCollisionGroups("compound", { memberships: 0x0001, filter: 0xffff })).toBe(true);
    const filtered = service.castRay({
      origin: { x: 10, y: 5, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 10,
      collisionGroups: { memberships: 0xffff, filter: 0x0002 },
    });
    expect(filtered.hit).toBe(false);

    expect(() => RigidBodyFactory.createColliderDesc({ shapeType: "cone", halfHeight: 1, radius: 1 })).not.toThrow();
    expect(() =>
      RigidBodyFactory.createColliderDesc({
        shapeType: "convexHull",
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      }),
    ).not.toThrow();
    expect(() =>
      RigidBodyFactory.createColliderDesc({ shapeType: "convexHull", vertices: new Float32Array([0, 0, 0, 1, 0, 0]) }),
    ).toThrow();
    expect(() =>
      RigidBodyFactory.createColliderDesc({ shapeType: "box", collisionGroups: { memberships: 0x1ffff, filter: 1 } }),
    ).toThrow();
  });

  it("G35: heightfield como chão", () => {
    const heights = new Float32Array(9).fill(1);
    service.createBody(
      "terrain",
      { bodyType: "fixed" },
      { shapeType: "heightfield", rows: 2, cols: 2, heights, scale: { x: 10, y: 2, z: 10 } },
    );
    const hit = service.castRay({ origin: { x: 1, y: 10, z: 1 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 20 });
    expect(hit.entityId).toBe("terrain");
    expect(hit.point.y).toBeCloseTo(2, 3);
    expect(() =>
      RigidBodyFactory.createColliderDesc({ shapeType: "heightfield", rows: 2, cols: 2, heights: new Float32Array(4) }),
    ).toThrow();
  });

  it("G35: joints fixed/revolute/spherical/prismatic e remoção junto com o corpo", () => {
    service.createBody("anchor", { bodyType: "fixed", position: { x: 0, y: 5, z: 0 } }, { shapeType: "sphere", radius: 0.1 });
    service.createBody("bob", { bodyType: "dynamic", position: { x: 0, y: 3, z: 0 } }, { shapeType: "sphere", radius: 0.2 });

    expect(
      service.createJoint("rod", {
        type: "fixed",
        entityIdA: "anchor",
        entityIdB: "bob",
        anchorA: { x: 0, y: 0, z: 0 },
        anchorB: { x: 0, y: 2, z: 0 },
      }),
    ).toBe(true);
    stepN(60);
    expect(service.getBodyTransform("bob")?.position.y).toBeCloseTo(3, 1);
    expect(service.hasJoint("rod")).toBe(true);
    expect(service.removeJoint("rod")).toBe(true);
    expect(service.hasJoint("rod")).toBe(false);

    expect(
      service.createJoint("hinge", {
        type: "revolute",
        entityIdA: "anchor",
        entityIdB: "bob",
        anchorB: { x: 0, y: 2, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        limits: { min: -0.5, max: 0.5 },
      }),
    ).toBe(true);
    expect(service.setJointMotor("hinge", { targetVelocity: 1, damping: 10 })).toBe(true);
    expect(
      service.createJoint("ball", { type: "spherical", entityIdA: "anchor", entityIdB: "bob", anchorB: { x: 0, y: 2, z: 0 } }),
    ).toBe(true);
    expect(
      service.createJoint("slider", {
        type: "prismatic",
        entityIdA: "anchor",
        entityIdB: "bob",
        axis: { x: 0, y: 1, z: 0 },
        limits: { min: -3, max: -1 },
      }),
    ).toBe(true);
    expect(service.setJointMotor("ball", { targetVelocity: 1 })).toBe(false);
    expect(() => service.createJoint("bad", { type: "revolute", entityIdA: "anchor", entityIdB: "bob" })).toThrow();
    expect(service.createJoint("ghost", { type: "spherical", entityIdA: "anchor", entityIdB: "missing" })).toBe(false);
    stepN(10);

    service.removeBody("bob");
    expect(service.hasJoint("hinge")).toBe(false);
    expect(service.hasJoint("ball")).toBe(false);
    expect(service.hasJoint("slider")).toBe(false);
  });

  it("G35: castShape e queryOverlap com filtro", () => {
    addGround();
    service.createBody("pillar", { bodyType: "fixed", position: { x: 5, y: 1, z: 0 } }, { shapeType: "box", halfExtents: { x: 0.5, y: 1, z: 0.5 } });
    service.createBody("hero", { bodyType: "dynamic", position: { x: 0, y: 1, z: 0 } }, { shapeType: "sphere", radius: 0.5 });

    const sweep = service.castShape({
      shape: { shapeType: "sphere", radius: 0.5 },
      position: { x: 0, y: 1, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      maxDistance: 10,
      excludeEntityId: "hero",
    });
    expect(sweep.hit).toBe(true);
    expect(sweep.entityId).toBe("pillar");
    expect(sweep.distance).toBeCloseTo(4, 2);
    expect(sweep.normal.x).toBeCloseTo(-1, 3);
    expect(sweep.point.x).toBeCloseTo(4.5, 2);

    // Collider deslocado e rotacionado 45° em Y: normal em mundo é diagonal.
    const yaw45 = { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) };
    service.createBody("diamond", { bodyType: "fixed", position: { x: 0, y: 1, z: 6 }, rotation: yaw45 }, { shapeType: "box", halfExtents: { x: 0.5, y: 1, z: 0.5 } });
    const diagonal = service.castShape({
      shape: { shapeType: "sphere", radius: 0.1 },
      position: { x: 0.2, y: 1, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
      maxDistance: 10,
      excludeEntityId: "hero",
    });
    expect(diagonal.entityId).toBe("diamond");
    expect(diagonal.normal.z).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(Math.abs(diagonal.normal.x)).toBeCloseTo(Math.SQRT1_2, 3);
    // Ponto no plano da face: distância do centro ao longo da normal = 0.5.
    const along = (diagonal.point.x - 0) * diagonal.normal.x + (diagonal.point.z - 6) * diagonal.normal.z;
    expect(along).toBeCloseTo(0.5, 3);

    const overlap = service.queryOverlap({
      shape: { shapeType: "box", halfExtents: { x: 10, y: 3, z: 10 } },
      position: { x: 0, y: 1, z: 0 },
    });
    expect(overlap.sort()).toEqual(["diamond", "ground", "hero", "pillar"]);

    const withoutHero = service.queryOverlap({
      shape: { shapeType: "sphere", radius: 1 },
      position: { x: 0, y: 1, z: 0 },
      excludeEntityId: "hero",
    });
    expect(withoutHero).toEqual(["ground"]);
  });

  it("G35: evento de força de contato (impacto)", async () => {
    addGround();
    service.createBody(
      "rock",
      { bodyType: "dynamic", position: { x: 0, y: 3, z: 0 }, linearVelocity: { x: 0, y: -10, z: 0 } },
      { shapeType: "sphere", radius: 0.5, contactForceThreshold: 1 },
    );
    for (let index = 0; index < 60; index += 1) {
      await service.stepForGameLoop(DT);
    }
    const impact = emitted.find((event) => event.type === "game.physics.contact-force");
    expect(impact).toBeDefined();
    expect(impact?.payload.totalForceMagnitude as number).toBeGreaterThan(1);
  });

  it("G36: raycast ignora o próprio corpo e sensores; corpo novo é consultável antes do step", () => {
    service.createBody("hero", { bodyType: "dynamic", position: { x: 0, y: 1, z: 0 } }, { shapeType: "capsule", halfHeight: 0.5, radius: 0.3 });
    service.createBody("trigger", { bodyType: "fixed", position: { x: 0, y: -1, z: 0 } }, { shapeType: "box", isSensor: true });
    service.createBody("floor", { bodyType: "fixed", position: { x: 0, y: -3, z: 0 } }, { shapeType: "box" });

    const naive = service.castRay({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 });
    expect(naive.entityId).toBe("hero");

    const filtered = service.castRay({
      origin: { x: 0, y: 1, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      maxDistance: 10,
      excludeEntityId: "hero",
      excludeSensors: true,
    });
    expect(filtered.entityId).toBe("floor");
    expect(filtered.distance).toBeCloseTo(3.5, 3);
  });

  it("G37: restitution > 1, setGravity acorda corpos, trigger fixed detecta kinematic", () => {
    expect(() => RigidBodyFactory.createColliderDesc({ shapeType: "sphere", restitution: 1.5 })).not.toThrow();
    expect(() => RigidBodyFactory.createColliderDesc({ shapeType: "sphere", restitution: -0.1 })).toThrow();

    addGround();
    service.createBody("sleeper", { bodyType: "dynamic", position: { x: 0, y: 0.5, z: 0 } }, { shapeType: "box" });
    stepN(240);
    expect(service.isBodySleeping("sleeper")).toBe(true);
    service.setGravity({ x: 0, y: 9.81, z: 0 });
    expect(service.getGravity().y).toBeCloseTo(9.81, 5);
    expect(service.isBodySleeping("sleeper")).toBe(false);
    stepN(30);
    expect(service.getBodyTransform("sleeper")?.position.y).toBeGreaterThan(1);

    emitted.length = 0;
    service.createBody("zone", { bodyType: "fixed", position: { x: 20, y: 0, z: 0 } }, { shapeType: "box", isSensor: true });
    service.createBody("mover", { bodyType: "kinematicPositionBased", position: { x: 15, y: 0, z: 0 } }, { shapeType: "box" });
    for (let step = 1; step <= 10; step += 1) {
      service.setNextKinematicTransform("mover", { position: { x: 15 + step * 0.6, y: 0, z: 0 } });
      service.step(DT);
    }
    expect(emitted.some((event) => event.type === "game.physics.trigger-enter")).toBe(true);
  });
});
