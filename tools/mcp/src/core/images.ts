/**
 * Leitura de dimensões de imagens SEM dependências (T8, SPEC §3.5).
 *
 * Formatos: PNG (IHDR), JPEG (varredura de marcadores até um SOFn), WebP
 * (`VP8 ` com perdas, `VP8L` sem perdas, `VP8X` estendido) e KTX2 (cabeçalho).
 * Toda leitura é checada contra o tamanho do buffer: nunca lê além do fim e
 * nunca lança — entrada malformada devolve `{ ok: false, code, message }`.
 */

export type ImageFormat = "png" | "jpeg" | "webp" | "ktx2";

export interface ImageInfo {
  readonly ok: true;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  /** Detalhes do formato (bitDepth/colorType do PNG, variante do WebP, etc.). */
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export type ImageErrorCode =
  | "UNKNOWN_FORMAT" // assinatura não reconhecida
  | "TRUNCATED" // o arquivo acaba antes do cabeçalho/segmento necessário
  | "MALFORMED" // estrutura inválida (chunk errado, comprimento impossível)
  | "NO_DIMENSIONS"; // estrutura válida mas sem dimensões (JPEG sem SOF)

export interface ImageError {
  readonly ok: false;
  readonly format: ImageFormat | null;
  readonly code: ImageErrorCode;
  readonly message: string;
}

export type ImageProbe = ImageInfo | ImageError;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const KTX2_SIGNATURE = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function fail(format: ImageFormat | null, code: ImageErrorCode, message: string): ImageError {
  return { ok: false, format, code, message };
}

function hasPrefix(buf: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(buf: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > buf.length) return "";
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(buf[offset + i]!);
  return out;
}

/** Leitores com checagem de limites (devolvem `null` se passariam do fim). */
function u16be(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 2 <= buf.length ? (buf[o]! << 8) | buf[o + 1]! : null;
}
function u16le(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 2 <= buf.length ? buf[o]! | (buf[o + 1]! << 8) : null;
}
function u24le(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 3 <= buf.length ? buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16) : null;
}
function u32be(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 4 <= buf.length ? ((buf[o]! << 24) >>> 0) + ((buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) : null;
}
function u32le(buf: Uint8Array, o: number): number | null {
  return o >= 0 && o + 4 <= buf.length ? (buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16)) + ((buf[o + 3]! << 24) >>> 0) : null;
}

/** Formato pela assinatura (ou `null`). */
export function detectImageFormat(buf: Uint8Array): ImageFormat | null {
  if (hasPrefix(buf, PNG_SIGNATURE)) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") return "webp";
  if (hasPrefix(buf, KTX2_SIGNATURE)) return "ktx2";
  return null;
}

/* ---------------------------------------------------------------- PNG */

const PNG_COLOR_TYPES: Readonly<Record<number, string>> = { 0: "gray", 2: "rgb", 3: "indexed", 4: "gray-alpha", 6: "rgba" };

export function probePng(buf: Uint8Array): ImageProbe {
  if (!hasPrefix(buf, PNG_SIGNATURE)) return fail("png", "UNKNOWN_FORMAT", "assinatura PNG ausente");
  // assinatura(8) + length(4) + "IHDR"(4) + dados(13) + CRC(4) = 33
  if (buf.length < 8 + 8 + 13) return fail("png", "TRUNCATED", "PNG truncado antes do fim do IHDR");
  const length = u32be(buf, 8);
  if (ascii(buf, 12, 4) !== "IHDR") return fail("png", "MALFORMED", "o primeiro chunk do PNG deveria ser IHDR");
  if (length !== 13) return fail("png", "MALFORMED", `IHDR com comprimento ${String(length)} (esperado 13)`);
  const width = u32be(buf, 16)!;
  const height = u32be(buf, 20)!;
  const bitDepth = buf[24]!;
  const colorType = buf[25]!;
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
    return fail("png", "MALFORMED", `dimensões inválidas no IHDR: ${String(width)}x${String(height)}`);
  }
  const colorName = PNG_COLOR_TYPES[colorType];
  if (colorName === undefined) return fail("png", "MALFORMED", `colorType desconhecido: ${String(colorType)}`);
  return {
    ok: true,
    format: "png",
    width,
    height,
    details: { bitDepth, colorType: colorName, interlaced: buf[28] === 1, hasCrc: buf.length >= 33 },
  };
}

