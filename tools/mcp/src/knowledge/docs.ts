/**
 * Leitura e parsing do manual de IA (docs/ai), receitas e GAPS — T2.
 *
 * Funções puras sobre o sistema de arquivos do repositório (sempre via
 * `ctx.paths.resolve`), compartilhadas por tools/knowledge.ts e resources.ts.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";

/* ============================================================================
 * Constantes
 * ========================================================================== */

export const CORE_DOCS = ["RULES", "CORE", "RECIPES", "GAPS", "INDEX"] as const;
export type CoreDoc = (typeof CORE_DOCS)[number];

export const AI_DIR = "docs/ai";
export const MODULES_DIR = "docs/ai/modules";
export const NOTES_DIR = "docs/ai/notes";
export const RECIPES_DIR = "src/projects/_template/recipes";
export const PROJECTS_DIR = "src/projects";
export const MODULE_MAP = "scripts/architecture/module-map.mjs";
export const FREEZE_LOCK = ".freeze-lock.json";

/** Raízes pesquisadas por `docs_search` (e legíveis por `docs_read { path }`). */
export const SEARCH_ROOTS: ReadonlyArray<{ readonly dir: string; readonly ext: readonly string[] }> = [
  { dir: "docs/ai", ext: [".md"] },
  { dir: "docs/layer1", ext: [".md"] },
  { dir: "docs/mcp", ext: [".md"] },
  { dir: RECIPES_DIR, ext: [".ts"] },
];

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ============================================================================
 * Utilidades de arquivo
 * ========================================================================== */

export function exists(ctx: ToolContext, rel: string): boolean {
  return existsSync(ctx.paths.resolve(rel));
}

export async function readText(ctx: ToolContext, rel: string): Promise<string> {
  const abs = ctx.paths.resolve(rel);
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new McpToolError("NOT_FOUND", `arquivo não encontrado: ${rel}`);
    }
    throw error;
  }
}

/** Nomes (sem extensão) dos arquivos `ext` diretamente em `dir`, ordenados. */
export function listNames(ctx: ToolContext, dir: string, ext: string): string[] {
  const abs = ctx.paths.resolve(dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => d.name.slice(0, -ext.length))
    .sort((a, b) => a.localeCompare(b, "en"));
}

