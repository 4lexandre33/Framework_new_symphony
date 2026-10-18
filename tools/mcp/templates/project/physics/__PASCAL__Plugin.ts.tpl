import type { Plugin, PluginContext } from "@core";
import { GameRenderEvent } from "../../contracts/game-loop/types";
import type { GameRenderPayload } from "../../contracts/game-loop/types";
import { PhysicsToken } from "../../tokens/physics";
import { RenderToken } from "../../tokens/render";
import { Three__PASCAL__View } from "./adapters/Three__PASCAL__View";
import { __PASCAL__Game } from "./__PASCAL__Game";

/**
 * Plugin de COMPOSIÇÃO do jogo (docs/ai/RULES.md): pede capabilities, liga
 * eventos e faz dispose. A lógica fica em `__PASCAL__Game`; Three.js fica no
 * adapter `Three__PASCAL__View`.
 */
export function create__PASCAL__Plugin(): Plugin {
  let game: __PASCAL__Game | null = null;

  const release = (): void => {
    game?.dispose();
    game = null;
  };

  return {
    manifest: {
      id: "project.__ID__",
      name: __PLUGIN_NAME_LITERAL__,
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      dependsOn: [
        { id: "game.loop", range: "^1.0.0" },
        { id: "game.render", range: "^1.0.0" },
        { id: "game.physics", range: "^1.0.0" },
      ],
      permissions: {
        capabilities: [RenderToken.id, PhysicsToken.id],
        events: [], // [] = não emite nada; liste os tipos emitidos (G21)
      },
      capabilities: {
        consumes: [
          { id: RenderToken.id, range: "^1.0.0", optional: false },
          { id: PhysicsToken.id, range: "^1.0.0", optional: false },
        ],
        conflicts: [],
      },
      lifecycleHooks: {
        // onBoot: todos os plugins já estão prontos (mundo físico inicializado).
        onBoot(ctx: PluginContext): void {
          const view = new Three__PASCAL__View(ctx.caps.require(RenderToken));
          try {
            game = new __PASCAL__Game(ctx.caps.require(PhysicsToken), view);
          } catch (error: unknown) {
            view.dispose();
            throw error;
          }
        },
      },
    },

    setup(ctx: PluginContext): void {
      // A física já avança no game.loop.tick; o visual é sincronizado no render.
      const offRender = ctx.events.on<"game.loop.render", GameRenderPayload>(GameRenderEvent.type, (): void => {
        game?.syncVisual();
      });
      ctx.lifecycle.onDispose((): void => {
        offRender();
        release();
      });
      ctx.lifecycle.ready();
    },
  };
}
