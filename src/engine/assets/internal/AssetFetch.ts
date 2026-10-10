/** Callback de progresso de bytes (totalBytes = 0 quando desconhecido). */
export type AssetProgressCallback = (loadedBytes: number, totalBytes: number) => void;

export type FetchLike = (input: string) => Promise<Response>;

const FALLBACK_BASE_URL = "http://localhost/";

/** Base usada para resolver URLs relativas (document.baseURI → location → localhost). */
export function resolveDefaultBaseUrl(): string {
  if (typeof document !== "undefined" && typeof document.baseURI === "string" && document.baseURI.length > 0) {
    return document.baseURI;
  }

  const location = (globalThis as { location?: { href?: unknown } }).location;

  if (location !== undefined && typeof location.href === "string" && location.href.length > 0) {
    return location.href;
  }

  return FALLBACK_BASE_URL;
}

/**
 * Chave canônica de um asset: URL absoluta resolvida contra a base, sem
 * fragmento (`./a.png`, `a.png` e `/a.png` na raiz viram a mesma chave).
 */
export function normalizeAssetUrl(url: string, baseUrl: string): string {
  if (typeof url !== "string") {
    throw new RangeError("URL de asset precisa ser string.");
  }

  const trimmed = url.trim();

  if (trimmed.length === 0) {
    throw new RangeError("URL de asset não pode ser vazia.");
  }

  try {
    const resolved = new URL(trimmed, baseUrl);
    resolved.hash = "";
    return resolved.href;
  } catch {
    return trimmed;
  }
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") {
    return (): Promise<Response> =>
      Promise.reject(new Error("fetch indisponível neste ambiente; injete loaders."));
  }

  return (input: string): Promise<Response> => fetch(input);
}

/**
 * Baixa o recurso inteiro reportando progresso real por chunk (stream) e
 * um progresso final com loaded === total.
 */
export async function fetchArrayBuffer(
  url: string,
  onProgress?: AssetProgressCallback,
  fetchImpl?: FetchLike,
): Promise<{ readonly buffer: ArrayBuffer; readonly contentType: string }> {
  const response = await (fetchImpl ?? defaultFetch())(url);

  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} ao carregar ${url}.`);
  }

  const header = response.headers.get("content-length");
  const declared = header === null ? 0 : Number(header);
  const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
  const contentType = response.headers.get("content-type") ?? "";
  const body = response.body;

  if (body === null || body === undefined || typeof body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, totalBytes > 0 ? totalBytes : buffer.byteLength);
    return { buffer, contentType };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value !== undefined) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, totalBytes);
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress?.(loaded, loaded);
  return { buffer: merged.buffer, contentType };
}
