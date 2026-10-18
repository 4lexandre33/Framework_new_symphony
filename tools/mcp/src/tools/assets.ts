/**
 * Domínio `assets` — T8: assets dos jogos (SPEC §3.5).
 *
 * - `assets_list`: arquivos de `public/**` e `src/projects/<id>/assets/**` com
 *   tipo (pela extensão), bytes, dimensões de imagens e resumo de glTF.
 * - `assets_validate`: GLB/glTF (cabeçalho, chunks, buffers/imagens externos),
 *   imagens (dimensões, potência de 2, > 4096), áudio (cabeçalho/tamanho),
 *   referências quebradas de cenas/prefabs e arquivos órfãos.
 * - `asset_import`: copia um arquivo local (dentro do repo ou de
 *   `ENGINE_MCP_IMPORT_DIR`) para `src/projects/<id>/assets/`.
 * - `gltf_inspect`: nós, malhas, triângulos, materiais, animações...
 *
 * Parsers sem dependência: `core/images.ts` e `core/gltf.ts`. Mapeamento de
 * URL → arquivo: `resolveAssetUrl` em `scenes.ts` (documentado lá).
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { inspectGltf, isGlb, parseGlb, parseGltfJson, readGlbHeader, type GltfIssue, type GltfSummary } from "../core/gltf.ts";
import { detectImageFormat, isPowerOfTwo, probeImage, type ImageFormat } from "../core/images.ts";
import { PROJECT_ID_RE } from "../core/paths.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";
import {
  loadProjectPrefabs,
  MAX_DOC_BYTES,
  projectRel,
  requireProjectDir,
  resolveAssetUrl,
  SCENE_SUFFIX,
  SCENES_DIR,
} from "./scenes.ts";

/* ============================================================================
 * Constantes
 * ========================================================================== */

export type AssetKind = "gltf" | "texture" | "audio" | "json" | "binary" | "other";

export const ASSET_EXTENSIONS: Readonly<Record<string, AssetKind>> = {
  gltf: "gltf",
  glb: "gltf",
  png: "texture",
  jpg: "texture",
  jpeg: "texture",
  webp: "texture",
  ktx2: "texture",
  mp3: "audio",
  ogg: "audio",
  wav: "audio",
  json: "json",
  bin: "binary",
};

const EXT_IMAGE_FORMAT: Readonly<Record<string, ImageFormat>> = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", ktx2: "ktx2" };

export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
export const LARGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXTURE_SIZE = 4096;
const MAX_LISTED = 5000;
const MAX_JSON_READ = 64 * 1024 * 1024;
const MAX_SOURCE_SCAN_BYTES = 2 * 1024 * 1024;
const SOURCE_SCAN_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function extOf(file: string): string {
  return path.extname(file).slice(1).toLowerCase();
}

export function assetKind(file: string): AssetKind {
  return ASSET_EXTENSIONS[extOf(file)] ?? "other";
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/* ============================================================================
 * Leitura de arquivos
 * ========================================================================== */

async function readHead(abs: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Lista arquivos regulares sob `dirAbs` (não segue links simbólicos; ignora ocultos). */
function walk(dirAbs: string, out: string[], limit: number): boolean {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return false;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (walk(abs, out, limit)) return true;
    } else if (entry.isFile()) {
      if (out.length >= limit) return true;
      out.push(abs);
    }
  }
  return false;
}

export interface ImageMeta {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
}

export interface FileIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

interface GltfLoad {
  readonly summary: GltfSummary | null;
  readonly glb: { version: number; declaredLength: number; chunks: Array<{ type: string; length: number }> } | null;
  readonly error: FileIssue | null;
  readonly parseIssues: readonly GltfIssue[];
}

