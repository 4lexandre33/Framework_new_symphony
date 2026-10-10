// Teste unitário do jogo sem subir o kernel: fakes PARCIAIS dos tokens.
// A API dos tokens cresce com o tempo; implemente só o que o jogo usa e
// deixe o resto lançar erro claro (assim o teste não quebra quando a engine ganha métodos).
import type { PluginContext } from "@core";
import type { PhysicsApi } from "../../../tokens/physics";

/** Cria um fake que implementa só `impl`; qualquer outro método lança "não implementado no fake". */
export function partialFake<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl as T, {
    get(target, prop, receiver): unknown {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (prop === "then") return undefined; // não parecer Promise
      return (): never => {
        throw new Error(`${name}.${String(prop)} não implementado no fake`);
      };
    },
  });
}

export function makeFakePhysics(): { api: PhysicsApi; bodies: string[] } {
  const bodies: string[] = [];
  const api = partialFake<PhysicsApi>("PhysicsApi", {
    createBody: (id): boolean => { bodies.push(id); return true; },
    removeBody: (id): boolean => { const i = bodies.indexOf(id); if (i >= 0) bodies.splice(i, 1); return i >= 0; },
    applyImpulse: (): boolean => true,
    getBodyTransform: () => null,
  });
  return { api, bodies };
}

// Passe o fake onde o plugin faria ctx.caps.require(PhysicsToken): extraia a lógica do jogo em funções que recebem PhysicsApi.
export type GameLogic = (ctx: PluginContext, physics: PhysicsApi) => () => void;
