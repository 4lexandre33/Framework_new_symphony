/**
 * Domínio `projects` — T3: jogos em src/projects/<id> (SPEC §3.2).
 *
 * - Leitura/escrita só dentro de `src/projects/<id>/` (texto ≤ 1 MiB, escrita
 *   atômica); links simbólicos que saem da pasta do jogo são recusados.
 * - `project_create` gera o jogo a partir de `tools/mcp/templates/project/<template>/`
 *   (arquivos `.tpl`; placeholders `__ID__`, `__PASCAL__`, `__NAME_LITERAL__`,
 *   `__PLUGIN_NAME_LITERAL__` no conteúdo e `__ID__`/`__PASCAL__` nos nomes).
 *   O `index.ts` é escrito por último: a descoberta automática só vê o jogo completo.
 * - `project_check` roda tsc do repo inteiro filtrado aos arquivos do jogo,
 *   o script de isolamento e o vitest da pasta do jogo.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import type { ExecResult } from "../core/exec.ts";
import { PROJECT_ID_RE } from "../core/paths.ts";
import { defineTool, type ToolCall, type ToolDef } from "../core/registry.ts";

/* ============================================================================
 * Constantes e helpers
 * ========================================================================== */

export const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_LISTED_FILES = 5000;
const TEMPLATE_ROOT = fileURLToPath(new URL("../../templates/project/", import.meta.url));
const TAURI_CONFIG_SCRIPT = fileURLToPath(new URL("../../../../scripts/tauri-project-config.mjs", import.meta.url));
export const PROJECT_TEMPLATES = ["minimal", "physics"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];
const RESERVED_IDS = new Set(["none"]);
const REPORT_FILE = "ENGINE_REPORT.md";
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const idInput = z
  .string()
  .regex(PROJECT_ID_RE, "id inválido: use minúsculas, dígitos e hífen ([a-z0-9][a-z0-9-]{0,62})")
  .describe("id do jogo = nome da pasta em src/projects/ (ex.: meu-jogo). Pastas _* (como _template) não são acessíveis.");

const fileInput = z
  .string()
  .min(1)
  .max(512)
  .describe("caminho RELATIVO à pasta do jogo, com '/' (ex.: index.ts, adapters/View.ts). Sem '..' para fora do jogo.");

function projectRel(id: string): string {
  return `src/projects/${id}`;
}

function projectAbs(ctx: ToolContext, id: string): string {
  return ctx.paths.resolve(projectRel(id));
}

