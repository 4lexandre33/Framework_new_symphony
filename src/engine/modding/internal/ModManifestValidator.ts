/**
 * Validação ÚNICA do manifesto de mod — espelha `validate_manifest` em
 * `src-tauri/src/modding.rs`; ambos são testados contra
 * `src-tauri/fixtures/mod-manifests.json` (G118).
 */
import type {
  AssetOverrideDescriptor,
  ModDependencyDescriptor,
  ModManifestDescriptor,
} from "../../../contracts/modding/types";

const MOD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SEMVER_PATTERN = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,64})?$/u;
const MAX_TEXT_LEN = 8 * 1024;
const MAX_NAME_LEN = 128;
const MAX_RELATIVE_PATH_LEN = 1024;
const MAX_OVERRIDES = 256;
const MAX_DEPENDENCIES = 64;

export function isModId(value: unknown): value is string {
  return typeof value === "string" && MOD_ID_PATTERN.test(value);
}

export function isSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

/** Byte length UTF-8 (o Rust mede bytes). */
function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Normaliza caminho relativo de mod: `\` → `/`, remove `.`/vazios; rejeita
 * absoluto, drive (`C:`), `..`, NUL e excesso de tamanho. `null` se inválido.
 */
export function normalizeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || utf8Length(value) > MAX_RELATIVE_PATH_LEN || value.includes("\0")) {
    return null;
  }

  const unified = value.replace(/\\/gu, "/");
  // Mesmo critério do Rust: 2º BYTE igual a ':' (drive do Windows).
  if (unified.startsWith("/") || new TextEncoder().encode(unified)[1] === 0x3a) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join("/") : null;
}

/**
 * Normaliza um caminho VIRTUAL de asset para lookup de override: igual a
 * `normalizeRelativePath`, mas tolera barra inicial (`/textures/a.png`).
 */
export function normalizeVirtualPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeRelativePath(value.trim().replace(/^[/\\]+/u, ""));
}

function isText(value: unknown, maxLen: number, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    utf8Length(value) <= maxLen &&
    !value.includes("\0") &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ManifestValidationResult {
  readonly manifest: ModManifestDescriptor | null;
  readonly error: string | null;
}

/** Valida e devolve uma cópia normalizada (sem campos extras). */
export function validateModManifest(value: unknown): ManifestValidationResult {
  const fail = (error: string): ManifestValidationResult => ({ manifest: null, error });

  if (!isRecord(value)) return fail("manifesto precisa ser objeto");
  if (!isModId(value.modId)) return fail("modId inválido");
  if (!isText(value.name, MAX_NAME_LEN, false)) return fail("name inválido");
  if (!isSemver(value.version)) return fail("version precisa ser semver");
  if (!isText(value.author, MAX_TEXT_LEN, true)) return fail("author inválido");
  if (!isText(value.description, MAX_TEXT_LEN, true)) return fail("description inválido");
  if (typeof value.minEngineVersion !== "string" || (value.minEngineVersion !== "" && !isSemver(value.minEngineVersion))) {
    return fail("minEngineVersion precisa ser semver ou vazio");
  }

  const modId = value.modId;
  let entryScript: string | undefined;
  if (value.entryScript !== undefined && value.entryScript !== null) {
    const normalized = normalizeRelativePath(value.entryScript);
    if (normalized === null) return fail("entryScript: caminho inválido");
    if (!normalized.endsWith(".js") && !normalized.endsWith(".mjs")) return fail("entryScript precisa ser .js/.mjs");
    entryScript = normalized;
  }

  let overrides: AssetOverrideDescriptor[] | undefined;
  if (value.overrides !== undefined && value.overrides !== null) {
    if (!Array.isArray(value.overrides) || value.overrides.length > MAX_OVERRIDES) {
      return fail(`overrides precisa ser array (máx. ${MAX_OVERRIDES})`);
    }
    overrides = [];
    for (const raw of value.overrides as unknown[]) {
      if (!isRecord(raw)) return fail("override inválido");
      const virtualPath = normalizeRelativePath(raw.virtualPath);
      const realPath = normalizeRelativePath(raw.realPath);
      if (virtualPath === null) return fail("override.virtualPath inválido");
      if (realPath === null) return fail("override.realPath inválido");
      if (raw.modId !== modId) return fail("override.modId precisa ser o modId do manifesto");
      if (typeof raw.priority !== "number" || !Number.isFinite(raw.priority)) return fail("override.priority precisa ser finito");
      overrides.push({ virtualPath, realPath, modId, priority: raw.priority });
    }
  }

  let dependencies: ModDependencyDescriptor[] | undefined;
  if (value.dependencies !== undefined && value.dependencies !== null) {
    if (!Array.isArray(value.dependencies) || value.dependencies.length > MAX_DEPENDENCIES) {
      return fail(`dependencies precisa ser array (máx. ${MAX_DEPENDENCIES})`);
    }
    dependencies = [];
    const seen = new Set<string>();
    for (const raw of value.dependencies as unknown[]) {
      if (!isRecord(raw) || !isModId(raw.modId) || raw.modId === modId) return fail("dependency.modId inválido");
      if (seen.has(raw.modId)) return fail("dependência duplicada");
      seen.add(raw.modId);
      if (!isSemver(raw.minVersion)) return fail("dependency.minVersion precisa ser semver");
      dependencies.push({ modId: raw.modId, minVersion: raw.minVersion });
    }
  }

  return {
    error: null,
    manifest: {
      modId,
      name: value.name,
      version: value.version,
      author: value.author,
      description: value.description,
      minEngineVersion: value.minEngineVersion,
      ...(entryScript ? { entryScript } : {}),
      ...(overrides ? { overrides } : {}),
      ...(dependencies ? { dependencies } : {}),
    },
  };
}
