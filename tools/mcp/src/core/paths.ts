/**
 * Caminhos seguros dentro do repositório (SPEC §1.2).
 *
 * - `resolve(rel)`: caminho absoluto dentro da raiz; recusa absolutos fora da
 *   raiz, escapes com `..` e links simbólicos que apontam para fora
 *   (realpath do ancestral existente mais próximo).
 * - `assertWritable(rel)`: só `src/projects/<id>/**` (nunca `_template`),
 *   `docs/games/<id>/**`, `src-tauri/gen/**` e `dist/**`; com
 *   `ENGINE_MCP_READONLY=1` toda escrita é recusada.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpToolError } from "./errors.ts";

export const REPO_PACKAGE_NAME = "projeto1";
export const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const isWindows = process.platform === "win32";

/** Valida um id de projeto (`[a-z0-9][a-z0-9-]{0,62}`). Devolve o próprio id. */
export function validateProjectId(id: unknown): string {
  if (typeof id !== "string" || !PROJECT_ID_RE.test(id)) {
    throw new McpToolError(
      "INVALID_INPUT",
      `id de projeto inválido: ${JSON.stringify(id)}`,
      "Use minúsculas, dígitos e hífen: [a-z0-9][a-z0-9-]{0,62} (ex.: meu-jogo).",
    );
  }
  return id;
}