/* ---------------------------------------------------------------- JPEG */

/** Marcadores sem segmento de comprimento. */
function jpegStandalone(marker: number): boolean {
  return marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

/** SOF0..SOF15 exceto DHT (C4), JPG (C8) e DAC (CC). */
function jpegIsSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function probeJpeg(buf: Uint8Array): ImageProbe {
  if (!(buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8)) return fail("jpeg", "UNKNOWN_FORMAT", "assinatura JPEG (FFD8) ausente");
  let offset = 2;
  // Limite de segurança: no máximo 65 536 marcadores (cada um avança ≥ 2 bytes).
  for (let guard = 0; guard < 65_536; guard += 1) {
    if (offset >= buf.length) return fail("jpeg", "TRUNCATED", "JPEG acaba antes de um marcador SOF");
    if (buf[offset] !== 0xff) return fail("jpeg", "MALFORMED", `byte 0x${buf[offset]!.toString(16)} onde se esperava um marcador (offset ${String(offset)})`);
    // Bytes de preenchimento 0xFF.
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) return fail("jpeg", "TRUNCATED", "JPEG acaba dentro de um marcador");
    const marker = buf[offset]!;
    offset += 1;
    if (marker === 0x00) return fail("jpeg", "MALFORMED", "marcador 0xFF00 fora dos dados de imagem");
    if (jpegStandalone(marker)) continue;
    if (marker === 0xd9) return fail("jpeg", "NO_DIMENSIONS", "fim da imagem (EOI) antes de um SOF");
    if (marker === 0xda) return fail("jpeg", "NO_DIMENSIONS", "início dos dados (SOS) antes de um SOF");
    const length = u16be(buf, offset);
    if (length === null) return fail("jpeg", "TRUNCATED", "comprimento de segmento truncado");
    if (length < 2) return fail("jpeg", "MALFORMED", `segmento 0xFF${marker.toString(16)} com comprimento ${String(length)}`);
    if (jpegIsSof(marker)) {
      if (length < 8 || offset + 8 > buf.length) return fail("jpeg", "TRUNCATED", "segmento SOF truncado");
      const precision = buf[offset + 2]!;
      const height = u16be(buf, offset + 3)!;
      const width = u16be(buf, offset + 5)!;
      const components = buf[offset + 7]!;
      if (width === 0) return fail("jpeg", "MALFORMED", "largura 0 no SOF");
      if (height === 0) return fail("jpeg", "NO_DIMENSIONS", "altura 0 no SOF (definida por DNL; não suportado)");
      return {
        ok: true,
        format: "jpeg",
        width,
        height,
        details: { sof: `SOF${String(marker - 0xc0)}`, progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce, precision, components },
      };
    }
    if (offset + length > buf.length) return fail("jpeg", "TRUNCATED", `segmento 0xFF${marker.toString(16)} passa do fim do arquivo`);
    offset += length;
  }
  return fail("jpeg", "MALFORMED", "marcadores demais sem SOF");
}

/* ---------------------------------------------------------------- WebP */