/** Lê um .glb (só cabeçalho + JSON + cabeçalho do BIN) ou .gltf e resume. */
async function loadGltf(abs: string): Promise<GltfLoad> {
  const size = statSync(abs).size;
  const head = await readHead(abs, Math.min(size, 20));
  if (isGlb(head) || extOf(abs) === "glb") {
    const header = readGlbHeader(head);
    if (!header.ok) return { summary: null, glb: null, error: { code: `GLB_${header.code}`, message: header.message }, parseIssues: [] };
    // Comprimento absurdo (> arquivo) cai no parseGlb como BAD_CHUNK; só recusa JSON real grande demais.
    const toRead = Math.min(size, 20 + (header.jsonLength ?? 0) + 8);
    if (toRead > MAX_JSON_READ) return { summary: null, glb: null, error: { code: "GLB_JSON_TOO_LARGE", message: `chunk JSON de ${String(header.jsonLength)} bytes` }, parseIssues: [] };
    const buf = await readHead(abs, toRead);
    const parsed = parseGlb(buf, size);
    if (!parsed.ok) return { summary: null, glb: null, error: { code: `GLB_${parsed.code}`, message: parsed.message }, parseIssues: [] };
    const binChunk = parsed.chunks.find((c) => c.type === "BIN");
    const summary = inspectGltf(parsed.json, { container: "glb", binLength: binChunk ? binChunk.length : null });
    return {
      summary,
      glb: { version: parsed.version, declaredLength: parsed.declaredLength, chunks: parsed.chunks.map((c) => ({ type: c.type, length: c.length })) },
      error: null,
      parseIssues: parsed.issues,
    };
  }
  if (size > MAX_JSON_READ) return { summary: null, glb: null, error: { code: "GLTF_TOO_LARGE", message: `.gltf com ${String(size)} bytes` }, parseIssues: [] };
  const parsed = parseGltfJson(await readFile(abs, "utf8"));
  if (!parsed.ok) return { summary: null, glb: null, error: { code: "GLTF_INVALID_JSON", message: parsed.message }, parseIssues: [] };
  return { summary: inspectGltf(parsed.json, { container: "gltf" }), glb: null, error: null, parseIssues: [] };
}

async function loadImage(abs: string): Promise<{ meta: ImageMeta | null; error: FileIssue | null; detected: ImageFormat | null }> {
  const size = statSync(abs).size;
  // JPEG pode ter EXIF grande antes do SOF: lê tudo até 16 MiB, senão 1 MiB.
  const buf = size <= 16 * 1024 * 1024 ? new Uint8Array(await readFile(abs)) : await readHead(abs, 1024 * 1024);
  const probe = probeImage(buf);
  if (!probe.ok) return { meta: null, error: { code: `IMAGE_${probe.code}`, message: probe.message }, detected: probe.format ?? detectImageFormat(buf) };
  return { meta: { format: probe.format, width: probe.width, height: probe.height }, error: null, detected: probe.format };
}

