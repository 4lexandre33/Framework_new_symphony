import type { Plugin } from "@core";
import type { ProjectDefinition } from "./project-contract";

/**
 * Composition root LOCAL dos projetos consumidores.
 *
 * Descoberta automática: toda pasta `src/projects/<nome>/` com um `index.ts`
 * que exporte `project` (ProjectDefinition) é encontrada em build time.
 * Pastas que começam com `_` (ex.: `_template`) são ignoradas.
 *
 *  - Adicionar um jogo: soltar a pasta em `src/projects/`.
 *  - Remover um jogo:   apagar a pasta. Nenhum arquivo da engine muda.
 *
 * Seleção: `createProjectPlugins(id)`, ou a variável `VITE_PROJECT`; se houver
 * exatamente um projeto, ele é o ativo. `"none"` sobe a engine sem projeto.
 * A API pública de distribuição será decidida nas Stages 91–116.
 */
const discovered = import.meta.glob<{ readonly project?: ProjectDefinition }>(
  ["./projects/*/index.ts", "!./projects/_*/index.ts"],
  { eager: true },
);

export function listProjects(): readonly ProjectDefinition[] {
  const projects: ProjectDefinition[] = [];
  for (const [file, module] of Object.entries(discovered)) {
    const candidate = module.project;
    if (candidate === undefined || typeof candidate.createPlugins !== "function") {
      throw new Error(`[Project] ${file} deve exportar "project" (ProjectDefinition).`);
    }
    projects.push(candidate);
  }
  return projects.sort((a, b) => a.id.localeCompare(b.id));
}

export function createProjectPlugins(requested?: string): readonly Plugin[] {
  const wanted = requested ?? import.meta.env.VITE_PROJECT;
  if (wanted === "none") return [];

  const projects = listProjects();
  if (projects.length === 0) return [];

  if (wanted !== undefined && wanted !== "") {
    const match = projects.find((p) => p.id === wanted);
    if (match === undefined) {
      throw new Error(
        `[Project] projeto "${wanted}" não encontrado. Disponíveis: ${projects.map((p) => p.id).join(", ")}.`,
      );
    }
    return match.createPlugins();
  }

  const [only] = projects;
  if (projects.length === 1 && only !== undefined) return only.createPlugins();

  throw new Error(
    `[Project] vários projetos encontrados (${projects.map((p) => p.id).join(", ")}); defina VITE_PROJECT.`,
  );
}
