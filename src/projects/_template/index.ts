import type { ProjectDefinition } from "../../project-contract";
import { createTemplatePlugin } from "./TemplatePlugin";

/**
 * MOLDE de projeto. Pastas que começam com "_" NÃO são carregadas.
 * Para criar um jogo: copie esta pasta para src/projects/<meu-jogo>/ (sem "_"),
 * troque o id/nome e implemente o plugin. Ver docs/layer1/creating-a-game.md.
 */
export const project: ProjectDefinition = {
  id: "meu-jogo",
  name: "Meu Jogo",
  createPlugins: () => [createTemplatePlugin()],
};
