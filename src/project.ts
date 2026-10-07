import type { Plugin } from "@core";
import { createPhysicsSandboxPlugin } from "./projects/physics-sandbox/PhysicsSandboxPlugin";

/**
 * Composition root LOCAL dos consumidores do host de desenvolvimento.
 * O Kernel/bootstrap conhece esta função, mas nunca conhece um jogo.
 * Para trocar de jogo: edite apenas este arquivo e src/projects/<nome>/.
 * A API pública de distribuição será decidida nas Stages 91–116.
 */
export type LocalProjectId = "none" | "physics-sandbox";

export function createProjectPlugins(
  project: LocalProjectId = "physics-sandbox",
): readonly Plugin[] {
  switch (project) {
    case "none":
      return [];
    case "physics-sandbox":
      return [createPhysicsSandboxPlugin()];
  }
}
