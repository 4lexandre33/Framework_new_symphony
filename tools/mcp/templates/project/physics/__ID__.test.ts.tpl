import { describe, expect, it } from "vitest";
import type { MutableBodyTransformDTO } from "../../contracts/physics/types";
import type { PhysicsApi } from "../../tokens/physics";
import { project } from "./index";
import { BOX_BODY_ID, FLOOR_BODY_ID, __PASCAL__Game } from "./__PASCAL__Game";
import type { Quat, Vec3, __PASCAL__ViewPort } from "./ports/__PASCAL__ViewPort";

/** Fake PARCIAL: implementa só o que o jogo usa; o resto lança erro claro (receita 11). */
function partialFake<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl as T, {
    get(target, prop, receiver): unknown {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "then") return undefined;
      return (): never => {
        throw new Error(`${name}.${String(prop)} não implementado no fake`);
      };
    },
  });
}

function makeFixtures(): {
  physics: PhysicsApi;
  view: __PASCAL__ViewPort & { readonly poses: Array<{ position: Vec3; rotation: Quat }>; disposed: boolean };
  bodies: Set<string>;
  impulses: string[];
} {
  const bodies = new Set<string>();
  const impulses: string[] = [];
  const physics = partialFake<PhysicsApi>("PhysicsApi", {
    createBody: (id: string): boolean => {
      bodies.add(id);
      return true;
    },
    removeBody: (id: string): boolean => bodies.delete(id),
    applyImpulse: (id: string): boolean => {
      impulses.push(id);
      return bodies.has(id);
    },
    getBodyTransformInto: (id: string, out: MutableBodyTransformDTO): boolean => {
      if (!bodies.has(id)) return false;
      out.position.y = 2;
      return true;
    },
  });
  const poses: Array<{ position: Vec3; rotation: Quat }> = [];
  const view = {
    poses,
    disposed: false,
    setBoxTransform(position: Vec3, rotation: Quat): void {
      poses.push({ position: { ...position }, rotation: { ...rotation } });
    },
    dispose(): void {
      view.disposed = true;
    },
  };
  return { physics, view, bodies, impulses };
}

describe("__ID__", () => {
  it("exporta o projeto com o plugin do jogo", () => {
    expect(project.id).toBe("__ID__");
    const plugins = project.createPlugins();
    expect(plugins.map((plugin) => plugin.manifest.id)).toEqual(["project.__ID__"]);
  });

  it("cria piso e caixa e sincroniza a pose", () => {
    const { physics, view, bodies } = makeFixtures();
    const game = new __PASCAL__Game(physics, view);
    expect([...bodies].sort()).toEqual([BOX_BODY_ID, FLOOR_BODY_ID].sort());
    game.syncVisual();
    expect(view.poses[view.poses.length - 1]?.position.y).toBe(2);
  });

  it("aplica impulso no salto", () => {
    const { physics, view, impulses } = makeFixtures();
    const game = new __PASCAL__Game(physics, view);
    expect(game.jump()).toBe(true);
    expect(impulses).toEqual([BOX_BODY_ID]);
  });

  it("libera corpos e visualização no dispose", () => {
    const { physics, view, bodies } = makeFixtures();
    const game = new __PASCAL__Game(physics, view);
    game.dispose();
    expect(bodies.size).toBe(0);
    expect(view.disposed).toBe(true);
    expect(game.jump()).toBe(false);
  });
});
