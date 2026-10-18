/**
 * Domínio `knowledge` — T2: manual, módulos, GAPS, receitas (SPEC §3.1).
 *
 * Tudo somente leitura. O parsing vive em ../knowledge/ (compartilhado com
 * os resources `engine://…`).
 */

import { z } from "zod";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";
import {
  AI_DIR,
  assertModuleKey,
  CORE_DOCS,
  fold,
  freezeLockStatus,
  listProjects,
  loadModuleMap,
  moduleKeys,
  MODULES_DIR,
  noteKeys,
  NOTES_DIR,
  notFound,
  parseGaps,
  parseIndex,
  parseModuleDoc,
  readRecipe,
  readText,
  recipeNames,
  resolveRecipeName,
  SEARCH_ROOTS,
  walkFiles,
  exists,
  type GapRow,
} from "../knowledge/docs.ts";
import { parseTokenSource } from "../knowledge/token-api.ts";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/* ============================================================================
 * Schemas compartilhados
 * ========================================================================== */

const gapSchema = z.object({
  id: z.string().describe("id da lacuna (ex.: G8, NV, —)"),
  severity: z.string().describe("A = bloqueia, M = surpresa séria, B = detalhe"),
  type: z.string().describe("LACUNA | RISCO | DESIGN | NV"),
  problem: z.string(),
  workaround: z.string().describe("contorno recomendado"),
  section: z.string().describe("seção do GAPS.md (chave do módulo ou Transversais)"),
  line: z.number().int().describe("linha no docs/ai/GAPS.md"),
});

const docOutput = {
  kind: z.enum(["doc", "module", "note", "path"]),
  name: z.string(),
  path: z.string(),
  bytes: z.number().int(),
  content: z.string(),
};

/* ============================================================================
 * Helpers
 * ========================================================================== */

async function gitValue(ctx: ToolContext, args: string[]): Promise<string | null> {
  try {
    const r = await ctx.exec.runAllowed("git", args, { timeoutMs: 10_000 });
    if (r.code !== 0) return null;
    const v = r.stdout.trim();
    return v === "" ? null : v;
  } catch {
    return null;
  }
}

function searchablePaths(ctx: ToolContext): string[] {
  return SEARCH_ROOTS.flatMap((r) => walkFiles(ctx, r.dir, r.ext));
}

const SNIPPET_MAX = 240;

function snippetOf(line: string, at: number, len: number): string {
  const t = line.trim();
  if (t.length <= SNIPPET_MAX) return t;
  const lead = line.length - line.trimStart().length;
  const pos = Math.max(0, at - lead);
  const start = Math.max(0, Math.min(t.length - SNIPPET_MAX, pos - Math.floor((SNIPPET_MAX - len) / 2)));
  const piece = t.slice(start, start + SNIPPET_MAX);
  return `${start > 0 ? "…" : ""}${piece}${start + SNIPPET_MAX < t.length ? "…" : ""}`;
}

/* ============================================================================
 * Tools
 * ========================================================================== */