function isDir(abs: string): boolean {
  try {
    return lstatSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function requireProject(ctx: ToolContext, id: string): string {
  const abs = projectAbs(ctx, id);
  if (!isDir(abs)) {
    throw new McpToolError("NOT_FOUND", `jogo ${id} não existe em src/projects/${id}`, "Use project_list para ver os jogos ou project_create para criar.");
  }
  return abs;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath do ancestral existente mais próximo + o resto. */
function nearestRealpath(abs: string): string {
  let current = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve um caminho relativo à pasta do jogo. Recusa escapes lexicais e
 * links simbólicos que levem para fora do jogo (`WRITE_FORBIDDEN` na escrita,
 * `INVALID_INPUT` na leitura). Devolve o relativo à raiz e o absoluto.
 */
function resolveProjectFile(ctx: ToolContext, id: string, file: string, mode: "read" | "write"): { rel: string; abs: string; inner: string } {
  const projAbs = requireProject(ctx, id);
  const code = mode === "write" ? "WRITE_FORBIDDEN" : "INVALID_INPUT";
  if (file.includes("\0")) throw new McpToolError("INVALID_INPUT", "caminho com byte nulo");
  const cleaned = file.replace(/\\/g, "/");
  if (cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) {
    throw new McpToolError(code, `caminho absoluto não é aceito: ${file}`, "Use um caminho relativo à pasta do jogo (ex.: adapters/View.ts).");
  }
  const inner = path.posix.normalize(cleaned).replace(/\/+$/, "");
  if (inner === "." || inner === "" || inner === ".." || inner.startsWith("../")) {
    throw new McpToolError(code, `caminho fora da pasta do jogo: ${file}`, `Só é permitido ${mode === "write" ? "escrever" : "ler"} dentro de src/projects/${id}/.`);
  }
  const rel = `${projectRel(id)}/${inner}`;
  const abs = ctx.paths.resolve(rel);
  const projReal = realpathSync(projAbs);
  if (!inside(nearestRealpath(abs), projReal)) {
    throw new McpToolError(code, `caminho sai da pasta do jogo (link simbólico): ${file}`, `Só é permitido ${mode === "write" ? "escrever" : "ler"} dentro de src/projects/${id}/.`);
  }
  return { rel, abs, inner };
}

interface FileEntry {
  path: string;
  bytes: number;
}

async function walkFiles(root: string, limit = MAX_LISTED_FILES): Promise<{ files: FileEntry[]; truncated: boolean }> {
  const files: FileEntry[] = [];
  let truncated = false;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(abs);
      } else if (entry.isFile()) {
        files.push({ path: toPosix(path.relative(root, abs)), bytes: (await stat(abs)).size });
      }
      // links simbólicos não são seguidos nem listados
    }
  };
  await walk(root);
  return { files, truncated };
}

function unquote(literal: string): string | null {
  try {
    if (literal.startsWith('"')) return JSON.parse(literal) as string;
    return literal.slice(1, -1).replace(/\\(.)/g, "$1");
  } catch {
    return null;
  }
}

/** Lê `id`/`name` declarados no `index.ts` (heurística por regex, sem executar). */
async function readDeclared(projAbs: string): Promise<{ hasIndex: boolean; declaredId: string | null; name: string | null }> {
  const index = path.join(projAbs, "index.ts");
  if (!existsSync(index)) return { hasIndex: false, declaredId: null, name: null };
  const src = await readFile(index, "utf8");
  const str = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
  const idMatch = new RegExp(String.raw`\bid\s*:\s*` + str).exec(src);
  const nameMatch = new RegExp(String.raw`\bname\s*:\s*` + str).exec(src);
  return {
    hasIndex: true,
    declaredId: idMatch ? unquote(idMatch[1]!) : null,
    name: nameMatch ? unquote(nameMatch[1]!) : null,
  };
}

/** "meu-jogo" → "MeuJogo"; ids que começam com dígito ganham prefixo "Game". */
export function toPascal(id: string): string {
  const pascal = id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return /^[0-9]/.test(pascal) ? `Game${pascal}` : pascal;
}

function reportHeader(id: string, name: string): string {
  return [
    `# ENGINE_REPORT — ${name}`,
    "",
    `Relatório do jogo \`${id}\` para quem mantém a engine: bugs, lacunas (gaps) e`,
    "confirmações (ok) observados ao usar as APIs públicas. Um jogo NÃO altera a",
    "engine (docs/ai/GAPS.md): registre aqui e siga com o contorno.",
    "",
    "Formato de cada entrada: `## AAAA-MM-DD — <módulo> — <bug|gap|ok>` seguido do",
    "texto (para bugs, uma reprodução mínima).",
    "",
  ].join("\n");
}

const REPORT_ENTRY_RE = /^## \d{4}-\d{2}-\d{2} — /gm;

/* ---- desktop.json --------------------------------------------------------- */

type BuildTauriConfig = (id: string, desktop?: Record<string, unknown>, baseWindow?: Record<string, unknown>) => Record<string, unknown>;
let tauriConfigFn: Promise<BuildTauriConfig> | null = null;

async function loadBuildTauriConfig(): Promise<BuildTauriConfig> {
  tauriConfigFn ??= (async () => {
    const mod = (await import(pathToFileURL(TAURI_CONFIG_SCRIPT).href)) as { buildProjectTauriConfig?: unknown };
    if (typeof mod.buildProjectTauriConfig !== "function") {
      throw new McpToolError("INTERNAL", "scripts/tauri-project-config.mjs não exporta buildProjectTauriConfig");
    }
    return mod.buildProjectTauriConfig as BuildTauriConfig;
  })();
  try {
    return await tauriConfigFn;
  } catch (error) {
    tauriConfigFn = null;
    throw error;
  }
}

/** Valida um desktop.json com o mesmo código do build (`buildProjectTauriConfig`). */
export async function validateDesktopJson(id: string, desktop: Record<string, unknown>): Promise<Record<string, unknown>> {
  const build = await loadBuildTauriConfig();
  try {
    return build(id, desktop, {});
  } catch (error) {
    throw new McpToolError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : String(error),
      "desktop.json aceita só productName, identifier (reverse-DNS, nunca com.projeto1.game) e window {title,width,height,resizable,fullscreen,decorations,alwaysOnTop,transparent}.",
    );
  }
}

