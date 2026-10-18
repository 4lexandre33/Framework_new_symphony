/**
 * Domínio `scenes` — T8: cenas e prefabs JSON (SPEC §3.5).
 *
 * Arquivos: `src/projects/<id>/scenes/<sceneId>.scene.json` (SceneDocument v1)
 * e `src/projects/<id>/prefabs/<prefabId>.prefab.json` (PrefabDocument v1). O
 * nome do arquivo é SEMPRE o id do documento. A validação é a MESMA da engine
 * (`validateSceneDocument` / `validatePrefabDocument` de
 * `src/contracts/world/scene-document.ts`). Toda escrita valida o documento
 * resultante inteiro antes e grava de forma atômica (JSON com 2 espaços e
 * `\n` final); documento inválido → `SCHEMA_INVALID` com `details.errors`.
 * Escritas NÃO são bloqueadas por asset inexistente (vira aviso), só por
 * erros de esquema/prefab — assim dá para referenciar um asset antes de
 * importá-lo; `scene_validate` reporta os assets como erro.
 *
 * Mapeamento URL do asset → arquivo (`resolveAssetUrl`), igual ao Vite:
 * - `/<p>` → `public/<p>` (pasta pública do Vite: servida na raiz em dev e
 *   copiada para o build; é o que a engine carrega em runtime — ex.:
 *   physics-sandbox usa `/projects/physics-sandbox/audio/jump.wav`).
 *   Também aceita, como alternativa, `/assets/<r>` → `src/projects/<id>/assets/<r>`
 *   e `/src/projects/<id>/<r>` (URL de fonte do Vite em dev). Nesses casos sai o
 *   aviso `ASSET_PROJECT_ONLY`: arquivos fora de `public/` só existem em runtime
 *   se o jogo os importar (`new URL("./assets/x.glb", import.meta.url).href`,
 *   `import url from "./assets/x.glb?url"` ou `import.meta.glob`) e mapear a URL.
 * - relativa (`assets/x.png`, `./assets/x.png`) → `src/projects/<id>/<caminho>`
 *   (mesmo aviso).
 * - `http(s)://`, `blob:`, `//host` → aviso `ASSET_UNVERIFIABLE` ("não
 *   verificável"), nunca erro; `data:` → embutido (ok).
 */

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PREFAB_DOCUMENT_FORMAT,
  SCENE_DOCUMENT_FORMAT,
  SCENE_DOCUMENT_VERSION,
  validatePrefabDocument,
  validateSceneDocument,
  type PrefabDocument,
  type SceneDocumentAsset,
  type SceneDocumentError,
} from "../../../../src/contracts/world/scene-document.ts";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";

/* ============================================================================
 * Constantes e helpers compartilhados (assets.ts também usa)
 * ========================================================================== */

export const SCENES_DIR = "scenes";
export const PREFABS_DIR = "prefabs";
export const SCENE_SUFFIX = ".scene.json";
export const PREFAB_SUFFIX = ".prefab.json";
/** Maior arquivo de cena/prefab lido (8 MiB). */
export const MAX_DOC_BYTES = 8 * 1024 * 1024;
/** Ids usados como nome de arquivo: subconjunto seguro do ID do formato (sem ':' e sem '..'). */
export const FILE_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const MAX_FILE_ID = 128;

export interface DocIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

export function projectRel(id: string): string {
  return `src/projects/${id}`;
}

/** Pasta do jogo (id validado); `NOT_FOUND` se não existir. */
export function requireProjectDir(ctx: ToolContext, id: string): string {
  const abs = ctx.paths.projectDir(id);
  let ok = false;
  try {
    ok = lstatSync(abs).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new McpToolError("NOT_FOUND", `jogo ${id} não existe em src/projects/${id}`, "Use project_list para ver os jogos ou project_create para criar.");
  return abs;
}

/** Normaliza o nome de cena/prefab recebido ("fase-1" ou "fase-1.scene.json"). */
export function normalizeDocId(raw: string, suffix: string, what: string): string {
  let id = raw.trim();
  if (id.endsWith(suffix)) id = id.slice(0, -suffix.length);
  if (id.length === 0 || id.length > MAX_FILE_ID || !FILE_ID_RE.test(id)) {
    throw new McpToolError(
      "INVALID_INPUT",
      `${what} inválido para nome de arquivo: ${JSON.stringify(raw)}`,
      "Use 1–128 caracteres de [A-Za-z0-9_-], com '.' só entre partes (sem ':', '/', '..').",
    );
  }
  return id;
}

function isFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function readJsonFile(abs: string, rel: string): { ok: true; value: unknown } | { ok: false; issue: DocIssue } {
  let size: number;
  try {
    size = statSync(abs).size;
  } catch {
    return { ok: false, issue: { path: "", code: "NOT_FOUND", message: `${rel} não existe` } };
  }
  if (size > MAX_DOC_BYTES) return { ok: false, issue: { path: "", code: "FILE_TOO_LARGE", message: `${rel} tem ${String(size)} bytes (máximo ${String(MAX_DOC_BYTES)})` } };
  try {
    return { ok: true, value: JSON.parse(readFileSync(abs, "utf8").replace(/^﻿/u, "")) as unknown };
  } catch (error) {
    return { ok: false, issue: { path: "", code: "INVALID_JSON", message: `JSON inválido em ${rel}: ${(error as Error).message}` } };
  }
}

/** Lista ids de `<dir>/*<suffix>` (só arquivos regulares, ordenados). */
function listDocIds(ctx: ToolContext, id: string, dir: string, suffix: string): string[] {
  const abs = ctx.paths.resolve(`${projectRel(id)}/${dir}`);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix) && e.name.length > suffix.length)
    .map((e) => e.name.slice(0, -suffix.length))
    .sort((a, b) => a.localeCompare(b));
}

