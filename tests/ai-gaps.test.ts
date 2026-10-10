// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import type { PluginContext } from "@core";

import type { NavMeshGraph, NavMeshPolygon, Vector3AI } from "../src/contracts/ai/types";
import { AIService } from "../src/engine/ai/internal/AIService";
import { NavMeshQuery } from "../src/engine/ai/internal/NavMeshQuery";
import { PhysicsService } from "../src/engine/physics/internal/PhysicsService";
import { PhysicsWorld } from "../src/engine/physics/internal/PhysicsWorld";
import { createAIPlugin } from "../src/plugins/ai/plugin";
import type { WorldApi } from "../src/tokens/world";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function ctxFor(emitted: Emitted[]): PluginContext {
  return {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
      async emitAsync(type: string, payload: Record<string, unknown>): Promise<void> {
        emitted.push({ type, payload });
      },
    },
    log: { debug(): void {}, info(): void {}, warn(): void {}, error(): void {} },
  } as unknown as PluginContext;
}

/** World mínimo: posições mutáveis por id. */
function createWorld(): { api: WorldApi; positions: Map<string, Vector3AI>; updates: string[] } {
  const positions = new Map<string, Vector3AI>();
  const updates: string[] = [];
  const api = {
    getEntityState(id: string) {
      const position = positions.get(id);
      return position ? { entityId: id, position: { ...position } } : null;
    },
    updateEntityTransform(id: string, patch: { position?: Vector3AI }): boolean {
      if (!positions.has(id) || !patch.position) return false;
      positions.set(id, { x: patch.position.x, y: patch.position.y, z: patch.position.z });
      updates.push(id);
      return true;
    },
  } as unknown as WorldApi;
  return { api, positions, updates };
}

function rect(id: number, x0: number, z0: number, x1: number, z1: number, neighbors: number[], y = 0, extra: Partial<NavMeshPolygon> = {}): NavMeshPolygon {
  return {
    id,
    vertices: [
      { x: x0, y, z: z0 },
      { x: x1, y, z: z0 },
      { x: x1, y, z: z1 },
      { x: x0, y, z: z1 },
    ],
    neighbors,
    center: { x: (x0 + x1) / 2, y, z: (z0 + z1) / 2 },
    ...extra,
  };
}

/** Corredor em L: 0 = (0..10, 0..2), 1 = (8..10, 2..10). */
function lCorridor(): NavMeshGraph {
  return {
    polygons: [
      rect(0, 0, 0, 10, 2, [1]),
      rect(1, 8, 2, 10, 10, [0]),
    ],
  };
}

function stepService(service: AIService, seconds: number): void {
  const dt = 1 / 60;

  for (let t = 0; t < seconds; t += dt) {
    service.update(dt);
  }
}

const physicsServices: PhysicsService[] = [];

afterEach(() => {
  while (physicsServices.length > 0) {
    physicsServices.pop()!.dispose();
  }
});

