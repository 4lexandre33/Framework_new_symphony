/**
 * Domínio `build` — T9: build web/desktop e Steam (SPEC §3.6).
 *
 * - `desktop_config_get` / `desktop_config_set`: `src/projects/<id>/desktop.json`
 *   validado pela MESMA função do script de build
 *   (`buildProjectTauriConfig` de `scripts/tauri-project-config.mjs`, import dinâmico).
 * - `build_web` / `build_desktop`: jobs (`vite build`, `tauri build`).
 * - `build_artifacts`: instaladores em `src-tauri/target/release/bundle/**` + sha256.
 * - `steam_*`: `src/projects/<id>/steam.json`, conferência de conquistas/stats
 *   usadas no código, VDFs do SteamPipe em `src-tauri/gen/steam/<id>/` e
 *   checagem do `steam_appid.txt`/feature Cargo/redistribuível.
 *
 * Nada aqui fala com a rede nem guarda credenciais: o upload é um comando
 * `steamcmd` que o usuário roda.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { z } from "zod";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { ensureSuccess } from "../core/exec.ts";
import type { JobInfo } from "../core/jobs.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";
import { serializeVdf, type VdfObject } from "../core/vdf.ts";

/* ============================================================================
 * Utilitários
 * ========================================================================== */

const idInput = z.string().describe("id do projeto (pasta em src/projects/<id>, ex.: physics-sandbox)");

const posix = (p: string): string => p.split(path.sep).join("/");

/** `src/projects/<id>` existente (com `index.ts`), senão NOT_FOUND. Devolve o caminho relativo. */
function requireProject(ctx: ToolContext, id: string): string {
  const dir = ctx.paths.projectDir(id);
  if (!existsSync(path.join(dir, "index.ts"))) {
    throw new McpToolError("NOT_FOUND", `jogo "${id}" não encontrado (falta src/projects/${id}/index.ts)`, "Use project_list para ver os jogos.");
  }
  return `src/projects/${id}`;
}

function readJsonFile(abs: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(abs, "utf8")) as unknown;
  } catch (error) {
    throw new McpToolError("SCHEMA_INVALID", `${label}: JSON inválido (${error instanceof Error ? error.message : String(error)})`, "Corrija o arquivo ou regrave com a tool *_set.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ============================================================================
 * Config desktop (Tauri por jogo)
 * ========================================================================== */

type BuildProjectTauriConfig = (projectId: string, desktop?: Record<string, unknown>, baseWindow?: Record<string, unknown>) => Record<string, unknown>;

const TAURI_SCRIPT = "scripts/tauri-project-config.mjs";
const TAURI_BASE_CONF = "src-tauri/tauri.conf.json";
const BUNDLE_DIR = "src-tauri/target/release/bundle";

async function loadTauriConfigModule(ctx: ToolContext): Promise<{ buildProjectTauriConfig: BuildProjectTauriConfig; SAFE_WINDOW_DEFAULTS: Record<string, unknown> }> {
  const abs = ctx.paths.resolve(TAURI_SCRIPT);
  if (!existsSync(abs)) throw new McpToolError("NOT_FOUND", `${TAURI_SCRIPT} não existe neste repositório`);
  const mod = (await import(pathToFileURL(abs).href)) as {
    buildProjectTauriConfig?: unknown;
    SAFE_WINDOW_DEFAULTS?: unknown;
  };
  if (typeof mod.buildProjectTauriConfig !== "function") {
    throw new McpToolError("INTERNAL", `${TAURI_SCRIPT} não exporta buildProjectTauriConfig`);
  }
  return {
    buildProjectTauriConfig: mod.buildProjectTauriConfig as BuildProjectTauriConfig,
    SAFE_WINDOW_DEFAULTS: (mod.SAFE_WINDOW_DEFAULTS as Record<string, unknown> | undefined) ?? {},
  };
}

interface TauriBase {
  readonly productName: string | null;
  readonly version: string | null;
  readonly identifier: string | null;
  readonly baseWindow: Record<string, unknown>;
  readonly bundleTargets: unknown;
}

function readTauriBase(ctx: ToolContext): TauriBase {
  const abs = ctx.paths.resolve(TAURI_BASE_CONF);
  if (!existsSync(abs)) throw new McpToolError("NOT_FOUND", `${TAURI_BASE_CONF} não existe`);
  const base = readJsonFile(abs, TAURI_BASE_CONF) as {
    productName?: unknown;
    version?: unknown;
    identifier?: unknown;
    app?: { windows?: unknown[] };
    bundle?: { targets?: unknown };
  };
  const w0 = base.app?.windows?.[0];
  return {
    productName: typeof base.productName === "string" ? base.productName : null,
    version: typeof base.version === "string" ? base.version : null,
    identifier: typeof base.identifier === "string" ? base.identifier : null,
    baseWindow: w0 && typeof w0 === "object" && !Array.isArray(w0) ? (w0 as Record<string, unknown>) : {},
    bundleTargets: base.bundle?.targets ?? null,
  };
}

/** Mescla e valida; erros do script viram SCHEMA_INVALID. */
async function mergeDesktopConfig(ctx: ToolContext, id: string, desktop: unknown): Promise<Record<string, unknown>> {
  const { buildProjectTauriConfig } = await loadTauriConfigModule(ctx);
  const base = readTauriBase(ctx);
  try {
    return buildProjectTauriConfig(id, desktop as Record<string, unknown>, base.baseWindow);
  } catch (error) {
    throw new McpToolError(
      "SCHEMA_INVALID",
      errorMessage(error),
      'Chaves permitidas: productName, identifier (reverse-DNS, nunca com.projeto1.game), window { title, width, height, resizable, fullscreen, decorations, alwaysOnTop, transparent }.',
    );
  }
}

const genConfigPath = (id: string): string => `src-tauri/gen/tauri.project.${id}.conf.json`;

/* ============================================================================
 * Build web
 * ========================================================================== */

interface ChunkInfo {
  file: string;
  bytes: number;
  gzipBytes: number;
}

function collectChunks(ctx: ToolContext, outDirRel: string): ChunkInfo[] {
  const assets = ctx.paths.resolve(`${outDirRel}/assets`);
  if (!existsSync(assets)) return [];
  const out: ChunkInfo[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const data = readFileSync(abs);
        const compressible = /\.(js|mjs|css|html|json|svg|wasm|txt)$/iu.test(entry.name);
        out.push({
          file: posix(path.relative(ctx.root, abs)),
          bytes: data.length,
          gzipBytes: compressible ? gzipSync(data).length : data.length,
        });
      }
    }
  };
  walk(assets);
  return out.sort((a, b) => b.bytes - a.bytes);
}