/** Confere URIs externas de um glTF relativas à pasta do arquivo. */
function checkGltfUris(ctx: ToolContext, fileRel: string, summary: GltfSummary): { refs: Array<{ kind: string; index: number; uri: string; status: "found" | "missing" | "unverifiable"; file: string | null }>; issues: FileIssue[] } {
  const refs: Array<{ kind: string; index: number; uri: string; status: "found" | "missing" | "unverifiable"; file: string | null }> = [];
  const issues: FileIssue[] = [];
  const dir = path.posix.dirname(fileRel);
  for (const ref of summary.externalUris) {
    const where = `${ref.kind === "buffer" ? "buffers" : "images"}[${String(ref.index)}].uri`;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref.uri) || ref.uri.startsWith("//")) {
      refs.push({ ...ref, status: "unverifiable", file: null });
      issues.push({ code: "GLTF_URI_UNVERIFIABLE", message: `URI remota não verificável: ${ref.uri}`, path: where });
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(ref.uri.split(/[?#]/u, 1)[0] ?? "");
    } catch {
      decoded = ref.uri;
    }
    const rel = path.posix.normalize(path.posix.join(dir, decoded.replace(/\\/g, "/")));
    let found: string | null = null;
    if (!decoded.startsWith("/")) {
      try {
        const abs = ctx.paths.resolve(rel);
        if (existsSync(abs) && statSync(abs).isFile()) found = rel;
      } catch {
        found = null;
      }
    }
    refs.push({ ...ref, status: found ? "found" : "missing", file: found });
    if (!found) issues.push({ code: "GLTF_URI_MISSING", message: `${ref.kind === "buffer" ? "buffer" : "imagem"} externo não encontrado: ${ref.uri} (esperado em ${rel})`, path: where });
  }
  return { refs, issues };
}

/* ============================================================================
 * Descrição de um arquivo (assets_list)
 * ========================================================================== */

const imageSchema = z.object({ format: z.string(), width: z.number(), height: z.number() });
const gltfBriefSchema = z.object({
  container: z.string(),
  nodes: z.number(),
  meshes: z.number(),
  triangles: z.number(),
  materials: z.number(),
  animations: z.number(),
  errors: z.number(),
});
const listEntrySchema = z.object({
  path: z.string(),
  root: z.enum(["public", "project"]),
  project: z.string().nullable(),
  url: z.string().nullable(),
  ext: z.string(),
  type: z.string(),
  bytes: z.number(),
  image: imageSchema.optional(),
  gltf: gltfBriefSchema.optional(),
  error: z.string().optional(),
});
type ListEntry = z.infer<typeof listEntrySchema>;

async function describeFile(ctx: ToolContext, abs: string, root: "public" | "project", project: string | null): Promise<ListEntry> {
  const rel = ctx.paths.relative(abs);
  const ext = extOf(abs);
  const type = assetKind(abs);
  const bytes = statSync(abs).size;
  const entry: ListEntry = {
    path: rel,
    root,
    project,
    url: root === "public" ? `/${rel.slice("public/".length)}` : null,
    ext,
    type,
    bytes,
  };
  try {
    if (type === "texture") {
      const img = await loadImage(abs);
      if (img.meta) entry.image = img.meta;
      if (img.error) entry.error = `${img.error.code}: ${img.error.message}`;
    } else if (type === "gltf") {
      const g = await loadGltf(abs);
      if (g.summary) {
        entry.gltf = {
          container: g.summary.container,
          nodes: g.summary.nodes,
          meshes: g.summary.meshes.length,
          triangles: g.summary.totals.triangles,
          materials: g.summary.materials.length,
          animations: g.summary.animations.length,
          errors: g.summary.issues.filter((i) => i.severity === "error").length,
        };
      }
      if (g.error) entry.error = `${g.error.code}: ${g.error.message}`;
    }
  } catch (error) {
    entry.error = `READ_FAILED: ${(error as Error).message}`;
  }
  return entry;
}

function projectIds(ctx: ToolContext): string[] {
  const base = ctx.paths.resolve("src/projects");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && PROJECT_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/* ============================================================================
 * Validação
 * ========================================================================== */

function sniffAudio(buf: Uint8Array, ext: string): string | null {
  const ascii = (o: number, n: number): string => String.fromCharCode(...buf.subarray(o, o + n));
  if (ext === "wav") return buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE" ? null : "cabeçalho RIFF/WAVE ausente";
  if (ext === "ogg") return buf.length >= 4 && ascii(0, 4) === "OggS" ? null : "cabeçalho OggS ausente";
  if (ext === "mp3") {
    if (buf.length >= 3 && ascii(0, 3) === "ID3") return null;
    if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return null;
    return "nem tag ID3 nem sincronismo de frame MPEG no início";
  }
  return null;
}

interface ValidatedFile {
  path: string;
  type: string;
  bytes: number;
  errors: FileIssue[];
  warnings: FileIssue[];
  image?: ImageMeta;
  gltf?: { container: string; triangles: number; meshes: number; animations: number; externalRefs: number };
}

async function validateFile(ctx: ToolContext, abs: string, gltfRefs: Set<string>): Promise<ValidatedFile> {
  const rel = ctx.paths.relative(abs);
  const ext = extOf(abs);
  const type = assetKind(abs);
  const bytes = statSync(abs).size;
  const out: ValidatedFile = { path: rel, type, bytes, errors: [], warnings: [] };
  if (bytes === 0) {
    out.errors.push({ code: "EMPTY_FILE", message: "arquivo vazio" });
    return out;
  }
  if (bytes > LARGE_FILE_BYTES) out.warnings.push({ code: "FILE_LARGE", message: `${(bytes / 1024 / 1024).toFixed(1)} MiB (> 10 MiB): considere compactar` });
  try {
    if (type === "texture") {
      const img = await loadImage(abs);
      if (img.error) out.errors.push(img.error);
      if (img.detected && EXT_IMAGE_FORMAT[ext] && img.detected !== EXT_IMAGE_FORMAT[ext]) {
        out.warnings.push({ code: "IMAGE_EXT_MISMATCH", message: `extensão .${ext} mas o conteúdo é ${img.detected}` });
      }
      if (img.meta) {
        out.image = img.meta;
        if (!isPowerOfTwo(img.meta.width) || !isPowerOfTwo(img.meta.height)) {
          out.warnings.push({ code: "IMAGE_NOT_POT", message: `${String(img.meta.width)}x${String(img.meta.height)} não é potência de 2 (mipmaps/repeat podem sofrer em WebGL)` });
        }
        if (img.meta.width > MAX_TEXTURE_SIZE || img.meta.height > MAX_TEXTURE_SIZE) {
          out.warnings.push({ code: "IMAGE_TOO_LARGE", message: `${String(img.meta.width)}x${String(img.meta.height)} > ${String(MAX_TEXTURE_SIZE)} (muitas GPUs limitam texturas)` });
        }
      }
    } else if (type === "gltf") {
      const g = await loadGltf(abs);
      if (g.error) out.errors.push(g.error);
      for (const i of g.parseIssues) (i.severity === "error" ? out.errors : out.warnings).push({ code: i.code, message: i.message, ...(i.path ? { path: i.path } : {}) });
      if (g.summary) {
        for (const i of g.summary.issues) (i.severity === "error" ? out.errors : out.warnings).push({ code: i.code, message: i.message, ...(i.path ? { path: i.path } : {}) });
        const uris = checkGltfUris(ctx, rel, g.summary);
        for (const i of uris.issues) (i.code === "GLTF_URI_MISSING" ? out.errors : out.warnings).push(i);
        for (const r of uris.refs) if (r.file) gltfRefs.add(r.file);
        out.gltf = {
          container: g.summary.container,
          triangles: g.summary.totals.triangles,
          meshes: g.summary.meshes.length,
          animations: g.summary.animations.length,
          externalRefs: uris.refs.length,
        };
      }
    } else if (type === "audio") {
      const problem = sniffAudio(await readHead(abs, 16), ext);
      if (problem) out.warnings.push({ code: "AUDIO_HEADER", message: `${problem} (extensão .${ext})` });
    } else if (type === "json") {
      if (bytes <= MAX_JSON_READ) {
        try {
          JSON.parse(await readFile(abs, "utf8"));
        } catch (error) {
          out.errors.push({ code: "INVALID_JSON", message: (error as Error).message });
        }
      }
    }
  } catch (error) {
    out.errors.push({ code: "READ_FAILED", message: (error as Error).message });
  }
  return out;
}

interface DocAssetRef {
  readonly document: string;
  readonly assetId: string;
  readonly url: string;
}

function collectDocAssetRefs(ctx: ToolContext, id: string): DocAssetRef[] {
  const refs: DocAssetRef[] = [];
  const add = (document: string, assets: unknown): void => {
    if (!Array.isArray(assets)) return;
    for (const a of assets) {
      if (typeof a === "object" && a !== null && typeof (a as Record<string, unknown>)["url"] === "string") {
        const rec = a as Record<string, unknown>;
        refs.push({ document, assetId: typeof rec["id"] === "string" ? rec["id"] : "?", url: rec["url"] as string });
      }
    }
  };
  const scenesAbs = ctx.paths.resolve(`${projectRel(id)}/${SCENES_DIR}`);
  if (existsSync(scenesAbs)) {
    for (const e of readdirSync(scenesAbs, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(SCENE_SUFFIX)) continue;
      const rel = `${projectRel(id)}/${SCENES_DIR}/${e.name}`;
      try {
        const abs = ctx.paths.resolve(rel);
        if (statSync(abs).size > MAX_DOC_BYTES) continue;
        const doc = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
        add(rel, doc["assets"]);
      } catch {
        // JSON quebrado: scene_validate reporta.
      }
    }
  }
  for (const p of loadProjectPrefabs(ctx, id).values()) {
    if (typeof p.raw === "object" && p.raw !== null) add(p.file, (p.raw as Record<string, unknown>)["assets"]);
  }
  return refs;
}

/** Arquivos-fonte do jogo (fora de assets/) para procurar nomes de arquivo. */
function readProjectSources(projectAbs: string): string {
  const files: string[] = [];
  walk(projectAbs, files, 20_000);
  const assetsAbs = path.join(projectAbs, "assets");
  let text = "";
  for (const f of files) {
    if (inside(f, assetsAbs)) continue;
    if (!SOURCE_SCAN_EXT.has(path.extname(f).toLowerCase())) continue;
    try {
      if (statSync(f).size > MAX_SOURCE_SCAN_BYTES) continue;
      text += readFileSync(f, "utf8") + "\n";
    } catch {
      // ignora arquivo ilegível
    }
  }
  return text;
}

/* ============================================================================
 * Importação
 * ========================================================================== */

/** Sanitiza o destino (subpastas permitidas): ASCII, [A-Za-z0-9._-], sem '..'. */
export function sanitizeDestName(raw: string): string {
  const segments = raw.replace(/\\/g, "/").split("/").filter((s) => s.length > 0);
  const clean = segments.map((seg) =>
    seg
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "-")
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/-+\./g, ".")
      .replace(/\.-+/g, ".")
      .replace(/^[.-]+/, "")
      .replace(/[.-]+$/, ""),
  );
  if (clean.length === 0 || clean.some((s) => s.length === 0 || s === "." || s === "..")) {
    throw new McpToolError("INVALID_INPUT", `destName inválido: ${JSON.stringify(raw)}`, "Use um nome como 'modelos/trem.glb' (letras, dígitos, '.', '_', '-').");
  }
  const last = clean[clean.length - 1]!;
  const dot = last.lastIndexOf(".");
  if (dot <= 0) throw new McpToolError("INVALID_INPUT", `destName sem extensão: ${JSON.stringify(raw)}`, `Extensões aceitas: ${Object.keys(ASSET_EXTENSIONS).join(", ")}.`);
  clean[clean.length - 1] = `${last.slice(0, dot)}.${last.slice(dot + 1).toLowerCase()}`;
  const out = clean.join("/");
  if (out.length > 200) throw new McpToolError("INVALID_INPUT", "destName longo demais (máximo 200 caracteres)");
  if (ASSET_EXTENSIONS[extOf(out)] === undefined) {
    throw new McpToolError("INVALID_INPUT", `extensão .${extOf(out)} não é de asset`, `Extensões aceitas: ${Object.keys(ASSET_EXTENSIONS).join(", ")}.`);
  }
  return out;
}