function readPackageName(dir: string): string | null {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function walkUpForRepo(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (readPackageName(dir) === REPO_PACKAGE_NAME) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Raiz do repositório: `ENGINE_MCP_ROOT` ou a primeira pasta (subindo a partir
 * deste arquivo e depois do cwd) com `package.json` de nome `projeto1`.
 */
export function detectRepoRoot(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const fromEnv = env.ENGINE_MCP_ROOT?.trim();
  if (fromEnv) {
    const abs = path.resolve(cwd, fromEnv);
    if (!existsSync(abs)) {
      throw new McpToolError("NOT_FOUND", `ENGINE_MCP_ROOT não existe: ${abs}`);
    }
    return realpathSync(abs);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = walkUpForRepo(here) ?? walkUpForRepo(cwd);
  if (!found) {
    throw new McpToolError(
      "NOT_FOUND",
      `não encontrei o repositório (package.json com name "${REPO_PACKAGE_NAME}")`,
      "Defina ENGINE_MCP_ROOT com a raiz do repositório.",
    );
  }
  return realpathSync(found);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * `child` está dentro de `parent` (ou é ele)? Só `..` como SEGMENTO conta
 * como saída: uma pasta chamada `..foo` dentro da raiz é válida.
 * Exportado para testes.
 */
export function samePathPrefix(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false; // outra unidade no Windows
  return rel !== ".." && !rel.startsWith(`..${path.sep}`);
}

/** realpath do ancestral existente mais próximo + o resto do caminho. */
function realpathOfNearestAncestor(abs: string): string {
  let current = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length > 0 ? path.join(real, ...rest.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) return abs;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/** Padrões graváveis (caminho relativo POSIX). */
const WRITABLE_RULES: ReadonlyArray<{ readonly label: string; readonly test: (rel: string) => boolean }> = [
  {
    label: "src/projects/<id>/**",
    test: (rel) => {
      const m = /^src\/projects\/([^/]+)(\/.*)?$/.exec(rel);
      return !!m && PROJECT_ID_RE.test(m[1]!);
    },
  },
  {
    label: "docs/games/<id>/**",
    test: (rel) => {
      const m = /^docs\/games\/([^/]+)(\/.*)?$/.exec(rel);
      return !!m && PROJECT_ID_RE.test(m[1]!);
    },
  },
  { label: "src-tauri/gen/**", test: (rel) => /^src-tauri\/gen\/.+/.test(rel) },
  { label: "dist/**", test: (rel) => /^dist\/.+/.test(rel) },
];

export const WRITABLE_PATTERNS: readonly string[] = WRITABLE_RULES.map((r) => r.label);

export interface RepoPaths {
  /** Raiz absoluta (realpath). */
  readonly root: string;
  readonly readonly: boolean;
  /** Absoluto dentro do repo. Aceita relativo ou absoluto (se dentro da raiz). */
  resolve(rel: string): string;
  /** Relativo POSIX à raiz ("" = raiz). */
  relative(abs: string): string;
  /** Indica se `rel` está numa área gravável (não lança; ignora READONLY). */
  isWritable(rel: string): boolean;
  /** Absoluto gravável; lança READONLY / WRITE_FORBIDDEN / PATH_OUTSIDE_REPO. */
  assertWritable(rel: string): string;
  /** `src/projects/<id>` absoluto (id validado). */
  projectDir(id: string): string;
  /** Escrita atômica (tmp + rename), cria pastas. Devolve o caminho absoluto. */
  writeFileAtomic(rel: string, data: string | Uint8Array): Promise<string>;
  /** `mkdir -p` numa área gravável. */
  mkdirp(rel: string): Promise<string>;
  /** Remove arquivo/pasta numa área gravável (recursivo). */
  remove(rel: string): Promise<void>;
}

export function createRepoPaths(rootInput: string, options: { readonly?: boolean } = {}): RepoPaths {
  const root = realpathSync(path.resolve(rootInput));
  const readonlyMode = options.readonly === true;
  const norm = (p: string): string => (isWindows ? p.toLowerCase() : p);

  const resolve = (rel: string): string => {
    if (typeof rel !== "string" || rel.length === 0) {
      throw new McpToolError("INVALID_INPUT", "caminho vazio");
    }
    if (rel.includes("\0")) {
      throw new McpToolError("INVALID_INPUT", "caminho com byte nulo");
    }
    const cleaned = isWindows ? rel : rel.replace(/\\/g, "/");
    const abs = path.resolve(root, cleaned);
    if (!samePathPrefix(norm(abs), norm(root))) {
      throw new McpToolError(
        "PATH_OUTSIDE_REPO",
        `caminho fora do repositório: ${rel}`,
        "Use caminhos relativos à raiz do repositório, sem '..' para fora dela.",
      );
    }
    const real = realpathOfNearestAncestor(abs);
    if (!samePathPrefix(norm(real), norm(root))) {
      throw new McpToolError(
        "PATH_OUTSIDE_REPO",
        `caminho aponta para fora do repositório (link simbólico): ${rel}`,
      );
    }
    return abs;
  };

  const relative = (abs: string): string => toPosix(path.relative(root, abs));

  const writableRel = (rel: string): boolean => {
    const r = isWindows ? rel.toLowerCase() : rel;
    return WRITABLE_RULES.some((rule) => rule.test(r));
  };

  const isWritable = (rel: string): boolean => {
    try {
      const abs = resolve(rel);
      return writableRel(relative(abs)) && writableRel(relative(realpathOfNearestAncestor(abs)));
    } catch {
      return false;
    }
  };

  const assertWritable = (rel: string): string => {
    if (readonlyMode) {
      throw new McpToolError("READONLY", "servidor em modo somente leitura (ENGINE_MCP_READONLY=1)");
    }
    const abs = resolve(rel);
    const lexical = relative(abs);
    const real = relative(realpathOfNearestAncestor(abs));
    if (!writableRel(lexical) || !writableRel(real)) {
      throw new McpToolError(
        "WRITE_FORBIDDEN",
        `escrita proibida em ${lexical || "."}`,
        `Só é permitido escrever em: ${WRITABLE_PATTERNS.join(", ")} (nunca em src/projects/_template nem na engine).`,
      );
    }
    return abs;
  };

  const projectDir = (id: string): string => path.join(root, "src", "projects", validateProjectId(id));

  const writeFileAtomic = async (rel: string, data: string | Uint8Array): Promise<string> => {
    const abs = assertWritable(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    // Revalida depois de criar as pastas (corrida com link simbólico).
    assertWritable(rel);
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, abs);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return abs;
  };

  const mkdirp = async (rel: string): Promise<string> => {
    const abs = assertWritable(rel);
    await mkdir(abs, { recursive: true });
    return abs;
  };

  const remove = async (rel: string): Promise<void> => {
    const abs = assertWritable(rel);
    await rm(abs, { recursive: true, force: true });
  };

  return { root, readonly: readonlyMode, resolve, relative, isWritable, assertWritable, projectDir, writeFileAtomic, mkdirp, remove };
}