function logTail(ctx: ToolContext, job: JobInfo, bytes = 4000): string {
  const from = Math.max(job.logStart, job.logBytes - bytes);
  return ctx.jobs.readLog(job.jobId, from, bytes).text;
}

/* ============================================================================
 * Artefatos
 * ========================================================================== */

const ARTIFACT_RULES: ReadonlyArray<{ readonly test: RegExp; readonly kind: string; readonly platform: Platform | "any" }> = [
  { test: /-setup\.exe$/iu, kind: "nsis", platform: "windows" },
  { test: /\.msi$/iu, kind: "msi", platform: "windows" },
  { test: /\.exe$/iu, kind: "exe", platform: "windows" },
  { test: /\.deb$/iu, kind: "deb", platform: "linux" },
  { test: /\.rpm$/iu, kind: "rpm", platform: "linux" },
  { test: /\.AppImage$/u, kind: "appimage", platform: "linux" },
  { test: /\.dmg$/iu, kind: "dmg", platform: "macos" },
  { test: /\.app\.tar\.gz$/iu, kind: "app-archive", platform: "macos" },
  { test: /\.(AppImage\.tar\.gz|nsis\.zip|msi\.zip)$/iu, kind: "updater-archive", platform: "any" },
  { test: /\.sig$/iu, kind: "signature", platform: "any" },
];

type Platform = "windows" | "linux" | "macos";
const PLATFORMS = ["windows", "linux", "macos"] as const;

interface Artifact {
  path: string;
  kind: string;
  platform: Platform | "any";
  bytes: number;
  sha256: string | null;
  modifiedAt: string;
  matchesProject: boolean;
}

function sha256File(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(abs)
      .on("data", (c) => hash.update(c))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function dirSize(abs: string): number {
  let total = 0;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, entry.name);
    if (entry.isDirectory()) total += dirSize(p);
    else if (entry.isFile()) total += statSync(p).size;
  }
  return total;
}

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/gu, "");

/* ============================================================================
 * Steam
 * ========================================================================== */

const STEAM_ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const steamApiName = z
  .string()
  .regex(STEAM_ID_RE, "use letras, dígitos e _ (API name do Steamworks), começando por letra ou _")
  .describe("API name exatamente como cadastrado no Steamworks (ex.: ACH_WIN_ONE_GAME)");
const steamUint = z.number().int().positive().max(0xffffffff);

const achievementSchema = z.strictObject({
  id: steamApiName,
  name: z.string().max(128).optional().describe("nome exibido (só documentação; o Steamworks é a fonte)"),
  description: z.string().max(512).optional(),
});
const statSchema = z.strictObject({
  id: steamApiName,
  type: z.enum(["int", "float"]).describe('tipo da stat no Steamworks; setStat(…, { type: "float" }) para float'),
});
const depotsSchema = z
  .strictObject({
    windows: steamUint.optional(),
    linux: steamUint.optional(),
    macos: steamUint.optional(),
  })
  .describe("depot id por sistema operacional (Steamworks > SteamPipe > Depots)");

export const steamConfigSchema = z
  .strictObject({
    appId: steamUint.describe("AppID do jogo no Steamworks (480 = Spacewar, só para testes)"),
    depots: depotsSchema,
    achievements: z.array(achievementSchema),
    stats: z.array(statSchema),
  })
  .superRefine((cfg, rc) => {
    const dup = (list: ReadonlyArray<{ id: string }>, key: string): void => {
      const seen = new Set<string>();
      list.forEach((item, i) => {
        if (seen.has(item.id)) rc.addIssue({ code: "custom", message: `id repetido: ${item.id}`, path: [key, i, "id"] });
        seen.add(item.id);
      });
    };
    dup(cfg.achievements, "achievements");
    dup(cfg.stats, "stats");
    const depotIds = Object.values(cfg.depots).filter((d): d is number => d !== undefined);
    if (new Set(depotIds).size !== depotIds.length) rc.addIssue({ code: "custom", message: "depot ids repetidos entre plataformas", path: ["depots"] });
    if (depotIds.includes(cfg.appId)) rc.addIssue({ code: "custom", message: "depot id igual ao appId", path: ["depots"] });
  });

export type SteamConfig = z.output<typeof steamConfigSchema>;

const steamJsonRel = (id: string): string => `src/projects/${id}/steam.json`;

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.length ? i.path.join(".") : "(raiz)"}: ${i.message}`)
    .join("; ");
}

function readSteamConfig(ctx: ToolContext, id: string): { exists: boolean; config: SteamConfig | null; raw: unknown; errors: string[] } {
  const abs = ctx.paths.resolve(steamJsonRel(id));
  if (!existsSync(abs)) return { exists: false, config: null, raw: null, errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    return { exists: true, config: null, raw: null, errors: [`JSON inválido: ${errorMessage(error)}`] };
  }
  const parsed = steamConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { exists: true, config: null, raw, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`) };
  }
  return { exists: true, config: parsed.data, raw, errors: [] };
}

function requireSteamConfig(ctx: ToolContext, id: string): SteamConfig {
  const st = readSteamConfig(ctx, id);
  if (!st.exists) throw new McpToolError("NOT_FOUND", `${steamJsonRel(id)} não existe`, "Crie com steam_config_set { id, appId, depots }.");
  if (!st.config) throw new McpToolError("SCHEMA_INVALID", `${steamJsonRel(id)} inválido: ${st.errors.slice(0, 5).join("; ")}`, "Regrave com steam_config_set.");
  return st.config;
}

/* ---- varredura de conquistas/stats no código ---------------------------- */

const ACHIEVEMENT_METHODS = new Set(["unlockAchievement", "clearAchievement", "isAchievementUnlocked", "getAchievement"]);
const STAT_METHODS = new Set(["setStat", "getStat", "incrementStat"]);

interface Usage {
  id: string;
  file: string;
  line: number;
  method: string;
  /** Só para stats: tipo inferido da chamada (`int` padrão). */
  type?: "int" | "float";
}

interface DynamicCall {
  file: string;
  line: number;
  method: string;
  expression: string;
}

function stringValue(node: ts.Node | undefined, consts: ReadonlyMap<string, string>): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) return consts.get(node.text) ?? null;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return stringValue(node.expression, consts);
  return null;
}

