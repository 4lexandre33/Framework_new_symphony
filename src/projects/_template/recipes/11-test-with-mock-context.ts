// Teste unitário do jogo sem subir o kernel: monte um ctx falso só com o que o plugin usa.
// (Use em arquivos *.test.ts do seu projeto; aqui só mostra a forma, compilada pelo tsc.)
import type { PluginContext } from "@core";
import type { PhysicsApi } from "../../../tokens/physics";

export function makeFakePhysics(): PhysicsApi & { bodies: string[] } {
  const bodies: string[] = [];
  const zero = { x: 0, y: 0, z: 0 };
  return {
    bodies,
    step: (): void => undefined,
    createBody: (id): boolean => { bodies.push(id); return true; },
    removeBody: (id): boolean => { const i = bodies.indexOf(id); if (i >= 0) bodies.splice(i, 1); return i >= 0; },
    applyImpulse: (): boolean => true,
    applyForce: (): boolean => true,
    castRay: () => ({ hit: false, distance: 0, point: zero, normal: zero }),
    getBodyTransform: () => null,
    syncMeshTransform: (): boolean => false,
    setGravity: (): void => undefined,
    getStats: () => ({ rigidBodyCount: bodies.length, colliderCount: bodies.length, stepTimeMs: 0, isWasmLoaded: true }),
  };
}

// Passe o fake onde o plugin faria ctx.caps.require(PhysicsToken): extraia a lógica do jogo em funções que recebem PhysicsApi.
export type GameLogic = (ctx: PluginContext, physics: PhysicsApi) => () => void;