describe("ai gaps — G7 árvores próprias e várias navmeshes", () => {
  it("árvore declarativa por agente com ações registradas, move-to e blackboard", () => {
    const emitted: Emitted[] = [];
    const service = new AIService(ctxFor(emitted));
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 20, 20, [])] });
    const calls: string[] = [];
    service.registerBehaviorAction("bark", (context, _dt, params) => {
      calls.push(`${context.agentId}:${String(params?.word)}`);
      context.setBlackboard("barked", true);
      return "SUCCESS";
    });
    service.registerBehaviorCondition("is-alert", (context) => context.getBlackboard("alert") === true);
    expect(service.registerAgent({ agentId: "dog", entityId: "dog_e", initialPosition: { x: 1, y: 0, z: 1 } })).toBe(true);
    expect(
      service.setAgentBehavior("dog", {
        type: "selector",
        children: [
          {
            type: "sequence",
            children: [
              { type: "condition", name: "is-alert" },
              { type: "action", name: "bark", params: { word: "woof" } },
              { type: "move-to", position: { x: 15, y: 0, z: 15 } },
              { type: "set-blackboard", key: "status", value: "done" },
            ],
          },
          { type: "set-blackboard", key: "status", value: "idle" },
        ],
      }),
    ).toBe(true);

    service.update(1 / 60);
    expect(service.getBlackboardValue("dog", "status")).toBe("idle");
    service.setBlackboardValue("dog", "alert", true);
    stepService(service, 6);
    expect(calls[0]).toBe("dog:woof");
    expect(service.getBlackboardValue("dog", "status")).toBe("done");
    const position = service.getAgentPosition("dog")!;
    expect(Math.hypot(position.x - 15, position.z - 15)).toBeLessThan(1.1);

    // Definição inválida é recusada e a anterior continua.
    expect(service.setAgentBehavior("dog", { type: "action", name: "missing" })).toBe(false);
    expect(service.setAgentBehavior("dog", { type: "nope" } as never)).toBe(false);
    expect(service.registerAgent({ agentId: "bad", entityId: "x", behavior: { type: "action", name: "missing" } })).toBe(false);
    // null volta à árvore padrão.
    expect(service.setAgentBehavior("dog", null)).toBe(true);
  });

  it("várias navmeshes coexistem; agente usa a sua", () => {
    const service = new AIService(ctxFor([]));
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 10, 10, [])] });
    service.loadNavMesh({ polygons: [rect(0, 100, 0, 110, 10, [])] }, "island");
    expect(service.getNavMeshIds().sort()).toEqual(["default", "island"]);
    expect(service.findPath({ start: { x: 101, y: 0, z: 1 }, target: { x: 109, y: 0, z: 9 }, navMeshId: "island", offMeshPolicy: "fail" }).found).toBe(true);
    expect(service.findPath({ start: { x: 101, y: 0, z: 1 }, target: { x: 109, y: 0, z: 9 }, offMeshPolicy: "fail" }).found).toBe(false);
    service.registerAgent({ agentId: "a", entityId: "a", initialPosition: { x: 101, y: 0, z: 1 }, navMeshId: "island" });
    expect(service.setAgentTarget("a", { x: 109, y: 0, z: 9 }).found).toBe(true);
    expect(service.unloadNavMesh("island")).toBe(true);
    expect(service.getNavMeshIds()).toEqual(["default"]);
  });
});

describe("ai gaps — G25 teleporte", () => {
  it("setAgentPosition teleporta e para; keepTarget refaz o caminho", () => {
    const service = new AIService(ctxFor([]));
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 30, 30, [])] });
    service.registerAgent({ agentId: "a", entityId: "a", initialPosition: { x: 1, y: 0, z: 1 } });
    service.setAgentTarget("a", { x: 29, y: 0, z: 29 });
    stepService(service, 0.5);
    expect(service.setAgentPosition("a", { x: 20, y: 0, z: 5 })).toBe(true);
    expect(service.getAgentPosition("a")).toEqual({ x: 20, y: 0, z: 5 });
    expect(service.getAgentState("a")?.moving).toBe(false);
    service.update(1 / 60);
    expect(service.getAgentPosition("a")).toEqual({ x: 20, y: 0, z: 5 });

    service.setAgentTarget("a", { x: 29, y: 0, z: 29 });
    service.setAgentPosition("a", { x: 25, y: 0, z: 25 }, { keepTarget: true });
    expect(service.getAgentState("a")?.moving).toBe(true);
    expect(service.setAgentPosition("missing", { x: 0, y: 0, z: 0 })).toBe(false);
  });
});