/** Tipo de stat pela opção `{ type: "float" }` (setStat 3º arg) ou `"float"` (getStat 2º arg). */
function statTypeOf(method: string, args: ts.NodeArray<ts.Expression>, consts: ReadonlyMap<string, string>): "int" | "float" {
  if (method === "getStat") return stringValue(args[1], consts) === "float" ? "float" : "int";
  const opt = method === "setStat" ? args[2] : undefined;
  if (opt && ts.isObjectLiteralExpression(opt)) {
    for (const prop of opt.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText() === "type" && stringValue(prop.initializer, consts) === "float") return "float";
    }
  }
  return "int";
}

function scanSource(fileRel: string, text: string): { achievements: Usage[]; stats: Usage[]; dynamic: DynamicCall[] } {
  const sf = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, fileRel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const consts = new Map<string, string>();
  const achievements: Usage[] = [];
  const stats: Usage[] = [];
  const dynamic: DynamicCall[] = [];
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // 1ª passada: `const X = "literal"` (nível qualquer) para resolver ids por identificador.
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const) {
      for (const decl of node.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const v = stringValue(decl.initializer, consts);
          if (v !== null) consts.set(decl.name.text, v);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
      if (name !== null && (ACHIEVEMENT_METHODS.has(name) || STAT_METHODS.has(name))) {
        const first = node.arguments[0];
        const value = stringValue(first, consts);
        if (value !== null) {
          if (ACHIEVEMENT_METHODS.has(name)) achievements.push({ id: value, file: fileRel, line: lineOf(node), method: name });
          else stats.push({ id: value, file: fileRel, line: lineOf(node), method: name, type: statTypeOf(name, node.arguments, consts) });
        } else if (first !== undefined) {
          dynamic.push({ file: fileRel, line: lineOf(node), method: name, expression: first.getText(sf).slice(0, 120) });
        }
      }
    }
    // Via comando: commands.send(UnlockAchievementCommand.type, { achievementId: "X" })
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === "achievementId") {
      const value = stringValue(node.initializer, consts);
      if (value !== null) achievements.push({ id: value, file: fileRel, line: lineOf(node), method: "achievementId" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { achievements, stats, dynamic };
}

function listSourceFiles(dirAbs: string, includeTests: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/u.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        if (!includeTests && /\.(test|spec)\.[cm]?tsx?$/u.test(entry.name)) continue;
        out.push(abs);
      }
    }
  };
  walk(dirAbs);
  return out.sort();
}

/* ---- SteamPipe ----------------------------------------------------------- */

/** Pasta de conteúdo padrão por SO (relativa à raiz). */
export const DEFAULT_CONTENT_ROOTS: Readonly<Record<Platform, string>> = {
  windows: `${BUNDLE_DIR}/nsis`,
  linux: `${BUNDLE_DIR}/appimage`,
  macos: `${BUNDLE_DIR}/macos`,
};

const steamGenDir = (id: string): string => `src-tauri/gen/steam/${id}`;

/** Garante `/` no fim (o SteamPipe trata ContentRoot/BuildOutput como pasta). */
function asDir(abs: string): string {
  return abs.endsWith(path.sep) ? abs : abs + path.sep;
}

export function buildAppVdf(opts: {
  appId: number;
  description: string;
  buildOutput: string;
  contentRoot: string;
  setLive?: string;
  preview?: boolean;
  depots: ReadonlyArray<{ depotId: number; file: string }>;
}): VdfObject {
  const depots: VdfObject = {};
  for (const d of opts.depots) depots[String(d.depotId)] = d.file;
  return {
    AppBuild: {
      AppID: String(opts.appId),
      Desc: opts.description,
      BuildOutput: opts.buildOutput,
      ContentRoot: opts.contentRoot,
      ...(opts.setLive !== undefined ? { SetLive: opts.setLive } : {}),
      ...(opts.preview ? { Preview: "1" } : {}),
      Depots: depots,
    },
  };
}

export function buildDepotVdf(opts: { depotId: number; contentRoot: string; exclusions?: readonly string[] }): VdfObject {
  const body: VdfObject = {
    DepotID: String(opts.depotId),
    ContentRoot: opts.contentRoot,
    FileMapping: { LocalPath: "*", DepotPath: ".", recursive: "1" },
  };
  // VDF não tem lista: chaves repetidas não cabem num objeto; uma exclusão por depot.
  const exclusion = (opts.exclusions ?? ["*.pdb"])[0];
  if (exclusion !== undefined) body.FileExclusion = exclusion;
  return { DepotBuild: body };
}

/* ---- steam_appid / Cargo / redistribuível ------------------------------- */

const REDISTRIBUTABLES: Readonly<Record<Platform, readonly string[]>> = {
  windows: ["steam_api64.dll"],
  linux: ["libsteam_api.so"],
  macos: ["libsteam_api.dylib"],
};

interface CargoSteam {
  cargoTomlExists: boolean;
  steamFeatureDeclared: boolean;
  steamInDefault: boolean;
  steamworksDependency: string | null;
  defaultFeatures: string[];
}

function parseCargoSteam(text: string | null): CargoSteam {
  if (text === null) return { cargoTomlExists: false, steamFeatureDeclared: false, steamInDefault: false, steamworksDependency: null, defaultFeatures: [] };
  const lines = text.split(/\r?\n/u);
  let section = "";
  let defaults: string[] = [];
  let steamDeclared = false;
  let steamworks: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/u, "").trim();
    const sec = /^\[([^\]]+)\]$/u.exec(line);
    if (sec) {
      section = sec[1]!.trim();
      continue;
    }
    if (section === "features") {
      const def = /^default\s*=\s*\[(.*)\]/u.exec(line);
      if (def) defaults = [...def[1]!.matchAll(/"([^"]+)"/gu)].map((m) => m[1]!);
      if (/^steam\s*=/u.test(line)) steamDeclared = true;
    }
    if (section === "dependencies" || /dependencies$/u.test(section)) {
      const dep = /^steamworks\s*=\s*(.+)$/u.exec(line);
      if (dep) steamworks = dep[1]!.trim();
    }
  }
  return {
    cargoTomlExists: true,
    steamFeatureDeclared: steamDeclared,
    steamInDefault: defaults.includes("steam"),
    steamworksDependency: steamworks,
    defaultFeatures: defaults,
  };
}

