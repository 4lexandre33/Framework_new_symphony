import type { Plugin, PluginContext } from "@core";
import { GameLoopToken } from "../../tokens/game-loop";
import { GameTickEvent, GameRenderEvent, PauseGameCommand, ResumeGameCommand, type PauseOptions } from "../../contracts/game-loop/types";
import { DeterministicGameLoop } from "../../engine/game-loop/internal/DeterministicGameLoop";

export const gameLoopManifest: Plugin["manifest"] = {
  id: "game.loop",
  name: "Deterministic Game Loop Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [GameLoopToken.id],
    events: ["game.loop.tick", "game.loop.render", "kernel.booted"],
  },
  capabilities: {
    provides: [
      {
        id: GameLoopToken.id,
        version: "1.0.0",
      },
    ],
    conflicts: [],
  },
};

export function createGameLoopPlugin(): Plugin {
  return {
    manifest: gameLoopManifest,

    setup(ctx: PluginContext) {
      const gameLoop = new DeterministicGameLoop(ctx);

      // 1. Prover Capability
      ctx.caps.provide(GameLoopToken, gameLoop);

      // 2. Registrar Eventos e Comandos
      ctx.events.define(GameTickEvent);
      ctx.events.define(GameRenderEvent);
      ctx.commands.define(PauseGameCommand);
      ctx.commands.define(ResumeGameCommand);

      // 3. Handlers de Comandos
      const unbindPause = ctx.commands.handle("game.loop.pause", (envelope) => {
        const payload = envelope.payload as PauseOptions | undefined;
        gameLoop.pause(
          payload?.freezeRender === true ? { freezeRender: true } : undefined,
        );
      });

      const unbindResume = ctx.commands.handle("game.loop.resume", () => {
        gameLoop.resume();
      });

      // 4. O loop só pode começar depois que TODOS os plugins
      // concluíram setup, resolução de capabilities e lifecycle.onBoot.
      // O Kernel emite "kernel.booted" somente após state.phase = "running".
      const unbindKernelBooted = ctx.events.on("kernel.booted", () => {
        gameLoop.start();
      });

      // 5. Configurar Desalocação
      ctx.lifecycle.onDispose(() => {
        unbindKernelBooted();
        gameLoop.stop();
        unbindPause();
        unbindResume();
      });

      // 6. Notificar o Kernel que a fase de setup foi concluída com sucesso
      ctx.lifecycle.ready();
    },
  };
}
