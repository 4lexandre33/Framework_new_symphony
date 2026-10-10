import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import type { SpriteAnimationFrame } from "../src/contracts/anim/types";
import { AnimationService } from "../src/engine/anim/internal/AnimationService";

interface Emitted {
  type: string;
  payload: any;
}

function setup(): { service: AnimationService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const ctx = {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push({ type, payload });
      },
    },
  } as unknown as PluginContext;
  return { service: new AnimationService(ctx), emitted };
}

function of(emitted: Emitted[], type: string): any[] {
  return emitted.filter((e) => e.type === type).map((e) => e.payload);
}

function clip(name: string, duration: number): THREE.AnimationClip {
  return new THREE.AnimationClip(name, duration, [
    new THREE.NumberKeyframeTrack(".position[x]", [0, duration], [0, 10]),
  ]);
}

function step(service: AnimationService, seconds: number, dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) service.tick(dt);
}

function mockSpriteMaterial(): { map: any; clone: () => any } {
  const vec = (): any => ({ x: 0, y: 0, set(x: number, y: number): void { this.x = x; this.y = y; } });
  const makeMap = (): any => ({
    offset: vec(),
    repeat: vec(),
    disposed: false,
    clone(): any { return makeMap(); },
    dispose(): void { this.disposed = true; },
  });
  const material: any = { map: makeMap(), clone(): any { return { map: makeMap(), clone: material.clone, disposed: false, dispose(): void { this.disposed = true; } }; } };
  return material;
}

function frames(xs: number[], ms = 100): SpriteAnimationFrame[] {
  return xs.map((x, i) => ({ frameIndex: i, durationMs: ms, uvOffset: { x, y: 0 }, uvScale: { x: 0.25, y: 1 } }));
}