function findRedistributables(ctx: ToolContext): Array<{ name: string; platform: Platform; path: string; bytes: number }> {
  const names = new Map<string, Platform>();
  for (const p of PLATFORMS) for (const n of REDISTRIBUTABLES[p]) names.set(n, p);
  const dirs: string[] = ["src-tauri", "src-tauri/lib", "src-tauri/libs", "src-tauri/resources", "src-tauri/redist"];
  for (const profile of ["release", "debug"]) {
    dirs.push(`src-tauri/target/${profile}`);
    const build = ctx.paths.resolve(`src-tauri/target/${profile}/build`);
    if (existsSync(build)) {
      for (const e of readdirSync(build)) if (e.startsWith("steamworks-sys-")) dirs.push(`src-tauri/target/${profile}/build/${e}/out`);
    }
  }
  const found: Array<{ name: string; platform: Platform; path: string; bytes: number }> = [];
  const seen = new Set<string>();
  for (const rel of dirs) {
    const abs = ctx.paths.resolve(rel);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const platform = names.get(entry.name);
      if (!platform || !entry.isFile()) continue;
      const fileRel = `${rel}/${entry.name}`;
      if (seen.has(fileRel)) continue;
      seen.add(fileRel);
      found.push({ name: entry.name, platform, path: fileRel, bytes: statSync(path.join(abs, entry.name)).size });
    }
  }
  return found;
}

/* ============================================================================
 * Schemas de saída
 * ========================================================================== */

const chunkSchema = z.object({ file: z.string(), bytes: z.number(), gzipBytes: z.number() });
const jobState = z.enum(["running", "succeeded", "failed", "cancelled"]);
const usageSchema = z.object({ id: z.string(), file: z.string(), line: z.number(), method: z.string(), type: z.enum(["int", "float"]).optional() });
const idLists = z.object({ achievements: z.array(z.string()), stats: z.array(z.string()) });

/* ============================================================================
 * Tools
 * ========================================================================== */

