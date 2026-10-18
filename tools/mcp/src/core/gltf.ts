/**
 * Leitura de glTF 2.0 / GLB SEM dependências (T8, SPEC §3.5).
 *
 * - `parseGlb(buf)`: cabeçalho (magic `glTF`, versão 2, comprimento) e chunks
 *   (JSON obrigatório primeiro, BIN opcional, desconhecidos ignorados), com
 *   checagem de limites — nunca lê além do buffer; malformado → erro estruturado.
 * - `parseGltfJson(text)`: JSON de um `.gltf`.
 * - `inspectGltf(json, opts)`: resumo (nós, malhas com nº de primitivas e
 *   triângulos, materiais, texturas/imagens, animações com nº de canais e
 *   duração, skins, extensões, caixa envolvente) + problemas estruturais
 *   (índices fora do intervalo, bufferView além do buffer, BIN ausente...).
 *
 * Puro: não acessa o disco. Quem chama confere URIs externas (`externalUris`).
 * Triângulos: `count` do accessor de `indices` (ou de `POSITION`) — modo 4
 * (TRIANGLES) = count/3, 5/6 (STRIP/FAN) = count−2, pontos/linhas = 0.
 * Caixa envolvente: união de `min`/`max` dos accessors POSITION, SEM aplicar
 * as transformações dos nós (aproximação no espaço da malha).
 */

export const GLB_MAGIC = 0x46546c67; // "glTF"
export const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON"
export const GLB_CHUNK_BIN = 0x004e4942; // "BIN\0"
const MAX_ISSUES = 200;

export type GltfSeverity = "error" | "warning";

export interface GltfIssue {
  readonly severity: GltfSeverity;
  readonly code: string;
  readonly message: string;
  /** Caminho JSON (ex.: `meshes[0].primitives[1].indices`). */
  readonly path?: string;
}

export interface GlbChunk {
  readonly type: "JSON" | "BIN" | "unknown";
  readonly typeCode: number;
  readonly offset: number;
  readonly length: number;
}

export interface GlbParsed {
  readonly ok: true;
  readonly version: number;
  readonly declaredLength: number;
  readonly fileLength: number;
  readonly chunks: readonly GlbChunk[];
  readonly json: unknown;
  readonly bin: Uint8Array | null;
  readonly issues: readonly GltfIssue[];
}

export type GltfParseErrorCode = "NOT_GLB" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "BAD_LENGTH" | "BAD_CHUNK" | "NO_JSON_CHUNK" | "INVALID_JSON";

export interface GltfParseError {
  readonly ok: false;
  readonly code: GltfParseErrorCode;
  readonly message: string;
}

function u32le(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 4 <= buf.length ? (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16)) + ((buf[o + 3]! << 24) >>> 0) : null;
}

