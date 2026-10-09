import type { Plugin, PluginContext } from "@core";
import { RenderToken } from "../../tokens/render";

/**
 * Plugin de COMPOSIÇÃO do projeto. Regras:
 *  - só importe `src/tokens/*`, `src/contracts/*` e `@core` (nunca `engine/**\/internal`);
 *  - requisite capabilities em `capabilities.consumes` e use `ctx.caps.require`;
 *  - toda coisa adquirida (listeners, DOM, corpos de física) precisa de dispose
 *    registrado em `ctx.lifecycle.onDispose`;
 *  - a lógica do jogo fica em classes próprias desta pasta, não aqui.
 */
export function createTemplatePlugin(): Plugin {
  return {
    manifest: {
      id: "project.meu-jogo",
      name: "Projeto — Meu Jogo",
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      dependsOn: [{ id: "game.render", range: "^1.0.0" }],
      permissions: {
        capabilities: [RenderToken.id],
        events: [],
      },
      capabilities: {
        consumes: [{ id: RenderToken.id, range: "^1.0.0", optional: false }],
        conflicts: [],
      },
    },

    setup(ctx: PluginContext): void {
      const render = ctx.caps.require(RenderToken);
      console.info("[MeuJogo] render disponível:", typeof render);
      ctx.lifecycle.onDispose((): void => {
        // libere aqui tudo o que o jogo adquiriu
      });
      ctx.lifecycle.ready();
    },
  };
}
