/**
 * SceneDocument v1 / PrefabDocument v1 — formato de cena em dados (JSON).
 *
 * Este arquivo é PURO: não importa nada (nem `@core`, DOM, three ou internals
 * da engine), para que o MCP (`tools/mcp`, Node via tsx) e a engine usem o
 * MESMO validador. Os validadores nunca lançam: devolvem
 * `{ ok: true, value }` (cópia normalizada) ou `{ ok: false, errors }` com
 * códigos estáveis (`SceneDocumentErrorCode`).
 *
 * Mapeamento para `EntitySpawnInput` (ver `toEntitySpawnInput`):
 *   id → entityId · type → type (padrão "entity") · position/rotation/scale →
 *   iguais (padrões 0 / identidade / 1) · tags → tags · data → customData.
 */

/* ============================================================================
 * TIPOS
 * ========================================================================== */

export const SCENE_DOCUMENT_FORMAT = "engine.scene";
export const PREFAB_DOCUMENT_FORMAT = "engine.prefab";
export const SCENE_DOCUMENT_VERSION = 1;

/** Limites do formato (fixos na v1). */
export const SCENE_DOCUMENT_LIMITS = Object.freeze({
  maxEntities: 10_000,
  maxIdLength: 128,
  maxNameLength: 256,
  maxUrlLength: 2048,
  maxDataDepth: 16,
  maxDataBytes: 64 * 1024,
  maxErrors: 200,
  /** |‖q‖ − 1| acima disto: o quaternion é normalizado no `value`. */
  quaternionTolerance: 1e-6,
  /** ‖q‖² abaixo disto: ZERO_QUATERNION. */
  quaternionMinLengthSq: 1e-12,
});

export interface SceneDocumentVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SceneDocumentQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export type SceneDocumentAssetType = "gltf" | "texture" | "audio";

export interface SceneDocumentAsset {
  readonly id: string;
  readonly url: string;
  readonly type: SceneDocumentAssetType;
}

export interface SceneDocumentBounds {
  readonly min: SceneDocumentVector3;
  readonly max: SceneDocumentVector3;
}

/** Valor JSON (o que `data` pode conter). */
export type SceneDocumentJson =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<SceneDocumentJson>
  | { readonly [key: string]: SceneDocumentJson };

export interface SceneDocumentEntity {
  readonly id: string;
  readonly type?: string;
  /** `prefabId` de um PrefabDocument: os campos da entidade sobrescrevem. */
  readonly prefab?: string;
  readonly position?: SceneDocumentVector3;
  readonly rotation?: SceneDocumentQuaternion;
  readonly scale?: SceneDocumentVector3;
  readonly tags?: ReadonlyArray<string>;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface SceneDocument {
  readonly format: typeof SCENE_DOCUMENT_FORMAT;
  readonly version: typeof SCENE_DOCUMENT_VERSION;
  readonly sceneId: string;
  readonly sceneName: string;
  readonly assets?: ReadonlyArray<SceneDocumentAsset>;
  readonly worldBounds?: SceneDocumentBounds;
  readonly entities: ReadonlyArray<SceneDocumentEntity>;
}

export interface PrefabDocument {
  readonly format: typeof PREFAB_DOCUMENT_FORMAT;
  readonly version: typeof SCENE_DOCUMENT_VERSION;
  readonly prefabId: string;
  readonly type?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly assets?: ReadonlyArray<SceneDocumentAsset>;
}

/** Prefabs por id (`{ [prefabId]: doc }`) ou lista. */
export type PrefabCollection =
  | Readonly<Record<string, PrefabDocument>>
  | ReadonlyArray<PrefabDocument>;

/** Códigos estáveis (o MCP e os testes dependem deles). */
export type SceneDocumentErrorCode =
  | "NOT_OBJECT"          // raiz/campo deveria ser objeto
  | "INVALID_FORMAT"      // format ≠ "engine.scene"/"engine.prefab"
  | "UNSUPPORTED_VERSION" // version ≠ 1
  | "REQUIRED"            // campo obrigatório ausente
  | "UNKNOWN_FIELD"       // campo desconhecido (chaves "$..." são permitidas)
  | "INVALID_TYPE"        // tipo JS errado (string/array/número...)
  | "INVALID_ID"          // vazio, > 128 ou fora de [A-Za-z0-9_.:-]
  | "INVALID_NAME"        // sceneName vazio ou > 256
  | "INVALID_TAG"         // tag vazia ou > 128
  | "INVALID_URL"         // url vazia ou > 2048
  | "INVALID_ASSET_TYPE"  // type fora de gltf|texture|audio
  | "DUPLICATE_ENTITY_ID"
  | "DUPLICATE_ASSET_ID"
  | "DUPLICATE_PREFAB_ID"
  | "PREFAB_ID_MISMATCH"  // chave do mapa ≠ prefabId
  | "ASSET_CONFLICT"      // mesmo id de asset com url/tipo diferentes (cena × prefab)
  | "NON_FINITE_NUMBER"
  | "ZERO_QUATERNION"
  | "ZERO_SCALE"
  | "INVALID_BOUNDS"      // min > max em algum eixo
  | "UNKNOWN_PREFAB"      // entity.prefab não existe (só quando prefabs foram passados)
  | "ASSET_NOT_FOUND"     // assetExists(asset) retornou false
  | "DATA_NOT_JSON"       // função, símbolo, bigint, undefined, NaN, ciclo, objeto não-plano
  | "DATA_TOO_DEEP"       // profundidade > 16
  | "DATA_TOO_LARGE"      // JSON > 64 KiB (UTF-8)
  | "TOO_MANY_ENTITIES"   // > 10000
  | "TOO_MANY_ERRORS";    // lista truncada em 200

export interface SceneDocumentError {
  /** Caminho no documento, ex.: `entities[2].position.x`. */
  readonly path: string;
  readonly code: SceneDocumentErrorCode;
  readonly message: string;
}

export type SceneDocumentValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: ReadonlyArray<SceneDocumentError> };

