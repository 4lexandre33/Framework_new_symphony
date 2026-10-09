// Plugin completo: manifest, consumo de capabilities, boot assíncrono e dispose.
import type { Plugin, PluginContext } from "@core";
import { PhysicsToken } from "../../../tokens/physics";
import { RenderToken } from "../../../tokens/render";

export function createGamePlugin(): Plugin {
  let disposers: Array<() => void> = [];

  return {
    manifest: {
      id: "project.meu-jogo", // único; prefixo "project."
      name: "Meu Jogo",
      version: "1.0.0",
      kind: "preloaded",
      authority: "game",
      // ordem de boot: liste os plugins da engine dos quais depende (ids "game.*")
      dependsOn: [
        { id: "game.render", range: "^1.0.0" },
        { id: "game.physics", range: "^1.0.0" },
      ],
      // todo token usado precisa estar aqui E em permissions.capabilities
      permissions: {
        capabilities: [RenderToken.id, PhysicsToken.id],
        events: [], // eventos que ESTE plugin emite
      },
      capabilities: {
        consumes: [
          { id: RenderToken.id, range: "^1.0.0", optional: false },
          { id: PhysicsToken.id, range: "^1.0.0", optional: false },
        ],
        conflicts: [],
      },
      lifecycleHooks: {
        async onBoot(ctx: PluginContext): Promise<void> {
          const render = ctx.caps.require(RenderToken);
          const physics = ctx.caps.require(PhysicsToken);
          disposers.push(() => render.removeMeshFromScene("meu-jogo"));
          void physics; // use aqui; carregue assets, monte a cena
        },
      },
    },

    setup(ctx: PluginContext): void {
      ctx.lifecycle.onDispose((): void => {
        for (const dispose of disposers.splice(0).reverse()) dispose(); // ordem inversa
        disposers = [];
      });
      ctx.lifecycle.ready(); // sempre chame, senão o boot fica pendente
    },
  };
}