/* ---- templates ------------------------------------------------------------ */

interface RenderedFile {
  readonly path: string;
  readonly content: string;
}

async function renderTemplate(template: ProjectTemplate, vars: Record<string, string>): Promise<RenderedFile[]> {
  const dir = path.join(TEMPLATE_ROOT, template);
  if (!isDir(dir)) throw new McpToolError("INTERNAL", `template ${template} não encontrado em ${dir}`);
  const { files } = await walkFiles(dir);
  const replace = (text: string): string => text.replace(/__(PLUGIN_NAME_LITERAL|NAME_LITERAL|PASCAL|ID)__/g, (_m, key: string) => vars[key] ?? _m);
  const out: RenderedFile[] = [];
  for (const f of files) {
    if (!f.path.endsWith(".tpl")) continue;
    const content = await readFile(path.join(dir, f.path), "utf8");
    out.push({ path: replace(f.path.slice(0, -".tpl".length)), content: replace(content) });
  }
  return out;
}

/* ---- project_check -------------------------------------------------------- */

const failureSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  code: z.string().optional(),
  message: z.string(),
});
type Failure = z.infer<typeof failureSchema>;

const checkStepName = z.enum(["tsc", "isolation", "tests"]);
type CheckStepName = z.infer<typeof checkStepName>;