export interface ValidateSceneDocumentOptions {
  /** Quando informado, `entity.prefab` precisa existir e os prefabs são validados. */
  readonly prefabs?: PrefabCollection;
  /** Verificação de existência de asset (ex.: fs no MCP). Síncrona. */
  readonly assetExists?: (asset: SceneDocumentAsset) => boolean;
}

/** Entidade com o prefab aplicado e todos os campos preenchidos. */
export interface ResolvedSceneEntity {
  readonly id: string;
  readonly type: string;
  readonly prefab: string | null;
  readonly position: SceneDocumentVector3;
  readonly rotation: SceneDocumentQuaternion;
  readonly scale: SceneDocumentVector3;
  readonly tags: ReadonlyArray<string>;
  readonly data: Record<string, unknown>;
  /** Assets do prefab (para pré-carregar). */
  readonly assets: ReadonlyArray<SceneDocumentAsset>;
}

/** Estruturalmente igual a `EntitySpawnInput` (contracts/world/types). */
export interface SceneDocumentSpawnInput {
  readonly entityId: string;
  readonly type: string;
  readonly position: SceneDocumentVector3;
  readonly rotation: SceneDocumentQuaternion;
  readonly scale: SceneDocumentVector3;
  readonly tags: ReadonlyArray<string>;
  readonly customData: Record<string, unknown>;
}

export const DEFAULT_SCENE_ENTITY_TYPE = "entity";

/* ============================================================================
 * INFRA DE VALIDAÇÃO
 * ========================================================================== */

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/u;
const ASSET_TYPES: ReadonlySet<string> = new Set(["gltf", "texture", "audio"]);

const SCENE_KEYS: ReadonlySet<string> = new Set(["format", "version", "sceneId", "sceneName", "assets", "worldBounds", "entities"]);
const PREFAB_KEYS: ReadonlySet<string> = new Set(["format", "version", "prefabId", "type", "tags", "data", "assets"]);
const ENTITY_KEYS: ReadonlySet<string> = new Set(["id", "type", "prefab", "position", "rotation", "scale", "tags", "data"]);
const ASSET_KEYS: ReadonlySet<string> = new Set(["id", "url", "type"]);
const BOUNDS_KEYS: ReadonlySet<string> = new Set(["min", "max"]);

class ErrorSink {
  public readonly errors: SceneDocumentError[] = [];
  private truncated = false;

  public add(path: string, code: SceneDocumentErrorCode, message: string): void {
    if (this.truncated) return;
    if (this.errors.length >= SCENE_DOCUMENT_LIMITS.maxErrors) {
      this.truncated = true;
      this.errors.push({ path: "", code: "TOO_MANY_ERRORS", message: `mais de ${String(SCENE_DOCUMENT_LIMITS.maxErrors)} erros; lista truncada` });
      return;
    }
    this.errors.push({ path, code, message });
  }