describe("ai gaps — G69 linha de visão com filtros", () => {
  it("ignora o collider do agente, conta o collider do alvo e é bloqueada por parede", async () => {
    const physics = new PhysicsService(ctxFor([]), new PhysicsWorld());
    expect(await physics.initialize()).toBe(true);
    physicsServices.push(physics);
    const emitted: Emitted[] = [];
    const world = createWorld();
    const service = new AIService(ctxFor(emitted));
    service.bindDependencies(physics, world.api);
    service.loadNavMesh({ polygons: [rect(0, -20, -20, 20, 20, [])] });
    world.positions.set("guard", { x: 0, y: 0, z: 0 });
    world.positions.set("player", { x: 0, y: 0, z: 10 });
    // Collider do guarda envolve a origem do raio; o do jogador envolve o alvo.
    physics.createBody("guard", { bodyType: "fixed", position: { x: 0, y: 1, z: 0 } }, { shapeType: "capsule", radius: 0.5, halfHeight: 0.5 });
    physics.createBody("player", { bodyType: "fixed", position: { x: 0, y: 1, z: 10 } }, { shapeType: "capsule", radius: 0.5, halfHeight: 0.5 });
    service.registerAgent({
      agentId: "g",
      entityId: "guard",
      maxSpeed: 0,
      perceptionConfig: { visionDistance: 30, visionAngleDegrees: 90, hearingRadius: 0, eyeHeight: 1, targetHeight: 1 },
    });
    expect(service.getAgentPosition("g")).toEqual({ x: 0, y: 0, z: 0 });
    expect(service.setAgentTargetEntity("g", "player")).toBe(true);
    service.update(1 / 60);
    expect(emitted.filter((e) => e.type === "game.ai.target-spotted")).toHaveLength(1);
    expect(emitted.find((e) => e.type === "game.ai.target-spotted")?.payload).toMatchObject({ senseType: "vision", targetEntityId: "player" });

    // Parede entre os dois: perde de vista.
    physics.createBody("wall", { bodyType: "fixed", position: { x: 0, y: 1, z: 5 } }, { shapeType: "box", halfExtents: { x: 3, y: 2, z: 0.2 } });
    service.update(1 / 60);
    expect(service.getBlackboardValue("g", "targetSpotted")).toBe(false);
    physics.removeBody("wall");
    service.update(1 / 60);
    expect(service.getBlackboardValue("g", "targetSpotted")).toBe(true);
    expect(emitted.filter((e) => e.type === "game.ai.target-spotted")).toHaveLength(2);
  });
});

describe("ai gaps — G70 audição real", () => {
  it("andar até um ponto não 'ouve' o destino; estímulo tem raio e não redireciona", () => {
    const emitted: Emitted[] = [];
    const service = new AIService(ctxFor(emitted));
    service.loadNavMesh({ polygons: [rect(0, -50, -50, 50, 50, [])] });
    service.registerAgent({ agentId: "near", entityId: "near", initialPosition: { x: 0, y: 0, z: 0 }, perceptionConfig: { hearingRadius: 10 } });
    service.registerAgent({ agentId: "far", entityId: "far", initialPosition: { x: 40, y: 0, z: 40 }, perceptionConfig: {} });
    service.registerAgent({
      agentId: "curious",
      entityId: "curious",
      initialPosition: { x: -5, y: 0, z: 0 },
      perceptionConfig: { investigateStimuli: true, hearingSensitivity: 2 },
    });
    service.setAgentTarget("near", { x: 3, y: 0, z: 0 });
    stepService(service, 2);
    expect(emitted.some((e) => e.type === "game.ai.target-spotted")).toBe(false);

    service.setAgentTarget("near", { x: -30, y: 0, z: 0 });
    service.triggerAudioStimulus({ x: 5, y: 0, z: 5 }, 12, "player");
    const heard = emitted.filter((e) => e.type === "game.ai.stimulus-heard").map((e) => e.payload.agentId);
    expect(heard.sort()).toEqual(["curious", "near"]);
    expect(service.getBlackboardValue("near", "lastHeardPosition")).toEqual({ x: 5, y: 0, z: 5 });
    expect(service.getBlackboardValue("near", "lastHeardSourceEntityId")).toBe("player");
    // Sem redirecionar: "near" segue para (-30, 0, 0).
    expect(service.getBlackboardValue("near", "targetPos")).toEqual({ x: -30, y: 0, z: 0 });
    // investigateStimuli: vai até o som.
    expect(service.getBlackboardValue("curious", "targetPos")).toEqual({ x: 5, y: 0, z: 5 });

    // Estímulo numa ilha desconectada (sem caminho): o alvo atual NÃO é cancelado.
    service.loadNavMesh({ polygons: [rect(0, -50, -50, 50, 50, []), rect(1, 200, 200, 210, 210, [])] });
    service.triggerAudioStimulus({ x: 205, y: 0, z: 205 }, 1000);
    expect(service.getBlackboardValue("curious", "targetPos")).toEqual({ x: 5, y: 0, z: 5 });
    expect(service.getAgentState("curious")?.moving).toBe(true);
  });
});