const stepSchema = z.object({
  name: checkStepName,
  ok: z.boolean(),
  durationMs: z.number(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  summary: z.string(),
  failures: z.array(failureSchema),
  /** tsc: erros fora do jogo (não contam para o resultado). */
  ignoredErrors: z.number().optional(),
  tests: z.object({ total: z.number(), passed: z.number(), failed: z.number(), files: z.number() }).optional(),
  outputTail: z.string().optional(),
});
type StepResult = z.infer<typeof stepSchema>;

const MAX_FAILURES = 200;
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export function parseTscOutput(output: string): Failure[] {
  const failures: Failure[] = [];
  let last: Failure | null = null;
  for (const line of output.split(/\r?\n/)) {
    const m = TSC_LINE_RE.exec(line);
    if (m) {
      last = { file: toPosix(m[1]!.trim()), line: Number(m[2]), column: Number(m[3]), code: m[4]!, message: m[5]! };
      failures.push(last);
    } else if (last && /^\s+\S/.test(line)) {
      last.message += `\n${line.trim()}`; // continuação de mensagem longa
    } else {
      last = null;
    }
  }
  return failures;
}

function tail(result: ExecResult, n = 3000): string {
  return `${result.stdout}\n${result.stderr}`.trim().slice(-n);
}

function missingStep(name: CheckStepName, what: string, hint: string): StepResult {
  return { name, ok: false, durationMs: 0, exitCode: null, timedOut: false, summary: `${what} não encontrado — ${hint}`, failures: [] };
}

async function runTscStep(ctx: ToolContext, id: string, signal: AbortSignal): Promise<StepResult> {
  const bin = path.join(ctx.root, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(bin)) return missingStep("tsc", "node_modules/typescript", "rode npm install");
  const r = await ctx.exec.runAllowed("node", [bin, "--noEmit", "-p", "tsconfig.json", "--pretty", "false"], { timeoutMs: 10 * 60_000, signal });
  const all = parseTscOutput(r.stdout + "\n" + r.stderr);
  const prefix = `${projectRel(id)}/`;
  const mine = all.filter((f) => f.file.startsWith(prefix));
  const ignored = all.length - mine.length;
  // Código ≠ 0 sem nenhum erro reconhecido = falha de configuração do tsc.
  const configFailure = r.code !== 0 && all.length === 0;
  const ok = !r.timedOut && !r.aborted && !configFailure && mine.length === 0;
  const summary = r.timedOut
    ? "tsc: tempo esgotado"
    : configFailure
      ? "tsc falhou sem erros de arquivo (configuração?)"
      : `${mine.length} erro(s) no jogo${ignored ? `; ${ignored} erro(s) fora do jogo ignorado(s)` : ""}`;
  return {
    name: "tsc",
    ok,
    durationMs: r.durationMs,
    exitCode: r.code,
    timedOut: r.timedOut,
    summary,
    failures: mine.slice(0, MAX_FAILURES),
    ignoredErrors: ignored,
    ...(configFailure || r.timedOut ? { outputTail: tail(r) } : {}),
  };
}

async function runIsolationStep(ctx: ToolContext, signal: AbortSignal): Promise<StepResult> {
  const script = "scripts/architecture/check-project-isolation.mjs";
  if (!existsSync(path.join(ctx.root, script))) return missingStep("isolation", script, "o repositório está incompleto");
  const r = await ctx.exec.runAllowed("node", [script], { timeoutMs: 30 * 60_000, signal });
  const ok = r.code === 0 && !r.timedOut && !r.aborted;
  const out = `${r.stdout}\n${r.stderr}`;
  const failedLines = out.split(/\r?\n/).filter((l) => /falhou|error TS\d+|FAIL\b/.test(l)).slice(0, MAX_FAILURES);
  return {
    name: "isolation",
    ok,
    durationMs: r.durationMs,
    exitCode: r.code,
    timedOut: r.timedOut,
    summary: ok ? "PROJECT ISOLATION: PASS" : r.timedOut ? "isolamento: tempo esgotado" : "isolamento falhou (a engine depende de algum jogo?)",
    failures: ok ? [] : failedLines.map((message) => ({ file: script, message: message.trim() })),
    ...(ok ? {} : { outputTail: tail(r) }),
  };
}

interface VitestJson {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  testResults?: Array<{
    name?: string;
    status?: string;
    message?: string;
    assertionResults?: Array<{ fullName?: string; title?: string; status?: string; failureMessages?: string[] }>;
  }>;
}

function parseVitestJson(stdout: string): VitestJson | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1)) as VitestJson;
  } catch {
    return null;
  }
}

async function runTestsStep(ctx: ToolContext, id: string, signal: AbortSignal): Promise<StepResult> {
  const bin = path.join(ctx.root, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(bin)) return missingStep("tests", "node_modules/vitest", "rode npm install");
  const r = await ctx.exec.runAllowed("node", [bin, "run", `${projectRel(id)}/`, "--reporter=json", "--passWithNoTests"], {
    timeoutMs: 10 * 60_000,
    signal,
  });
  const json = parseVitestJson(r.stdout);
  const failures: Failure[] = [];
  for (const file of json?.testResults ?? []) {
    const rel = file.name ? toPosix(path.isAbsolute(file.name) ? path.relative(ctx.root, file.name) : file.name) : "?";
    for (const a of file.assertionResults ?? []) {
      if (a.status === "failed") {
        const first = (a.failureMessages?.[0] ?? "").split("\n")[0] ?? "";
        failures.push({ file: rel, message: `${a.fullName ?? a.title ?? "teste"}: ${first}`.trim() });
      }
    }
    if (file.status === "failed" && !(file.assertionResults ?? []).some((a) => a.status === "failed")) {
      failures.push({ file: rel, message: (file.message ?? "suíte falhou").split("\n").slice(0, 5).join("\n") });
    }
  }
  const tests = {
    total: json?.numTotalTests ?? 0,
    passed: json?.numPassedTests ?? 0,
    failed: json?.numFailedTests ?? 0,
    files: json?.testResults?.length ?? 0,
  };
  const ok = r.code === 0 && !r.timedOut && !r.aborted;
  const summary = r.timedOut
    ? "testes: tempo esgotado"
    : json
      ? `${tests.passed}/${tests.total} teste(s) passaram em ${tests.files} arquivo(s)`
      : `vitest terminou com código ${r.code ?? "nulo"} (saída não reconhecida)`;
  return {
    name: "tests",
    ok,
    durationMs: r.durationMs,
    exitCode: r.code,
    timedOut: r.timedOut,
    summary,
    failures: failures.slice(0, MAX_FAILURES),
    tests,
    ...(ok ? {} : { outputTail: tail(r) }),
  };
}