export const tools: ToolDef[] = [
  defineTool({
    name: "desktop_config_get",
    title: "Config desktop (Tauri) do jogo",
    description:
      "Lê src/projects/<id>/desktop.json (identidade e janela do executável do jogo) e devolve também a config Tauri MESCLADA que o build usa (buildProjectTauriConfig de scripts/tauri-project-config.mjs sobre src-tauri/tauri.conf.json). Se o desktop.json for inválido, `valid=false` e `error` explicam o motivo.",
    input: { id: idInput },
    output: {
      id: z.string(),
      path: z.string(),
      exists: z.boolean(),
      desktop: z.record(z.string(), z.unknown()).nullable(),
      valid: z.boolean(),
      error: z.string().optional(),
      merged: z.record(z.string(), z.unknown()).nullable(),
      generatedPath: z.string(),
      host: z.object({ productName: z.string().nullable(), identifier: z.string().nullable(), version: z.string().nullable(), bundleTargets: z.unknown() }),
      safeWindowDefaults: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id }, ctx) => {
      const dirRel = requireProject(ctx, id);
      const rel = `${dirRel}/desktop.json`;
      const abs = ctx.paths.resolve(rel);
      const exists = existsSync(abs);
      const { buildProjectTauriConfig, SAFE_WINDOW_DEFAULTS } = await loadTauriConfigModule(ctx);
      const base = readTauriBase(ctx);
      let desktop: Record<string, unknown> | null = null;
      let merged: Record<string, unknown> | null = null;
      let error: string | undefined;
      try {
        const raw = exists ? (JSON.parse(readFileSync(abs, "utf8")) as unknown) : {};
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) desktop = exists ? (raw as Record<string, unknown>) : null;
        merged = buildProjectTauriConfig(id, raw as Record<string, unknown>, base.baseWindow);
      } catch (e) {
        error = errorMessage(e);
      }
      return {
        id,
        path: rel,
        exists,
        desktop,
        valid: error === undefined,
        ...(error !== undefined ? { error } : {}),
        merged,
        generatedPath: genConfigPath(id),
        host: { productName: base.productName, identifier: base.identifier, version: base.version, bundleTargets: base.bundleTargets },
        safeWindowDefaults: { ...SAFE_WINDOW_DEFAULTS },
      };
    },
    summarize: (out) =>
      out.valid
        ? `${out.id}: ${out.exists ? "desktop.json" : "sem desktop.json (defaults)"} → ${String(out.merged?.productName)} (${String(out.merged?.identifier)})`
        : `${out.id}: desktop.json inválido — ${out.error}`,
  }),

  defineTool({
    name: "desktop_config_set",
    title: "Gravar config desktop do jogo",
    description:
      "Valida `config` com buildProjectTauriConfig (mesma regra do build: só productName, identifier reverse-DNS — nunca o do host com.projeto1.game — e window { title, width, height, resizable, fullscreen, decorations, alwaysOnTop, transparent }) e grava src/projects/<id>/desktop.json de forma atômica. Substitui o arquivo inteiro. `dryRun: true` só valida.",
    input: {
      id: idInput,
      config: z
        .record(z.string(), z.unknown())
        .describe('conteúdo completo do desktop.json, ex.: { "productName": "Meu Jogo", "identifier": "com.empresa.meujogo", "window": { "width": 1600, "height": 900 } }'),
      dryRun: z.boolean().optional().describe("true = só valida, não grava"),
    },
    output: { path: z.string(), written: z.boolean(), merged: z.record(z.string(), z.unknown()) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, config, dryRun }, ctx) => {
      const rel = `${requireProject(ctx, id)}/desktop.json`;
      const merged = await mergeDesktopConfig(ctx, id, config);
      if (!dryRun) await ctx.paths.writeFileAtomic(rel, `${JSON.stringify(config, null, 2)}\n`);
      return { path: rel, written: !dryRun, merged };
    },
    summarize: (out) => `${out.written ? "gravado" : "válido (dryRun)"}: ${out.path} → ${String(out.merged.productName)}`,
  }),

  defineTool({
    name: "build_web",
    title: "Build web do jogo",
    description:
      "Gera o build web de produção de um jogo: job `npx vite build --outDir dist/<id>` com VITE_PROJECT=<id> (o jogo fica fixo no bundle). Devolve `jobId` na hora (acompanhe com job_status/job_log). Com `wait: true` espera terminar (até `timeoutMs`) e devolve os chunks de dist/<id>/assets com bytes e gzip.",
    input: {
      id: idInput,
      wait: z.boolean().optional().describe("true = espera o job e devolve tamanhos dos chunks"),
      timeoutMs: z.number().int().min(1000).max(30 * 60_000).optional().describe("espera máxima com wait (padrão 300000)"),
    },
    output: {
      jobId: z.string(),
      state: jobState,
      outDir: z.string(),
      command: z.string(),
      chunks: z.array(chunkSchema).optional(),
      totalBytes: z.number().optional(),
      totalGzipBytes: z.number().optional(),
      largestChunk: chunkSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async ({ id, wait, timeoutMs }, ctx) => {
      requireProject(ctx, id);
      const outDir = `dist/${id}`;
      ctx.paths.assertWritable(outDir);
      const args = ["vite", "build", "--outDir", outDir, "--emptyOutDir"];
      const job = ctx.jobs.start(`build_web ${id}`, "npx", args, { env: { VITE_PROJECT: id } });
      const base = { jobId: job.jobId, outDir, command: `VITE_PROJECT=${id} npx ${args.join(" ")}` };
      if (!wait) return { ...base, state: job.state };
      const done = await ctx.jobs.wait(job.jobId, timeoutMs ?? 300_000);
      if (done.state === "running") return { ...base, state: done.state };
      if (done.state !== "succeeded") {
        throw new McpToolError("COMMAND_FAILED", `vite build de ${id} terminou ${done.state} (código ${done.exitCode ?? "nulo"})`, `Veja job_log { jobId: "${done.jobId}" }.`, {
          jobId: done.jobId,
          tail: logTail(ctx, done),
        });
      }
      const chunks = collectChunks(ctx, outDir);
      return {
        ...base,
        state: done.state,
        chunks,
        totalBytes: chunks.reduce((s, c) => s + c.bytes, 0),
        totalGzipBytes: chunks.reduce((s, c) => s + c.gzipBytes, 0),
        ...(chunks[0] ? { largestChunk: chunks[0] } : {}),
      };
    },
    summarize: (out) =>
      out.chunks
        ? `build web ${out.outDir}: ${out.chunks.length} arquivo(s), ${(out.totalBytes! / 1024).toFixed(1)} KiB (gzip ${(out.totalGzipBytes! / 1024).toFixed(1)} KiB)`
        : `job ${out.jobId} [${out.state}] → ${out.outDir}`,
  }),

  defineTool({
    name: "build_desktop",
    title: "Build desktop (Tauri) do jogo",
    description:
      "Inicia o build desktop (instaladores) de um jogo como job. Sem `bundles`: `node scripts/tauri-project-config.mjs <id> --build` (todos os alvos de bundle do host). Com `bundles`: gera a config do jogo (src-tauri/gen/tauri.project.<id>.conf.json) e roda `npx tauri build --config <arquivo> --bundles <lista>` com VITE_PROJECT=<id> (o script não repassa argumentos extras). Leva minutos (Rust); acompanhe com job_status/job_log e depois use build_artifacts.",
    input: {
      id: idInput,
      bundles: z
        .array(z.enum(["nsis", "msi", "deb", "appimage"]))
        .min(1)
        .optional()
        .describe("formatos de instalador (nsis/msi só no Windows; deb/appimage só no Linux)"),
    },
    output: {
      jobId: z.string(),
      state: jobState,
      command: z.string(),
      args: z.array(z.string()),
      configPath: z.string(),
      bundleDir: z.string(),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async ({ id, bundles }, ctx, call) => {
      requireProject(ctx, id);
      // Valida o desktop.json ANTES de gastar minutos de cargo.
      const desktopAbs = ctx.paths.resolve(`src/projects/${id}/desktop.json`);
      await mergeDesktopConfig(ctx, id, existsSync(desktopAbs) ? readJsonFile(desktopAbs, "desktop.json") : {});
      const warnings: string[] = [];
      const host = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
      for (const b of bundles ?? []) {
        const target = b === "nsis" || b === "msi" ? "windows" : "linux";
        if (target !== host) warnings.push(`bundle ${b} é de ${target}; este host é ${host} (o Tauri não faz cross-build de instalador).`);
      }
      if (!existsSync(ctx.paths.resolve("node_modules/@tauri-apps/cli"))) warnings.push("node_modules/@tauri-apps/cli não encontrado: rode npm install.");
      warnings.push("O Tauri CLI normaliza src-tauri/Cargo.toml durante o build; confira `git diff src-tauri/Cargo.toml` depois.");
      const configPath = genConfigPath(id);
      let cmd: string;
      let args: string[];
      if (bundles === undefined) {
        cmd = "node";
        args = [TAURI_SCRIPT, id, "--build"];
      } else {
        ctx.paths.assertWritable(configPath);
        const gen = await ctx.exec.runAllowed("node", [TAURI_SCRIPT, id], { timeoutMs: 60_000, signal: call.signal });
        ensureSuccess(gen, `node ${TAURI_SCRIPT} ${id}`);
        cmd = "npx";
        args = ["tauri", "build", "--config", configPath, "--bundles", [...new Set(bundles)].join(",")];
      }
      const job = ctx.jobs.start(`build_desktop ${id}`, cmd, args, { env: { VITE_PROJECT: id }, timeoutMs: 60 * 60_000 });
      return { jobId: job.jobId, state: job.state, command: cmd, args, configPath, bundleDir: BUNDLE_DIR, warnings };
    },
    summarize: (out) => `job ${out.jobId} [${out.state}]: ${out.command} ${out.args.join(" ")}`,
  }),

  defineTool({
    name: "build_artifacts",
    title: "Instaladores gerados",
    description:
      "Procura instaladores/bundles em src-tauri/target/release/bundle/** (nsis, msi, deb, rpm, appimage, dmg, macos .app) com tamanho, sha256 e data. `matchesProject` indica se o nome do arquivo começa com o productName do jogo (a pasta de bundle é compartilhada entre jogos).",
    input: { id: idInput },
    output: {
      bundleDir: z.string(),
      exists: z.boolean(),
      productName: z.string(),
      artifacts: z.array(
        z.object({
          path: z.string(),
          kind: z.string(),
          platform: z.enum(["windows", "linux", "macos", "any"]),
          bytes: z.number(),
          sha256: z.string().nullable(),
          modifiedAt: z.string(),
          matchesProject: z.boolean(),
        }),
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id }, ctx) => {
      requireProject(ctx, id);
      const desktopAbs = ctx.paths.resolve(`src/projects/${id}/desktop.json`);
      let productName = id;
      try {
        const merged = await mergeDesktopConfig(ctx, id, existsSync(desktopAbs) ? readJsonFile(desktopAbs, "desktop.json") : {});
        if (typeof merged.productName === "string") productName = merged.productName;
      } catch {
        /* desktop.json inválido: usa o id */
      }
      const bundleAbs = ctx.paths.resolve(BUNDLE_DIR);
      if (!existsSync(bundleAbs)) return { bundleDir: BUNDLE_DIR, exists: false, productName, artifacts: [] };
      const artifacts: Artifact[] = [];
      const want = normName(productName);
      const pushArtifact = async (abs: string, kind: string, platform: Platform | "any", isDir: boolean): Promise<void> => {
        const st = statSync(abs);
        artifacts.push({
          path: posix(path.relative(ctx.root, abs)),
          kind,
          platform,
          bytes: isDir ? dirSize(abs) : st.size,
          sha256: isDir ? null : await sha256File(abs),
          modifiedAt: st.mtime.toISOString(),
          matchesProject: want.length > 0 && normName(path.basename(abs)).startsWith(want),
        });
      };
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 4) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.endsWith(".app")) await pushArtifact(abs, "app", "macos", true);
            else await walk(abs, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const rule = ARTIFACT_RULES.find((r) => r.test.test(entry.name));
          if (rule) await pushArtifact(abs, rule.kind, rule.platform, false);
        }
      };
      await walk(bundleAbs, 0);
      artifacts.sort((a, b) => a.path.localeCompare(b.path));
      return { bundleDir: BUNDLE_DIR, exists: true, productName, artifacts };
    },
    summarize: (out) =>
      out.exists
        ? `${out.artifacts.length} artefato(s) em ${out.bundleDir} (${out.artifacts.filter((a) => a.matchesProject).length} de ${out.productName})`
        : `${out.bundleDir} não existe — rode build_desktop primeiro`,
  }),

  defineTool({
    name: "steam_config_get",
    title: "Config Steam do jogo",
    description:
      "Lê src/projects/<id>/steam.json: { appId, depots: { windows?, linux?, macos? }, achievements: [{ id, name?, description? }], stats: [{ id, type: int|float }] }. Devolve `valid`/`errors` se o arquivo não bater com o schema.",
    input: { id: idInput },
    output: {
      path: z.string(),
      exists: z.boolean(),
      valid: z.boolean(),
      config: z.record(z.string(), z.unknown()).nullable(),
      errors: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id }, ctx) => {
      requireProject(ctx, id);
      const st = readSteamConfig(ctx, id);
      return { path: steamJsonRel(id), exists: st.exists, valid: st.exists && st.config !== null, config: st.config ?? (st.raw as Record<string, unknown> | null), errors: st.errors };
    },
    summarize: (out) =>
      !out.exists ? `${out.path} não existe` : out.valid ? `${out.path}: appId ${String(out.config?.appId)}` : `${out.path} inválido: ${out.errors[0]}`,
  }),

  defineTool({
    name: "steam_config_set",
    title: "Gravar config Steam do jogo",
    description:
      "Cria/atualiza src/projects/<id>/steam.json (escrita atômica). Os campos enviados substituem os existentes (`depots`, `achievements` e `stats` inteiros); os omitidos são mantidos. `replace: true` ignora o arquivo atual. Valida ids (API names do Steamworks, sem repetição), depots únicos. Nunca guarda credenciais.",
    input: {
      id: idInput,
      appId: steamUint.optional().describe("AppID do Steamworks (obrigatório na criação)"),
      depots: depotsSchema.optional(),
      achievements: z.array(achievementSchema).optional().describe("lista COMPLETA de conquistas"),
      stats: z.array(statSchema).optional().describe("lista COMPLETA de stats"),
      replace: z.boolean().optional().describe("true = não mescla com o steam.json atual"),
    },
    output: { path: z.string(), created: z.boolean(), config: z.record(z.string(), z.unknown()), warnings: z.array(z.string()) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, appId, depots, achievements, stats, replace }, ctx) => {
      requireProject(ctx, id);
      const rel = steamJsonRel(id);
      const current = replace ? { exists: existsSync(ctx.paths.resolve(rel)), raw: null } : readSteamConfig(ctx, id);
      const prev = current.raw !== null && typeof current.raw === "object" && !Array.isArray(current.raw) ? (current.raw as Record<string, unknown>) : {};
      const next = {
        depots: {},
        achievements: [],
        stats: [],
        ...prev,
        ...(appId !== undefined ? { appId } : {}),
        ...(depots !== undefined ? { depots } : {}),
        ...(achievements !== undefined ? { achievements } : {}),
        ...(stats !== undefined ? { stats } : {}),
      };
      const parsed = steamConfigSchema.safeParse(next);
      if (!parsed.success) {
        throw new McpToolError("SCHEMA_INVALID", `steam.json inválido: ${formatZodIssues(parsed.error)}`, "appId é obrigatório; ids de conquista/stat únicos ([A-Za-z_][A-Za-z0-9_]*).", {
          issues: parsed.error.issues.slice(0, 50),
        });
      }
      const config = parsed.data;
      const warnings: string[] = [];
      if (config.appId === 480) warnings.push("appId 480 é o Spacewar (teste da Valve); troque pelo AppID real antes de publicar.");
      if (Object.keys(config.depots).length === 0) warnings.push("nenhum depot definido: steam_pipeline_prepare precisa de pelo menos um.");
      await ctx.paths.writeFileAtomic(rel, `${JSON.stringify(config, null, 2)}\n`);
      return { path: rel, created: !current.exists, config, warnings };
    },
    summarize: (out) => `${out.created ? "criado" : "atualizado"}: ${out.path} (appId ${String(out.config.appId)})${out.warnings.length ? ` — ${out.warnings.length} aviso(s)` : ""}`,
  }),

  defineTool({
    name: "steam_achievements_check",
    title: "Conferir conquistas/stats Steam",
    description:
      "Varre o código TypeScript do jogo (src/projects/<id>/**, AST) atrás de ids usados em unlockAchievement/clearAchievement/getAchievement, setStat/getStat e `achievementId: \"…\"` (comando UnlockAchievementCommand) — literais ou constantes `const X = \"…\"` do mesmo arquivo — e compara com steam.json: usedButUndeclared, declaredButUnused, tipos de stat divergentes e chamadas com id dinâmico (não verificáveis).",
    input: {
      id: idInput,
      includeTests: z.boolean().optional().describe("incluir *.test.ts / *.spec.ts (padrão false)"),
    },
    output: {
      steamJson: z.object({ path: z.string(), exists: z.boolean(), valid: z.boolean() }),
      filesScanned: z.number(),
      used: z.object({ achievements: z.array(usageSchema), stats: z.array(usageSchema) }),
      declared: idLists,
      usedButUndeclared: idLists,
      declaredButUnused: idLists,
      typeMismatches: z.array(z.object({ id: z.string(), declared: z.enum(["int", "float"]), used: z.enum(["int", "float"]), file: z.string(), line: z.number() })),
      dynamicCalls: z.array(z.object({ file: z.string(), line: z.number(), method: z.string(), expression: z.string() })),
      ok: z.boolean(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id, includeTests }, ctx) => {
      const dirRel = requireProject(ctx, id);
      const st = readSteamConfig(ctx, id);
      if (st.exists && !st.config) {
        throw new McpToolError("SCHEMA_INVALID", `${steamJsonRel(id)} inválido: ${st.errors.slice(0, 5).join("; ")}`, "Corrija com steam_config_set.");
      }
      const files = listSourceFiles(ctx.paths.resolve(dirRel), includeTests === true);
      const achievements: Usage[] = [];
      const stats: Usage[] = [];
      const dynamicCalls: DynamicCall[] = [];
      for (const abs of files) {
        const rel = posix(path.relative(ctx.root, abs));
        const res = scanSource(rel, await readFile(abs, "utf8"));
        achievements.push(...res.achievements);
        stats.push(...res.stats);
        dynamicCalls.push(...res.dynamic);
      }
      const declAch = (st.config?.achievements ?? []).map((a) => a.id);
      const declStats = new Map((st.config?.stats ?? []).map((s) => [s.id, s.type] as const));
      const usedAch = new Set(achievements.map((u) => u.id));
      const usedStats = new Set(stats.map((u) => u.id));
      const typeMismatches = stats
        .filter((u) => u.method === "setStat" || u.method === "getStat")
        .flatMap((u) => {
          const declared = declStats.get(u.id);
          return declared && u.type && declared !== u.type ? [{ id: u.id, declared, used: u.type, file: u.file, line: u.line }] : [];
        });
      const usedButUndeclared = {
        achievements: [...usedAch].filter((a) => !declAch.includes(a)).sort(),
        stats: [...usedStats].filter((s) => !declStats.has(s)).sort(),
      };
      const declaredButUnused = {
        achievements: declAch.filter((a) => !usedAch.has(a)).sort(),
        stats: [...declStats.keys()].filter((s) => !usedStats.has(s)).sort(),
      };
      return {
        steamJson: { path: steamJsonRel(id), exists: st.exists, valid: st.config !== null },
        filesScanned: files.length,
        used: { achievements, stats },
        declared: { achievements: [...declAch].sort(), stats: [...declStats.keys()].sort() },
        usedButUndeclared,
        declaredButUnused,
        typeMismatches,
        dynamicCalls,
        ok: usedButUndeclared.achievements.length === 0 && usedButUndeclared.stats.length === 0 && typeMismatches.length === 0,
      };
    },
    summarize: (out) =>
      `${out.filesScanned} arquivo(s): ${out.used.achievements.length} uso(s) de conquista, ${out.used.stats.length} de stat; ` +
      `não declaradas ${out.usedButUndeclared.achievements.length + out.usedButUndeclared.stats.length}, sem uso ${out.declaredButUnused.achievements.length + out.declaredButUnused.stats.length}` +
      (out.dynamicCalls.length ? `, ${out.dynamicCalls.length} dinâmica(s)` : ""),
  }),

  defineTool({
    name: "steam_pipeline_prepare",
    title: "Preparar upload SteamPipe",
    description:
      "Gera os scripts do SteamPipe em src-tauri/gen/steam/<id>/: app_build_<appId>.vdf (AppBuild: AppID, Desc, BuildOutput, ContentRoot, SetLive se `branch` ≠ default, Depots) e um depot_build_<depotId>.vdf por SO de steam.json (DepotBuild: DepotID, ContentRoot = pasta do bundle daquele SO, FileMapping * → . recursivo, FileExclusion *.pdb). Devolve o comando `steamcmd +login <usuario> +run_app_build \"…\" +quit` para o USUÁRIO rodar — o MCP não faz upload nem aceita/guarda senha.",
    input: {
      id: idInput,
      branch: z
        .string()
        .regex(/^[A-Za-z0-9_.-]{1,64}$/u, "use letras, dígitos, _ . -")
        .optional()
        .describe('branch para SetLive (ex.: "beta"); "default" é ignorado (o Steam não permite pôr a default no ar por script)'),
      description: z.string().max(256).optional().describe("Desc do build (aparece no Steamworks)"),
      platforms: z.array(z.enum(PLATFORMS)).min(1).optional().describe("restringe os SOs (padrão: todos com depot em steam.json)"),
      contentRoots: z
        .strictObject({ windows: z.string().optional(), linux: z.string().optional(), macos: z.string().optional() })
        .optional()
        .describe(`pasta de conteúdo por SO (relativa à raiz do repo). Padrão: ${Object.entries(DEFAULT_CONTENT_ROOTS).map(([k, v]) => `${k}=${v}`).join(", ")}`),
      preview: z.boolean().optional().describe('true = "Preview" "1" (simula, não envia conteúdo)'),
    },
    output: {
      appId: z.number(),
      dir: z.string(),
      appBuild: z.string(),
      appBuildAbs: z.string(),
      depots: z.array(z.object({ platform: z.enum(PLATFORMS), depotId: z.number(), file: z.string(), contentRoot: z.string(), contentExists: z.boolean() })),
      setLive: z.string().nullable(),
      command: z.string(),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, branch, description, platforms, contentRoots, preview }, ctx) => {
      requireProject(ctx, id);
      const cfg = requireSteamConfig(ctx, id);
      const wanted = (platforms ?? PLATFORMS).filter((p) => cfg.depots[p] !== undefined);
      if (wanted.length === 0) {
        throw new McpToolError("SCHEMA_INVALID", `steam.json de ${id} não tem depot para ${(platforms ?? PLATFORMS).join("/")}`, "Defina depots com steam_config_set { id, depots: { windows: <depotId> } }.");
      }
      const dirRel = steamGenDir(id);
      ctx.paths.assertWritable(`${dirRel}/x`);
      const warnings: string[] = [];
      if (cfg.appId === 480) warnings.push("appId 480 (Spacewar) não aceita upload: use o AppID real.");
      const depots: Array<{ platform: Platform; depotId: number; file: string; contentRoot: string; contentExists: boolean }> = [];
      const files: Array<{ rel: string; data: string }> = [];
      for (const platform of wanted) {
        const depotId = cfg.depots[platform]!;
        const rootRel = contentRoots?.[platform] ?? DEFAULT_CONTENT_ROOTS[platform];
        const rootAbs = ctx.paths.resolve(rootRel);
        const contentExists = existsSync(rootAbs) && statSync(rootAbs).isDirectory();
        if (!contentExists) warnings.push(`${platform}: ContentRoot ${posix(path.relative(ctx.root, rootAbs))} não existe ainda (rode build_desktop).`);
        const file = `depot_build_${depotId}.vdf`;
        files.push({ rel: `${dirRel}/${file}`, data: serializeVdf(buildDepotVdf({ depotId, contentRoot: asDir(rootAbs) })) });
        depots.push({ platform, depotId, file: `${dirRel}/${file}`, contentRoot: asDir(rootAbs), contentExists });
      }
      if (depots.some((d) => d.platform === "windows" && /bundle[\\/](nsis|msi)/u.test(d.contentRoot))) {
        warnings.push("windows: a pasta do bundle contém o INSTALADOR; o Steam normalmente recebe os arquivos do jogo já instalados (exe + recursos). Ajuste contentRoots.windows se preciso.");
      }
      const setLive = branch !== undefined && branch.toLowerCase() !== "default" ? branch : undefined;
      if (branch !== undefined && setLive === undefined) warnings.push('branch "default" ignorado: ponha no ar manualmente no Steamworks.');
      const genAbs = ctx.paths.resolve(dirRel);
      const appFile = `app_build_${cfg.appId}.vdf`;
      const appVdf = buildAppVdf({
        appId: cfg.appId,
        description: description ?? `${id} build`,
        buildOutput: asDir(path.join(genAbs, "output")),
        contentRoot: asDir(genAbs),
        ...(setLive !== undefined ? { setLive } : {}),
        ...(preview ? { preview: true } : {}),
        depots: depots.map((d) => ({ depotId: d.depotId, file: path.basename(d.file) })),
      });
      files.push({ rel: `${dirRel}/${appFile}`, data: serializeVdf(appVdf) });
      for (const f of files) await ctx.paths.writeFileAtomic(f.rel, f.data);
      const appBuildAbs = path.join(genAbs, appFile);
      return {
        appId: cfg.appId,
        dir: dirRel,
        appBuild: `${dirRel}/${appFile}`,
        appBuildAbs,
        depots,
        setLive: setLive ?? null,
        command: `steamcmd +login <usuario> +run_app_build "${appBuildAbs}" +quit`,
        warnings,
      };
    },
    summarize: (out) => `${out.depots.length} depot(s) → ${out.appBuild}\n${out.command}`,
  }),

  defineTool({
    name: "steam_appid_check",
    title: "Checar steam_appid / Steamworks",
    description:
      "Confere o ambiente Steam do host: steam_appid.txt (raiz e src-tauri/, só desenvolvimento), feature Cargo `steam` (declarada e em default) e o redistribuível do Steamworks (steam_api64.dll / libsteam_api.so / libsteam_api.dylib) em src-tauri/ ou src-tauri/target/*/ (inclui build/steamworks-sys-*/out). Com `id`, compara o AppID com o steam.json do jogo.",
    input: { id: idInput.optional() },
    output: {
      appIdFiles: z.array(z.object({ path: z.string(), exists: z.boolean(), content: z.string().nullable(), appId: z.number().nullable(), valid: z.boolean() })),
      cargo: z.object({
        cargoTomlExists: z.boolean(),
        steamFeatureDeclared: z.boolean(),
        steamInDefault: z.boolean(),
        steamworksDependency: z.string().nullable(),
        defaultFeatures: z.array(z.string()),
      }),
      redistributables: z.array(z.object({ name: z.string(), platform: z.enum(PLATFORMS), path: z.string(), bytes: z.number() })),
      missingRedistributables: z.array(z.object({ platform: z.enum(PLATFORMS), name: z.string() })),
      projectAppId: z.number().nullable(),
      warnings: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id }, ctx) => {
      const warnings: string[] = [];
      const appIdFiles = ["steam_appid.txt", "src-tauri/steam_appid.txt"].map((rel) => {
        const abs = ctx.paths.resolve(rel);
        if (!existsSync(abs)) return { path: rel, exists: false, content: null, appId: null, valid: false };
        const content = readFileSync(abs, "utf8");
        const trimmed = content.trim();
        const valid = /^\d{1,10}$/u.test(trimmed) && Number(trimmed) > 0;
        if (!valid) warnings.push(`${rel}: conteúdo deve ser só o AppID numérico (achei ${JSON.stringify(content.slice(0, 40))}).`);
        return { path: rel, exists: true, content, appId: valid ? Number(trimmed) : null, valid };
      });
      if (!appIdFiles.some((f) => f.exists)) warnings.push("nenhum steam_appid.txt: em desenvolvimento o SteamAPI_Init precisa dele (fora do Steam).");
      const ids = new Set(appIdFiles.filter((f) => f.appId !== null).map((f) => f.appId));
      if (ids.size > 1) warnings.push(`steam_appid.txt divergentes: ${[...ids].join(" × ")}.`);
      if (ids.has(480)) warnings.push("steam_appid.txt = 480 (Spacewar): ok para desenvolvimento, troque pelo AppID real para testar conquistas próprias.");
      const cargoAbs = ctx.paths.resolve("src-tauri/Cargo.toml");
      const cargo = parseCargoSteam(existsSync(cargoAbs) ? readFileSync(cargoAbs, "utf8") : null);
      if (cargo.cargoTomlExists && !cargo.steamFeatureDeclared) warnings.push("Cargo.toml sem feature `steam`.");
      if (cargo.steamFeatureDeclared && !cargo.steamInDefault) warnings.push("feature `steam` fora de default: o build normal sai sem Steam (use --features steam).");
      const redistributables = findRedistributables(ctx);
      const missingRedistributables = PLATFORMS.flatMap((platform) =>
        REDISTRIBUTABLES[platform].filter((name) => !redistributables.some((r) => r.name === name)).map((name) => ({ platform, name })),
      );
      const hostPlatform: Platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
      if (cargo.steamInDefault && missingRedistributables.some((m) => m.platform === hostPlatform)) {
        warnings.push(`redistribuível de ${hostPlatform} não encontrado: ele é gerado pelo build (target/*/build/steamworks-sys-*/out) e precisa ir junto do executável.`);
      }
      let projectAppId: number | null = null;
      if (id !== undefined) {
        requireProject(ctx, id);
        const st = readSteamConfig(ctx, id);
        projectAppId = st.config?.appId ?? null;
        if (projectAppId !== null && ids.size > 0 && !ids.has(projectAppId)) {
          warnings.push(`steam.json de ${id} usa appId ${projectAppId}, mas steam_appid.txt tem ${[...ids].join("/")}.`);
        }
      }
      return { appIdFiles, cargo, redistributables, missingRedistributables, projectAppId, warnings };
    },
    summarize: (out) =>
      `steam_appid: ${out.appIdFiles.filter((f) => f.exists).map((f) => `${f.path}=${f.appId ?? "?"}`).join(", ") || "ausente"}; ` +
      `feature steam ${out.cargo.steamInDefault ? "em default" : out.cargo.steamFeatureDeclared ? "opcional" : "ausente"}; ` +
      `${out.redistributables.length} redistribuível(is); ${out.warnings.length} aviso(s)`,
  }),
];