describe("ai gaps — G71 fora da malha e busca 3D", () => {
  it("destino fora da navmesh é preso à borda (sem atravessar parede) ou falha com 'fail'", () => {
    const query = new NavMeshQuery();
    query.loadGraph(lCorridor());
    // Destino no "vazio" dentro da quina do L (atrás da parede): (4, 0, 6).
    const result = query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 4, y: 0, z: 6 } });
    expect(result.found).toBe(true);
    expect(result.clampedTarget).toBeDefined();
    const last = result.waypoints[result.waypoints.length - 1]!;
    // O ponto final está sobre a malha.
    const insideA = last.x >= 0 && last.x <= 10 && last.z >= 0 && last.z <= 2 + 1e-3;
    const insideB = last.x >= 8 - 1e-3 && last.x <= 10 && last.z >= 2 && last.z <= 10;
    expect(insideA || insideB).toBe(true);
    expect(query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 4, y: 0, z: 6 }, offMeshPolicy: "fail" }).found).toBe(false);
    expect(query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 4, y: 0, z: 6 }, maxSnapDistance: 1 }).found).toBe(false);
  });

  it("andares sobrepostos: o polígono certo é escolhido pela altura", () => {
    const query = new NavMeshQuery();
    query.loadGraph({
      polygons: [
        rect(0, 0, 0, 10, 10, [], 0),
        rect(1, 0, 0, 10, 10, [], 5),
      ],
    });
    // Mesmo andar: ok. Andares diferentes (não conectados): sem caminho.
    expect(query.findPath({ start: { x: 1, y: 5, z: 1 }, target: { x: 9, y: 5, z: 9 }, offMeshPolicy: "fail" }).found).toBe(true);
    const upper = query.findPath({ start: { x: 1, y: 5, z: 1 }, target: { x: 9, y: 5, z: 9 } });
    expect(upper.waypoints.every((point) => point.y === 5)).toBe(true);
    expect(query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 9, y: 5, z: 9 }, offMeshPolicy: "fail" }).found).toBe(false);
  });
});