/** Arquivos (relativos POSIX) com uma das extensões, recursivo, ordenados. */
export function walkFiles(ctx: ToolContext, dir: string, ext: readonly string[]): string[] {
  const abs = ctx.paths.resolve(dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const visit = (current: string, rel: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const e of entries) {
      const childRel = `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path.join(current, e.name), childRel);
      else if (e.isFile() && ext.some((x) => e.name.endsWith(x))) out.push(childRel);
    }
  };
  visit(abs, dir);
  return out;
}

/** Normaliza para busca: minúsculas, sem acentos. Mantém o comprimento por caractere-base. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Lança `NOT_FOUND` com a lista de valores válidos na dica. */
export function notFound(what: string, value: string, valid: readonly string[]): McpToolError {
  const list = valid.length > 0 ? valid.join(", ") : "(nenhum)";
  return new McpToolError("NOT_FOUND", `${what} desconhecido: ${JSON.stringify(value)}`, `Valores válidos: ${list}.`, { valid });
}

/* ============================================================================
 * Módulos, notas, receitas, projetos
 * ========================================================================== */

export function moduleKeys(ctx: ToolContext): string[] {
  return listNames(ctx, MODULES_DIR, ".md");
}

export function noteKeys(ctx: ToolContext): string[] {
  return listNames(ctx, NOTES_DIR, ".md");
}

export function recipeNames(ctx: ToolContext): string[] {
  return listNames(ctx, RECIPES_DIR, ".ts");
}

export function assertModuleKey(ctx: ToolContext, key: string): string {
  const keys = moduleKeys(ctx);
  if (!KEY_RE.test(key) || !keys.includes(key)) throw notFound("módulo", key, keys);
  return key;
}

/** Aceita `03-physics-body`, `03-physics-body.ts` ou só o prefixo `03`/`3`. */
export function resolveRecipeName(ctx: ToolContext, raw: string): string {
  const names = recipeNames(ctx);
  const name = raw.trim().replace(/\.ts$/, "");
  if (names.includes(name)) return name;
  if (/^\d{1,2}$/.test(name)) {
    const prefix = name.padStart(2, "0") + "-";
    const hit = names.find((n) => n.startsWith(prefix));
    if (hit) return hit;
  }
  const partial = names.filter((n) => n.replace(/^\d+-/, "") === name);
  if (partial.length === 1) return partial[0]!;
  throw notFound("receita", raw, names);
}

export interface RecipeInfo {
  name: string;
  path: string;
  description: string;
  bytes: number;
  imports: string[];
}

/** Comentários `//` iniciais do arquivo viram a descrição. */
export function recipeDescription(source: string): string {
  const lines: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const m = /^\s*\/\/\s?(.*)$/.exec(line);
    if (!m) break;
    lines.push(m[1]!.trim());
  }
  return lines.join(" ").trim();
}

export function recipeImports(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) out.add(m[1]!);
  return [...out];
}

export async function readRecipe(ctx: ToolContext, name: string): Promise<RecipeInfo & { content: string }> {
  const rel = `${RECIPES_DIR}/${name}.ts`;
  const content = await readText(ctx, rel);
  return {
    name,
    path: rel,
    description: recipeDescription(content),
    bytes: Buffer.byteLength(content),
    imports: recipeImports(content),
    content,
  };
}

export interface ProjectInfo {
  id: string;
  path: string;
  hasIndex: boolean;
  hasReport: boolean;
  hasDesktopJson: boolean;
}

/** Jogos em `src/projects/*` (pastas `_*` excluídas). */
export function listProjects(ctx: ToolContext): ProjectInfo[] {
  const abs = ctx.paths.resolve(PROJECTS_DIR);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((id) => {
      const dir = path.join(abs, id);
      return {
        id,
        path: `${PROJECTS_DIR}/${id}`,
        hasIndex: existsSync(path.join(dir, "index.ts")),
        hasReport: existsSync(path.join(dir, "ENGINE_REPORT.md")),
        hasDesktopJson: existsSync(path.join(dir, "desktop.json")),
      };
    });
}

/* ============================================================================
 * module-map.mjs (import dinâmico)
 * ========================================================================== */

export interface MapTokenRecord {
  readonly path: string;
  readonly capabilityId: string;
  readonly version?: string;
  readonly primary?: boolean;
}

export interface MapModule {
  readonly key: string;
  readonly displayName: string;
  readonly category: string;
  readonly layer: number | null;
  readonly capabilityId: string;
  readonly capabilityVersion?: string;
  readonly tokens: readonly MapTokenRecord[];
  readonly contracts: readonly string[];
  readonly plugin?: string;
}

/** `CANONICAL_MODULES` de scripts/architecture/module-map.mjs, ou `null` se ausente/inválido. */
export async function loadModuleMap(ctx: ToolContext): Promise<MapModule[] | null> {
  const abs = ctx.paths.resolve(MODULE_MAP);
  if (!existsSync(abs)) return null;
  try {
    const mod = (await import(pathToFileURL(abs).href)) as { CANONICAL_MODULES?: unknown };
    if (!Array.isArray(mod.CANONICAL_MODULES)) return null;
    return (mod.CANONICAL_MODULES as Array<Record<string, unknown>>).map((m) => ({
      key: String(m.key),
      displayName: String(m.displayName ?? m.key),
      category: String(m.category ?? "functional"),
      layer: typeof m.layer === "number" ? m.layer : null,
      capabilityId: String(m.capabilityId ?? ""),
      ...(typeof m.capabilityVersion === "string" ? { capabilityVersion: m.capabilityVersion } : {}),
      tokens: Array.isArray(m.tokens) ? (m.tokens as MapTokenRecord[]) : [],
      contracts: Array.isArray(m.contracts) ? (m.contracts as string[]) : [],
      ...(typeof m.plugin === "string" ? { plugin: m.plugin } : {}),
    }));
  } catch (error) {
    ctx.log.warn("falha ao importar module-map.mjs", error);
    return null;
  }
}

/* ============================================================================
 * Freeze-lock
 * ========================================================================== */

export interface FreezeLockStatus {
  status: "locked" | "drift" | "unlocked" | "invalid";
  present: boolean;
  version: string | null;
  lockedAt: string | null;
  files: number;
  changed: string[];
  missing: string[];
}

/** Confere os sha256 do `.freeze-lock.json` contra os arquivos atuais. */
export async function freezeLockStatus(ctx: ToolContext): Promise<FreezeLockStatus> {
  const empty = { version: null, lockedAt: null, files: 0, changed: [], missing: [] };
  if (!exists(ctx, FREEZE_LOCK)) return { status: "unlocked", present: false, ...empty };
  let lock: { version?: unknown; lockedAt?: unknown; files?: unknown };
  try {
    lock = JSON.parse(await readText(ctx, FREEZE_LOCK)) as typeof lock;
  } catch {
    return { status: "invalid", present: true, ...empty };
  }
  const files = lock.files && typeof lock.files === "object" ? (lock.files as Record<string, unknown>) : {};
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [rel, hash] of Object.entries(files)) {
    let abs: string;
    try {
      abs = ctx.paths.resolve(rel);
    } catch {
      missing.push(rel);
      continue;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      missing.push(rel);
      continue;
    }
    const actual = createHash("sha256").update(await readFile(abs)).digest("hex");
    if (actual !== hash) changed.push(rel);
  }
  return {
    status: changed.length + missing.length > 0 ? "drift" : "locked",
    present: true,
    version: typeof lock.version === "string" ? lock.version : null,
    lockedAt: typeof lock.lockedAt === "string" ? lock.lockedAt : null,
    files: Object.keys(files).length,
    changed,
    missing,
  };
}

