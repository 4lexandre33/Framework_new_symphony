/**
 * Agregador dos domínios de tools. Cada domínio vive no seu arquivo e é dono
 * exclusivo de uma tarefa (docs/mcp/TASK_GRAPH.md); este índice não precisa
 * mudar quando um domínio ganha tools.
 */

import type { ToolContext } from "../core/context.ts";
import type { ToolDef } from "../core/registry.ts";
import * as assets from "./assets.ts";
import * as build from "./build.ts";
import * as core from "./core.ts";
import * as gates from "./gates.ts";
import * as jobs from "./jobs.ts";
import * as knowledge from "./knowledge.ts";
import * as projects from "./projects.ts";
import * as runtime from "./runtime.ts";
import * as scenes from "./scenes.ts";

/** Forma de um arquivo de domínio. `init`/`dispose` são opcionais. */
export interface DomainModule {
  readonly tools: readonly ToolDef[];
  /** Chamado uma vez por servidor, antes do registro das tools. */
  readonly init?: (ctx: ToolContext) => void | Promise<void>;
  /** Chamado no encerramento do servidor (ordem inversa), antes de matar jobs. */
  readonly dispose?: (ctx: ToolContext) => void | Promise<void>;
}

export interface NamedDomain {
  readonly name: string;
  readonly module: DomainModule;
}

export const domains: readonly NamedDomain[] = [
  { name: "core", module: core },
  { name: "knowledge", module: knowledge },
  { name: "projects", module: projects },
  { name: "gates", module: gates },
  { name: "jobs", module: jobs },
  { name: "runtime", module: runtime },
  { name: "scenes", module: scenes },
  { name: "assets", module: assets },
  { name: "build", module: build },
];

export function allTools(list: readonly NamedDomain[] = domains): ToolDef[] {
  return list.flatMap((d) => d.module.tools);
}