export function probeWebp(buf: Uint8Array): ImageProbe {
  if (!(ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP")) return fail("webp", "UNKNOWN_FORMAT", "assinatura RIFF/WEBP ausente");
  if (buf.length < 20) return fail("webp", "TRUNCATED", "WebP truncado antes do primeiro chunk");
  const riffSize = u32le(buf, 4)!;
  const chunk = ascii(buf, 12, 4);
  const chunkSize = u32le(buf, 16)!;
  const details: Record<string, string | number | boolean> = { variant: chunk.trim(), riffSizeMatches: riffSize + 8 === buf.length };
  if (chunk === "VP8 ") {
    // frame tag (3) + start code 9D 01 2A (3) + largura(2) + altura(2)
    if (buf.length < 30) return fail("webp", "TRUNCATED", "chunk VP8 truncado");
    if (!(buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a)) return fail("webp", "MALFORMED", "start code VP8 (9D 01 2A) ausente");
    const width = u16le(buf, 26)! & 0x3fff;
    const height = u16le(buf, 28)! & 0x3fff;
    if (width === 0 || height === 0) return fail("webp", "MALFORMED", "dimensões zero no VP8");
    return { ok: true, format: "webp", width, height, details: { ...details, lossless: false, chunkSize } };
  }
  if (chunk === "VP8L") {
    if (buf.length < 25) return fail("webp", "TRUNCATED", "chunk VP8L truncado");
    if (buf[20] !== 0x2f) return fail("webp", "MALFORMED", "assinatura VP8L (0x2F) ausente");
    const b1 = buf[21]!;
    const b2 = buf[22]!;
    const b3 = buf[23]!;
    const b4 = buf[24]!;
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    const version = b4 >> 5;
    if (version !== 0) return fail("webp", "MALFORMED", `versão VP8L ${String(version)} (esperado 0)`);
    return { ok: true, format: "webp", width, height, details: { ...details, lossless: true, alpha: (b4 & 0x10) !== 0 } };
  }
  if (chunk === "VP8X") {
    if (buf.length < 30) return fail("webp", "TRUNCATED", "chunk VP8X truncado");
    const flags = buf[20]!;
    const width = 1 + u24le(buf, 24)!;
    const height = 1 + u24le(buf, 27)!;
    return {
      ok: true,
      format: "webp",
      width,
      height,
      details: { ...details, extended: true, alpha: (flags & 0x10) !== 0, animated: (flags & 0x02) !== 0 },
    };
  }
  return fail("webp", "MALFORMED", `chunk WebP desconhecido '${chunk}'`);
}

/* ---------------------------------------------------------------- KTX2 */

export function probeKtx2(buf: Uint8Array): ImageProbe {
  if (!hasPrefix(buf, KTX2_SIGNATURE)) return fail("ktx2", "UNKNOWN_FORMAT", "assinatura KTX2 ausente");
  if (buf.length < 48) return fail("ktx2", "TRUNCATED", "cabeçalho KTX2 truncado");
  const vkFormat = u32le(buf, 12)!;
  const width = u32le(buf, 20)!;
  const height = u32le(buf, 24)!;
  const levelCount = u32le(buf, 40)!;
  const supercompression = u32le(buf, 44)!;
  if (width === 0) return fail("ktx2", "MALFORMED", "pixelWidth 0 no KTX2");
  return {
    ok: true,
    format: "ktx2",
    width,
    height: Math.max(1, height),
    details: { vkFormat, levelCount, supercompressionScheme: supercompression },
  };
}

/** Detecta o formato e lê as dimensões. Nunca lança. */
export function probeImage(buf: Uint8Array): ImageProbe {
  const format = detectImageFormat(buf);
  switch (format) {
    case "png":
      return probePng(buf);
    case "jpeg":
      return probeJpeg(buf);
    case "webp":
      return probeWebp(buf);
    case "ktx2":
      return probeKtx2(buf);
    default:
      return fail(null, buf.length < 12 ? "TRUNCATED" : "UNKNOWN_FORMAT", "assinatura de imagem não reconhecida (PNG, JPEG, WebP ou KTX2)");
  }
}

export function isPowerOfTwo(n: number): boolean {
  if (!Number.isSafeInteger(n) || n <= 0) return false;
  let v = n;
  while (v % 2 === 0) v /= 2;
  return v === 1;
}
