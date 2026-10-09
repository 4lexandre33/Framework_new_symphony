import type { Plugin } from "@core";

/**
 * Contrato que todo projeto consumidor (jogo/app) cumpre.
 *
 * Cada projeto vive em `src/projects/<nome>/` e exporta `project` em
 * `src/projects/<nome>/index.ts`. A engine nunca importa um projeto pelo nome:
 * `src/project.ts` descobre as pastas automaticamente.
 */
export interface ProjectDefinition {
  /** Identificador estável; usado em VITE_PROJECT. */
  readonly id: string;
  /** Nome legível. */
  readonly name: string;
  /** Cria os plugins do projeto. Chamado uma vez pelo bootstrap. */
  createPlugins(): readonly Plugin[];
}