export function sceneRel(id: string, sceneId: string): string {
  return `${projectRel(id)}/${SCENES_DIR}/${sceneId}${SCENE_SUFFIX}`;
}

export function prefabRel(id: string, prefabId: string): string {
  return `${projectRel(id)}/${PREFABS_DIR}/${prefabId}${PREFAB_SUFFIX}`;
}

function serialize(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/* ---------------------------------------------------------------- URLs de asset */

export type AssetUrlStatus = "found" | "missing" | "unverifiable" | "embedded";

export interface AssetUrlResolution {
  readonly url: string;
  readonly status: AssetUrlStatus;
  /** Arquivo encontrado (relativo à raiz) ou `null`. */
  readonly file: string | null;
  /** `public` (servido em runtime) ou `project` (precisa de import no jogo). */
  readonly location: "public" | "project" | null;
  /** Caminhos tentados (relativos à raiz). */
  readonly candidates: readonly string[];
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Resolve a URL de um asset de cena para um arquivo do repositório (regras no topo do arquivo). */
export function resolveAssetUrl(ctx: ToolContext, projectId: string, url: string): AssetUrlResolution {
  const base = { url, file: null, location: null } as const;
  if (url.startsWith("data:")) return { ...base, status: "embedded", candidates: [] };
  if (SCHEME_RE.test(url) || url.startsWith("//")) return { ...base, status: "unverifiable", candidates: [] };
  let clean = url.split(/[?#]/u, 1)[0] ?? "";
  try {
    clean = decodeURIComponent(clean);
  } catch {
    return { ...base, status: "missing", candidates: [] };
  }
  clean = clean.replace(/\\/g, "/");
  const candidates: Array<{ rel: string; location: "public" | "project" }> = [];
  const proj = projectRel(projectId);
  if (clean.startsWith("/")) {
    const p = path.posix.normalize(clean.slice(1));
    if (!p.startsWith("..")) {
      candidates.push({ rel: `public/${p}`, location: "public" });
      if (p.startsWith("assets/")) candidates.push({ rel: `${proj}/${p}`, location: "project" });
      if (p.startsWith(`${proj}/`)) candidates.push({ rel: p, location: "project" });
    }
  } else {
    const p = path.posix.normalize(clean);
    if (p !== "." && !p.startsWith("..")) candidates.push({ rel: `${proj}/${p}`, location: "project" });
  }
  const tried: string[] = [];
  for (const c of candidates) {
    tried.push(c.rel);
    let abs: string;
    try {
      abs = ctx.paths.resolve(c.rel);
    } catch {
      continue; // fora do repositório / link para fora
    }
    if (isFile(abs)) return { url, status: "found", file: c.rel, location: c.location, candidates: tried };
  }
  return { ...base, status: "missing", candidates: tried };
}

interface AssetCheck {
  readonly id: string;
  readonly url: string;
  readonly type: string;
  readonly status: AssetUrlStatus;
  readonly file: string | null;
  readonly location: "public" | "project" | null;
}

/** `assetExists` para o validador + registro de cada verificação. */
function makeAssetChecker(ctx: ToolContext, projectId: string): { exists: (a: SceneDocumentAsset) => boolean; checks: AssetCheck[] } {
  const checks: AssetCheck[] = [];
  const exists = (a: SceneDocumentAsset): boolean => {
    const r = resolveAssetUrl(ctx, projectId, a.url);
    if (!checks.some((c) => c.id === a.id && c.url === a.url)) {
      checks.push({ id: a.id, url: a.url, type: a.type, status: r.status, file: r.file, location: r.location });
    }
    return r.status !== "missing";
  };
  return { exists, checks };
}

function assetWarnings(checks: readonly AssetCheck[], includeMissing: boolean): DocIssue[] {
  const out: DocIssue[] = [];
  for (const c of checks) {
    if (c.status === "unverifiable") out.push({ path: `assets.${c.id}`, code: "ASSET_UNVERIFIABLE", message: `asset '${c.id}' (${c.url}) não verificável (URL remota)` });
    else if (c.status === "found" && c.location === "project") {
      out.push({
        path: `assets.${c.id}`,
        code: "ASSET_PROJECT_ONLY",
        message: `asset '${c.id}' (${c.url}) está em ${c.file ?? "?"}, fora de public/: em runtime a URL só funciona se o jogo importar o arquivo (new URL(..., import.meta.url) / ?url / import.meta.glob) e mapear a URL; ou mova para public/`,
      });
    } else if (includeMissing && c.status === "missing") {
      out.push({ path: `assets.${c.id}`, code: "ASSET_NOT_FOUND", message: `asset '${c.id}' não encontrado em '${c.url}' (importe com asset_import ou copie para public/)` });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- Prefabs do projeto */

export interface LoadedPrefab {
  readonly prefabId: string;
  readonly file: string;
  /** Documento cru (com chaves `$...`), ou `null` se o JSON não abriu. */
  readonly raw: unknown;
  readonly valid: boolean;
  readonly errors: readonly DocIssue[];
}

/** Lê e valida (esquema; sem checar assets) todos os prefabs do jogo. */
export function loadProjectPrefabs(ctx: ToolContext, id: string): Map<string, LoadedPrefab> {
  const out = new Map<string, LoadedPrefab>();
  for (const prefabId of listDocIds(ctx, id, PREFABS_DIR, PREFAB_SUFFIX)) {
    const rel = prefabRel(id, prefabId);
    const read = readJsonFile(ctx.paths.resolve(rel), rel);
    if (!read.ok) {
      out.set(prefabId, { prefabId, file: rel, raw: null, valid: false, errors: [read.issue] });
      continue;
    }
    const errors: DocIssue[] = [];
    const result = validatePrefabDocument(read.value);
    if (!result.ok) errors.push(...result.errors);
    const declared = isPlainObject(read.value) ? read.value["prefabId"] : undefined;
    if (typeof declared === "string" && declared !== prefabId) {
      errors.push({ path: "prefabId", code: "FILE_NAME_MISMATCH", message: `prefabId '${declared}' ≠ nome do arquivo '${prefabId}${PREFAB_SUFFIX}'` });
    }
    out.set(prefabId, { prefabId, file: rel, raw: read.value, valid: errors.length === 0, errors });
  }
  return out;
}

/* ---------------------------------------------------------------- Validação completa de cena */

export interface SceneValidationResult {
  readonly valid: boolean;
  readonly errors: DocIssue[];
  readonly warnings: DocIssue[];
  readonly assets: AssetCheck[];
  readonly prefabsUsed: string[];
}

function prefabsUsedBy(doc: unknown): string[] {
  if (!isPlainObject(doc) || !Array.isArray(doc["entities"])) return [];
  const used = new Set<string>();
  for (const e of doc["entities"] as unknown[]) {
    if (isPlainObject(e) && typeof e["prefab"] === "string") used.add(e["prefab"]);
  }
  return [...used].sort();
}

/**
 * Valida uma cena com o validador da engine, os prefabs do projeto (só os
 * usados, para que um prefab quebrado não invalide cenas que não o usam) e,
 * se `checkAssets`, a existência dos assets (cena + prefabs usados).
 */
export function validateSceneForProject(
  ctx: ToolContext,
  id: string,
  doc: unknown,
  options: { checkAssets: boolean; fileId?: string; prefabs?: Map<string, LoadedPrefab> },
): SceneValidationResult {
  const prefabs = options.prefabs ?? loadProjectPrefabs(ctx, id);
  const used = prefabsUsedBy(doc);
  const subset: Record<string, PrefabDocument> = {};
  for (const prefabId of used) {
    const p = prefabs.get(prefabId);
    if (p && p.valid) subset[prefabId] = p.raw as PrefabDocument;
  }
  const checker = makeAssetChecker(ctx, id);
  const result = validateSceneDocument(doc, {
    prefabs: subset,
    ...(options.checkAssets ? { assetExists: checker.exists } : {}),
  });
  const errors: DocIssue[] = result.ok ? [] : result.errors.map((e: SceneDocumentError) => ({ path: e.path, code: e.code, message: e.message }));
  for (const e of errors) {
    if (e.code !== "UNKNOWN_PREFAB") continue;
    const m = /prefab '([^']+)'/u.exec(e.message);
    const broken = m ? prefabs.get(m[1]!) : undefined;
    if (broken && !broken.valid) {
      (e as { message: string }).message = `prefab '${broken.prefabId}' existe em ${broken.file} mas é inválido: ${broken.errors.map((x) => `${x.path || "(raiz)"} ${x.code}`).join("; ")}`;
    }
  }
  if (options.fileId !== undefined && isPlainObject(doc) && typeof doc["sceneId"] === "string" && doc["sceneId"] !== options.fileId) {
    errors.push({ path: "sceneId", code: "FILE_NAME_MISMATCH", message: `sceneId '${doc["sceneId"]}' ≠ nome do arquivo '${options.fileId}${SCENE_SUFFIX}'` });
  }
  let assets = checker.checks;
  let warnings: DocIssue[] = [];
  if (!options.checkAssets && isPlainObject(doc)) {
    // Escrita: confere os assets só para avisar (não bloqueia).
    const warnChecker = makeAssetChecker(ctx, id);
    const declared: unknown[] = [...(Array.isArray(doc["assets"]) ? (doc["assets"] as unknown[]) : [])];
    for (const prefabId of used) {
      const raw = subset[prefabId];
      if (raw && Array.isArray(raw.assets)) declared.push(...raw.assets);
    }
    for (const a of declared) {
      if (isPlainObject(a) && typeof a["id"] === "string" && typeof a["url"] === "string" && typeof a["type"] === "string") {
        warnChecker.exists({ id: a["id"], url: a["url"], type: a["type"] as SceneDocumentAsset["type"] });
      }
    }
    assets = warnChecker.checks;
    warnings = assetWarnings(assets, true);
  } else {
    warnings = assetWarnings(assets, false);
  }
  return { valid: errors.length === 0, errors, warnings, assets, prefabsUsed: used };
}

/* ---------------------------------------------------------------- Leitura/escrita */

function readSceneFile(ctx: ToolContext, id: string, sceneId: string): { rel: string; doc: Json } {
  requireProjectDir(ctx, id);
  const rel = sceneRel(id, sceneId);
  const abs = ctx.paths.resolve(rel);
  if (!isFile(abs)) throw new McpToolError("NOT_FOUND", `cena '${sceneId}' não existe (${rel})`, "Use scene_list para ver as cenas ou scene_create para criar.");
  const read = readJsonFile(abs, rel);
  if (!read.ok) throw new McpToolError("SCHEMA_INVALID", read.issue.message, "Corrija o JSON do arquivo (ou recrie a cena).", { errors: [read.issue] });
  if (!isPlainObject(read.value)) throw new McpToolError("SCHEMA_INVALID", `${rel} não contém um objeto JSON`, undefined, { errors: [{ path: "", code: "NOT_OBJECT", message: "deveria ser objeto" }] });
  return { rel, doc: read.value };
}

function readPrefabFile(ctx: ToolContext, id: string, prefabId: string): { rel: string; doc: Json } {
  requireProjectDir(ctx, id);
  const rel = prefabRel(id, prefabId);
  const abs = ctx.paths.resolve(rel);
  if (!isFile(abs)) throw new McpToolError("NOT_FOUND", `prefab '${prefabId}' não existe (${rel})`, "Use prefab_list para ver os prefabs ou prefab_create para criar.");
  const read = readJsonFile(abs, rel);
  if (!read.ok) throw new McpToolError("SCHEMA_INVALID", read.issue.message, "Corrija o JSON do arquivo.", { errors: [read.issue] });
  if (!isPlainObject(read.value)) throw new McpToolError("SCHEMA_INVALID", `${rel} não contém um objeto JSON`, undefined, { errors: [{ path: "", code: "NOT_OBJECT", message: "deveria ser objeto" }] });
  return { rel, doc: read.value };
}

function schemaInvalid(what: string, errors: readonly DocIssue[]): McpToolError {
  const head = errors.slice(0, 5).map((e) => `${e.path || "(raiz)"} ${e.code}: ${e.message}`).join("; ");
  return new McpToolError(
    "SCHEMA_INVALID",
    `${what} inválido (${String(errors.length)} erro(s)): ${head}`,
    "Nada foi gravado. Corrija os campos listados em details.errors (formato: src/contracts/world/scene-document.ts).",
    { errors },
  );
}

/** Valida a cena resultante (esquema + prefabs) e grava atômico; devolve avisos de assets. */
async function writeScene(ctx: ToolContext, id: string, sceneId: string, doc: Json): Promise<{ file: string; warnings: DocIssue[] }> {
  const rel = sceneRel(id, sceneId);
  ctx.paths.assertWritable(rel);
  const check = validateSceneForProject(ctx, id, doc, { checkAssets: false, fileId: sceneId });
  if (!check.valid) throw schemaInvalid(`a cena '${sceneId}'`, check.errors);
  await ctx.paths.writeFileAtomic(rel, serialize(doc));
  return { file: rel, warnings: check.warnings };
}

function prefabAssetWarnings(ctx: ToolContext, id: string, doc: Json): DocIssue[] {
  const checker = makeAssetChecker(ctx, id);
  for (const a of Array.isArray(doc["assets"]) ? (doc["assets"] as unknown[]) : []) {
    if (isPlainObject(a) && typeof a["id"] === "string" && typeof a["url"] === "string" && typeof a["type"] === "string") {
      checker.exists({ id: a["id"], url: a["url"], type: a["type"] as SceneDocumentAsset["type"] });
    }
  }
  return assetWarnings(checker.checks, true);
}

/** Cenas que usam o prefab e se continuam válidas. */
function scenesUsingPrefab(ctx: ToolContext, id: string, prefabId: string): Array<{ sceneId: string; valid: boolean }> {
  const prefabs = loadProjectPrefabs(ctx, id);
  const out: Array<{ sceneId: string; valid: boolean }> = [];
  for (const sceneId of listDocIds(ctx, id, SCENES_DIR, SCENE_SUFFIX)) {
    const rel = sceneRel(id, sceneId);
    const read = readJsonFile(ctx.paths.resolve(rel), rel);
    if (!read.ok || !prefabsUsedBy(read.value).includes(prefabId)) continue;
    out.push({ sceneId, valid: validateSceneForProject(ctx, id, read.value, { checkAssets: false, fileId: sceneId, prefabs }).valid });
  }
  return out;
}

async function writePrefab(ctx: ToolContext, id: string, prefabId: string, doc: Json): Promise<{ file: string; warnings: DocIssue[] }> {
  const rel = prefabRel(id, prefabId);
  ctx.paths.assertWritable(rel);
  const result = validatePrefabDocument(doc);
  const errors: DocIssue[] = result.ok ? [] : [...result.errors];
  if (doc["prefabId"] !== prefabId) errors.push({ path: "prefabId", code: "FILE_NAME_MISMATCH", message: `prefabId deve ser '${prefabId}'` });
  if (errors.length > 0) throw schemaInvalid(`o prefab '${prefabId}'`, errors);
  await ctx.paths.writeFileAtomic(rel, serialize(doc));
  return { file: rel, warnings: prefabAssetWarnings(ctx, id, doc) };
}

/* ---------------------------------------------------------------- Merge patch */

/** JSON Merge Patch (RFC 7386): objeto mescla recursivamente, `null` remove, resto substitui. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const base: Json = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = mergePatch(base[key], value);
  }
  return base;
}

const DEEP_ENTITY_KEYS = new Set(["position", "rotation", "scale", "data"]);
const DEEP_PREFAB_KEYS = new Set(["data"]);

function applyPatch(target: Json, patch: Json, deepKeys: ReadonlySet<string>): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (deepKeys.has(key)) out[key] = mergePatch(out[key], value);
    else out[key] = value; // tags, assets, type, prefab, $... substituem
  }
  return out;
}

/* ============================================================================
 * Schemas de entrada/saída
 * ========================================================================== */

const projectIdInput = z.string().describe("id do projeto (pasta em src/projects/, ex.: physics-sandbox)");
const sceneInput = z.string().min(1).describe("id da cena = nome do arquivo sem '.scene.json' (ex.: fase-1; aceita também 'fase-1.scene.json')");
const prefabInput = z.string().min(1).describe("id do prefab = nome do arquivo sem '.prefab.json' (ex.: jogador)");
const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

const issueSchema = z.object({ path: z.string(), code: z.string(), message: z.string() });
const assetCheckSchema = z.object({
  id: z.string(),
  url: z.string(),
  type: z.string(),
  status: z.enum(["found", "missing", "unverifiable", "embedded"]),
  file: z.string().nullable(),
  location: z.enum(["public", "project"]).nullable(),
});
const docSchema = z.record(z.string(), z.unknown());
const writeOutput = { file: z.string(), document: docSchema, warnings: z.array(issueSchema) };

function countWarnings(w: readonly unknown[]): string {
  return w.length > 0 ? ` (${String(w.length)} aviso(s))` : "";
}

/* ============================================================================
 * Tools
 * ========================================================================== */

export const tools: ToolDef[] = [
  defineTool({
    name: "scene_list",
    title: "Listar cenas",
    description:
      "Lista as cenas (src/projects/<id>/scenes/*.scene.json) com resumo: sceneName, nº de entidades, ids dos assets, prefabs usados e se a cena é válida (mesma validação de scene_validate, incluindo prefabs e existência de assets). JSON quebrado aparece com valid=false.",
    input: { id: projectIdInput },
    output: {
      scenes: z.array(
        z.object({
          sceneId: z.string(),
          file: z.string(),
          sceneName: z.string().nullable(),
          entities: z.number(),
          assets: z.array(z.string()),
          prefabs: z.array(z.string()),
          valid: z.boolean(),
          errorCount: z.number(),
          warningCount: z.number(),
        }),
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id }, ctx) => {
      requireProjectDir(ctx, id);
      const prefabs = loadProjectPrefabs(ctx, id);
      const scenes = listDocIds(ctx, id, SCENES_DIR, SCENE_SUFFIX).map((sceneId) => {
        const file = sceneRel(id, sceneId);
        const read = readJsonFile(ctx.paths.resolve(file), file);
        if (!read.ok) return { sceneId, file, sceneName: null, entities: 0, assets: [], prefabs: [], valid: false, errorCount: 1, warningCount: 0 };
        const doc = read.value;
        const check = validateSceneForProject(ctx, id, doc, { checkAssets: true, fileId: sceneId, prefabs });
        const obj = isPlainObject(doc) ? doc : {};
        return {
          sceneId,
          file,
          sceneName: typeof obj["sceneName"] === "string" ? obj["sceneName"] : null,
          entities: Array.isArray(obj["entities"]) ? obj["entities"].length : 0,
          assets: Array.isArray(obj["assets"]) ? (obj["assets"] as unknown[]).flatMap((a) => (isPlainObject(a) && typeof a["id"] === "string" ? [a["id"]] : [])) : [],
          prefabs: check.prefabsUsed,
          valid: check.valid,
          errorCount: check.errors.length,
          warningCount: check.warnings.length,
        };
      });
      return { scenes };
    },
    summarize: (out) => `${out.scenes.length} cena(s)${out.scenes.length ? `: ${out.scenes.map((s) => `${s.sceneId}${s.valid ? "" : " (inválida)"}`).join(", ")}` : ""}`,
  }),

  defineTool({
    name: "prefab_list",
    title: "Listar prefabs",
    description:
      "Lista os prefabs (src/projects/<id>/prefabs/*.prefab.json) com resumo: type, tags, ids dos assets, cenas que o usam e se é válido (esquema + nome do arquivo = prefabId).",
    input: { id: projectIdInput },
    output: {
      prefabs: z.array(
        z.object({
          prefabId: z.string(),
          file: z.string(),
          type: z.string().nullable(),
          tags: z.array(z.string()),
          assets: z.array(z.string()),
          usedBy: z.array(z.string()),
          valid: z.boolean(),
          errors: z.array(issueSchema),
        }),
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id }, ctx) => {
      requireProjectDir(ctx, id);
      const usage = new Map<string, string[]>();
      for (const sceneId of listDocIds(ctx, id, SCENES_DIR, SCENE_SUFFIX)) {
        const rel = sceneRel(id, sceneId);
        const read = readJsonFile(ctx.paths.resolve(rel), rel);
        if (!read.ok) continue;
        for (const p of prefabsUsedBy(read.value)) usage.set(p, [...(usage.get(p) ?? []), sceneId]);
      }
      const prefabs = [...loadProjectPrefabs(ctx, id).values()].map((p) => {
        const raw = isPlainObject(p.raw) ? p.raw : {};
        return {
          prefabId: p.prefabId,
          file: p.file,
          type: typeof raw["type"] === "string" ? raw["type"] : null,
          tags: Array.isArray(raw["tags"]) ? (raw["tags"] as unknown[]).filter((t): t is string => typeof t === "string") : [],
          assets: Array.isArray(raw["assets"]) ? (raw["assets"] as unknown[]).flatMap((a) => (isPlainObject(a) && typeof a["id"] === "string" ? [a["id"]] : [])) : [],
          usedBy: usage.get(p.prefabId) ?? [],
          valid: p.valid,
          errors: [...p.errors],
        };
      });
      return { prefabs };
    },
    summarize: (out) => `${out.prefabs.length} prefab(s)${out.prefabs.length ? `: ${out.prefabs.map((p) => `${p.prefabId}${p.valid ? "" : " (inválido)"}`).join(", ")}` : ""}`,
  }),

  defineTool({
    name: "scene_read",
    title: "Ler cena",
    description: "Lê uma cena (SceneDocument v1) de src/projects/<id>/scenes/<scene>.scene.json e devolve o documento cru (inclui chaves '$...').",
    input: { id: projectIdInput, scene: sceneInput },
    output: { file: z.string(), document: docSchema },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id, scene }, ctx) => {
      const sceneId = normalizeDocId(scene, SCENE_SUFFIX, "id de cena");
      const { rel, doc } = readSceneFile(ctx, id, sceneId);
      return { file: rel, document: doc };
    },
    summarize: (out) => `${out.file}: ${Array.isArray(out.document["entities"]) ? out.document["entities"].length : 0} entidade(s)`,
  }),

  defineTool({
    name: "prefab_read",
    title: "Ler prefab",
    description: "Lê um prefab (PrefabDocument v1) de src/projects/<id>/prefabs/<prefab>.prefab.json e devolve o documento cru.",
    input: { id: projectIdInput, prefab: prefabInput },
    output: { file: z.string(), document: docSchema },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id, prefab }, ctx) => {
      const prefabId = normalizeDocId(prefab, PREFAB_SUFFIX, "id de prefab");
      const { rel, doc } = readPrefabFile(ctx, id, prefabId);
      return { file: rel, document: doc };
    },
    summarize: (out) => `${out.file}`,
  }),

  defineTool({
    name: "scene_create",
    title: "Criar cena",
    description:
      "Cria src/projects/<id>/scenes/<sceneId>.scene.json (SceneDocument v1: format 'engine.scene', version 1). Vazia (entities: []) ou copiando entidades/assets/worldBounds de outra cena ('from'). Valida antes de gravar; recusa se o arquivo já existe (INVALID_INPUT). Depois use scene_entity_add. A engine carrega com world.loadSceneDocument(doc, { prefabs }).",
    input: {
      id: projectIdInput,
      sceneId: z.string().min(1).describe("id da nova cena; vira o nome do arquivo (1–128 de [A-Za-z0-9_-], '.' entre partes)"),
      sceneName: z.string().min(1).max(256).describe("nome legível (1–256 caracteres)"),
      from: z.string().min(1).optional().describe("id de uma cena existente do mesmo jogo para copiar (entidades, assets, worldBounds, chaves '$')"),
      worldBounds: z.object({ min: vec3, max: vec3 }).optional().describe("limites do mundo { min:{x,y,z}, max:{x,y,z} } (min ≤ max em cada eixo); sobrescreve o de 'from'"),
    },
    output: writeOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ id, sceneId: rawId, sceneName, from, worldBounds }, ctx) => {
      requireProjectDir(ctx, id);
      const sceneId = normalizeDocId(rawId, SCENE_SUFFIX, "sceneId");
      const rel = sceneRel(id, sceneId);
      ctx.paths.assertWritable(rel);
      if (existsSync(ctx.paths.resolve(rel))) {
        throw new McpToolError("INVALID_INPUT", `a cena '${sceneId}' já existe (${rel})`, "Escolha outro sceneId, ou edite a existente com scene_entity_add/update/remove.");
      }
      let doc: Json = { format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, sceneId, sceneName, entities: [] };
      if (from !== undefined) {
        const source = readSceneFile(ctx, id, normalizeDocId(from, SCENE_SUFFIX, "from")).doc;
        doc = { ...JSON.parse(JSON.stringify(source)) as Json, format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, sceneId, sceneName };
        if (!Array.isArray(doc["entities"])) doc["entities"] = [];
      }
      if (worldBounds !== undefined) doc["worldBounds"] = worldBounds;
      const written = await writeScene(ctx, id, sceneId, doc);
      return { file: written.file, document: doc, warnings: written.warnings };
    },
    summarize: (out) => `cena criada: ${out.file}${countWarnings(out.warnings)}`,
  }),

  defineTool({
    name: "scene_validate",
    title: "Validar cena",
    description:
      "Valida uma cena com o MESMO validador da engine (validateSceneDocument): esquema (campos desconhecidos são erro, exceto chaves '$...'), ids repetidos, prefab inexistente (prefabs lidos de src/projects/<id>/prefabs), asset inexistente (URL '/x' → public/x; '/assets/x' ou relativa → src/projects/<id>/assets/x, com aviso ASSET_PROJECT_ONLY) e nome do arquivo = sceneId. URLs http(s) viram aviso ASSET_UNVERIFIABLE. Passe 'scene' (arquivo) ou 'document' (documento não gravado).",
    input: {
      id: projectIdInput,
      scene: sceneInput.optional(),
      document: docSchema.optional().describe("SceneDocument a validar sem gravar (alternativa a 'scene')"),
    },
    output: {
      valid: z.boolean(),
      file: z.string().nullable(),
      errors: z.array(issueSchema),
      warnings: z.array(issueSchema),
      assets: z.array(assetCheckSchema),
      prefabsUsed: z.array(z.string()),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ id, scene, document }, ctx) => {
      requireProjectDir(ctx, id);
      if ((scene === undefined) === (document === undefined)) {
        throw new McpToolError("INVALID_INPUT", "informe exatamente um entre 'scene' e 'document'");
      }
      let file: string | null = null;
      let doc: unknown = document;
      let fileId: string | undefined;
      if (scene !== undefined) {
        fileId = normalizeDocId(scene, SCENE_SUFFIX, "id de cena");
        file = sceneRel(id, fileId);
        const abs = ctx.paths.resolve(file);
        if (!isFile(abs)) throw new McpToolError("NOT_FOUND", `cena '${fileId}' não existe (${file})`, "Use scene_list.");
        const read = readJsonFile(abs, file);
        if (!read.ok) return { valid: false, file, errors: [read.issue], warnings: [], assets: [], prefabsUsed: [] };
        doc = read.value;
      }
      const check = validateSceneForProject(ctx, id, doc, { checkAssets: true, ...(fileId !== undefined ? { fileId } : {}) });
      return { valid: check.valid, file, errors: check.errors, warnings: check.warnings, assets: check.assets, prefabsUsed: check.prefabsUsed };
    },
    summarize: (out) => (out.valid ? `cena válida${countWarnings(out.warnings)}` : `cena INVÁLIDA: ${String(out.errors.length)} erro(s) — ${out.errors.slice(0, 3).map((e) => `${e.path || "(raiz)"} ${e.code}`).join("; ")}`),
  }),

  defineTool({
    name: "scene_entity_add",
    title: "Adicionar entidade à cena",
    description:
      "Acrescenta uma entidade ao fim de 'entities' e grava (atômico) se a cena resultante for válida; senão SCHEMA_INVALID com details.errors e nada é gravado. Entidade: { id (único), type?, prefab? (prefabId existente), position?{x,y,z}, rotation?{x,y,z,w}, scale?{x,y,z} (≠0), tags?[], data?{} (JSON ≤ 64 KiB) }. Campos da entidade vencem os do prefab. Asset inexistente vira aviso.",
    input: {
      id: projectIdInput,
      scene: sceneInput,
      entity: docSchema.describe("a entidade (SceneDocument v1); ex.: { \"id\": \"caixa-1\", \"type\": \"prop\", \"position\": {\"x\":0,\"y\":1,\"z\":0} }"),
    },
    output: writeOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ id, scene, entity }, ctx) => {
      const sceneId = normalizeDocId(scene, SCENE_SUFFIX, "id de cena");
      ctx.paths.assertWritable(sceneRel(id, sceneId));
      const { doc } = readSceneFile(ctx, id, sceneId);
      const entities = Array.isArray(doc["entities"]) ? [...(doc["entities"] as unknown[])] : [];
      entities.push(entity);
      const next: Json = { ...doc, entities };
      const written = await writeScene(ctx, id, sceneId, next);
      return { file: written.file, document: next, warnings: written.warnings };
    },
    summarize: (out) => `entidade adicionada em ${out.file} (${Array.isArray(out.document["entities"]) ? out.document["entities"].length : 0} no total)${countWarnings(out.warnings)}`,
  }),

  defineTool({
    name: "scene_entity_update",
    title: "Alterar entidade da cena",
    description:
      "Altera uma entidade por id com um patch: position/rotation/scale/data são mesclados em profundidade (JSON Merge Patch: objeto mescla, null remove a chave); tags e os demais campos (type, prefab, id, '$...') são substituídos; null num campo de topo o remove. Valida a cena resultante antes de gravar (SCHEMA_INVALID se inválida).",
    input: {
      id: projectIdInput,
      scene: sceneInput,
      entityId: z.string().min(1).describe("id da entidade a alterar"),
      patch: docSchema.describe("ex.: { \"position\": { \"y\": 2 }, \"data\": { \"vida\": 10 }, \"tags\": [\"inimigo\"] }"),
    },
    output: writeOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, scene, entityId, patch }, ctx) => {
      const sceneId = normalizeDocId(scene, SCENE_SUFFIX, "id de cena");
      ctx.paths.assertWritable(sceneRel(id, sceneId));
      const { doc } = readSceneFile(ctx, id, sceneId);
      const entities = Array.isArray(doc["entities"]) ? [...(doc["entities"] as unknown[])] : [];
      const index = entities.findIndex((e) => isPlainObject(e) && e["id"] === entityId);
      if (index < 0) throw new McpToolError("NOT_FOUND", `entidade '${entityId}' não existe na cena '${sceneId}'`, "Use scene_read para ver os ids.");
      entities[index] = applyPatch(entities[index] as Json, patch, DEEP_ENTITY_KEYS);
      const next: Json = { ...doc, entities };
      const written = await writeScene(ctx, id, sceneId, next);
      return { file: written.file, document: next, warnings: written.warnings };
    },
    summarize: (out, args) => `entidade '${args.entityId}' alterada em ${out.file}${countWarnings(out.warnings)}`,
  }),

  defineTool({
    name: "scene_entity_remove",
    title: "Remover entidade da cena",
    description: "Remove uma entidade por id e grava a cena (atômico). NOT_FOUND se o id não existir.",
    input: { id: projectIdInput, scene: sceneInput, entityId: z.string().min(1).describe("id da entidade a remover") },
    output: writeOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: async ({ id, scene, entityId }, ctx) => {
      const sceneId = normalizeDocId(scene, SCENE_SUFFIX, "id de cena");
      ctx.paths.assertWritable(sceneRel(id, sceneId));
      const { doc } = readSceneFile(ctx, id, sceneId);
      const entities = Array.isArray(doc["entities"]) ? (doc["entities"] as unknown[]) : [];
      const kept = entities.filter((e) => !(isPlainObject(e) && e["id"] === entityId));
      if (kept.length === entities.length) throw new McpToolError("NOT_FOUND", `entidade '${entityId}' não existe na cena '${sceneId}'`, "Use scene_read para ver os ids.");
      const next: Json = { ...doc, entities: kept };
      const written = await writeScene(ctx, id, sceneId, next);
      return { file: written.file, document: next, warnings: written.warnings };
    },
    summarize: (out, args) => `entidade '${args.entityId}' removida de ${out.file}`,
  }),

  defineTool({
    name: "prefab_create",
    title: "Criar prefab",
    description:
      "Cria src/projects/<id>/prefabs/<prefabId>.prefab.json (PrefabDocument v1). Documento: { prefabId, type?, tags?[], data?{}, assets?[{ id, url, type: gltf|texture|audio }] }; 'format' ('engine.prefab') e 'version' (1) são preenchidos se faltarem. Valida antes de gravar (SCHEMA_INVALID); recusa prefab existente (INVALID_INPUT). Asset inexistente vira aviso.",
    input: {
      id: projectIdInput,
      prefab: docSchema.describe("ex.: { \"prefabId\": \"jogador\", \"type\": \"player\", \"tags\": [\"player\"], \"data\": { \"vida\": 3 } }"),
    },
    output: writeOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async ({ id, prefab }, ctx) => {
      requireProjectDir(ctx, id);
      if (typeof prefab["prefabId"] !== "string") {
        throw new McpToolError("SCHEMA_INVALID", "prefabId obrigatório (string)", undefined, { errors: [{ path: "prefabId", code: "REQUIRED", message: "campo obrigatório" }] });
      }
      const prefabId = normalizeDocId(prefab["prefabId"], PREFAB_SUFFIX, "prefabId");
      const rel = prefabRel(id, prefabId);
      ctx.paths.assertWritable(rel);
      if (existsSync(ctx.paths.resolve(rel))) {
        throw new McpToolError("INVALID_INPUT", `o prefab '${prefabId}' já existe (${rel})`, "Use prefab_update para alterá-lo.");
      }
      const doc: Json = { format: PREFAB_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, ...prefab, prefabId };
      const written = await writePrefab(ctx, id, prefabId, doc);
      return { file: written.file, document: doc, warnings: written.warnings };
    },
    summarize: (out) => `prefab criado: ${out.file}${countWarnings(out.warnings)}`,
  }),

  defineTool({
    name: "prefab_update",
    title: "Alterar prefab",
    description:
      "Altera um prefab com um patch: 'data' é mesclado em profundidade (JSON Merge Patch; null remove a chave); tags, assets, type e '$...' são substituídos; null num campo de topo o remove. prefabId/format/version não mudam. Valida antes de gravar e devolve as cenas que usam o prefab com a validade de cada uma após a mudança.",
    input: {
      id: projectIdInput,
      prefabId: prefabInput,
      patch: docSchema.describe("ex.: { \"data\": { \"vida\": 5 }, \"tags\": [\"player\", \"heroi\"] }"),
    },
    output: { ...writeOutput, scenesUsing: z.array(z.object({ sceneId: z.string(), valid: z.boolean() })) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, prefabId: rawId, patch }, ctx) => {
      const prefabId = normalizeDocId(rawId, PREFAB_SUFFIX, "prefabId");
      ctx.paths.assertWritable(prefabRel(id, prefabId));
      for (const key of ["prefabId", "format", "version"]) {
        if (key in patch) throw new McpToolError("INVALID_INPUT", `o patch não pode alterar '${key}'`, "Para renomear, crie outro prefab com prefab_create.");
      }
      const { doc } = readPrefabFile(ctx, id, prefabId);
      const next = applyPatch(doc, patch, DEEP_PREFAB_KEYS);
      const written = await writePrefab(ctx, id, prefabId, next);
      return { file: written.file, document: next, warnings: written.warnings, scenesUsing: scenesUsingPrefab(ctx, id, prefabId) };
    },
    summarize: (out) => {
      const broken = out.scenesUsing.filter((s) => !s.valid).map((s) => s.sceneId);
      return `prefab alterado: ${out.file}${countWarnings(out.warnings)}${broken.length ? ` — cenas agora inválidas: ${broken.join(", ")}` : ""}`;
    },
  }),
];