describe("anim gaps (G74–G78)", () => {
  it("G74: pedir o estado atual com restart reinicia o clip e os triggers; LoopOnce terminado reinicia sozinho", () => {
    const { service, emitted } = setup();
    const root = new THREE.Object3D();
    service.register3DSkeleton("e", root, [clip("punch", 0.5)]);
    service.registerState("e", {
      id: "punch",
      name: "Punch",
      loopMode: "LoopOnce",
      triggers: [{ frameOrTime: 0.5, eventName: "hit" }],
    });
    expect(service.playAnimation("e", "Punch", 0)).toBe(true);
    step(service, 0.6);
    expect(of(emitted, "game.anim.event-triggered")).toHaveLength(1);
    expect(root.position.x).toBeCloseTo(10, 3);
    expect(service.getStateInfo("e")?.isFinished).toBe(true);

    // LoopOnce já terminado: pedir de novo reinicia (padrão).
    expect(service.playAnimation("e", "Punch", 0)).toBe(true);
    expect(service.getStateInfo("e")?.elapsedSeconds).toBe(0);
    step(service, 0.1);
    expect(root.position.x).toBeLessThan(5);
    step(service, 0.3);
    expect(of(emitted, "game.anim.event-triggered")).toHaveLength(2);

    // restart: true no meio do clip reinicia; restart:false nunca.
    service.playAnimation("e", "Punch", 0, { restart: true });
    expect(service.getStateInfo("e")?.elapsedSeconds).toBe(0);
    step(service, 0.2);
    service.playAnimation("e", "Punch", 0, { restart: false });
    expect(service.getStateInfo("e")?.elapsedSeconds).toBeCloseTo(0.2, 3);
    step(service, 0.4);
    expect(of(emitted, "game.anim.event-triggered")).toHaveLength(3);
  });

  it("G74/G75: triggers disparam a cada ciclo em LoopRepeat, incluindo 0,0 e 1,0", () => {
    const { service, emitted } = setup();
    service.registerState("e", {
      id: "walk",
      name: "Walk",
      durationSeconds: 1,
      triggers: [
        { frameOrTime: 0, eventName: "start" },
        { frameOrTime: 0.5, eventName: "step" },
        { frameOrTime: 1, eventName: "end" },
      ],
    });
    step(service, 3.05, 0.05);
    const names = of(emitted, "game.anim.event-triggered").map((p) => p.eventName);
    expect(names.filter((n) => n === "start")).toHaveLength(4); // 0, 1, 2, 3
    expect(names.filter((n) => n === "step")).toHaveLength(3);
    expect(names.filter((n) => n === "end")).toHaveLength(3); // 1, 2, 3
    const finished = of(emitted, "game.anim.clip-finished");
    expect(finished.map((p) => p.completedCycles)).toEqual([1, 2, 3]);
  });

  it("G75: transição sem condição espera o fim do clip; exitTime com condição; clip-finished no LoopOnce", () => {
    const { service, emitted } = setup();
    service.registerState("e", { id: "a", name: "Attack", durationSeconds: 0.5, loopMode: "LoopOnce" });
    service.registerState("e", { id: "i", name: "Idle", durationSeconds: 1 });
    service.registerState("e", { id: "r", name: "Run", durationSeconds: 1 });
    service.addTransition("e", { fromState: "Attack", toState: "Idle", durationSeconds: 0 });
    service.addTransition("e", { fromState: "Idle", toState: "Run", durationSeconds: 0, conditionParam: "go", conditionValue: true, exitTime: 0.5 });
    step(service, 0.1);
    expect(service.getCurrentState("e")).toBe("Attack");
    step(service, 0.45);
    expect(service.getCurrentState("e")).toBe("Idle");
    expect(of(emitted, "game.anim.clip-finished")).toEqual([
      { entityId: "e", stateName: "Attack", clipId: "a", loopMode: "LoopOnce", completedCycles: 1 },
    ]);
    service.setParam("e", "go", true);
    step(service, 0.2);
    expect(service.getCurrentState("e")).toBe("Idle"); // espera o 0,5 do ciclo
    step(service, 0.4);
    expect(service.getCurrentState("e")).toBe("Run");

    // hasExitTime:false mantém o comportamento imediato antigo.
    const b = setup();
    b.service.registerState("x", { id: "a", name: "A" });
    b.service.registerState("x", { id: "b", name: "B" });
    b.service.addTransition("x", { fromState: "A", toState: "B", durationSeconds: 0, hasExitTime: false });
    b.service.tick(1 / 60);
    expect(b.service.getCurrentState("x")).toBe("B");
  });

  it("G76: ordem livre, estado inicial toca e é anunciado; alvo do crossfade visível", () => {
    const { service, emitted } = setup();
    // Transição antes dos estados.
    expect(service.addTransition("e", { fromState: "Idle", toState: "Run", durationSeconds: 0.2, conditionParam: "speed", conditionOperator: ">", conditionValue: 0 })).toBe(true);
    const root = new THREE.Object3D();
    service.register3DSkeleton("e", root, [clip("clip_idle", 1), clip("clip_run", 1)]);
    // Estados explícitos substituem o estado automático do 1º clip.
    service.registerState("e", { id: "clip_idle", name: "Idle" });
    service.registerState("e", { id: "clip_run", name: "Run" });
    expect(service.getCurrentState("e")).toBe("Idle");
    service.tick(0.1);
    expect(of(emitted, "game.anim.state-changed")[0]).toMatchObject({ entityId: "e", fromState: "none", toState: "Idle" });
    expect(root.position.x).toBeGreaterThan(0); // o clip inicial tocou
    expect(service.getStateInfo("e")?.durationSeconds).toBe(1);

    service.setParam("e", "speed", 1);
    service.tick(0.05);
    expect(service.getCurrentState("e")).toBe("Idle");
    expect(service.getTargetState("e")).toBe("Run");
    expect(service.getStateInfo("e")?.requestedState).toBe("Run");
    step(service, 0.2, 0.05);
    expect(service.getCurrentState("e")).toBe("Run");
    expect(service.getTargetState("e")).toBeNull();
  });

  it("G77: sprite 2D dirigido pela FSM por estado; textura por entidade", () => {
    const { service } = setup();
    const shared = mockSpriteMaterial();
    const sharedMap = shared.map;
    const target1 = { material: shared as unknown };
    const target2 = { material: shared as unknown };
    const m1 = service.register2DSprite("a", shared, frames([0]), { target: target1 }) as any;
    const m2 = service.register2DSprite("b", shared, frames([0]), { target: target2 }) as any;
    expect(m1).toBe(shared);
    expect(m2).not.toBe(shared); // material compartilhado -> clone para "b"
    expect(target2.material).toBe(m2);
    expect(m2.map).not.toBe(sharedMap);

    service.registerState("a", { id: "idle", name: "Idle", loopMode: "LoopRepeat" });
    service.registerState("a", { id: "atk", name: "Attack", loopMode: "LoopOnce" });
    expect(service.register2DSpriteState("a", "Idle", frames([0, 0.25]))).toBe(true);
    expect(service.register2DSpriteState("a", "Attack", frames([0.5, 0.75], 50))).toBe(true);
    // Duração do estado = soma dos quadros (relógio único).
    expect(service.getStateInfo("a")?.durationSeconds).toBeCloseTo(0.2, 6);

    service.tick(0.15);
    expect(m1.map.offset.x).toBe(0.25);
    service.playAnimation("a", "Attack", 0);
    service.tick(0.01);
    expect(m1.map.offset.x).toBe(0.5);
    step(service, 0.3, 0.05);
    expect(m1.map.offset.x).toBe(0.75); // LoopOnce para no último quadro
    // A outra entidade não foi afetada.
    expect(m2.map.offset.x).toBe(0);

    service.unregisterEntity("b");
    expect(target2.material).toBe(shared);
    expect(m2.disposed).toBe(true);
  });

  it("G78: FSM e mixer no mesmo relógio; ids/nomes com ':' e espaço", () => {
    const { service, emitted } = setup();
    const root = new THREE.Object3D();
    service.register3DSkeleton("npc:1 a", root, [clip("Armature|Run Cycle", 2)]);
    service.registerState("npc:1 a", {
      id: "Armature|Run Cycle",
      name: "Run Fast",
      durationSeconds: 0.5, // ignorado: o clip real manda
      triggers: [{ frameOrTime: 0.5, eventName: "foot:left" }],
    });
    service.playAnimation("npc:1 a", "Run Fast", 0);
    step(service, 1.0, 0.05);
    expect(service.getStateInfo("npc:1 a")?.normalizedTime).toBeCloseTo(0.5, 3);
    expect(root.position.x).toBeCloseTo(5, 2); // mixer em 1,0 s de 2 s
    expect(of(emitted, "game.anim.event-triggered")).toEqual([
      { entityId: "npc:1 a", stateName: "Run Fast", eventName: "foot:left", payload: undefined },
    ]);
    // relógio "render": tick não avança mais
    service.setClockSource("render");
    service.tick(0.5);
    expect(service.getStateInfo("npc:1 a")?.normalizedTime).toBeCloseTo(0.5, 3);
    service.render(0.25);
    expect(service.getStateInfo("npc:1 a")?.normalizedTime).toBeCloseTo(0.625, 3);
  });
});