describe("ai gaps — G72 portais tolerantes, raio, carga atômica", () => {
  it("T-junction e vértices quase iguais formam portal", () => {
    const query = new NavMeshQuery();
    query.loadGraph({
      polygons: [
        rect(0, 0, 0, 10, 10, [1, 2]),
        rect(1, 10.001, 0, 20, 5, [0]),
        rect(2, 10, 5, 20, 10.002, [0]),
      ],
    });
    expect(query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 19, y: 0, z: 2 } }).found).toBe(true);
    expect(query.findPath({ start: { x: 1, y: 0, z: 9 }, target: { x: 19, y: 0, z: 9 } }).found).toBe(true);
  });

  it("raio do agente: portal estreito bloqueia; o caminho mantém distância da quina", () => {
    const query = new NavMeshQuery();
    query.loadGraph({
      polygons: [
        rect(0, 0, 0, 10, 10, [1]),
        // Porta de 1 unidade em x=10 (z 4..5).
        rect(1, 10, 4, 12, 5, [0, 2]),
        rect(2, 12, 0, 22, 10, [1]),
      ],
    });
    expect(query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 20, y: 0, z: 1 }, agentRadius: 0.6 }).found).toBe(false);
    const ok = query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 20, y: 0, z: 1 }, agentRadius: 0.3 });
    expect(ok.found).toBe(true);
    // Passa pela porta longe das quinas (z entre 4.3 e 4.7).
    const atDoor = ok.waypoints.filter((point) => Math.abs(point.x - 10) < 1e-6 || Math.abs(point.x - 12) < 1e-6);
    expect(atDoor.length).toBeGreaterThan(0);

    for (const point of atDoor) {
      expect(point.z).toBeGreaterThanOrEqual(4.3 - 1e-6);
      expect(point.z).toBeLessThanOrEqual(4.7 + 1e-6);
    }
  });

  it("loadNavMesh inválida lança e mantém a anterior (atômico)", () => {
    const service = new AIService(ctxFor([]));
    service.loadNavMesh(lCorridor());
    expect(() =>
      service.loadNavMesh({ polygons: [rect(0, 0, 0, 5, 5, [1]), rect(1, 50, 50, 60, 60, [0])] }),
    ).toThrow("não compartilham aresta");
    expect(() => service.loadNavMesh({ polygons: [rect(0, 0, 0, 5, 5, [7])] })).toThrow("inexistente");
    expect(() => service.loadNavMesh({ polygons: [{ ...rect(0, 0, 0, 5, 5, []), vertices: [{ x: 0, y: 0, z: Number.NaN }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }] }] })).toThrow("inválido");
    expect(service.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 9, y: 0, z: 9 } }).found).toBe(true);
  });
});