export function isGlb(buf: Uint8Array): boolean {
  return u32le(buf, 0) === GLB_MAGIC;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Só cabeçalho + chunk JSON (para ler arquivos grandes aos pedaços). */
export function readGlbHeader(buf: Uint8Array): { ok: true; version: number; length: number; jsonLength: number | null } | GltfParseError {
  if (buf.length < 12) return { ok: false, code: "TRUNCATED", message: "GLB menor que o cabeçalho (12 bytes)" };
  if (u32le(buf, 0) !== GLB_MAGIC) return { ok: false, code: "NOT_GLB", message: "magic 'glTF' ausente" };
  const version = u32le(buf, 4)!;
  const length = u32le(buf, 8)!;
  const jsonLength = buf.length >= 20 && u32le(buf, 16) === GLB_CHUNK_JSON ? u32le(buf, 12) : null;
  return { ok: true, version, length, jsonLength };
}

/**
 * Analisa um GLB inteiro. `buf` pode ser só o começo do arquivo (cabeçalho +
 * chunk JSON) quando `fileLength` é informado: o BIN fica `null` e o
 * comprimento é conferido contra `fileLength`.
 */
export function parseGlb(buf: Uint8Array, fileLength: number = buf.length): GlbParsed | GltfParseError {
  const head = readGlbHeader(buf);
  if (!head.ok) return head;
  if (head.version !== 2) return { ok: false, code: "UNSUPPORTED_VERSION", message: `versão GLB ${String(head.version)} (só 2 é suportada)` };
  const issues: GltfIssue[] = [];
  if (head.length !== fileLength) {
    if (head.length > fileLength) {
      return { ok: false, code: "BAD_LENGTH", message: `cabeçalho declara ${String(head.length)} bytes mas o arquivo tem ${String(fileLength)} (truncado?)` };
    }
    issues.push({ severity: "warning", code: "GLB_TRAILING_BYTES", message: `arquivo tem ${String(fileLength - head.length)} byte(s) após o fim declarado` });
  }
  if (head.length < 20) return { ok: false, code: "BAD_LENGTH", message: "GLB sem espaço para o chunk JSON" };
  const limit = Math.min(head.length, buf.length);
  const chunks: GlbChunk[] = [];
  let json: unknown;
  let jsonSeen = false;
  let bin: Uint8Array | null = null;
  let offset = 12;
  while (offset < head.length) {
    if (offset + 8 > head.length) return { ok: false, code: "BAD_CHUNK", message: `cabeçalho de chunk incompleto no offset ${String(offset)}` };
    if (offset + 8 > buf.length) break; // leitura parcial: o resto não foi carregado
    const length = u32le(buf, offset)!;
    const typeCode = u32le(buf, offset + 4)!;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > head.length) return { ok: false, code: "BAD_CHUNK", message: `chunk no offset ${String(offset)} (${String(length)} bytes) passa do fim do GLB` };
    const type: GlbChunk["type"] = typeCode === GLB_CHUNK_JSON ? "JSON" : typeCode === GLB_CHUNK_BIN ? "BIN" : "unknown";
    chunks.push({ type, typeCode, offset, length });
    if (length % 4 !== 0) issues.push({ severity: "warning", code: "GLB_CHUNK_ALIGNMENT", message: `chunk ${type} com ${String(length)} bytes (deveria ser múltiplo de 4)` });
    if (chunks.length === 1 && type !== "JSON") return { ok: false, code: "NO_JSON_CHUNK", message: "o primeiro chunk do GLB deveria ser JSON" };
    if (type === "JSON") {
      if (jsonSeen) return { ok: false, code: "BAD_CHUNK", message: "mais de um chunk JSON" };
      jsonSeen = true;
      if (dataEnd > limit) return { ok: false, code: "TRUNCATED", message: "chunk JSON incompleto" };
      try {
        json = JSON.parse(decodeUtf8(buf.subarray(dataStart, dataEnd)).replace(/[\u0000 ]+$/u, ""));
      } catch (error) {
        return { ok: false, code: "INVALID_JSON", message: `chunk JSON inválido: ${(error as Error).message}` };
      }
    } else if (type === "BIN") {
      if (bin !== null || chunks.length !== 2) issues.push({ severity: "error", code: "GLB_BIN_POSITION", message: "o chunk BIN deve ser único e o segundo" });
      if (dataEnd <= buf.length) bin = buf.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  if (!jsonSeen) return { ok: false, code: "NO_JSON_CHUNK", message: "GLB sem chunk JSON" };
  return {
    ok: true,
    version: head.version,
    declaredLength: head.length,
    fileLength,
    chunks,
    json,
    bin,
    issues,
  };
}

export function parseGltfJson(text: string): { ok: true; json: unknown } | GltfParseError {
  try {
    return { ok: true, json: JSON.parse(text.replace(/^﻿/u, "")) };
  } catch (error) {
    return { ok: false, code: "INVALID_JSON", message: `JSON inválido: ${(error as Error).message}` };
  }
}

/* ============================================================================
 * Resumo + validação estrutural
 * ========================================================================== */

export interface GltfMeshSummary {
  readonly index: number;
  readonly name: string | null;
  readonly primitives: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface GltfAnimationSummary {
  readonly index: number;
  readonly name: string | null;
  readonly channels: number;
  readonly samplers: number;
  /** Segundos (maior `max` dos accessors de entrada), ou `null` se ausente. */
  readonly duration: number | null;
}

export interface GltfUriRef {
  readonly kind: "buffer" | "image";
  readonly index: number;
  readonly uri: string;
}

export interface GltfSummary {
  readonly container: "glb" | "gltf";
  readonly assetVersion: string | null;
  readonly generator: string | null;
  readonly scenes: number;
  readonly nodes: number;
  readonly meshes: readonly GltfMeshSummary[];
  readonly totals: { readonly triangles: number; readonly vertices: number; readonly primitives: number };
  readonly materials: ReadonlyArray<{ readonly index: number; readonly name: string | null }>;
  readonly textures: number;
  readonly images: ReadonlyArray<{ readonly index: number; readonly name: string | null; readonly uri: string | null; readonly mimeType: string | null; readonly bufferView: number | null }>;
  readonly samplers: number;
  readonly animations: readonly GltfAnimationSummary[];
  readonly skins: ReadonlyArray<{ readonly index: number; readonly name: string | null; readonly joints: number }>;
  readonly buffers: ReadonlyArray<{ readonly index: number; readonly byteLength: number | null; readonly source: "glb-bin" | "data-uri" | "external" | "missing" }>;
  readonly extensionsUsed: readonly string[];
  readonly extensionsRequired: readonly string[];
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | null;
  /** URIs externas (não `data:`) a conferir no disco, relativas ao arquivo. */
  readonly externalUris: readonly GltfUriRef[];
  readonly issues: readonly GltfIssue[];
}

export interface InspectGltfOptions {
  readonly container: "glb" | "gltf";
  /** Tamanho do chunk BIN (GLB), `null` se não houver; `undefined` = desconhecido (leitura parcial). */
  readonly binLength?: number | null;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function nonNegInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function finiteArray3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out = v.slice(0, 3);
  return out.every((n) => typeof n === "number" && Number.isFinite(n)) ? (out as [number, number, number]) : null;
}

/** Tamanho decodificado (bytes) de um `data:...;base64,` (ou `null` se não for base64). */
export function dataUriByteLength(uri: string): number | null {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) return null;
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return decodeURIComponentSafe(payload)?.length ?? null;
  const clean = payload.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function decodeURIComponentSafe(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

const COMPONENT_SIZES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/** Analisa o JSON glTF. Nunca lança. */
export function inspectGltf(json: unknown, options: InspectGltfOptions): GltfSummary {
  const issues: GltfIssue[] = [];
  const issue = (severity: GltfSeverity, code: string, message: string, path?: string): void => {
    if (issues.length >= MAX_ISSUES) return;
    issues.push({ severity, code, message, ...(path !== undefined ? { path } : {}) });
  };
  const root: Obj = isObj(json) ? json : {};
  if (!isObj(json)) issue("error", "GLTF_NOT_OBJECT", "o JSON glTF deveria ser um objeto");

  const asset = isObj(root["asset"]) ? root["asset"] : null;
  const assetVersion = asset ? str(asset["version"]) : null;
  if (asset === null) issue("error", "GLTF_NO_ASSET", "campo 'asset' obrigatório ausente", "asset");
  else if (assetVersion === null || !/^2\.\d+$/.test(assetVersion)) issue("error", "GLTF_VERSION", `asset.version '${String(assetVersion)}' (esperado 2.x)`, "asset.version");

  const arr = (key: string): unknown[] => {
    const v = root[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      issue("error", "GLTF_NOT_ARRAY", `'${key}' deveria ser lista`, key);
      return [];
    }
    return v;
  };
  const accessors = arr("accessors");
  const bufferViews = arr("bufferViews");
  const buffers = arr("buffers");
  const nodes = arr("nodes");
  const meshes = arr("meshes");
  const materials = arr("materials");
  const textures = arr("textures");
  const images = arr("images");
  const samplers = arr("samplers");
  const animations = arr("animations");
  const skins = arr("skins");
  const scenes = arr("scenes");

  const ref = (value: unknown, list: unknown[], what: string, path: string, required = false): Obj | null => {
    if (value === undefined) {
      if (required) issue("error", "GLTF_REQUIRED", `${what} obrigatório ausente`, path);
      return null;
    }
    const idx = nonNegInt(value);
    if (idx === null || idx >= list.length) {
      issue("error", "GLTF_BAD_INDEX", `${what} ${JSON.stringify(value)} fora do intervalo (há ${String(list.length)})`, path);
      return null;
    }
    const target = list[idx];
    return isObj(target) ? target : null;
  };

  // Buffers
  const externalUris: GltfUriRef[] = [];
  const bufferLengths: Array<number | null> = [];
  const bufferSummaries: Array<GltfSummary["buffers"][number]> = [];
  buffers.forEach((raw, i) => {
    const path = `buffers[${String(i)}]`;
    const b = isObj(raw) ? raw : {};
    const byteLength = nonNegInt(b["byteLength"]);
    if (byteLength === null) issue("error", "GLTF_REQUIRED", "byteLength inválido ou ausente", `${path}.byteLength`);
    const uri = str(b["uri"]);
    let source: GltfSummary["buffers"][number]["source"];
    if (uri === null) {
      if (options.container === "glb" && i === 0) {
        source = "glb-bin";
        if (options.binLength === null) issue("error", "GLB_BIN_MISSING", "buffers[0] sem uri exige o chunk BIN do GLB", path);
        else if (options.binLength !== undefined && byteLength !== null && byteLength > options.binLength) {
          issue("error", "GLB_BIN_SHORT", `buffers[0].byteLength ${String(byteLength)} > chunk BIN (${String(options.binLength)})`, `${path}.byteLength`);
        }
      } else {
        source = "missing";
        issue("error", "GLTF_BUFFER_NO_URI", "buffer sem uri (só o buffers[0] de um GLB pode omitir)", path);
      }
    } else if (uri.startsWith("data:")) {
      source = "data-uri";
      const decoded = dataUriByteLength(uri);
      if (decoded === null) issue("error", "GLTF_DATA_URI", "data URI inválida", `${path}.uri`);
      else if (byteLength !== null && decoded < byteLength) issue("error", "GLTF_DATA_URI_SHORT", `data URI com ${String(decoded)} bytes < byteLength ${String(byteLength)}`, `${path}.uri`);
    } else {
      source = "external";
      externalUris.push({ kind: "buffer", index: i, uri });
    }
    bufferLengths.push(byteLength);
    bufferSummaries.push({ index: i, byteLength, source });
  });

  // BufferViews
  bufferViews.forEach((raw, i) => {
    const path = `bufferViews[${String(i)}]`;
    const v = isObj(raw) ? raw : {};
    const bufferIdx = nonNegInt(v["buffer"]);
    ref(v["buffer"], buffers, "buffer", `${path}.buffer`, true);
    const byteLength = nonNegInt(v["byteLength"]);
    if (byteLength === null) issue("error", "GLTF_REQUIRED", "byteLength inválido ou ausente", `${path}.byteLength`);
    const byteOffset = v["byteOffset"] === undefined ? 0 : nonNegInt(v["byteOffset"]);
    if (byteOffset === null) issue("error", "GLTF_BAD_OFFSET", "byteOffset inválido", `${path}.byteOffset`);
    const bufLen = bufferIdx !== null ? bufferLengths[bufferIdx] : null;
    if (bufLen !== null && bufLen !== undefined && byteLength !== null && byteOffset !== null && byteOffset + byteLength > bufLen) {
      issue("error", "GLTF_VIEW_OUT_OF_BOUNDS", `bufferView termina em ${String(byteOffset + byteLength)} > buffer ${String(bufLen)}`, path);
    }
  });

  // Accessors
  accessors.forEach((raw, i) => {
    const path = `accessors[${String(i)}]`;
    const a = isObj(raw) ? raw : {};
    const count = nonNegInt(a["count"]);
    if (count === null || count === 0) issue("error", "GLTF_REQUIRED", "count inválido ou ausente (≥ 1)", `${path}.count`);
    const componentSize = COMPONENT_SIZES[a["componentType"] as number];
    if (componentSize === undefined) issue("error", "GLTF_COMPONENT_TYPE", `componentType ${JSON.stringify(a["componentType"])} inválido`, `${path}.componentType`);
    const components = TYPE_COMPONENTS[a["type"] as string];
    if (components === undefined) issue("error", "GLTF_ACCESSOR_TYPE", `type ${JSON.stringify(a["type"])} inválido`, `${path}.type`);
    const view = ref(a["bufferView"], bufferViews, "bufferView", `${path}.bufferView`);
    if (view && count && componentSize && components) {
      const viewLength = nonNegInt(view["byteLength"]);
      const offset = a["byteOffset"] === undefined ? 0 : nonNegInt(a["byteOffset"]) ?? 0;
      const elementSize = componentSize * components;
      const stride = nonNegInt(view["byteStride"]) ?? elementSize;
      const needed = offset + stride * (count - 1) + elementSize;
      if (viewLength !== null && needed > viewLength) {
        issue("error", "GLTF_ACCESSOR_OUT_OF_BOUNDS", `accessor precisa de ${String(needed)} bytes; bufferView tem ${String(viewLength)}`, path);
      }
    }
  });

  const accessorCount = (value: unknown): number | null => {
    const idx = nonNegInt(value);
    if (idx === null || idx >= accessors.length) return null;
    const a = accessors[idx];
    return isObj(a) ? nonNegInt(a["count"]) : null;
  };

  // Meshes
  let totalTriangles = 0;
  let totalVertices = 0;
  let totalPrimitives = 0;
  let boundsMin: [number, number, number] | null = null;
  let boundsMax: [number, number, number] | null = null;
  const meshSummaries: GltfMeshSummary[] = meshes.map((raw, i) => {
    const path = `meshes[${String(i)}]`;
    const m = isObj(raw) ? raw : {};
    const prims = Array.isArray(m["primitives"]) ? m["primitives"] : [];
    if (!Array.isArray(m["primitives"]) || prims.length === 0) issue("error", "GLTF_REQUIRED", "malha sem primitives", `${path}.primitives`);
    let triangles = 0;
    let vertices = 0;
    prims.forEach((rawPrim, p) => {
      const ppath = `${path}.primitives[${String(p)}]`;
      const prim = isObj(rawPrim) ? rawPrim : {};
      const attributes = isObj(prim["attributes"]) ? prim["attributes"] : null;
      if (attributes === null) {
        issue("error", "GLTF_REQUIRED", "primitive sem attributes", `${ppath}.attributes`);
        return;
      }
      for (const [name, value] of Object.entries(attributes)) ref(value, accessors, `accessor do atributo ${name}`, `${ppath}.attributes.${name}`, true);
      if (prim["indices"] !== undefined) ref(prim["indices"], accessors, "accessor de indices", `${ppath}.indices`);
      if (prim["material"] !== undefined) ref(prim["material"], materials, "material", `${ppath}.material`);
      const positionCount = accessorCount(attributes["POSITION"]);
      if (attributes["POSITION"] === undefined) issue("warning", "GLTF_NO_POSITION", "primitive sem POSITION", `${ppath}.attributes`);
      vertices += positionCount ?? 0;
      const posIdx = nonNegInt(attributes["POSITION"]);
      const posAccessor = posIdx !== null && posIdx < accessors.length && isObj(accessors[posIdx]) ? (accessors[posIdx] as Obj) : null;
      if (posAccessor) {
        const min = finiteArray3(posAccessor["min"]);
        const max = finiteArray3(posAccessor["max"]);
        if (min === null || max === null) issue("warning", "GLTF_POSITION_BOUNDS", "accessor POSITION sem min/max (obrigatórios na spec)", `accessors[${String(posIdx)}]`);
        else {
          boundsMin = boundsMin ? [Math.min(boundsMin[0], min[0]), Math.min(boundsMin[1], min[1]), Math.min(boundsMin[2], min[2])] : [...min];
          boundsMax = boundsMax ? [Math.max(boundsMax[0], max[0]), Math.max(boundsMax[1], max[1]), Math.max(boundsMax[2], max[2])] : [...max];
        }
      }
      const mode = prim["mode"] === undefined ? 4 : nonNegInt(prim["mode"]);
      if (mode === null || mode > 6) issue("error", "GLTF_MODE", `mode ${JSON.stringify(prim["mode"])} inválido`, `${ppath}.mode`);
      const n = prim["indices"] !== undefined ? accessorCount(prim["indices"]) : positionCount;
      if (n !== null && mode !== null) {
        if (mode === 4) triangles += Math.floor(n / 3);
        else if (mode === 5 || mode === 6) triangles += Math.max(0, n - 2);
      }
    });
    totalTriangles += triangles;
    totalVertices += vertices;
    totalPrimitives += prims.length;
    return { index: i, name: str(m["name"]), primitives: prims.length, triangles, vertices };
  });

  // Nodes
  nodes.forEach((raw, i) => {
    const path = `nodes[${String(i)}]`;
    const n = isObj(raw) ? raw : {};
    if (n["mesh"] !== undefined) ref(n["mesh"], meshes, "mesh", `${path}.mesh`);
    if (n["skin"] !== undefined) ref(n["skin"], skins, "skin", `${path}.skin`);
    if (n["camera"] !== undefined) ref(n["camera"], arr("cameras"), "camera", `${path}.camera`);
    if (n["children"] !== undefined) {
      if (!Array.isArray(n["children"])) issue("error", "GLTF_NOT_ARRAY", "children deveria ser lista", `${path}.children`);
      else (n["children"] as unknown[]).forEach((c, k) => ref(c, nodes, "nó filho", `${path}.children[${String(k)}]`));
    }
  });
  scenes.forEach((raw, i) => {
    const s = isObj(raw) ? raw : {};
    if (Array.isArray(s["nodes"])) (s["nodes"] as unknown[]).forEach((c, k) => ref(c, nodes, "nó", `scenes[${String(i)}].nodes[${String(k)}]`));
  });
  if (root["scene"] !== undefined) ref(root["scene"], scenes, "scene", "scene");

  // Textures / images
  textures.forEach((raw, i) => {
    const t = isObj(raw) ? raw : {};
    if (t["source"] !== undefined) ref(t["source"], images, "image", `textures[${String(i)}].source`);
    if (t["sampler"] !== undefined) ref(t["sampler"], samplers, "sampler", `textures[${String(i)}].sampler`);
  });
  const imageSummaries = images.map((raw, i) => {
    const path = `images[${String(i)}]`;
    const img = isObj(raw) ? raw : {};
    const uri = str(img["uri"]);
    const bufferView = img["bufferView"] === undefined ? null : nonNegInt(img["bufferView"]);
    if (img["bufferView"] !== undefined) {
      ref(img["bufferView"], bufferViews, "bufferView", `${path}.bufferView`);
      if (str(img["mimeType"]) === null) issue("error", "GLTF_REQUIRED", "imagem em bufferView exige mimeType", `${path}.mimeType`);
    }
    if (uri === null && img["bufferView"] === undefined) issue("error", "GLTF_IMAGE_SOURCE", "imagem sem uri nem bufferView", path);
    if (uri !== null && !uri.startsWith("data:")) externalUris.push({ kind: "image", index: i, uri });
    return { index: i, name: str(img["name"]), uri: uri !== null && uri.startsWith("data:") ? `${uri.slice(0, 32)}…` : uri, mimeType: str(img["mimeType"]), bufferView };
  });

  // Animations
  const animationSummaries: GltfAnimationSummary[] = animations.map((raw, i) => {
    const path = `animations[${String(i)}]`;
    const a = isObj(raw) ? raw : {};
    const channels = Array.isArray(a["channels"]) ? (a["channels"] as unknown[]) : [];
    const animSamplers = Array.isArray(a["samplers"]) ? (a["samplers"] as unknown[]) : [];
    let duration: number | null = null;
    animSamplers.forEach((rawS, s) => {
      const sp = isObj(rawS) ? rawS : {};
      const input = ref(sp["input"], accessors, "accessor de input", `${path}.samplers[${String(s)}].input`, true);
      ref(sp["output"], accessors, "accessor de output", `${path}.samplers[${String(s)}].output`, true);
      const max = input && Array.isArray(input["max"]) ? (input["max"] as unknown[])[0] : undefined;
      if (typeof max === "number" && Number.isFinite(max)) duration = Math.max(duration ?? 0, max);
      else if (input) issue("warning", "GLTF_ANIMATION_INPUT_MAX", "accessor de input sem max (duração desconhecida)", `${path}.samplers[${String(s)}].input`);
    });
    channels.forEach((rawC, c) => {
      const ch = isObj(rawC) ? rawC : {};
      const cpath = `${path}.channels[${String(c)}]`;
      ref(ch["sampler"], animSamplers, "sampler", `${cpath}.sampler`, true);
      const target = isObj(ch["target"]) ? ch["target"] : null;
      if (target === null) issue("error", "GLTF_REQUIRED", "channel sem target", `${cpath}.target`);
      else if (target["node"] !== undefined) ref(target["node"], nodes, "nó", `${cpath}.target.node`);
    });
    if (channels.length === 0) issue("warning", "GLTF_ANIMATION_EMPTY", "animação sem canais", path);
    return { index: i, name: str(a["name"]), channels: channels.length, samplers: animSamplers.length, duration };
  });

  const skinSummaries = skins.map((raw, i) => {
    const s = isObj(raw) ? raw : {};
    const joints = Array.isArray(s["joints"]) ? (s["joints"] as unknown[]) : [];
    joints.forEach((j, k) => ref(j, nodes, "joint", `skins[${String(i)}].joints[${String(k)}]`));
    if (s["inverseBindMatrices"] !== undefined) ref(s["inverseBindMatrices"], accessors, "accessor", `skins[${String(i)}].inverseBindMatrices`);
    return { index: i, name: str(s["name"]), joints: joints.length };
  });

  const strList = (key: string): string[] => {
    const v = root[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      issue("error", "GLTF_NOT_ARRAY", `'${key}' deveria ser lista de strings`, key);
      return [];
    }
    return v as string[];
  };
  const extensionsUsed = strList("extensionsUsed");
  const extensionsRequired = strList("extensionsRequired");
  for (const ext of extensionsRequired) {
    if (!extensionsUsed.includes(ext)) issue("error", "GLTF_EXTENSION_REQUIRED_NOT_USED", `extensão obrigatória '${ext}' ausente de extensionsUsed`, "extensionsRequired");
  }

  const min = boundsMin as [number, number, number] | null;
  const max = boundsMax as [number, number, number] | null;
  return {
    container: options.container,
    assetVersion,
    generator: asset ? str(asset["generator"]) : null,
    scenes: scenes.length,
    nodes: nodes.length,
    meshes: meshSummaries,
    totals: { triangles: totalTriangles, vertices: totalVertices, primitives: totalPrimitives },
    materials: materials.map((raw, i) => ({ index: i, name: isObj(raw) ? str(raw["name"]) : null })),
    textures: textures.length,
    images: imageSummaries,
    samplers: samplers.length,
    animations: animationSummaries,
    skins: skinSummaries,
    buffers: bufferSummaries,
    extensionsUsed,
    extensionsRequired,
    bounds: min && max ? { min, max } : null,
    externalUris,
    issues,
  };
}