const engineInfo = defineTool({
  name: "engine_info",
  title: "Informações da engine",
  description:
    "Visão geral da engine: versão (package.json), branch/commit git, módulos (capabilities) do module-map, jogos em src/projects e status do freeze-lock. Comece por aqui.",
  output: {
    engineVersion: z.string().nullable(),
    serverVersion: z.string(),
    root: z.string(),
    git: z.object({ branch: z.string().nullable(), commit: z.string().nullable() }),
    modules: z.object({
      source: z.enum(["module-map", "docs"]).describe("de onde veio a lista (module-map.mjs ou docs/ai/modules)"),
      count: z.number().int(),
      functional: z.number().int(),
      runtime: z.number().int(),
      capabilities: z.array(
        z.object({ key: z.string(), capabilityId: z.string(), displayName: z.string(), category: z.string(), layer: z.number().nullable() }),
      ),
    }),
    projects: z.array(
      z.object({ id: z.string(), path: z.string(), hasIndex: z.boolean(), hasReport: z.boolean(), hasDesktopJson: z.boolean() }),
    ),
    freezeLock: z.object({
      status: z.enum(["locked", "drift", "unlocked", "invalid"]).describe("locked = arquivos batem; drift = algum hash mudou; unlocked = sem .freeze-lock.json"),
      present: z.boolean(),
      version: z.string().nullable(),
      lockedAt: z.string().nullable(),
      files: z.number().int(),
      changed: z.array(z.string()),
      missing: z.array(z.string()),
    }),
  },
  annotations: READ_ONLY,
  summarize: (o) =>
    `engine ${o.engineVersion ?? "?"} · ${o.git.branch ?? "?"}@${o.git.commit?.slice(0, 8) ?? "?"} · ${o.modules.count} módulos · ${o.projects.length} jogo(s) · freeze-lock ${o.freezeLock.status}`,
  run: async (_args, ctx) => {
    const [branch, commit, map, freezeLock] = await Promise.all([
      gitValue(ctx, ["rev-parse", "--abbrev-ref", "HEAD"]),
      gitValue(ctx, ["rev-parse", "HEAD"]),
      loadModuleMap(ctx),
      freezeLockStatus(ctx),
    ]);
    const capabilities = map
      ? map.map((m) => ({ key: m.key, capabilityId: m.capabilityId, displayName: m.displayName, category: m.category, layer: m.layer }))
      : await Promise.all(
          moduleKeys(ctx).map(async (key) => {
            const doc = parseModuleDoc(await readText(ctx, `${MODULES_DIR}/${key}.md`));
            return {
              key,
              capabilityId: doc.capability?.replace(/@.*$/, "") ?? "",
              displayName: doc.title.replace(/^[^—]*—\s*/, ""),
              category: doc.category ?? "functional",
              layer: null,
            };
          }),
        );
    return {
      engineVersion: ctx.engineVersion,
      serverVersion: ctx.version,
      root: ctx.root,
      git: { branch, commit },
      modules: {
        source: map ? ("module-map" as const) : ("docs" as const),
        count: capabilities.length,
        functional: capabilities.filter((c) => c.category === "functional").length,
        runtime: capabilities.filter((c) => c.category === "runtime").length,
        capabilities,
      },
      projects: listProjects(ctx),
      freezeLock,
    };
  },
});

const docsIndex = defineTool({
  name: "docs_index",
  title: "Índice do manual de IA",
  description:
    "docs/ai/INDEX.md estruturado: ordem de leitura, tabela 'preciso de … → módulo' (chave, capability, dependsOn, ~tokens), tamanhos e atalhos por tipo de jogo. Use para escolher quais módulos ler com module_api/docs_read.",
  output: {
    title: z.string(),
    version: z.string().nullable(),
    readingOrder: z.array(z.string()),
    modules: z.array(
      z.object({
        need: z.string(),
        key: z.string(),
        capability: z.string(),
        dependsOn: z.array(z.string()),
        tokens: z.number().nullable(),
        docPath: z.string(),
      }),
    ),
    sizes: z.record(z.string(), z.number()).describe("~tokens por documento (RULES, CORE, RECIPES, modules)"),
    shortcuts: z.array(z.string()),
    outside: z.array(z.string()),
    docs: z.array(z.string()).describe("valores aceitos em docs_read { doc }"),
  },
  annotations: READ_ONLY,
  summarize: (o) => `manual ${o.version ?? "?"}: ${o.modules.length} módulos`,
  run: async (_args, ctx) => {
    const parsed = parseIndex(await readText(ctx, `${AI_DIR}/INDEX.md`));
    return { ...parsed, docs: [...CORE_DOCS] };
  },
});