describe("ai gaps — G73 funnel, separação, chegada, request-path, posição inicial", () => {
  it("funnel: caminho em L passa rente à quina interna (3 pontos)", () => {
    const query = new NavMeshQuery();
    query.loadGraph(lCorridor());
    const result = query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 9, y: 0, z: 9 } });
    expect(result.waypoints).toHaveLength(3);
    const corner = result.waypoints[1]!;
    expect(corner.x).toBeCloseTo(8, 5);
    expect(corner.z).toBeCloseTo(2, 5);
    // Com raio, a quina fica afastada.
    const withRadius = query.findPath({ start: { x: 1, y: 0, z: 1 }, target: { x: 9, y: 0, z: 9 }, agentRadius: 0.5 });
    expect(withRadius.waypoints[1]!.x).toBeCloseTo(8.5, 5);
  });

  it("separação afasta agentes sobrepostos; agente fica na navmesh", () => {
    const service = new AIService(ctxFor([]));
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 10, 10, [])] });
    service.registerAgent({ agentId: "a", entityId: "a", initialPosition: { x: 5, y: 0, z: 5 }, separationRadius: 1 });
    service.registerAgent({ agentId: "b", entityId: "b", initialPosition: { x: 5, y: 0, z: 5 }, separationRadius: 1 });
    stepService(service, 1);
    const a = service.getAgentPosition("a")!;
    const b = service.getAgentPosition("b")!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.9);

    // Empurrado contra a borda: continua dentro.
    service.registerAgent({ agentId: "c", entityId: "c", initialPosition: { x: 0.1, y: 0, z: 0.1 }, separationRadius: 3 });
    service.registerAgent({ agentId: "d", entityId: "d", initialPosition: { x: 0.2, y: 0, z: 0.2 }, separationRadius: 3 });
    stepService(service, 1);

    for (const id of ["a", "b", "c", "d"]) {
      const p = service.getAgentPosition(id)!;
      expect(p.x).toBeGreaterThanOrEqual(-1e-3);
      expect(p.z).toBeGreaterThanOrEqual(-1e-3);
      expect(p.x).toBeLessThanOrEqual(10 + 1e-3);
    }
  });

  it("chegada: evento uma vez, status 'arrived' persiste até novo destino", () => {
    const emitted: Emitted[] = [];
    const service = new AIService(ctxFor(emitted));
    service.loadNavMesh(lCorridor());
    service.registerAgent({ agentId: "a", entityId: "a", initialPosition: { x: 1, y: 0, z: 1 }, maxSpeed: 6, stoppingDistance: 0.3 });
    service.setAgentTarget("a", { x: 9, y: 0, z: 9 });
    stepService(service, 6);
    expect(emitted.filter((e) => e.type === "game.ai.agent-arrived")).toHaveLength(1);
    stepService(service, 1);
    expect(service.getBlackboardValue("a", "status")).toBe("arrived");
    expect(service.getAgentState("a")).toMatchObject({ arrived: true, moving: false, status: "arrived" });
    expect(emitted.filter((e) => e.type === "game.ai.agent-arrived")).toHaveLength(1);
    // Nunca atravessou a parede interna do L (x<8 com z>2), salvo a tolerância de borda (0,01).
    service.setAgentTarget("a", { x: 1, y: 0, z: 1 });
    let crossed = false;

    for (let i = 0; i < 400; i += 1) {
      service.update(1 / 60);
      const p = service.getAgentPosition("a")!;

      if (p.x < 8 - 0.011 && p.z > 2 + 0.011) {
        crossed = true;
      }
    }

    expect(crossed).toBe(false);
    expect(service.getBlackboardValue("a", "status")).toBe("arrived");
  });

  it("request-path só calcula (não move) a menos que move:true", () => {
    const handlers = new Map<string, (env: { payload: unknown }) => unknown>();
    let provided: AIService | null = null;
    const ctx = {
      caps: {
        provide(_token: unknown, value: AIService): void {
          provided = value;
        },
      },
      events: { define(): void {}, on: () => () => {}, emit(): void {} },
      commands: {
        define(): void {},
        handle(type: string, fn: (env: { payload: unknown }) => unknown) {
          handlers.set(type, fn);
          return () => {};
        },
      },
      lifecycle: { onDispose(): void {}, ready(): void {} },
      log: { warn(): void {}, error(): void {}, info(): void {}, debug(): void {} },
    } as unknown as PluginContext;
    createAIPlugin().setup(ctx);
    const service = provided as unknown as AIService;
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 10, 10, [])] });
    service.registerAgent({ agentId: "a", entityId: "a", initialPosition: { x: 1, y: 0, z: 1 } });
    const request = handlers.get("game.ai.request-path")!;
    const result = request({ payload: { agentId: "a", targetPosition: { x: 9, y: 0, z: 9 } } }) as { found: boolean };
    expect(result.found).toBe(true);
    expect(service.getAgentState("a")?.moving).toBe(false);
    request({ payload: { agentId: "a", targetPosition: { x: 9, y: 0, z: 9 }, move: true } });
    expect(service.getAgentState("a")?.moving).toBe(true);
  });

  it("posição inicial vem do world (inclusive se a entidade surgir depois); sync opcional do transform", () => {
    const world = createWorld();
    const service = new AIService(ctxFor([]));
    service.bindDependencies(null, world.api);
    service.loadNavMesh({ polygons: [rect(0, 0, 0, 20, 20, [])] });
    world.positions.set("e1", { x: 3, y: 0, z: 4 });
    service.registerAgent({ agentId: "a1", entityId: "e1", syncWorldTransform: true });
    expect(service.getAgentPosition("a1")).toEqual({ x: 3, y: 0, z: 4 });
    service.registerAgent({ agentId: "a2", entityId: "e2" });
    world.positions.set("e2", { x: 7, y: 0, z: 7 });
    service.update(1 / 60);
    expect(service.getAgentPosition("a2")).toEqual({ x: 7, y: 0, z: 7 });
    service.setAgentTarget("a1", { x: 15, y: 0, z: 4 });
    stepService(service, 0.5);
    expect(world.positions.get("e1")!.x).toBeGreaterThan(3);
    expect(world.updates.length).toBeGreaterThan(0);
  });
});