/* ============================================================================
 * Markdown: tabelas
 * ========================================================================== */

/** Divide uma linha `| a | b |` em células (respeita `\|`). `null` se não é linha de tabela. */
export function splitRow(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const inner = t.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/* ============================================================================
 * INDEX.md
 * ========================================================================== */

export interface IndexModule {
  need: string;
  key: string;
  capability: string;
  dependsOn: string[];
  tokens: number | null;
  docPath: string;
}

export interface ParsedIndex {
  title: string;
  version: string | null;
  readingOrder: string[];
  modules: IndexModule[];
  sizes: Record<string, number>;
  shortcuts: string[];
  outside: string[];
}

function stripTicks(s: string): string {
  return s.replace(/`/g, "").trim();
}

function parseTokens(s: string): number | null {
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? n : null;
}

export function parseIndex(md: string): ParsedIndex {
  const lines = md.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith("# ")) ?? "").replace(/^#\s+/, "");
  const version = /vers[aã]o\s+([\w.\-]+)/i.exec(md)?.[1] ?? null;
  const out: ParsedIndex = { title, version, readingOrder: [], modules: [], sizes: {}, shortcuts: [], outside: [] };
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## ")) {
      section = fold(line.slice(3));
      continue;
    }
    if (section.startsWith("como usar")) {
      const m = /^\d+\.\s+(.*)$/.exec(line);
      if (m) out.readingOrder.push(m[1]!.trim());
    } else if (section.startsWith("preciso de")) {
      const cells = splitRow(line);
      if (cells && cells.length >= 5 && !isSeparatorRow(cells) && fold(cells[0]!) !== "preciso de") {
        const key = stripTicks(cells[1]!);
        const deps = stripTicks(cells[3]!);
        out.modules.push({
          need: cells[0]!,
          key,
          capability: stripTicks(cells[2]!),
          dependsOn: deps === "-" || deps === "" ? [] : deps.split(",").map((d) => d.trim()).filter(Boolean),
          tokens: parseTokens(cells[4]!),
          docPath: `${MODULES_DIR}/${key}.md`,
        });
      } else if (/^Tamanho:/i.test(line)) {
        for (const m of line.matchAll(/(RULES|CORE|RECIPES|GAPS|INDEX)\s*≈\s*([\d.]+)/g)) out.sizes[m[1]!] = Number(m[2]!.replace(/\./g, ""));
        const all = /m[oó]dulos\s*≈\s*([\d.]+)/i.exec(line);
        if (all) out.sizes.modules = Number(all[1]!.replace(/\./g, ""));
      }
    } else if (section.startsWith("atalhos")) {
      const m = /^-\s+(.*)$/.exec(line);
      if (m) out.shortcuts.push(m[1]!.trim());
    } else if (section.startsWith("fora deste manual")) {
      const m = /^-\s+(.*)$/.exec(line);
      if (m) out.outside.push(m[1]!.trim());
    }
  }
  return out;
}

/* ============================================================================
 * GAPS.md
 * ========================================================================== */

export interface GapRow {
  id: string;
  severity: string;
  type: string;
  problem: string;
  workaround: string;
  section: string;
  line: number;
}

/**
 * Linhas abertas: todas as tabelas `| # | G | Tipo | Problema | Contorno |`
 * fora da seção "Resolvido". `section` = título `## …` (chave do módulo ou "Transversais").
 */
export function parseGaps(md: string): GapRow[] {
  const lines = md.split(/\r?\n/);
  const rows: GapRow[] = [];
  let section = "";
  let inTable = false;
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      inTable = false;
      return;
    }
    const cells = splitRow(line);
    if (!cells) {
      inTable = false;
      return;
    }
    if (!inTable) {
      // cabeçalho
      inTable = cells.length >= 5 && cells[0] === "#" && fold(cells[2]!) === "tipo";
      return;
    }
    if (isSeparatorRow(cells)) return;
    if (/^resolvid/i.test(fold(section))) return;
    if (cells.length < 5) return;
    rows.push({
      id: cells[0]!,
      severity: cells[1]!,
      type: cells[2]!,
      problem: cells[3]!,
      workaround: cells.slice(4).join(" | "),
      section,
      line: i + 1,
    });
  });
  return rows;
}

