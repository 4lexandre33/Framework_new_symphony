import type { ProjectDefinition } from "../../project-contract";
import { create__PASCAL__Plugin } from "./__PASCAL__Plugin";

/**
 * Jogo gerado pelo MCP da engine (template "physics": corpo rígido + Three.js).
 * Descoberta automática: esta pasta aparece no seletor; apagar a pasta remove o jogo.
 * Regras: docs/ai/RULES.md · receitas: src/projects/_template/recipes/.
 */
export const project: ProjectDefinition = {
  id: "__ID__",
  name: __NAME_LITERAL__,
  createPlugins: () => [create__PASCAL__Plugin()],
};