const docsRead = defineTool({
  name: "docs_read",
  title: "Ler documento do manual",
  description:
    "Lê um documento em markdown. Passe EXATAMENTE um: { doc: RULES|CORE|RECIPES|GAPS|INDEX } (docs/ai/<doc>.md), { module: <chave> } (docs/ai/modules/<chave>.md: API completa do módulo), { note: <chave> } (docs/ai/notes/<chave>.md: notas verificadas) ou { path } (arquivo devolvido por docs_search, dentro de docs/ai, docs/layer1, docs/mcp ou das receitas).",
  input: {
    doc: z.enum(CORE_DOCS).optional().describe("documento central do manual; leia RULES antes de tudo"),
    module: z.string().optional().describe("chave do módulo (ex.: physics, game-loop); lista em docs_index"),
    note: z.string().optional().describe("chave das notas verificadas (mesmas chaves dos módulos)"),
    path: z.string().optional().describe("caminho relativo devolvido por docs_search (ex.: docs/layer1/creating-a-game.md)"),
  },
  output: docOutput,
  annotations: READ_ONLY,
  summarize: (o) => `${o.path} (${o.bytes} bytes)`,
  run: async ({ doc, module, note, path: relPath }, ctx) => {
    const given = [doc, module, note, relPath].filter((v) => v !== undefined).length;
    if (given !== 1) {
      throw new McpToolError(
        "INVALID_INPUT",
        given === 0 ? "informe doc, module, note ou path" : "informe só um entre doc, module, note e path",
        `doc: ${CORE_DOCS.join(", ")}; module/note: ${moduleKeys(ctx).join(", ")}.`,
      );
    }
    let kind: "doc" | "module" | "note" | "path";
    let name: string;
    let rel: string;
    if (doc !== undefined) {
      kind = "doc";
      name = doc;
      rel = `${AI_DIR}/${doc}.md`;
    } else if (module !== undefined) {
      kind = "module";
      name = assertModuleKey(ctx, module);
      rel = `${MODULES_DIR}/${name}.md`;
    } else if (note !== undefined) {
      const keys = noteKeys(ctx);
      if (!keys.includes(note)) throw notFound("nota", note, keys);
      kind = "note";
      name = note;
      rel = `${NOTES_DIR}/${note}.md`;
    } else {
      const wanted = relPath!.replace(/\\/g, "/").replace(/^\.\//, "");
      const allowed = searchablePaths(ctx);
      if (!allowed.includes(wanted)) {
        throw new McpToolError(
          "NOT_FOUND",
          `caminho fora do manual ou inexistente: ${JSON.stringify(relPath)}`,
          `Use um caminho devolvido por docs_search (raízes: ${SEARCH_ROOTS.map((r) => r.dir).join(", ")}).`,
        );
      }
      kind = "path";
      name = wanted;
      rel = wanted;
    }
    const content = await readText(ctx, rel);
    return { kind, name, path: rel, bytes: Buffer.byteLength(content), content };
  },
});

const docsSearch = defineTool({
  name: "docs_search",
  title: "Buscar no manual",
  description:
    "Busca textual (sem diferenciar maiúsculas nem acentos) em docs/ai (inclui modules/ e notes/), docs/layer1, docs/mcp e nas receitas do template. Várias palavras = todas na mesma linha (frase exata ranqueia primeiro). Devolve caminho:linha + trecho; leia o arquivo com docs_read { path }.",
  input: {
    query: z.string().trim().min(2).max(200).describe("texto a buscar (ex.: 'setNextKinematicTransform', 'pausa render')"),
    limit: z.number().int().min(1).max(200).default(20).describe("máximo de resultados (padrão 20)"),
  },
  output: {
    query: z.string(),
    total: z.number().int().describe("total de linhas encontradas"),
    truncated: z.boolean(),
    filesSearched: z.number().int(),
    results: z.array(
      z.object({ path: z.string(), line: z.number().int(), location: z.string(), snippet: z.string(), score: z.number() }),
    ),
  },
  annotations: READ_ONLY,
  summarize: (o) => `${o.total} ocorrência(s) de "${o.query}"${o.truncated ? ` (mostrando ${o.results.length})` : ""}`,
  run: async ({ query, limit }, ctx) => {
    const phrase = fold(query).replace(/\s+/g, " ").trim();
    const terms = [...new Set(phrase.split(" ").filter(Boolean))];
    const files = searchablePaths(ctx);
    const hits: Array<{ path: string; line: number; location: string; snippet: string; score: number; order: number }> = [];
    let order = 0;
    for (const rel of files) {
      const text = await readText(ctx, rel);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const folded = fold(raw);
        if (!terms.every((t) => folded.includes(t))) continue;
        const phraseAt = folded.indexOf(phrase);
        const at = phraseAt >= 0 ? phraseAt : folded.indexOf(terms[0]!);
        let score = phraseAt >= 0 ? 2 : 1;
        if (/^\s*#/.test(raw)) score += 1;
        hits.push({
          path: rel,
          line: i + 1,
          location: `${rel}:${i + 1}`,
          snippet: snippetOf(raw, at, phraseAt >= 0 ? phrase.length : terms[0]!.length),
          score,
          order: order++,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.order - b.order);
    return {
      query,
      total: hits.length,
      truncated: hits.length > limit,
      filesSearched: files.length,
      results: hits.slice(0, limit).map(({ order: _o, ...h }) => h),
    };
  },
});

const memberSchema = z.object({
  name: z.string(),
  kind: z.enum(["method", "property", "call", "index"]),
  optional: z.boolean(),
  readonly: z.boolean(),
  signature: z.string(),
  doc: z.string().nullable(),
  tags: z.array(z.object({ tag: z.string(), text: z.string().nullable() })),
});

const moduleApi = defineTool({
  name: "module_api",
  title: "API de um módulo",
  description:
    "API pública de um módulo da engine: interfaces do(s) token(s) em src/tokens (métodos/propriedades com assinatura e JSDoc, via AST do TypeScript), capabilities (id@versão), eventos e comandos (de docs/ai/modules/<chave>.md), contratos, notas verificadas e lacunas abertas do GAPS.md para o módulo. Use antes de escrever código que consome o módulo.",
  input: {
    module: z.string().describe("chave do módulo (ex.: physics, world, game-loop); lista em docs_index ou engine_info"),
  },
  output: {
    key: z.string(),
    title: z.string(),
    capability: z.string().nullable(),
    category: z.string().nullable(),
    pluginId: z.string().nullable(),
    docPath: z.string(),
    usage: z.array(z.string()).describe("como importar e acessar"),
    tokens: z.array(
      z.object({
        path: z.string(),
        capabilityId: z.string().nullable(),
        primary: z.boolean(),
        capabilities: z.array(z.object({ constName: z.string(), api: z.string().nullable(), id: z.string().nullable(), version: z.string().nullable() })),
        interfaces: z.array(
          z.object({
            name: z.string(),
            exported: z.boolean(),
            extends: z.array(z.string()),
            typeParameters: z.string().nullable(),
            doc: z.string().nullable(),
            members: z.array(memberSchema),
          }),
        ),
        types: z.array(z.object({ name: z.string(), signature: z.string(), doc: z.string().nullable() })),
      }),
    ),
    events: z.array(z.object({ name: z.string(), type: z.string(), payload: z.string(), description: z.string().nullable() })),
    commands: z.array(z.object({ name: z.string(), type: z.string(), request: z.string(), description: z.string().nullable() })),
    contracts: z.array(z.string()),
    notes: z.array(z.string()).describe("notas verificadas (comportamento)"),
    gaps: z.array(gapSchema).describe("linhas abertas do GAPS.md na seção deste módulo"),
  },
  annotations: READ_ONLY,
  summarize: (o) => {
    const methods = o.tokens.reduce((n, t) => n + t.interfaces.reduce((m, i) => m + i.members.filter((x) => x.kind === "method").length, 0), 0);
    return `${o.key} (${o.capability ?? "?"}): ${methods} método(s), ${o.events.length} evento(s), ${o.commands.length} comando(s), ${o.gaps.length} gap(s)`;
  },
  run: async ({ module }, ctx) => {
    const key = assertModuleKey(ctx, module);
    const docPath = `${MODULES_DIR}/${key}.md`;
    const doc = parseModuleDoc(await readText(ctx, docPath));
    const map = await loadModuleMap(ctx);
    const entry = map?.find((m) => m.key === key);
    const tokenRecords: Array<{ path: string; capabilityId: string | null; primary: boolean }> =
      entry && entry.tokens.length > 0
        ? entry.tokens.map((t) => ({ path: t.path, capabilityId: t.capabilityId ?? null, primary: t.primary !== false }))
        : doc.tokenFiles.length > 0
          ? doc.tokenFiles.map((p, i) => ({ path: p, capabilityId: null, primary: i === 0 }))
          : [{ path: `src/tokens/${key}.ts`, capabilityId: null, primary: true }];
    const tokens = [];
    for (const rec of tokenRecords) {
      if (!exists(ctx, rec.path)) continue;
      const api = parseTokenSource(await readText(ctx, rec.path), rec.path);
      tokens.push({ ...rec, capabilityId: rec.capabilityId ?? api.capabilities[0]?.id ?? null, ...api });
    }
    let notes = doc.notes;
    if (notes.length === 0 && exists(ctx, `${NOTES_DIR}/${key}.md`)) {
      notes = parseModuleDoc(`# n\n\n## notas\n${await readText(ctx, `${NOTES_DIR}/${key}.md`)}`).notes;
    }
    const gaps = exists(ctx, `${AI_DIR}/GAPS.md`)
      ? parseGaps(await readText(ctx, `${AI_DIR}/GAPS.md`)).filter((g) => g.section.toLowerCase() === key)
      : [];
    return {
      key,
      title: doc.title,
      capability: doc.capability,
      category: doc.category,
      pluginId: doc.pluginId,
      docPath,
      usage: doc.usage,
      tokens,
      events: doc.events,
      commands: doc.commands,
      contracts: entry?.contracts.length ? [...entry.contracts] : doc.contracts,
      notes,
      gaps,
    };
  },
});

const gapsList = defineTool({
  name: "gaps_list",
  title: "Lacunas abertas da engine",
  description:
    "Linhas ABERTAS de docs/ai/GAPS.md (o que a engine ainda não faz e o contorno), com filtros. Leia antes de planejar um jogo; registre o que observar com project_report_append.",
  input: {
    module: z.string().optional().describe("chave do módulo (ex.: net) ou 'Transversais'; omitido = todas as seções"),
    severity: z.enum(["A", "M", "B"]).optional().describe("A = bloqueia, M = surpresa séria, B = detalhe"),
    type: z.enum(["LACUNA", "RISCO", "DESIGN", "NV"]).optional().describe("tipo da lacuna"),
    includeCrossCutting: z.boolean().default(false).describe("com `module`, inclui também as linhas de 'Transversais'"),
  },
  output: {
    total: z.number().int(),
    sections: z.array(z.string()).describe("seções com linhas abertas (antes dos filtros)"),
    gaps: z.array(gapSchema),
  },
  annotations: READ_ONLY,
  summarize: (o) => `${o.total} lacuna(s) aberta(s)`,
  run: async ({ module, severity, type, includeCrossCutting }, ctx) => {
    const all: GapRow[] = parseGaps(await readText(ctx, `${AI_DIR}/GAPS.md`));
    const sections = [...new Set(all.map((g) => g.section))];
    let gaps = all;
    if (module !== undefined) {
      const wanted = module.trim().toLowerCase();
      const valid = [...new Set([...sections, ...moduleKeys(ctx)])];
      if (!valid.some((v) => v.toLowerCase() === wanted)) throw notFound("módulo", module, valid);
      gaps = gaps.filter((g) => {
        const s = g.section.toLowerCase();
        return s === wanted || (includeCrossCutting && s === "transversais");
      });
    }
    if (severity !== undefined) gaps = gaps.filter((g) => g.severity.toUpperCase() === severity);
    if (type !== undefined) gaps = gaps.filter((g) => g.type.toUpperCase() === type);
    return { total: gaps.length, sections, gaps };
  },
});

const recipeSummary = z.object({
  name: z.string(),
  path: z.string(),
  description: z.string().describe("comentário inicial da receita"),
  bytes: z.number().int(),
  imports: z.array(z.string()),
});

const recipesList = defineTool({
  name: "recipes_list",
  title: "Receitas do template",
  description:
    "Lista as receitas de src/projects/_template/recipes (trechos que compilam: manifest, tick, física, render, input, HUD, save, Steam, câmera, testes…). Leia uma com recipe_read.",
  output: { recipes: z.array(recipeSummary) },
  annotations: READ_ONLY,
  summarize: (o) => `${o.recipes.length} receita(s)`,
  run: async (_args, ctx) => {
    const recipes = [];
    for (const name of recipeNames(ctx)) {
      const { content: _c, ...info } = await readRecipe(ctx, name);
      recipes.push(info);
    }
    return { recipes };
  },
});

const recipeRead = defineTool({
  name: "recipe_read",
  title: "Ler receita",
  description: "Código-fonte de uma receita do template (aceita o nome completo, com ou sem .ts, o número '03' ou o nome sem prefixo 'physics-body').",
  input: { name: z.string().min(1).describe("nome da receita (ex.: 03-physics-body); lista em recipes_list") },
  output: { ...recipeSummary.shape, content: z.string() },
  annotations: READ_ONLY,
  summarize: (o) => `${o.path} (${o.bytes} bytes)`,
  run: async ({ name }, ctx) => readRecipe(ctx, resolveRecipeName(ctx, name)),
});

export const tools: ToolDef[] = [engineInfo, docsIndex, docsRead, docsSearch, moduleApi, gapsList, recipesList, recipeRead];
