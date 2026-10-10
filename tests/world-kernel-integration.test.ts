// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import { Kernel, type Plugin } from "@core";

import { createGameLoopPlugin } from "../src/plugins/game-loop/plugin";
import { createWorldPlugin } from "../src/plugins/world/plugin";
import { GameLoopToken, type GameLoopApi } from "../src/tokens/game-loop";
import { WorldToken, type WorldApi } from "../src/tokens/world";

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

describe("game.world + game.loop no Kernel real", () => {
  it("world consome game.loop/game.assets como opcionais e autoStartLoop retoma o loop", async () => {
    globalThis.requestAnimationFrame = (): number => 1;
    globalThis.cancelAnimationFrame = (): void => {};

    let world: WorldApi | undefined;
    let loop: GameLoopApi | undefined;

    const probe: Plugin = {
      manifest: {
        id: "test.world-probe",
        name: "World probe",
        version: "1.0.0",
        kind: "preloaded",
        capabilities: {
          provides: [],
          consumes: [
            { id: WorldToken.id, range: "^1.0.0", optional: false },
            { id: GameLoopToken.id, range: "^1.0.0", optional: false },
          ],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            world = ctx.caps.require(WorldToken);
            loop = ctx.caps.require(GameLoopToken);
          },
        },
      },
      setup(ctx): void {
        ctx.lifecycle.ready();
      },
    };

    const kernel = new Kernel();
    kernel.register(createGameLoopPlugin());
    kernel.register(createWorldPlugin());
    kernel.register(probe);
    await kernel.boot();

    expect(world).toBeDefined();
    expect(loop).toBeDefined();

    loop?.pause();
    expect(loop?.getStats().isPaused).toBe(true);

    // Sem game.assets registrado: a cena carrega e reporta o asset não carregado.
    const loaded = await world?.loadScene(
      {
        sceneId: "kernel-scene",
        sceneName: "Kernel scene",
        assetsToPreload: [{ id: "a", url: "a.glb", type: "gltf" }],
      },
      { autoStartLoop: true },
    );
    expect(loaded).toBe(true);
    expect(loop?.getStats().isPaused).toBe(false);

    expect(world?.spawnEntity({ entityId: "e1" })).toBe(true);
    expect(world?.updateEntityTransform("e1", { position: { x: 2, y: 0, z: 0 } })).toBe(true);
    expect(world?.querySphere({ x: 2, y: 0, z: 0 }, 0.1)[0]?.entityId).toBe("e1");

    await kernel.stop();
  });
});