function resolveImportSource(ctx: ToolContext, sourcePath: string): string {
  if (sourcePath.includes("\0")) throw new McpToolError("INVALID_INPUT", "caminho com byte nulo");
  const candidate = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(ctx.root, sourcePath);
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    throw new McpToolError("NOT_FOUND", `arquivo de origem não existe: ${sourcePath}`);
  }
  const allowed = [ctx.root];
  if (ctx.config.importDir) {
    try {
      allowed.push(realpathSync(ctx.config.importDir));
    } catch {
      // pasta de importação sumiu: só o repo
    }
  }
  // Confere o realpath: um link simbólico dentro do repo apontando para fora é recusado.
  if (!allowed.some((dir) => inside(real, dir))) {
    throw new McpToolError(
      "PATH_OUTSIDE_REPO",
      `origem fora do repositório e da pasta de importação: ${sourcePath}`,
      "Copie o arquivo para dentro do repositório ou defina ENGINE_MCP_IMPORT_DIR com a pasta de onde importar.",
    );
  }
  return real;
}

/* ============================================================================
 * Schemas
 * ========================================================================== */

const fileIssueSchema = z.object({ code: z.string(), message: z.string(), path: z.string().optional() });
const projectIdInput = z.string().describe("id do projeto (pasta em src/projects/, ex.: physics-sandbox)");