/* ============================================================================
 * Documento de módulo (docs/ai/modules/<key>.md)
 * ========================================================================== */

export interface ModuleEventDoc {
  name: string;
  type: string;
  payload: string;
  description: string | null;
}

export interface ModuleCommandDoc {
  name: string;
  type: string;
  request: string;
  description: string | null;
}

export interface ParsedModuleDoc {
  title: string;
  capability: string | null;
  category: string | null;
  pluginId: string | null;
  usage: string[];
  tokenFiles: string[];
  contracts: string[];
  capabilities: Array<{ name: string; id: string; version: string; api: string }>;
  events: ModuleEventDoc[];
  commands: ModuleCommandDoc[];
  notes: string[];
}

const EVENT_RE = /^event\s+(\w+)\s*=\s*"([^"]+)"\s+payload\s+(.+?)(?:\s+\/\/\s*(.*))?$/;
const COMMAND_RE = /^command\s+(\w+)\s*=\s*"([^"]+)"\s+request\s+(.+?)(?:\s+\/\/\s*(.*))?$/;
const CAPABILITY_RE = /^capability\s+(\w+)\s*=\s*"([^"]+)"@([\w.\-]+)\s+api\s+(\w+)/;

export function parseModuleDoc(md: string): ParsedModuleDoc {
  const lines = md.split(/\r?\n/);
  const out: ParsedModuleDoc = {
    title: (lines[0] ?? "").replace(/^#\s+/, ""),
    capability: null,
    category: null,
    pluginId: null,
    usage: [],
    tokenFiles: [],
    contracts: [],
    capabilities: [],
    events: [],
    commands: [],
    notes: [],
  };
  const header = /^capability:\s*(\S+)\s*\|\s*category:\s*(\S+)\s*\|\s*engine plugin id:\s*(\S+)/.exec(lines[1] ?? "");
  if (header) {
    out.capability = header[1]!;
    out.category = header[2]!;
    out.pluginId = header[3]!;
  }
  let section = "head";
  for (const raw of lines.slice(2)) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      const h = line.slice(3).trim();
      if (h.startsWith("token ")) {
        section = "token";
        out.tokenFiles.push(h.slice(6).replace(/\s*\(.*\)$/, "").trim());
      } else if (h.startsWith("contract ")) {
        section = "contract";
        out.contracts.push(h.slice(9).trim());
      } else if (fold(h).startsWith("notas")) {
        section = "notes";
      } else section = "other";
      continue;
    }
    if (section === "head") {
      if (line.trim() && !line.startsWith("use (")) out.usage.push(line.trim());
      continue;
    }
    if (section === "notes") {
      const m = /^-\s+(.*)$/.exec(line);
      if (m) out.notes.push(m[1]!.trim());
      continue;
    }
    const t = line.trim();
    let m = EVENT_RE.exec(t);
    if (m) {
      out.events.push({ name: m[1]!, type: m[2]!, payload: m[3]!.trim(), description: m[4]?.trim() || null });
      continue;
    }
    m = COMMAND_RE.exec(t);
    if (m) {
      out.commands.push({ name: m[1]!, type: m[2]!, request: m[3]!.trim(), description: m[4]?.trim() || null });
      continue;
    }
    m = CAPABILITY_RE.exec(t);
    if (m) out.capabilities.push({ name: m[1]!, id: m[2]!, version: m[3]!, api: m[4]! });
  }
  return out;
}
