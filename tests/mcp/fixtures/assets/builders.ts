/**
 * Fixtures binárias geradas em código para os testes de assets/cenas (T8):
 * GLB mínimo (1 triângulo + 1 animação), PNG/JPEG/WebP/KTX2/WAV mínimos e
 * variantes malformadas. Nada de arquivo binário versionado.
 */

/* ---------------------------------------------------------------- utilitários */

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16be(n: number): number[] {
  return [(n >>> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: readonly number[]): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------------------------------------------------------- imagens */

/** PNG válido mínimo (IHDR + IDAT vazio + IEND; os decodificadores reais recusariam o IDAT, o parser só lê o IHDR). */
export function makePng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: number[]): number[] => {
    const body = [...ascii(type), ...data];
    return [...u32be(data.length), ...body, ...u32be(crc32(body))];
  };
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...chunk("IDAT", []),
    ...chunk("IEND", []),
  ]);
}

/** JPEG mínimo: SOI, APP0 (JFIF), SOF0 com dimensões, EOI. `exifBytes` insere um APP1 antes do SOF. */
export function makeJpeg(width: number, height: number, options: { progressive?: boolean; exifBytes?: number } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii("JFIF"), 0, 1, 1, 0, ...u16be(1), ...u16be(1), 0, 0];
  const exif = options.exifBytes ? [0xff, 0xe1, ...u16be(options.exifBytes + 2), ...new Array<number>(options.exifBytes).fill(0x45)] : [];
  const sof = [0xff, options.progressive ? 0xc2 : 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...exif, ...sof, 0xff, 0xd9]);
}

function riffWebp(chunkType: string, payload: number[]): Uint8Array {
  const padded = payload.length % 2 === 1 ? [...payload, 0] : payload;
  const body = [...ascii("WEBP"), ...ascii(chunkType), ...u32le(payload.length), ...padded];
  return Uint8Array.from([...ascii("RIFF"), ...u32le(body.length), ...body]);
}

/** WebP com perdas (`VP8 `). */
export function makeWebpLossy(width: number, height: number): Uint8Array {
  return riffWebp("VP8 ", [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height), 0, 0]);
}

/** WebP sem perdas (`VP8L`). */
export function makeWebpLossless(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14) | (1 << 28); // alpha_is_used = 1, version = 0
  return riffWebp("VP8L", [0x2f, ...u32le(bits >>> 0), 0, 0]);
}

/** WebP estendido (`VP8X`). */
export function makeWebpExtended(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riffWebp("VP8X", [0x10, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]);
}

/** KTX2: só o cabeçalho (48 bytes + índice). */
export function makeKtx2(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32le(37), // vkFormat
    ...u32le(1), // typeSize
    ...u32le(width),
    ...u32le(height),
    ...u32le(0), // depth
    ...u32le(0), // layers
    ...u32le(1), // faces
    ...u32le(1), // levels
    ...u32le(0), // supercompression
    ...new Array<number>(32).fill(0),
  ]);
}

/** WAV PCM mínimo (44 bytes de cabeçalho + `samples` amostras de 16 bits). */
export function makeWav(samples = 8): Uint8Array {
  const data = new Array<number>(samples * 2).fill(0);
  const fmt = [...u16le(1), ...u16le(1), ...u32le(22050), ...u32le(44100), ...u16le(2), ...u16le(16)];
  const body = [...ascii("WAVE"), ...ascii("fmt "), ...u32le(fmt.length), ...fmt, ...ascii("data"), ...u32le(data.length), ...data];
  return Uint8Array.from([...ascii("RIFF"), ...u32le(body.length), ...body]);
}

/* ---------------------------------------------------------------- glTF */

function f32(values: number[]): number[] {
  const buf = new Uint8Array(new Float32Array(values).buffer);
  return [...buf];
}
function u16list(values: number[]): number[] {
  return values.flatMap((v) => u16le(v));
}