  public get count(): number {
    return this.errors.length;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function join(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${String(key)}]`;
  return base === "" ? key : `${base}.${key}`;
}

function checkUnknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, sink: ErrorSink): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key) && !key.startsWith("$")) {
      sink.add(join(path, key), "UNKNOWN_FIELD", `campo desconhecido '${key}'`);
    }
  }
}

function checkId(value: unknown, path: string, sink: ErrorSink, required: boolean): string | null {
  if (value === undefined) {
    if (required) sink.add(path, "REQUIRED", "campo obrigatório");
    return null;
  }
  if (typeof value !== "string") {
    sink.add(path, "INVALID_TYPE", "deveria ser string");
    return null;
  }
  if (value.length === 0 || value.length > SCENE_DOCUMENT_LIMITS.maxIdLength || !ID_PATTERN.test(value)) {
    sink.add(path, "INVALID_ID", `id inválido '${value.slice(0, 40)}': 1–${String(SCENE_DOCUMENT_LIMITS.maxIdLength)} caracteres de [A-Za-z0-9_.:-]`);
    return null;
  }
  return value;
}

function checkFiniteNumber(value: unknown, path: string, sink: ErrorSink): number | null {
  if (value === undefined) {
    sink.add(path, "REQUIRED", "campo obrigatório");
    return null;
  }
  if (typeof value !== "number") {
    sink.add(path, "INVALID_TYPE", "deveria ser número");
    return null;
  }
  if (!Number.isFinite(value)) {
    sink.add(path, "NON_FINITE_NUMBER", "número não finito (NaN/Infinity)");
    return null;
  }
  return value;
}

function checkVector(value: unknown, path: string, sink: ErrorSink): SceneDocumentVector3 | null {
  if (!isPlainObject(value)) {
    sink.add(path, "NOT_OBJECT", "deveria ser objeto { x, y, z }");
    return null;
  }
  checkUnknownKeys(value, new Set(["x", "y", "z"]), path, sink);
  const x = checkFiniteNumber(value["x"], join(path, "x"), sink);
  const y = checkFiniteNumber(value["y"], join(path, "y"), sink);
  const z = checkFiniteNumber(value["z"], join(path, "z"), sink);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function checkQuaternion(value: unknown, path: string, sink: ErrorSink): SceneDocumentQuaternion | null {
  if (!isPlainObject(value)) {
    sink.add(path, "NOT_OBJECT", "deveria ser objeto { x, y, z, w }");
    return null;
  }
  checkUnknownKeys(value, new Set(["x", "y", "z", "w"]), path, sink);
  const x = checkFiniteNumber(value["x"], join(path, "x"), sink);
  const y = checkFiniteNumber(value["y"], join(path, "y"), sink);
  const z = checkFiniteNumber(value["z"], join(path, "z"), sink);
  const w = checkFiniteNumber(value["w"], join(path, "w"), sink);
  if (x === null || y === null || z === null || w === null) return null;
  const lengthSq = x * x + y * y + z * z + w * w;
  if (!(lengthSq >= SCENE_DOCUMENT_LIMITS.quaternionMinLengthSq) || !Number.isFinite(lengthSq)) {
    sink.add(path, "ZERO_QUATERNION", "quaternion de comprimento zero");
    return null;
  }
  const length = Math.sqrt(lengthSq);
  if (Math.abs(length - 1) <= SCENE_DOCUMENT_LIMITS.quaternionTolerance) return { x, y, z, w };
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function checkScale(value: unknown, path: string, sink: ErrorSink): SceneDocumentVector3 | null {
  const vector = checkVector(value, path, sink);
  if (vector === null) return null;
  for (const axis of ["x", "y", "z"] as const) {
    if (vector[axis] === 0) {
      sink.add(join(path, axis), "ZERO_SCALE", "escala não pode ser zero");
      return null;
    }
  }
  return vector;
}

function checkTags(value: unknown, path: string, sink: ErrorSink): string[] | null {
  if (!Array.isArray(value)) {
    sink.add(path, "INVALID_TYPE", "deveria ser lista de strings");
    return null;
  }
  const tags: string[] = [];
  let ok = true;
  value.forEach((tag: unknown, index) => {
    const tagPath = join(path, index);
    if (typeof tag !== "string") {
      sink.add(tagPath, "INVALID_TYPE", "tag deveria ser string");
      ok = false;
    } else if (tag.length === 0 || tag.length > SCENE_DOCUMENT_LIMITS.maxIdLength) {
      sink.add(tagPath, "INVALID_TAG", `tag deve ter 1–${String(SCENE_DOCUMENT_LIMITS.maxIdLength)} caracteres`);
      ok = false;
    } else {
      tags.push(tag);
    }
  });
  return ok ? tags : null;
}

/** Copia `value` validando que é JSON puro (sem funções, ciclos, NaN, protótipos). */
function cloneJson(value: unknown, path: string, depth: number, seen: Set<object>, sink: ErrorSink): { ok: boolean; value: unknown } {
  if (value === null || typeof value === "boolean" || typeof value === "string") return { ok: true, value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      sink.add(path, "DATA_NOT_JSON", "número não finito não é JSON");
      return { ok: false, value: null };
    }
    return { ok: true, value };
  }
  if (typeof value !== "object") {
    sink.add(path, "DATA_NOT_JSON", `valor do tipo ${typeof value} não é JSON`);
    return { ok: false, value: null };
  }
  if (depth > SCENE_DOCUMENT_LIMITS.maxDataDepth) {
    sink.add(path, "DATA_TOO_DEEP", `profundidade máxima de data é ${String(SCENE_DOCUMENT_LIMITS.maxDataDepth)}`);
    return { ok: false, value: null };
  }
  if (seen.has(value)) {
    sink.add(path, "DATA_NOT_JSON", "referência circular");
    return { ok: false, value: null };
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const out: unknown[] = [];
    let ok = true;
    for (let i = 0; i < value.length; i += 1) {
      const child = cloneJson(value[i], join(path, i), depth + 1, seen, sink);
      ok = ok && child.ok;
      out.push(child.value);
    }
    seen.delete(value);
    return { ok, value: out };
  }
  if (!isPlainObject(value)) {
    sink.add(path, "DATA_NOT_JSON", "objeto não-plano (classe, Date, Map...) não é JSON");
    return { ok: false, value: null };
  }
  seen.add(value);
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const key of Object.keys(value)) {
    const child = cloneJson(value[key], join(path, key), depth + 1, seen, sink);
    ok = ok && child.ok;
    out[key] = child.value;
  }
  seen.delete(value);
  return { ok, value: out };
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function checkDataSize(data: Record<string, unknown>, path: string, sink: ErrorSink): boolean {
  const size = utf8Length(JSON.stringify(data));
  if (size > SCENE_DOCUMENT_LIMITS.maxDataBytes) {
    sink.add(path, "DATA_TOO_LARGE", `data tem ${String(size)} bytes; máximo ${String(SCENE_DOCUMENT_LIMITS.maxDataBytes)}`);
    return false;
  }
  return true;
}

function checkData(value: unknown, path: string, sink: ErrorSink): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    sink.add(path, "NOT_OBJECT", "data deveria ser objeto JSON");
    return null;
  }
  const cloned = cloneJson(value, path, 1, new Set(), sink);
  if (!cloned.ok) return null;
  const data = cloned.value as Record<string, unknown>;
  return checkDataSize(data, path, sink) ? data : null;
}

function checkAssets(
  value: unknown,
  path: string,
  sink: ErrorSink,
  assetExists: ValidateSceneDocumentOptions["assetExists"],
): SceneDocumentAsset[] | null {
  if (!Array.isArray(value)) {
    sink.add(path, "INVALID_TYPE", "assets deveria ser lista");
    return null;
  }
  const before = sink.count;
  const seen = new Set<string>();
  const out: SceneDocumentAsset[] = [];
  value.forEach((raw: unknown, index) => {
    const assetPath = join(path, index);
    if (!isPlainObject(raw)) {
      sink.add(assetPath, "NOT_OBJECT", "asset deveria ser objeto { id, url, type }");
      return;
    }
    checkUnknownKeys(raw, ASSET_KEYS, assetPath, sink);
    const id = checkId(raw["id"], join(assetPath, "id"), sink, true);
    let url: string | null = null;
    const rawUrl = raw["url"];
    if (rawUrl === undefined) sink.add(join(assetPath, "url"), "REQUIRED", "campo obrigatório");
    else if (typeof rawUrl !== "string") sink.add(join(assetPath, "url"), "INVALID_TYPE", "deveria ser string");
    else if (rawUrl.length === 0 || rawUrl.length > SCENE_DOCUMENT_LIMITS.maxUrlLength) sink.add(join(assetPath, "url"), "INVALID_URL", "url vazia ou longa demais");
    else url = rawUrl;
    let type: SceneDocumentAssetType | null = null;
    const rawType = raw["type"];
    if (rawType === undefined) sink.add(join(assetPath, "type"), "REQUIRED", "campo obrigatório");
    else if (typeof rawType !== "string" || !ASSET_TYPES.has(rawType)) sink.add(join(assetPath, "type"), "INVALID_ASSET_TYPE", "type deve ser gltf, texture ou audio");
    else type = rawType as SceneDocumentAssetType;
    if (id !== null) {
      if (seen.has(id)) sink.add(join(assetPath, "id"), "DUPLICATE_ASSET_ID", `asset '${id}' repetido`);
      seen.add(id);
    }
    if (id === null || url === null || type === null) return;
    const asset: SceneDocumentAsset = { id, url, type };
    if (assetExists !== undefined) {
      let exists = false;
      try {
        exists = assetExists(asset);
      } catch {
        exists = false;
      }
      if (!exists) sink.add(join(assetPath, "url"), "ASSET_NOT_FOUND", `asset '${id}' não encontrado em '${url}'`);
    }
    out.push(asset);
  });
  return sink.count === before ? out : null;
}

function checkTypeName(value: unknown, path: string, sink: ErrorSink): string | null | undefined {
  if (value === undefined) return undefined;
  return checkId(value, path, sink, false);
}

function checkHeader(
  raw: Record<string, unknown>,
  format: string,
  sink: ErrorSink,
  path: string,
): void {
  if (raw["format"] === undefined) sink.add(join(path, "format"), "REQUIRED", `format deve ser "${format}"`);
  else if (raw["format"] !== format) sink.add(join(path, "format"), "INVALID_FORMAT", `format deve ser "${format}"`);
  if (raw["version"] === undefined) sink.add(join(path, "version"), "REQUIRED", "version deve ser 1");
  else if (raw["version"] !== SCENE_DOCUMENT_VERSION) sink.add(join(path, "version"), "UNSUPPORTED_VERSION", `versão não suportada: ${String(raw["version"])} (esperado 1)`);
}

/* ============================================================================
 * PREFAB
 * ========================================================================== */

function validatePrefabInto(
  doc: unknown,
  path: string,
  sink: ErrorSink,
  assetExists: ValidateSceneDocumentOptions["assetExists"],
): PrefabDocument | null {
  if (!isPlainObject(doc)) {
    sink.add(path, "NOT_OBJECT", "PrefabDocument deveria ser objeto");
    return null;
  }
  const before = sink.count;
  checkHeader(doc, PREFAB_DOCUMENT_FORMAT, sink, path);
  checkUnknownKeys(doc, PREFAB_KEYS, path, sink);
  const prefabId = checkId(doc["prefabId"], join(path, "prefabId"), sink, true);
  const type = checkTypeName(doc["type"], join(path, "type"), sink);
  const tags = doc["tags"] === undefined ? undefined : checkTags(doc["tags"], join(path, "tags"), sink);
  const data = doc["data"] === undefined ? undefined : checkData(doc["data"], join(path, "data"), sink);
  const assets = doc["assets"] === undefined ? undefined : checkAssets(doc["assets"], join(path, "assets"), sink, assetExists);
  if (sink.count !== before || prefabId === null) return null;
  return {
    format: PREFAB_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    prefabId,
    ...(typeof type === "string" ? { type } : {}),
    ...(tags ? { tags } : {}),
    ...(data ? { data } : {}),
    ...(assets ? { assets } : {}),
  };
}

/** Valida um PrefabDocument v1. Nunca lança. */
export function validatePrefabDocument(
  doc: unknown,
  options: Pick<ValidateSceneDocumentOptions, "assetExists"> = {},
): SceneDocumentValidation<PrefabDocument> {
  const sink = new ErrorSink();
  const value = validatePrefabInto(doc, "", sink, options.assetExists);
  return value === null || sink.count > 0 ? { ok: false, errors: sink.errors } : { ok: true, value };
}

/** Normaliza a coleção de prefabs em mapa `prefabId → doc` (sem validar). */
export function toPrefabMap(prefabs: PrefabCollection | undefined): Map<string, PrefabDocument> {
  const map = new Map<string, PrefabDocument>();
  if (prefabs === undefined) return map;
  if (Array.isArray(prefabs)) {
    for (const prefab of prefabs as ReadonlyArray<PrefabDocument>) map.set(prefab.prefabId, prefab);
  } else {
    for (const [key, prefab] of Object.entries(prefabs as Readonly<Record<string, PrefabDocument>>)) map.set(key, prefab);
  }
  return map;
}

function validatePrefabCollection(
  prefabs: unknown,
  sink: ErrorSink,
  assetExists: ValidateSceneDocumentOptions["assetExists"],
): Map<string, PrefabDocument> | null {
  const before = sink.count;
  const map = new Map<string, PrefabDocument>();
  if (Array.isArray(prefabs)) {
    prefabs.forEach((raw: unknown, index) => {
      const path = `prefabs[${String(index)}]`;
      const prefab = validatePrefabInto(raw, path, sink, assetExists);
      if (prefab === null) return;
      if (map.has(prefab.prefabId)) sink.add(join(path, "prefabId"), "DUPLICATE_PREFAB_ID", `prefab '${prefab.prefabId}' repetido`);
      else map.set(prefab.prefabId, prefab);
    });
  } else if (isPlainObject(prefabs)) {
    for (const [key, raw] of Object.entries(prefabs)) {
      const path = `prefabs.${key}`;
      const prefab = validatePrefabInto(raw, path, sink, assetExists);
      if (prefab === null) continue;
      if (prefab.prefabId !== key) sink.add(join(path, "prefabId"), "PREFAB_ID_MISMATCH", `chave '${key}' ≠ prefabId '${prefab.prefabId}'`);
      else map.set(key, prefab);
    }
  } else {
    sink.add("prefabs", "INVALID_TYPE", "prefabs deveria ser mapa { prefabId: doc } ou lista");
  }
  return sink.count === before ? map : null;
}

/* ============================================================================
 * CENA
 * ========================================================================== */

function validateEntity(
  raw: unknown,
  path: string,
  sink: ErrorSink,
): SceneDocumentEntity | null {
  if (!isPlainObject(raw)) {
    sink.add(path, "NOT_OBJECT", "entidade deveria ser objeto");
    return null;
  }
  const before = sink.count;
  checkUnknownKeys(raw, ENTITY_KEYS, path, sink);
  const id = checkId(raw["id"], join(path, "id"), sink, true);
  const type = checkTypeName(raw["type"], join(path, "type"), sink);
  const prefab = raw["prefab"] === undefined ? undefined : checkId(raw["prefab"], join(path, "prefab"), sink, false);
  const position = raw["position"] === undefined ? undefined : checkVector(raw["position"], join(path, "position"), sink);
  const rotation = raw["rotation"] === undefined ? undefined : checkQuaternion(raw["rotation"], join(path, "rotation"), sink);
  const scale = raw["scale"] === undefined ? undefined : checkScale(raw["scale"], join(path, "scale"), sink);
  const tags = raw["tags"] === undefined ? undefined : checkTags(raw["tags"], join(path, "tags"), sink);
  const data = raw["data"] === undefined ? undefined : checkData(raw["data"], join(path, "data"), sink);
  if (sink.count !== before || id === null) return null;
  return {
    id,
    ...(typeof type === "string" ? { type } : {}),
    ...(typeof prefab === "string" ? { prefab } : {}),
    ...(position ? { position } : {}),
    ...(rotation ? { rotation } : {}),
    ...(scale ? { scale } : {}),
    ...(tags ? { tags } : {}),
    ...(data ? { data } : {}),
  };
}

function validateBounds(raw: unknown, sink: ErrorSink): SceneDocumentBounds | null {
  const path = "worldBounds";
  if (!isPlainObject(raw)) {
    sink.add(path, "NOT_OBJECT", "worldBounds deveria ser { min, max }");
    return null;
  }
  checkUnknownKeys(raw, BOUNDS_KEYS, path, sink);
  const min = raw["min"] === undefined ? (sink.add(join(path, "min"), "REQUIRED", "campo obrigatório"), null) : checkVector(raw["min"], join(path, "min"), sink);
  const max = raw["max"] === undefined ? (sink.add(join(path, "max"), "REQUIRED", "campo obrigatório"), null) : checkVector(raw["max"], join(path, "max"), sink);
  if (min === null || max === null) return null;
  for (const axis of ["x", "y", "z"] as const) {
    if (min[axis] > max[axis]) {
      sink.add(join(path, axis), "INVALID_BOUNDS", `min.${axis} > max.${axis}`);
      return null;
    }
  }
  return { min, max };
}

/**
 * Valida um SceneDocument v1 (e, se `prefabs` vier, os prefabs e as
 * referências `entity.prefab`, inclusive o tamanho do `data` mesclado). Nunca
 * lança. Em sucesso, `value` é uma cópia normalizada (quaternions
 * normalizados, `data` clonado).
 */
export function validateSceneDocument(
  doc: unknown,
  options: ValidateSceneDocumentOptions = {},
): SceneDocumentValidation<SceneDocument> {
  const sink = new ErrorSink();
  if (!isPlainObject(doc)) {
    sink.add("", "NOT_OBJECT", "SceneDocument deveria ser objeto");
    return { ok: false, errors: sink.errors };
  }
  checkHeader(doc, SCENE_DOCUMENT_FORMAT, sink, "");
  checkUnknownKeys(doc, SCENE_KEYS, "", sink);
  const sceneId = checkId(doc["sceneId"], "sceneId", sink, true);

  let sceneName: string | null = null;
  const rawName = doc["sceneName"];
  if (rawName === undefined) sink.add("sceneName", "REQUIRED", "campo obrigatório");
  else if (typeof rawName !== "string") sink.add("sceneName", "INVALID_TYPE", "deveria ser string");
  else if (rawName.trim().length === 0 || rawName.length > SCENE_DOCUMENT_LIMITS.maxNameLength) sink.add("sceneName", "INVALID_NAME", `sceneName deve ter 1–${String(SCENE_DOCUMENT_LIMITS.maxNameLength)} caracteres`);
  else sceneName = rawName;

  const assets = doc["assets"] === undefined ? [] : checkAssets(doc["assets"], "assets", sink, options.assetExists);
  const worldBounds = doc["worldBounds"] === undefined ? undefined : validateBounds(doc["worldBounds"], sink);

  const prefabMap = options.prefabs === undefined ? null : validatePrefabCollection(options.prefabs, sink, options.assetExists);

  const entities: SceneDocumentEntity[] = [];
  const rawEntities = doc["entities"];
  if (rawEntities === undefined) sink.add("entities", "REQUIRED", "campo obrigatório (pode ser [])");
  else if (!Array.isArray(rawEntities)) sink.add("entities", "INVALID_TYPE", "entities deveria ser lista");
  else if (rawEntities.length > SCENE_DOCUMENT_LIMITS.maxEntities) {
    sink.add("entities", "TOO_MANY_ENTITIES", `${String(rawEntities.length)} entidades; máximo ${String(SCENE_DOCUMENT_LIMITS.maxEntities)}`);
  } else {
    const seenIds = new Set<string>();
    rawEntities.forEach((raw: unknown, index) => {
      const path = `entities[${String(index)}]`;
      const entity = validateEntity(raw, path, sink);
      const rawId = isPlainObject(raw) ? raw["id"] : undefined;
      if (typeof rawId === "string" && rawId.length > 0) {
        if (seenIds.has(rawId)) sink.add(join(path, "id"), "DUPLICATE_ENTITY_ID", `entidade '${rawId}' repetida`);
        seenIds.add(rawId);
      }
      if (entity === null) return;
      if (entity.prefab !== undefined && options.prefabs !== undefined && prefabMap !== null) {
        const prefab = prefabMap.get(entity.prefab);
        if (prefab === undefined) {
          sink.add(join(path, "prefab"), "UNKNOWN_PREFAB", `prefab '${entity.prefab}' não existe`);
          return;
        }
        if (prefab.data !== undefined && entity.data !== undefined) {
          checkDataSize({ ...prefab.data, ...entity.data }, join(path, "data"), sink);
        }
      }
      entities.push(entity);
    });
  }

  // Assets de prefab com o mesmo id de um asset da cena precisam ser iguais.
  if (assets !== null && prefabMap !== null) {
    const byId = new Map(assets.map((a) => [a.id, a] as const));
    for (const prefab of prefabMap.values()) {
      (prefab.assets ?? []).forEach((asset, index) => {
        const other = byId.get(asset.id);
        if (other !== undefined && (other.url !== asset.url || other.type !== asset.type)) {
          sink.add(`prefabs.${prefab.prefabId}.assets[${String(index)}].id`, "ASSET_CONFLICT", `asset '${asset.id}' difere do declarado em outro documento`);
        } else if (other === undefined) {
          byId.set(asset.id, asset);
        }
      });
    }
  }

  if (sink.count > 0 || sceneId === null || sceneName === null || assets === null) {
    return { ok: false, errors: sink.errors };
  }
  return {
    ok: true,
    value: {
      format: SCENE_DOCUMENT_FORMAT,
      version: SCENE_DOCUMENT_VERSION,
      sceneId,
      sceneName,
      ...(doc["assets"] !== undefined ? { assets } : {}),
      ...(worldBounds ? { worldBounds } : {}),
      entities,
    },
  };
}

/* ============================================================================
 * RESOLUÇÃO (prefab → entidade)
 * ========================================================================== */

function cloneData(data: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return data === undefined ? {} : (JSON.parse(JSON.stringify(data)) as Record<string, unknown>);
}

/**
 * Aplica os prefabs às entidades de uma cena JÁ VALIDADA. Regras: campos da
 * entidade sobrescrevem os do prefab; `tags` = união (prefab primeiro, sem
 * repetição); `data` = merge raso (entidade vence); `assets` = assets do
 * prefab. Lança `RangeError` se um prefab referenciado não existir.
 */
export function resolveSceneEntities(
  scene: SceneDocument,
  prefabs?: PrefabCollection,
): ResolvedSceneEntity[] {
  const map = toPrefabMap(prefabs);
  return scene.entities.map((entity): ResolvedSceneEntity => {
    let prefab: PrefabDocument | undefined;
    if (entity.prefab !== undefined) {
      prefab = map.get(entity.prefab);
      if (prefab === undefined) throw new RangeError(`prefab '${entity.prefab}' não existe (entidade '${entity.id}')`);
    }
    const tags: string[] = [];
    for (const tag of [...(prefab?.tags ?? []), ...(entity.tags ?? [])]) {
      if (!tags.includes(tag)) tags.push(tag);
    }
    const position = entity.position ?? { x: 0, y: 0, z: 0 };
    const rotation = entity.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const scale = entity.scale ?? { x: 1, y: 1, z: 1 };
    return {
      id: entity.id,
      type: entity.type ?? prefab?.type ?? DEFAULT_SCENE_ENTITY_TYPE,
      prefab: entity.prefab ?? null,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      scale: { x: scale.x, y: scale.y, z: scale.z },
      tags,
      data: { ...cloneData(prefab?.data), ...cloneData(entity.data) },
      assets: (prefab?.assets ?? []).map((a) => ({ ...a })),
    };
  });
}

/**
 * Assets a pré-carregar: os da cena + os dos prefabs USADOS (união por id; o
 * primeiro declarado vence — conflitos já são erro de validação).
 */
export function collectSceneAssets(
  scene: SceneDocument,
  prefabs?: PrefabCollection,
): SceneDocumentAsset[] {
  const map = toPrefabMap(prefabs);
  const out = new Map<string, SceneDocumentAsset>();
  for (const asset of scene.assets ?? []) if (!out.has(asset.id)) out.set(asset.id, { ...asset });
  for (const entity of scene.entities) {
    if (entity.prefab === undefined) continue;
    for (const asset of map.get(entity.prefab)?.assets ?? []) if (!out.has(asset.id)) out.set(asset.id, { ...asset });
  }
  return [...out.values()];
}

/** Mapeia uma entidade resolvida para a entrada de `WorldApi.spawnEntity`. */
export function toEntitySpawnInput(entity: ResolvedSceneEntity): SceneDocumentSpawnInput {
  return {
    entityId: entity.id,
    type: entity.type,
    position: entity.position,
    rotation: entity.rotation,
    scale: entity.scale,
    tags: entity.tags,
    customData: entity.data,
  };
}
