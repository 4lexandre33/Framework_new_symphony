/**
 * Resources MCP (`engine://…`) — T2 (SPEC §3.1).
 *
 * - `engine://docs/{name}`          docs/ai/<RULES|CORE|RECIPES|GAPS|INDEX>.md
 * - `engine://module/{key}`         docs/ai/modules/<key>.md
 * - `engine://recipe/{name}`        src/projects/_template/recipes/<name>.ts
 * - `engine://project/{id}/report`  src/projects/<id>/ENGINE_REPORT.md
 */

import { defineResource, type ResourceDef } from "./core/registry.ts";
import { validateProjectId } from "./core/paths.ts";
import {
  AI_DIR,
  assertModuleKey,
  CORE_DOCS,
  exists,
  listProjects,
  moduleKeys,
  MODULES_DIR,
  notFound,
  PROJECTS_DIR,
  readText,
  recipeDescription,
  recipeNames,
  RECIPES_DIR,
  resolveRecipeName,
} from "./knowledge/docs.ts";

const MD = "text/markdown";

function startsWith(values: readonly string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  return values.filter((v) => v.toLowerCase().startsWith(p));
}

export const resources: ResourceDef[] = [
  defineResource({
    name: "engine-docs",
    uri: "engine://docs/{name}",
    title: "Manual de IA",
    description: "Documentos centrais do manual (docs/ai): RULES, CORE, RECIPES, GAPS, INDEX.",
    mimeType: MD,
    list: () =>
      CORE_DOCS.map((name) => ({ uri: `engine://docs/${name}`, name: `docs/ai/${name}.md`, title: `Manual: ${name}`, mimeType: MD })),
    complete: { name: (value) => startsWith(CORE_DOCS, value) },
    read: async (_uri, vars, ctx) => {
      const name = (vars.name ?? "").toUpperCase();
      if (!(CORE_DOCS as readonly string[]).includes(name)) throw notFound("documento", vars.name ?? "", CORE_DOCS);
      return { text: await readText(ctx, `${AI_DIR}/${name}.md`), mimeType: MD };
    },
  }),
  defineResource({
    name: "engine-module",
    uri: "engine://module/{key}",
    title: "Módulo da engine",
    description: "API pública de um módulo (docs/ai/modules/<key>.md): token, tipos, eventos, comandos, notas.",
    mimeType: MD,
    list: (ctx) =>
      moduleKeys(ctx).map((key) => ({ uri: `engine://module/${key}`, name: `${MODULES_DIR}/${key}.md`, title: `Módulo ${key}`, mimeType: MD })),
    complete: { key: (value, ctx) => startsWith(moduleKeys(ctx), value) },
    read: async (_uri, vars, ctx) => {
      const key = assertModuleKey(ctx, vars.key ?? "");
      return { text: await readText(ctx, `${MODULES_DIR}/${key}.md`), mimeType: MD };
    },
  }),
  defineResource({
    name: "engine-recipe",
    uri: "engine://recipe/{name}",
    title: "Receita do template",
    description: "Trecho que compila de src/projects/_template/recipes/<name>.ts.",
    mimeType: "text/x-typescript",
    list: async (ctx) => {
      const out = [];
      for (const name of recipeNames(ctx)) {
        const description = recipeDescription(await readText(ctx, `${RECIPES_DIR}/${name}.ts`));
        out.push({
          uri: `engine://recipe/${name}`,
          name: `${RECIPES_DIR}/${name}.ts`,
          title: `Receita ${name}`,
          ...(description ? { description } : {}),
          mimeType: "text/x-typescript",
        });
      }
      return out;
    },
    complete: { name: (value, ctx) => startsWith(recipeNames(ctx), value) },
    read: async (_uri, vars, ctx) => {
      const name = resolveRecipeName(ctx, vars.name ?? "");
      return { text: await readText(ctx, `${RECIPES_DIR}/${name}.ts`), mimeType: "text/x-typescript" };
    },
  }),
  defineResource({
    name: "engine-project-report",
    uri: "engine://project/{id}/report",
    title: "ENGINE_REPORT de um jogo",
    description: "src/projects/<id>/ENGINE_REPORT.md: bugs, lacunas e confirmações da engine observados pelo jogo.",
    mimeType: MD,
    list: (ctx) =>
      listProjects(ctx)
        .filter((p) => p.hasReport)
        .map((p) => ({ uri: `engine://project/${p.id}/report`, name: `${p.path}/ENGINE_REPORT.md`, title: `ENGINE_REPORT de ${p.id}`, mimeType: MD })),
    complete: { id: (value, ctx) => startsWith(listProjects(ctx).map((p) => p.id), value) },
    read: async (_uri, vars, ctx) => {
      const id = validateProjectId(vars.id);
      const projects = listProjects(ctx).map((p) => p.id);
      if (!projects.includes(id)) throw notFound("jogo", id, projects);
      const rel = `${PROJECTS_DIR}/${id}/ENGINE_REPORT.md`;
      if (!exists(ctx, rel)) {
        throw notFound(
          "ENGINE_REPORT de",
          id,
          listProjects(ctx)
            .filter((p) => p.hasReport)
            .map((p) => p.id),
        );
      }
      return { text: await readText(ctx, rel), mimeType: MD };
    },
  }),
];
