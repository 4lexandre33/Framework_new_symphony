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
 * Seleção (`selectProject`): argumento, `VITE_PROJECT`, `?project=<id>` na URL
 * (só se o build não fixou) ou o projeto único. `"none"` sobe a engine sem
 * projeto. Vários projetos sem seleção NÃO derrubam o app: a engine sobe sem
 * projeto e o host mostra um seletor (G24).
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

/**
 * Resultado da seleção do projeto ativo (G24). Nunca lança para o caso
 * "vários projetos sem seleção": devolve `status: "none"` com
 * `reason: "ambiguous"` para o host mostrar um seletor/mensagem.
 */
export type ProjectSelection =
  | {
      readonly status: "selected";
      readonly project: ProjectDefinition;
      readonly source: "argument" | "env" | "url" | "single";
    }
  | {
      readonly status: "none";
      readonly reason: "explicit-none" | "no-projects" | "ambiguous" | "unknown-url";
      readonly available: readonly ProjectDefinition[];
      /** Id pedido pela URL que não existe (reason "unknown-url"). */
      readonly requested?: string;
    };

/** Parâmetro de URL usado pelo seletor de projeto (`?project=<id>`). */
export const PROJECT_URL_PARAM = "project";

function readUrlProject(search: string | undefined): string | undefined {
  if (search === undefined || search === "") return undefined;
  try {
    const value = new URLSearchParams(search).get(PROJECT_URL_PARAM);
    return value === null || value === "" ? undefined : value;
  } catch {
    return undefined;
  }
}

function currentSearch(): string | undefined {
  return typeof location !== "undefined" && typeof location.search === "string"
    ? location.search
    : undefined;
}

/**
 * Precedência: argumento > `VITE_PROJECT` (build fixa o jogo) > `?project=`
 * na URL (só quando o build não fixou) > projeto único.
 *
 * - argumento/`VITE_PROJECT` inexistente = erro de configuração (lança).
 * - `?project=` inexistente = `none/unknown-url` (não derruba o app).
 * - vários projetos sem seleção = `none/ambiguous` (não derruba o app).
 */
export function selectProject(
  requested?: string,
  search: string | undefined = currentSearch(),
): ProjectSelection {
  return resolveProjectSelection(listProjects(), {
    requested,
    env: import.meta.env.VITE_PROJECT,
    search,
  });
}

/** Núcleo puro de `selectProject` (testável com uma lista arbitrária). */
export function resolveProjectSelection(
  projects: readonly ProjectDefinition[],
  opts: { readonly requested?: string; readonly env?: string; readonly search?: string } = {},
): ProjectSelection {
  const { requested, search } = opts;
  const fromEnv = opts.env;
  const explicit =
    requested !== undefined && requested !== ""
      ? { id: requested, source: "argument" as const }
      : fromEnv !== undefined && fromEnv !== ""
        ? { id: fromEnv, source: "env" as const }
        : undefined;

  if (explicit?.id === "none") {
    return { status: "none", reason: "explicit-none", available: projects };
  }
  if (explicit !== undefined) {
    const match = projects.find((p) => p.id === explicit.id);
    if (match === undefined) {
      throw new Error(
        `[Project] projeto "${explicit.id}" não encontrado. Disponíveis: ${projects.map((p) => p.id).join(", ") || "(nenhum)"}.`,
      );
    }
    return { status: "selected", project: match, source: explicit.source };
  }

  const fromUrl = readUrlProject(search);
  if (fromUrl === "none") {
    return { status: "none", reason: "explicit-none", available: projects };
  }
  if (fromUrl !== undefined) {
    const match = projects.find((p) => p.id === fromUrl);
    if (match !== undefined) return { status: "selected", project: match, source: "url" };
    return { status: "none", reason: "unknown-url", available: projects, requested: fromUrl };
  }

  if (projects.length === 0) return { status: "none", reason: "no-projects", available: projects };
  const [only] = projects;
  if (projects.length === 1 && only !== undefined) {
    return { status: "selected", project: only, source: "single" };
  }
  return { status: "none", reason: "ambiguous", available: projects };
}

/**
 * Plugins do projeto ativo. Com vários projetos e nenhuma seleção devolve
 * `[]` (engine sem projeto) em vez de lançar (G24); use `selectProject`
 * para saber o motivo e mostrar um seletor.
 */
export function createProjectPlugins(requested?: string): readonly Plugin[] {
  const selection = selectProject(requested);
  return selection.status === "selected" ? selection.project.createPlugins() : [];
}