/** BIN: posições (36) + índices (6 + 2 pad) + tempos (8) + translações (24) = 76 bytes. */
export function triangleBin(): Uint8Array {
  return Uint8Array.from([
    ...f32([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    ...u16list([0, 1, 2]),
    0, 0,
    ...f32([0, 1.5]),
    ...f32([0, 0, 0, 0, 2, 0]),
  ]);
}

/** JSON glTF do triângulo animado. `bufferUri` = buffer externo/data URI (para .gltf); sem = BIN do GLB. */
export function triangleGltfJson(bufferUri?: string): Record<string, unknown> {
  return {
    asset: { version: "2.0", generator: "engine-mcp-tests" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Triangulo", mesh: 0 }],
    meshes: [{ name: "tri", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "vermelho", pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }],
    animations: [
      {
        name: "sobe",
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
        samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }],
      },
    ],
    buffers: [{ byteLength: 76, ...(bufferUri !== undefined ? { uri: bufferUri } : {}) }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 44, byteLength: 8 },
      { buffer: 0, byteOffset: 52, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1.5] },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" },
    ],
    extensionsUsed: ["KHR_materials_unlit"],
  };
}

/** Monta um GLB a partir de um JSON e de um BIN opcional. */
export function makeGlb(json: unknown = triangleGltfJson(), bin: Uint8Array | null = triangleBin(), options: { version?: number; lengthDelta?: number } = {}): Uint8Array {
  const jsonBytes = [...new TextEncoder().encode(JSON.stringify(json))];
  while (jsonBytes.length % 4 !== 0) jsonBytes.push(0x20);
  const chunks: number[] = [...u32le(jsonBytes.length), ...u32le(0x4e4f534a), ...jsonBytes];
  if (bin) {
    const binBytes = [...bin];
    while (binBytes.length % 4 !== 0) binBytes.push(0);
    chunks.push(...u32le(binBytes.length), ...u32le(0x004e4942), ...binBytes);
  }
  const total = 12 + chunks.length;
  return Uint8Array.from([...u32le(0x46546c67), ...u32le(options.version ?? 2), ...u32le(total + (options.lengthDelta ?? 0)), ...chunks]);
}

/** Variantes malformadas de GLB (nome → bytes). */
export function malformedGlbs(): Record<string, Uint8Array> {
  const good = makeGlb();
  const badMagic = Uint8Array.from(good);
  badMagic[0] = 0x00;
  const chunkOverflow = Uint8Array.from(good);
  chunkOverflow.set(u32le(0x7fffffff), 12); // comprimento do chunk JSON absurdo
  const binFirst = makeGlbRaw([[0x004e4942, [0, 0, 0, 0]]]);
  const badJson = makeGlbRaw([[0x4e4f534a, ascii("{oi ")]]);
  return {
    "magic errado": badMagic,
    "versão 1": makeGlb(undefined, undefined, { version: 1 }),
    "comprimento maior que o arquivo": makeGlb(undefined, undefined, { lengthDelta: 64 }),
    "chunk passa do fim": chunkOverflow,
    "primeiro chunk BIN": binFirst,
    "JSON inválido": badJson,
    "truncado no cabeçalho": good.subarray(0, 10),
  };
}

function makeGlbRaw(chunks: Array<[number, number[]]>): Uint8Array {
  const body = chunks.flatMap(([type, data]) => [...u32le(data.length), ...u32le(type), ...data]);
  return Uint8Array.from([...u32le(0x46546c67), ...u32le(2), ...u32le(12 + body.length), ...body]);
}

/** Variantes malformadas de imagens (nome → bytes). */
export function malformedImages(): Record<string, Uint8Array> {
  const png = makePng(16, 16);
  const pngBadIhdr = Uint8Array.from(png);
  pngBadIhdr.set(ascii("IDAT"), 12);
  const jpegOverflow = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00]);
  return {
    "vazio": new Uint8Array(0),
    "lixo": Uint8Array.from(ascii("isto não é imagem nenhuma")),
    "PNG truncado": png.subarray(0, 20),
    "PNG sem IHDR": pngBadIhdr,
    "JPEG sem SOF": Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
    "JPEG segmento passa do fim": jpegOverflow,
    "JPEG truncado no SOF": makeJpeg(10, 10).subarray(0, 26),
    "WebP chunk desconhecido": riffWebp("ABCD", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    "WebP VP8 sem start code": riffWebp("VP8 ", [0, 0, 0, 1, 2, 3, 4, 0, 4, 0]),
  };
}