/* ============================================================================
 * Tools
 * ========================================================================== */

export const tools: ToolDef[] = [
  defineTool({
    name: "assets_list",
    title: "Listar assets",
    description:
      "Lista assets de public/** (servidos na raiz: url '/<caminho sem public/>') e de src/projects/<id>/assets/** (url null: o jogo importa com new URL('./assets/x', import.meta.url) ou '?url'). Para cada arquivo: tipo pela extensão (gltf/glb → gltf; png/jpg/jpeg/webp/ktx2 → texture; mp3/ogg/wav → audio; json; bin → binary; resto → other), bytes, dimensões de imagens e resumo de glTF (nós, malhas, triângulos, materiais, animações). Sem 'id': public/ + assets de todos os jogos.",
    input: { id: projectIdInput.optional() },
    output: { assets: z.array(listEntrySchema), truncated: z.boolean(), totalBytes: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id }, ctx) => {
      const ids = id !== undefined ? [id] : projectIds(ctx);
      if (id !== undefined) requireProjectDir(ctx, id);
      const roots: Array<{ abs: string; root: "public" | "project"; project: string | null }> = [];
      const publicAbs = ctx.paths.resolve("public");
      if (existsSync(publicAbs) && lstatSync(publicAbs).isDirectory()) roots.push({ abs: publicAbs, root: "public", project: null });
      for (const pid of ids) {
        const abs = ctx.paths.resolve(`${projectRel(pid)}/assets`);
        if (existsSync(abs) && lstatSync(abs).isDirectory()) roots.push({ abs, root: "project", project: pid });
      }
      const assets: ListEntry[] = [];
      let truncated = false;
      for (const r of roots) {
        const files: string[] = [];
        truncated = walk(r.abs, files, MAX_LISTED - assets.length) || truncated;
        for (const f of files) assets.push(await describeFile(ctx, f, r.root, r.project));
        if (assets.length >= MAX_LISTED) {
          truncated = true;
          break;
        }
      }
      return { assets, truncated, totalBytes: assets.reduce((n, a) => n + a.bytes, 0) };
    },
    summarize: (out) => `${out.assets.length} asset(s), ${(out.totalBytes / 1024).toFixed(1)} KiB${out.truncated ? " (lista truncada)" : ""}`,
  }),

  defineTool({
    name: "assets_validate",
    title: "Validar assets do jogo",
    description:
      "Valida os assets de um jogo: arquivos em src/projects/<id>/assets/**, public/projects/<id>/** e os de public/ referenciados por cenas/prefabs. GLB (magic, versão 2, comprimento, chunks JSON+BIN, buffers[0] cabe no BIN), .gltf (JSON, buffers/imagens externos existem), índices do glTF; imagens (dimensões legíveis, aviso se não for potência de 2 ou > 4096, extensão × conteúdo); áudio (cabeçalho WAV/OGG/MP3); qualquer arquivo > 10 MiB (aviso). Também: referências quebradas de cenas/prefabs (erro) e órfãos — arquivos do jogo não citados por cena, prefab, glTF nem pelo código-fonte do jogo (aviso).",
    input: { id: projectIdInput },
    output: {
      ok: z.boolean(),
      files: z.array(
        z.object({
          path: z.string(),
          type: z.string(),
          bytes: z.number(),
          errors: z.array(fileIssueSchema),
          warnings: z.array(fileIssueSchema),
          image: imageSchema.optional(),
          gltf: z.object({ container: z.string(), triangles: z.number(), meshes: z.number(), animations: z.number(), externalRefs: z.number() }).optional(),
        }),
      ),
      brokenRefs: z.array(z.object({ document: z.string(), assetId: z.string(), url: z.string(), candidates: z.array(z.string()) })),
      unverifiableRefs: z.array(z.object({ document: z.string(), assetId: z.string(), url: z.string() })),
      orphans: z.array(z.string()),
      totals: z.object({ files: z.number(), errors: z.number(), warnings: z.number() }),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ id }, ctx) => {
      const projectAbs = requireProjectDir(ctx, id);
      const ownFiles: string[] = [];
      for (const rel of [`${projectRel(id)}/assets`, `public/projects/${id}`]) {
        const abs = ctx.paths.resolve(rel);
        if (existsSync(abs) && lstatSync(abs).isDirectory()) walk(abs, ownFiles, MAX_LISTED);
      }
      const refs = collectDocAssetRefs(ctx, id);
      const brokenRefs: Array<{ document: string; assetId: string; url: string; candidates: string[] }> = [];
      const unverifiableRefs: Array<{ document: string; assetId: string; url: string }> = [];
      const referenced = new Set<string>();
      const extraFiles = new Set<string>();
      for (const ref of refs) {
        const r = resolveAssetUrl(ctx, id, ref.url);
        if (r.status === "missing") brokenRefs.push({ ...ref, candidates: [...r.candidates] });
        else if (r.status === "unverifiable") unverifiableRefs.push(ref);
        else if (r.file) {
          referenced.add(r.file);
          extraFiles.add(ctx.paths.resolve(r.file));
        }
      }
      const all = [...new Set([...ownFiles, ...extraFiles])].sort();
      const gltfRefs = new Set<string>();
      const files: ValidatedFile[] = [];
      for (const abs of all) files.push(await validateFile(ctx, abs, gltfRefs));

      const sources = readProjectSources(projectAbs);
      const orphans: string[] = [];
      for (const abs of ownFiles) {
        const rel = ctx.paths.relative(abs);
        if (referenced.has(rel) || gltfRefs.has(rel)) continue;
        if (sources.includes(path.basename(abs))) continue;
        orphans.push(rel);
        const entry = files.find((f) => f.path === rel);
        entry?.warnings.push({ code: "ASSET_ORPHAN", message: "não é referenciado por cena, prefab, glTF nem pelo código do jogo" });
      }
      const errors = files.reduce((n, f) => n + f.errors.length, 0) + brokenRefs.length;
      const warnings = files.reduce((n, f) => n + f.warnings.length, 0) + unverifiableRefs.length;
      return { ok: errors === 0, files, brokenRefs, unverifiableRefs, orphans, totals: { files: files.length, errors, warnings } };
    },
    summarize: (out) =>
      `${out.ok ? "assets ok" : "assets com ERROS"}: ${String(out.totals.files)} arquivo(s), ${String(out.totals.errors)} erro(s), ${String(out.totals.warnings)} aviso(s), ${String(out.brokenRefs.length)} referência(s) quebrada(s), ${String(out.orphans.length)} órfão(s)`,
  }),

  defineTool({
    name: "asset_import",
    title: "Importar asset",
    description:
      "Copia um arquivo local para src/projects/<id>/assets/<destName>. A origem precisa estar dentro do repositório ou de ENGINE_MCP_IMPORT_DIR (senão PATH_OUTSIDE_REPO), ser arquivo regular, ter extensão de asset e até 256 MiB. destName pode ter subpastas ('modelos/trem.glb') e é sanitizado (ASCII, [A-Za-z0-9._-], extensão minúscula). Recusa sobrescrever sem overwrite: true. Um .gltf com buffers/texturas externos não leva os externos: importe-os também (aviso).",
    input: {
      id: projectIdInput,
      sourcePath: z.string().min(1).describe("caminho do arquivo de origem: relativo à raiz do repo ou absoluto (dentro do repo ou de ENGINE_MCP_IMPORT_DIR)"),
      destName: z.string().min(1).max(256).describe("nome de destino dentro de src/projects/<id>/assets/ (ex.: 'trem.glb' ou 'texturas/chao.png')"),
      overwrite: z.boolean().optional().describe("true substitui um arquivo existente (padrão: recusa)"),
    },
    output: {
      file: z.string(),
      destName: z.string(),
      sanitized: z.boolean(),
      bytes: z.number(),
      sha256: z.string(),
      overwritten: z.boolean(),
      type: z.string(),
      usage: z.string(),
      warnings: z.array(fileIssueSchema),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async ({ id, sourcePath, destName, overwrite }, ctx) => {
      requireProjectDir(ctx, id);
      const finalName = sanitizeDestName(destName);
      const rel = `${projectRel(id)}/assets/${finalName}`;
      const destAbs = ctx.paths.assertWritable(rel);
      const source = resolveImportSource(ctx, sourcePath);
      const st = statSync(source);
      if (!st.isFile()) throw new McpToolError("INVALID_INPUT", `a origem não é um arquivo regular: ${sourcePath}`);
      if (st.size > MAX_IMPORT_BYTES) throw new McpToolError("INVALID_INPUT", `origem tem ${String(st.size)} bytes (máximo ${String(MAX_IMPORT_BYTES)} = 256 MiB)`);
      const sourceExt = extOf(source);
      if (ASSET_EXTENSIONS[sourceExt] === undefined) {
        throw new McpToolError("INVALID_INPUT", `a origem não tem extensão de asset (.${sourceExt || "?"})`, `Extensões aceitas: ${Object.keys(ASSET_EXTENSIONS).join(", ")}.`);
      }
      let overwritten = false;
      if (existsSync(destAbs)) {
        if (!statSync(destAbs).isFile()) throw new McpToolError("INVALID_INPUT", `${rel} existe e não é arquivo`);
        if (overwrite !== true) throw new McpToolError("INVALID_INPUT", `${rel} já existe`, "Passe overwrite: true para substituir, ou escolha outro destName.");
        overwritten = true;
      }
      const warnings: FileIssue[] = [];
      if (sourceExt !== extOf(finalName)) warnings.push({ code: "EXT_CHANGED", message: `extensão de origem .${sourceExt} ≠ destino .${extOf(finalName)}` });
      const data = await readFile(source);
      await ctx.paths.writeFileAtomic(rel, data);
      if (extOf(finalName) === "gltf") {
        const g = await loadGltf(destAbs);
        if (g.summary) {
          for (const i of checkGltfUris(ctx, rel, g.summary).issues) {
            warnings.push({ ...i, message: `${i.message} — importe o arquivo externo para a mesma pasta relativa` });
          }
        }
      }
      const type = assetKind(finalName);
      return {
        file: rel,
        destName: finalName,
        sanitized: finalName !== destName,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        overwritten,
        type,
        usage: `No código do jogo: new URL("./assets/${finalName}", import.meta.url).href. Fora de public/, a URL '/assets/${finalName}' numa cena só funciona se o jogo mapear o arquivo (scene_validate avisa ASSET_PROJECT_ONLY).`,
        warnings,
      };
    },
    summarize: (out) => `importado: ${out.file} (${String(out.bytes)} bytes${out.overwritten ? ", substituído" : ""})${out.warnings.length ? ` — ${String(out.warnings.length)} aviso(s)` : ""}`,
  }),

  defineTool({
    name: "gltf_inspect",
    title: "Inspecionar glTF/GLB",
    description:
      "Analisa um .glb ou .gltf do repositório: cabeçalho/chunks do GLB, nós, malhas (primitivas, triângulos e vértices pelos accessors), materiais, texturas/imagens, animações (canais, duração pelo max do accessor de entrada), skins, extensionsUsed/Required, caixa envolvente (min/max dos POSITION, sem transformações dos nós), buffers e URIs externas (existem?), além de problemas estruturais (índices fora do intervalo, bufferView além do buffer...).",
    input: { path: z.string().min(1).describe("caminho do arquivo relativo à raiz do repo (ex.: src/projects/meu-jogo/assets/trem.glb ou public/modelos/x.gltf)") },
    output: {
      file: z.string(),
      bytes: z.number(),
      valid: z.boolean(),
      glb: z.object({ version: z.number(), declaredLength: z.number(), chunks: z.array(z.object({ type: z.string(), length: z.number() })) }).nullable(),
      summary: z.record(z.string(), z.unknown()),
      externalRefs: z.array(z.object({ kind: z.string(), index: z.number(), uri: z.string(), status: z.string(), file: z.string().nullable() })),
      errors: z.array(fileIssueSchema),
      warnings: z.array(fileIssueSchema),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ path: input }, ctx) => {
      const abs = ctx.paths.resolve(input);
      const rel = ctx.paths.relative(abs);
      if (!existsSync(abs) || !statSync(abs).isFile()) throw new McpToolError("NOT_FOUND", `arquivo não existe: ${rel}`, "Use assets_list para ver os assets.");
      const ext = extOf(abs);
      if (ext !== "glb" && ext !== "gltf") throw new McpToolError("INVALID_INPUT", `não é .glb/.gltf: ${rel}`);
      const g = await loadGltf(abs);
      if (g.error || !g.summary) {
        throw new McpToolError("SCHEMA_INVALID", `${rel}: ${g.error?.message ?? "glTF ilegível"}`, "O arquivo não é um glTF 2.0 válido.", { errors: g.error ? [g.error] : [] });
      }
      const errors: FileIssue[] = [];
      const warnings: FileIssue[] = [];
      for (const i of [...g.parseIssues, ...g.summary.issues]) (i.severity === "error" ? errors : warnings).push({ code: i.code, message: i.message, ...(i.path ? { path: i.path } : {}) });
      const uris = checkGltfUris(ctx, rel, g.summary);
      for (const i of uris.issues) (i.code === "GLTF_URI_MISSING" ? errors : warnings).push(i);
      const { issues: _issues, externalUris: _ext, ...summary } = g.summary;
      return { file: rel, bytes: statSync(abs).size, valid: errors.length === 0, glb: g.glb, summary: summary as unknown as Record<string, unknown>, externalRefs: uris.refs, errors, warnings };
    },
    summarize: (out) => {
      const s = out.summary as { totals?: { triangles?: number }; meshes?: unknown[]; animations?: unknown[]; nodes?: number };
      return `${out.file}: ${String(s.nodes ?? 0)} nó(s), ${String(s.meshes?.length ?? 0)} malha(s), ${String(s.totals?.triangles ?? 0)} triângulo(s), ${String(s.animations?.length ?? 0)} animação(ões)${out.valid ? "" : ` — ${String(out.errors.length)} erro(s)`}`;
    },
  }),
];
