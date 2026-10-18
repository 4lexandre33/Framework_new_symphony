import type { Plugin, PluginContext } from "@core";
import { GameTickEvent } from "../../contracts/game-loop/types";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { __PASCAL__Game } from "./__PASCAL__Game";

/**
 * Plugin de COMPOSIÇÃO do jogo. Regras (docs/ai/RULES.md):
 *  - só importe `src/tokens/*`, `src/contracts/*` e `@core` (nunca `engine/**\/internal`);
 *  - capability nova: declare em `capabilities.consumes` E `permissions.capabilities`,
 *    depois `ctx.caps.require(Token)`;
 *  - tudo que for adquirido precisa de dispose em `ctx.lifecycle.onDispose`;
 *  - a lógica fica em `__PASCAL__Game` (classe pura desta pasta).
 */
export function create__PASCAL__Plugin(): Plugin {
  let game: __PASCAL__Game | null = null;

  return {
    manifest: {
      id: "project.__ID__",
      name: __PLUGIN_NAME_LITERAL__,
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      dependsOn: [{ id: "game.loop", range: "^1.0.0" }],
      permissions: {
        capabilities: [],
        events: [], // [] = não emite nada; liste os tipos emitidos (G21)
      },
      capabilities: {
        consumes: [],
        conflicts: [],
      },
    },

    setup(ctx: PluginContext): void {
      game = new __PASCAL__Game();
      const offTick = ctx.events.on<"game.loop.tick", GameTickPayload>(GameTickEvent.type, (env): void => {
        game?.tick(env.payload.deltaSeconds);
      });
      ctx.lifecycle.onDispose((): void => {
        offTick();
        game?.dispose();
        game = null;
      });
      ctx.lifecycle.ready();
    },
  };
}