async function runCheck(ctx: ToolContext, id: string, steps: readonly CheckStepName[], call: ToolCall): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let i = 0;
  for (const step of steps) {
    await call.progress(i++, steps.length, `project_check ${id}: ${step}`);
    if (call.signal.aborted) break;
    if (step === "tsc") results.push(await runTscStep(ctx, id, call.signal));
    else if (step === "isolation") results.push(await runIsolationStep(ctx, call.signal));
    else results.push(await runTestsStep(ctx, id, call.signal));
  }
  await call.progress(steps.length, steps.length, `project_check ${id}: fim`);
  return results;
}

/* ============================================================================
 * Tools
 * ========================================================================== */

const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  declaredId: z.string().nullable(),
  path: z.string(),
  hasIndex: z.boolean(),
  hasDesktopJson: z.boolean(),
  hasReport: z.boolean(),
  files: z.number(),
});

export const tools: ToolDef[] = [
  defineTool({
    name: "project_list",
    title: "Listar jogos",
    description:
      "Lista os jogos em src/projects/ (pastas que não começam com '_'; _template é o molde e nunca é carregado). Para cada jogo: id (pasta), nome e id declarados no index.ts, se tem desktop.json e ENGINE_REPORT.md e nº de arquivos. Também devolve os templates aceitos por project_create.",
    output: { projects: z.array(projectSummarySchema), templates: z.array(z.string()) },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (_args, ctx) => {
      const base = ctx.paths.resolve("src/projects");
      const projects: z.infer<typeof projectSummarySchema>[] = [];
      if (isDir(base)) {
        const entries = (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith("_") && PROJECT_ID_RE.test(e.name));
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const e of entries) {
          const abs = path.join(base, e.name);
          const declared = await readDeclared(abs);
          const { files } = await walkFiles(abs);
          projects.push({
            id: e.name,
            name: declared.name ?? e.name,
            declaredId: declared.declaredId,
            path: projectRel(e.name),
            hasIndex: declared.hasIndex,
            hasDesktopJson: existsSync(path.join(abs, "desktop.json")),
            hasReport: existsSync(path.join(abs, REPORT_FILE)),
            files: files.length,
          });
        }
      }
      return { projects, templates: [...PROJECT_TEMPLATES] };
    },
    summarize: (out) => `${out.projects.length} jogo(s): ${out.projects.map((p) => p.id).join(", ") || "(nenhum)"}`,
  }),

  defineTool({
    name: "project_create",
    title: "Criar jogo",
    description:
      "Cria um jogo novo em src/projects/<id>/ a partir de um template ('minimal': plugin + lógica pura no game.loop.tick; 'physics': corpo rígido com PhysicsApi + adapter Three.js no padrão ports/adapters). Gera index.ts (exporta `project`), plugin com manifest, lógica testável, teste vitest e ENGINE_REPORT.md; opcionalmente desktop.json (validado como no build desktop). O jogo aparece sozinho no seletor (descoberta automática). Recusa id existente (PROJECT_EXISTS) e ids reservados ('none', '_*'). Depois rode project_check.",
    input: {
      id: idInput,
      name: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[^\u0000-\u001f\u007f]+$/, "nome sem caracteres de controle")
        .describe("nome legível do jogo (ex.: \"Meu Jogo\"), até 64 caracteres"),
      template: z.enum(PROJECT_TEMPLATES).optional().describe("'minimal' (padrão) ou 'physics'"),
      withDesktopJson: z
        .boolean()
        .optional()
        .describe("true gera desktop.json (productName = nome, identifier com.projeto1.<id sem hífens>, janela 1280x720 redimensionável)"),
      desktop: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("sobrescreve campos do desktop.json gerado: { productName?, identifier?, window?: { title,width,height,resizable,fullscreen,decorations,alwaysOnTop,transparent } } (implica withDesktopJson)"),
    },
    output: {
      id: z.string(),
      path: z.string(),
      template: z.enum(PROJECT_TEMPLATES),
      files: z.array(z.string()),
      next: z.array(z.string()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ id, name, template = "minimal", withDesktopJson, desktop }, ctx) => {
      if (RESERVED_IDS.has(id) || id.startsWith("_")) {
        throw new McpToolError("INVALID_INPUT", `id reservado: ${id}`, "'none' sobe a engine sem projeto e pastas '_*' são ignoradas; escolha outro id.");
      }
      const rel = projectRel(id);
      ctx.paths.assertWritable(rel); // READONLY / WRITE_FORBIDDEN antes de qualquer trabalho
      const abs = projectAbs(ctx, id);
      if (existsSync(abs)) {
        throw new McpToolError("PROJECT_EXISTS", `já existe src/projects/${id}`, "Escolha outro id ou use project_delete antes (irreversível).");
      }

      const pascal = toPascal(id);
      const files = await renderTemplate(template, {
        ID: id,
        PASCAL: pascal,
        NAME_LITERAL: JSON.stringify(name),
        PLUGIN_NAME_LITERAL: JSON.stringify(`Projeto — ${name}`),
      });
      const extra: RenderedFile[] = [{ path: REPORT_FILE, content: reportHeader(id, name) }];
      if (withDesktopJson === true || desktop !== undefined) {
        const defaults = {
          productName: name,
          identifier: `com.projeto1.${id.replace(/-/g, "")}`,
          window: { title: name, width: 1280, height: 720, resizable: true },
        };
        const userWindow = desktop?.window;
        const merged: Record<string, unknown> = {
          ...defaults,
          ...(desktop ?? {}),
          window:
            userWindow !== undefined && userWindow !== null && typeof userWindow === "object" && !Array.isArray(userWindow)
              ? { ...defaults.window, ...(userWindow as Record<string, unknown>) }
              : (userWindow ?? defaults.window),
        };
        await validateDesktopJson(id, merged);
        extra.push({ path: "desktop.json", content: `${JSON.stringify(merged, null, 2)}\n` });
      }

      // index.ts por último: o jogo só fica visível para a descoberta quando completo.
      const all = [...files.filter((f) => f.path !== "index.ts"), ...extra, ...files.filter((f) => f.path === "index.ts")];
      try {
        for (const f of all) await ctx.paths.writeFileAtomic(`${rel}/${f.path}`, f.content);
      } catch (error) {
        await ctx.paths.remove(rel).catch(() => undefined);
        throw error;
      }
      return {
        id,
        path: rel,
        template,
        files: all.map((f) => f.path).sort(),
        next: [
          `project_check { id: "${id}" } — tsc + isolamento + testes do jogo`,
          `npm run dev e abra http://localhost:1420/?project=${id} (ou VITE_PROJECT=${id})`,
          "Leia docs/ai/RULES.md e as receitas (recipes_list) antes de crescer o jogo",
        ],
      };
    },
    summarize: (out) => `jogo ${out.id} criado (${out.template}, ${out.files.length} arquivos) em ${out.path}`,
  }),

  defineTool({
    name: "project_files",
    title: "Arquivos de um jogo",
    description: "Lista recursivamente os arquivos de src/projects/<id>/ (caminhos relativos à pasta do jogo e tamanho em bytes). Links simbólicos não são seguidos.",
    input: { id: idInput },
    output: {
      id: z.string(),
      path: z.string(),
      files: z.array(z.object({ path: z.string(), bytes: z.number() })),
      totalBytes: z.number(),
      truncated: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id }, ctx) => {
      const abs = requireProject(ctx, id);
      const { files, truncated } = await walkFiles(abs);
      return { id, path: projectRel(id), files, totalBytes: files.reduce((s, f) => s + f.bytes, 0), truncated };
    },
    summarize: (out) => `${out.files.length} arquivo(s) em ${out.path}${out.truncated ? " (truncado)" : ""}`,
  }),

  defineTool({
    name: "project_read_file",
    title: "Ler arquivo do jogo",
    description: "Lê um arquivo de TEXTO (≤ 1 MiB, UTF-8) dentro de src/projects/<id>/. Recusa binários, caminhos fora do jogo e links simbólicos que saem dele.",
    input: { id: idInput, path: fileInput },
    output: { id: z.string(), path: z.string(), content: z.string(), bytes: z.number(), lines: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id, path: file }, ctx) => {
      const { rel, abs, inner } = resolveProjectFile(ctx, id, file, "read");
      let info;
      try {
        info = await stat(abs);
      } catch {
        throw new McpToolError("NOT_FOUND", `arquivo não existe: ${rel}`, "Use project_files para ver os arquivos do jogo.");
      }
      if (!info.isFile()) throw new McpToolError("INVALID_INPUT", `não é um arquivo: ${rel}`);
      if (info.size > MAX_TEXT_BYTES) {
        throw new McpToolError("INVALID_INPUT", `arquivo grande demais (${info.size} bytes; limite ${MAX_TEXT_BYTES})`);
      }
      const buf = await readFile(abs);
      if (buf.includes(0)) throw new McpToolError("INVALID_INPUT", `arquivo binário: ${rel}`, "Só arquivos de texto podem ser lidos por esta tool.");
      const content = buf.toString("utf8");
      return { id, path: inner, content, bytes: buf.length, lines: content === "" ? 0 : content.split("\n").length };
    },
    summarize: (out) => `${out.path}: ${out.bytes} bytes, ${out.lines} linha(s)`,
  }),

  defineTool({
    name: "project_write_file",
    title: "Gravar arquivo do jogo",
    description:
      "Grava (cria ou substitui, de forma atômica) um arquivo de TEXTO (≤ 1 MiB) dentro de src/projects/<id>/, criando as pastas. O jogo precisa existir. Escrita fora do jogo, na engine ou em _template é recusada (WRITE_FORBIDDEN). Rode project_check depois.",
    input: {
      id: idInput,
      path: fileInput,
      content: z.string().describe("conteúdo completo do arquivo (UTF-8, ≤ 1 MiB, sem byte nulo)"),
    },
    output: { id: z.string(), path: z.string(), bytes: z.number(), created: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async ({ id, path: file, content }, ctx) => {
      const { rel, abs, inner } = resolveProjectFile(ctx, id, file, "write");
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_TEXT_BYTES) throw new McpToolError("INVALID_INPUT", `conteúdo grande demais (${bytes} bytes; limite ${MAX_TEXT_BYTES})`);
      if (content.includes("\0")) throw new McpToolError("INVALID_INPUT", "conteúdo com byte nulo (só texto)");
      if (isDir(abs)) throw new McpToolError("INVALID_INPUT", `${rel} é uma pasta`);
      const created = !existsSync(abs);
      await ctx.paths.writeFileAtomic(rel, content);
      return { id, path: inner, bytes, created };
    },
    summarize: (out) => `${out.created ? "criado" : "atualizado"} ${out.path} (${out.bytes} bytes)`,
  }),

  defineTool({
    name: "project_report_append",
    title: "Registrar no ENGINE_REPORT",
    description:
      "Anexa uma entrada ao src/projects/<id>/ENGINE_REPORT.md (cria com cabeçalho se faltar): `## AAAA-MM-DD — <módulo> — <kind>` + texto. Use para bugs da engine, lacunas de API (gap) ou confirmações (ok) — em vez de alterar a engine.",
    input: {
      id: idInput,
      module: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "módulo: minúsculas, dígitos, '.', '_' ou '-' (ex.: physics, game.render)")
        .describe("chave do módulo da engine (como em docs/ai/modules/<chave>.md) ou id da capability (ex.: physics, game.render)"),
      kind: z.enum(["bug", "gap", "ok"]).describe("bug = comportamento errado; gap = falta API; ok = recurso verificado e funcionando"),
      text: z.string().trim().min(1).max(20_000).describe("descrição em markdown (para bug: passos, esperado × obtido, reprodução mínima)"),
    },
    output: { id: z.string(), path: z.string(), created: z.boolean(), entry: z.string(), entries: z.number() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ id, module, kind, text }, ctx) => {
      const { rel, abs } = resolveProjectFile(ctx, id, REPORT_FILE, "write");
      let current: string | null = null;
      if (existsSync(abs)) current = await readFile(abs, "utf8");
      if (current === null) {
        const declared = await readDeclared(projectAbs(ctx, id));
        current = reportHeader(id, declared.name ?? id);
      }
      const date = new Date().toISOString().slice(0, 10);
      const entry = `## ${date} — ${module} — ${kind}\n\n${text}\n`;
      const next = `${current.replace(/\s*$/, "\n")}\n${entry}`;
      if (Buffer.byteLength(next, "utf8") > MAX_TEXT_BYTES) {
        throw new McpToolError("INVALID_INPUT", "ENGINE_REPORT.md passaria de 1 MiB", "Resuma ou arquive entradas antigas com project_write_file.");
      }
      const created = !existsSync(abs);
      await ctx.paths.writeFileAtomic(rel, next);
      return { id, path: rel, created, entry, entries: (next.match(REPORT_ENTRY_RE) ?? []).length };
    },
    summarize: (out) => `${out.created ? "criado " : ""}${out.path}: ${out.entries} entrada(s)`,
  }),

  defineTool({
    name: "project_check",
    title: "Verificar jogo",
    description:
      "Verifica um jogo: 'tsc' (tsc --noEmit do repo inteiro, filtrado aos erros em src/projects/<id>/), 'isolation' (scripts/architecture/check-project-isolation.mjs: engine verde sem os jogos — lento, minutos) e 'tests' (vitest run src/projects/<id>/). Devolve resumo estruturado por etapa com failures[{file,line,message}]. Padrão: todas as etapas.",
    input: {
      id: idInput,
      steps: z
        .array(checkStepName)
        .min(1)
        .optional()
        .describe("etapas a rodar, na ordem (padrão: [\"tsc\", \"isolation\", \"tests\"]); omita 'isolation' para um ciclo rápido"),
    },
    output: { id: z.string(), ok: z.boolean(), durationMs: z.number(), steps: z.array(stepSchema) },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id, steps }, ctx, call) => {
      requireProject(ctx, id);
      const started = Date.now();
      const order = [...new Set(steps ?? (["tsc", "isolation", "tests"] as const))];
      const results = await runCheck(ctx, id, order, call);
      return { id, ok: results.length === order.length && results.every((s) => s.ok), durationMs: Date.now() - started, steps: results };
    },
    summarize: (out) => `${out.id}: ${out.ok ? "OK" : "FALHOU"} — ${out.steps.map((s) => `${s.name} ${s.ok ? "ok" : "falhou"} (${s.summary})`).join("; ")}`,
  }),

  defineTool({
    name: "project_delete",
    title: "Apagar jogo",
    description:
      "Apaga a pasta src/projects/<id>/ inteira (irreversível; a engine continua funcionando — descoberta automática). Exige confirm igual ao id. Nunca apaga _template.",
    input: {
      id: idInput,
      confirm: z.string().describe("repita o id exatamente para confirmar a remoção"),
    },
    output: { id: z.string(), path: z.string(), removedFiles: z.number() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: async ({ id, confirm }, ctx) => {
      if (confirm !== id) throw new McpToolError("INVALID_INPUT", "confirm deve ser igual ao id", `Passe confirm: "${id}" para apagar o jogo.`);
      if (id.startsWith("_")) throw new McpToolError("WRITE_FORBIDDEN", "o molde _template nunca é apagado");
      const rel = projectRel(id);
      ctx.paths.assertWritable(rel);
      const abs = requireProject(ctx, id);
      const { files } = await walkFiles(abs, Number.MAX_SAFE_INTEGER);
      await ctx.paths.remove(rel);
      return { id, path: rel, removedFiles: files.length };
    },
    summarize: (out) => `jogo ${out.id} apagado (${out.removedFiles} arquivo(s))`,
  }),
];
