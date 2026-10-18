// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectGltf, parseGlb, parseGltfJson } from "../../tools/mcp/src/core/gltf.ts";
import { isPowerOfTwo, probeImage } from "../../tools/mcp/src/core/images.ts";
import { sanitizeDestName } from "../../tools/mcp/src/tools/assets.ts";
import {
  makeGlb,
  makeJpeg,
  makeKtx2,
  makePng,
  makeWav,
  makeWebpExtended,
  makeWebpLossless,
  makeWebpLossy,
  malformedGlbs,
  malformedImages,
  triangleBin,
  triangleGltfJson,
} from "./fixtures/assets/builders.ts";
import { createTestClient, HAS_SAMPLE_GAME, makeTempRepo, type TempRepo, type TestClient } from "./harness.ts";

const isWindows = process.platform === "win32";

/* ============================================================================
 * Parsers puros
 * ========================================================================== */

describe("core/images: dimensões sem dependências", () => {
  it("lê PNG, JPEG (baseline, progressivo, EXIF grande), WebP (VP8/VP8L/VP8X) e KTX2", () => {
    expect(probeImage(makePng(256, 128))).toMatchObject({ ok: true, format: "png", width: 256, height: 128, details: { colorType: "rgba", bitDepth: 8 } });
    expect(probeImage(makeJpeg(640, 480))).toMatchObject({ ok: true, format: "jpeg", width: 640, height: 480, details: { progressive: false } });
    expect(probeImage(makeJpeg(33, 17, { progressive: true, exifBytes: 40_000 }))).toMatchObject({ ok: true, width: 33, height: 17, details: { progressive: true } });
    expect(probeImage(makeWebpLossy(300, 200))).toMatchObject({ ok: true, format: "webp", width: 300, height: 200, details: { lossless: false } });
    expect(probeImage(makeWebpLossless(4096, 3))).toMatchObject({ ok: true, format: "webp", width: 4096, height: 3, details: { lossless: true, alpha: true } });
    expect(probeImage(makeWebpExtended(5000, 70000))).toMatchObject({ ok: true, format: "webp", width: 5000, height: 70000, details: { extended: true } });
    expect(probeImage(makeKtx2(512, 512))).toMatchObject({ ok: true, format: "ktx2", width: 512, height: 512 });
  });

  it("entrada malformada → erro estruturado (nunca lança)", () => {
    const expected: Record<string, string> = {
      vazio: "TRUNCATED",
      lixo: "UNKNOWN_FORMAT",
      "PNG truncado": "TRUNCATED",
      "PNG sem IHDR": "MALFORMED",
      "JPEG sem SOF": "NO_DIMENSIONS",
      "JPEG segmento passa do fim": "TRUNCATED",
      "JPEG truncado no SOF": "TRUNCATED",
      "WebP chunk desconhecido": "MALFORMED",
      "WebP VP8 sem start code": "MALFORMED",
    };
    for (const [name, bytes] of Object.entries(malformedImages())) {
      const result = probeImage(bytes);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.code, name).toBe(expected[name]);
    }
  });

  it("qualquer truncamento ou byte trocado nunca lança nem lê fora do buffer", () => {
    const samples = [makePng(8, 8), makeJpeg(8, 8, { exifBytes: 10 }), makeWebpLossy(8, 8), makeWebpLossless(8, 8), makeWebpExtended(8, 8), makeKtx2(8, 8)];
    for (const sample of samples) {
      for (let n = 0; n <= sample.length; n += 1) expect(() => probeImage(sample.subarray(0, n))).not.toThrow();
      for (let i = 0; i < sample.length; i += 1) {
        const copy = Uint8Array.from(sample);
        copy[i] = (copy[i]! + 0x80) & 0xff;
        expect(() => probeImage(copy)).not.toThrow();
      }
    }
  });

  it("isPowerOfTwo", () => {
    expect([1, 2, 256, 4096, 2 ** 40].every(isPowerOfTwo)).toBe(true);
    expect([0, 3, 300, -4, 1.5].some(isPowerOfTwo)).toBe(false);
  });
});

describe("core/gltf: GLB/glTF sem dependências", () => {
  it("GLB válido: chunks, triângulos, animação com duração, caixa envolvente", () => {
    const glb = makeGlb();
    const parsed = parseGlb(glb);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.version).toBe(2);
    expect(parsed.chunks.map((c) => c.type)).toEqual(["JSON", "BIN"]);
    expect(parsed.bin?.length).toBe(76);
    const summary = inspectGltf(parsed.json, { container: "glb", binLength: parsed.bin!.length });
    expect(summary.issues).toEqual([]);
    expect(summary.meshes).toEqual([{ index: 0, name: "tri", primitives: 1, triangles: 1, vertices: 3 }]);
    expect(summary.animations).toEqual([{ index: 0, name: "sobe", channels: 1, samplers: 1, duration: 1.5 }]);
    expect(summary.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    expect(summary.buffers).toEqual([{ index: 0, byteLength: 76, source: "glb-bin" }]);
    expect(summary.extensionsUsed).toEqual(["KHR_materials_unlit"]);
    expect(summary.materials).toEqual([{ index: 0, name: "vermelho" }]);
  });

  it("leitura parcial (só cabeçalho + JSON) confere o comprimento pelo tamanho real", () => {
    const glb = makeGlb();
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const parsed = parseGlb(glb.subarray(0, 20 + jsonLen + 8), glb.length);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bin).toBeNull();
      expect(parsed.chunks.find((c) => c.type === "BIN")?.length).toBe(76);
    }
  });

  it("GLB malformado → código estruturado", () => {
    const expected: Record<string, string> = {
      "magic errado": "NOT_GLB",
      "versão 1": "UNSUPPORTED_VERSION",
      "comprimento maior que o arquivo": "BAD_LENGTH",
      "chunk passa do fim": "BAD_CHUNK",
      "primeiro chunk BIN": "NO_JSON_CHUNK",
      "JSON inválido": "INVALID_JSON",
      "truncado no cabeçalho": "TRUNCATED",
    };
    for (const [name, bytes] of Object.entries(malformedGlbs())) {
      const result = parseGlb(bytes);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.code, name).toBe(expected[name]);
    }
  });

  it("truncamentos e bytes trocados nunca lançam", () => {
    const glb = makeGlb();
    for (let n = 0; n <= glb.length; n += 1) expect(() => parseGlb(glb.subarray(0, n))).not.toThrow();
    for (let i = 0; i < 40; i += 1) {
      const copy = Uint8Array.from(glb);
      copy[i] = (copy[i]! ^ 0xff) & 0xff;
      expect(() => {
        const r = parseGlb(copy);
        if (r.ok) inspectGltf(r.json, { container: "glb", binLength: r.bin?.length ?? null });
      }).not.toThrow();
    }
  });

  it("problemas estruturais: índices fora do intervalo, BIN ausente/curto, bufferView além do buffer, extensão obrigatória", () => {
    const json = triangleGltfJson() as Record<string, any>;
    json.meshes[0].primitives[0].indices = 9;
    json.bufferViews[3].byteLength = 500;
    json.extensionsRequired = ["KHR_draco_mesh_compression"];
    const codes = inspectGltf(json, { container: "glb", binLength: 40 }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["GLTF_BAD_INDEX", "GLB_BIN_SHORT", "GLTF_VIEW_OUT_OF_BOUNDS", "GLTF_EXTENSION_REQUIRED_NOT_USED"]));
    expect(inspectGltf(triangleGltfJson(), { container: "glb", binLength: null }).issues.map((i) => i.code)).toContain("GLB_BIN_MISSING");
    expect(inspectGltf(triangleGltfJson(), { container: "gltf" }).issues.map((i) => i.code)).toContain("GLTF_BUFFER_NO_URI");
    expect(inspectGltf("x", { container: "gltf" }).issues.map((i) => i.code)).toContain("GLTF_NOT_OBJECT");
  });

  it(".gltf com data URI e com buffer externo (URIs listadas para conferir no disco)", () => {
    const dataUri = `data:application/octet-stream;base64,${Buffer.from(triangleBin()).toString("base64")}`;
    const embedded = inspectGltf(parseGltfJson(JSON.stringify(triangleGltfJson(dataUri))).ok ? triangleGltfJson(dataUri) : null, { container: "gltf" });
    expect(embedded.issues).toEqual([]);
    expect(embedded.externalUris).toEqual([]);
    const external = inspectGltf(triangleGltfJson("tri.bin"), { container: "gltf" });
    expect(external.externalUris).toEqual([{ kind: "buffer", index: 0, uri: "tri.bin" }]);
    expect(parseGltfJson("{")).toMatchObject({ ok: false, code: "INVALID_JSON" });
  });
});

describe("sanitizeDestName", () => {
  it("normaliza acentos/espaços, mantém subpastas e baixa a extensão", () => {
    expect(sanitizeDestName("Árvore Grande.PNG")).toBe("Arvore-Grande.png");
    expect(sanitizeDestName("modelos\\trem (v2).glb")).toBe("modelos/trem-v2.glb");
    expect(() => sanitizeDestName("../fora.png")).toThrow(/destName inválido/);
    expect(() => sanitizeDestName("semext")).toThrow(/sem extensão/);
    expect(() => sanitizeDestName("script.sh")).toThrow(/não é de asset/);
  });
});

/* ============================================================================
 * Tools via MCP (repo temporário)
 * ========================================================================== */

async function put(root: string, rel: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), data);
}

describe("assets: tools no repo temporário", () => {
  let repo: TempRepo;
  let t: TestClient;
  const P = "src/projects/demo";

  beforeAll(async () => {
    repo = await makeTempRepo();
    await put(repo.root, `${P}/index.ts`, `export const project = { id: "demo", name: "Demo" };\nconst chao = new URL("./assets/chao.png", import.meta.url).href;\nvoid chao;\n`);
    await put(repo.root, `${P}/assets/trem.glb`, makeGlb());
    await put(repo.root, `${P}/assets/chao.png`, makePng(256, 256));
    await put(repo.root, `${P}/assets/npot.png`, makePng(300, 200));
    await put(repo.root, `${P}/assets/gigante.png`, makePng(8192, 8192));
    await put(repo.root, `${P}/assets/foto.jpg`, makeJpeg(64, 64));
    await put(repo.root, `${P}/assets/falso.jpg`, makePng(4, 4));
    await put(repo.root, `${P}/assets/sprite.webp`, makeWebpLossless(128, 64));
    await put(repo.root, `${P}/assets/som.wav`, makeWav());
    await put(repo.root, `${P}/assets/ruim.mp3`, Uint8Array.from([1, 2, 3, 4]));
    await put(repo.root, `${P}/assets/quebrado.glb`, malformedGlbs()["chunk passa do fim"]!);
    await put(repo.root, `${P}/assets/modelo.gltf`, JSON.stringify(triangleGltfJson("modelo.bin")));
    await put(repo.root, `${P}/assets/ok/tri.gltf`, JSON.stringify(triangleGltfJson("tri.bin")));
    await put(repo.root, `${P}/assets/ok/tri.bin`, triangleBin());
    await put(repo.root, `${P}/assets/orfao.png`, makePng(2, 2));
    await put(repo.root, `${P}/assets/vazio.ogg`, new Uint8Array(0));
    await put(repo.root, `public/projects/demo/fundo.png`, makePng(512, 512));
    await put(repo.root, `public/compartilhado/logo.webp`, makeWebpLossy(32, 32));
    await put(
      repo.root,
      `${P}/scenes/fase-1.scene.json`,
      JSON.stringify({
        format: "engine.scene",
        version: 1,
        sceneId: "fase-1",
        sceneName: "Fase 1",
        assets: [
          { id: "trem", url: "/assets/trem.glb", type: "gltf" },
          { id: "fundo", url: "/projects/demo/fundo.png", type: "texture" },
          { id: "logo", url: "/compartilhado/logo.webp", type: "texture" },
          { id: "sumiu", url: "/nao-existe.glb", type: "gltf" },
          { id: "cdn", url: "https://cdn.example.com/x.glb", type: "gltf" },
          { id: "tri", url: "assets/ok/tri.gltf", type: "gltf" },
        ],
        entities: [],
      }),
    );
    t = await createTestClient({ root: repo.root });
  });

  afterAll(async () => {
    await t.close();
    await repo.cleanup();
  });

  it("assets_list {id}: public/ + assets do jogo com tipo, bytes, dimensões e resumo glTF", async () => {
    const out = await t.callTool("assets_list", { id: "demo" });
    const byPath = new Map<string, any>(out.assets.map((a: any) => [a.path, a]));
    expect(byPath.get(`${P}/assets/trem.glb`)).toMatchObject({ type: "gltf", root: "project", project: "demo", url: null, gltf: { container: "glb", triangles: 1, meshes: 1, animations: 1, errors: 0 } });
    expect(byPath.get(`${P}/assets/chao.png`)).toMatchObject({ type: "texture", image: { format: "png", width: 256, height: 256 } });
    expect(byPath.get(`${P}/assets/sprite.webp`)).toMatchObject({ image: { format: "webp", width: 128, height: 64 } });
    expect(byPath.get(`${P}/assets/som.wav`)).toMatchObject({ type: "audio", ext: "wav" });
    expect(byPath.get(`${P}/assets/quebrado.glb`).error).toMatch(/^GLB_BAD_CHUNK/);
    expect(byPath.get("public/projects/demo/fundo.png")).toMatchObject({ root: "public", url: "/projects/demo/fundo.png", image: { width: 512 } });
    expect(out.truncated).toBe(false);
    expect(out.totalBytes).toBeGreaterThan(0);
  });

  it("assets_list sem id lista public/ e os assets de todos os jogos; jogo inexistente → NOT_FOUND", async () => {
    const out = await t.callTool("assets_list");
    expect(out.assets.some((a: any) => a.path === "public/compartilhado/logo.webp")).toBe(true);
    expect(out.assets.some((a: any) => a.project === "demo")).toBe(true);
    await expect(t.callTool("assets_list", { id: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("assets_list", { id: "../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("assets_validate: GLB/glTF, imagens, áudio, referências quebradas e órfãos", async () => {
    const out = await t.callTool("assets_validate", { id: "demo" });
    const file = (rel: string): any => out.files.find((f: any) => f.path === rel);
    const codes = (rel: string, kind: "errors" | "warnings"): string[] => (file(rel)?.[kind] ?? []).map((i: any) => i.code);

    expect(out.ok).toBe(false);
    expect(file(`${P}/assets/trem.glb`)).toMatchObject({ errors: [], gltf: { triangles: 1, animations: 1 } });
    expect(codes(`${P}/assets/quebrado.glb`, "errors")).toEqual(["GLB_BAD_CHUNK"]);
    expect(codes(`${P}/assets/modelo.gltf`, "errors")).toEqual(["GLTF_URI_MISSING"]);
    expect(codes(`${P}/assets/ok/tri.gltf`, "errors")).toEqual([]);
    expect(codes(`${P}/assets/npot.png`, "warnings")).toContain("IMAGE_NOT_POT");
    expect(codes(`${P}/assets/gigante.png`, "warnings")).toContain("IMAGE_TOO_LARGE");
    expect(codes(`${P}/assets/chao.png`, "warnings")).toEqual([]);
    expect(codes(`${P}/assets/falso.jpg`, "warnings")).toContain("IMAGE_EXT_MISMATCH");
    expect(codes(`${P}/assets/ruim.mp3`, "warnings")).toContain("AUDIO_HEADER");
    expect(codes(`${P}/assets/som.wav`, "warnings")).not.toContain("AUDIO_HEADER");
    expect(codes(`${P}/assets/vazio.ogg`, "errors")).toEqual(["EMPTY_FILE"]);
    // Arquivo público referenciado por cena entra na validação.
    expect(file("public/compartilhado/logo.webp")).toBeDefined();

    expect(out.brokenRefs).toEqual([{ document: `${P}/scenes/fase-1.scene.json`, assetId: "sumiu", url: "/nao-existe.glb", candidates: ["public/nao-existe.glb"] }]);
    expect(out.unverifiableRefs.map((r: any) => r.assetId)).toEqual(["cdn"]);

    // Órfãos: não citados por cena/prefab/glTF/código. trem (cena), chao (index.ts), tri.bin (glTF), fundo (cena) não são.
    expect(out.orphans).toContain(`${P}/assets/orfao.png`);
    expect(out.orphans).not.toContain(`${P}/assets/trem.glb`);
    expect(out.orphans).not.toContain(`${P}/assets/chao.png`);
    expect(out.orphans).not.toContain(`${P}/assets/ok/tri.bin`);
    expect(out.orphans).not.toContain("public/projects/demo/fundo.png");
    expect(codes(`${P}/assets/orfao.png`, "warnings")).toContain("ASSET_ORPHAN");
    expect(out.totals.errors).toBeGreaterThanOrEqual(4);

    await expect(t.callTool("assets_validate", { id: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gltf_inspect: resumo completo; erros estruturados", async () => {
    const out = await t.callTool("gltf_inspect", { path: `${P}/assets/trem.glb` });
    expect(out.valid).toBe(true);
    expect(out.glb).toMatchObject({ version: 2, chunks: [{ type: "JSON" }, { type: "BIN", length: 76 }] });
    expect(out.summary).toMatchObject({
      nodes: 1,
      totals: { triangles: 1, vertices: 3, primitives: 1 },
      animations: [{ name: "sobe", channels: 1, duration: 1.5 }],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      extensionsUsed: ["KHR_materials_unlit"],
      skins: [],
    });
    const gltf = await t.callTool("gltf_inspect", { path: `${P}/assets/ok/tri.gltf` });
    expect(gltf.externalRefs).toEqual([{ kind: "buffer", index: 0, uri: "tri.bin", status: "found", file: `${P}/assets/ok/tri.bin` }]);
    const missing = await t.callTool("gltf_inspect", { path: `${P}/assets/modelo.gltf` });
    expect(missing.valid).toBe(false);
    expect(missing.errors.map((e: any) => e.code)).toEqual(["GLTF_URI_MISSING"]);

    await expect(t.callTool("gltf_inspect", { path: `${P}/assets/quebrado.glb` })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("gltf_inspect", { path: `${P}/assets/chao.png` })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("gltf_inspect", { path: `${P}/assets/nada.glb` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("gltf_inspect", { path: "../fora.glb" })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
  });

  it("asset_import: copia de dentro do repo, sanitiza, recusa sobrescrever sem overwrite", async () => {
    await put(repo.root, "entrada/Árvore Grande.PNG", makePng(64, 64));
    const out = await t.callTool("asset_import", { id: "demo", sourcePath: "entrada/Árvore Grande.PNG", destName: "texturas/Árvore Grande.PNG" });
    expect(out).toMatchObject({ file: `${P}/assets/texturas/Arvore-Grande.png`, destName: "texturas/Arvore-Grande.png", sanitized: true, overwritten: false, type: "texture", bytes: makePng(64, 64).length });
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.compare(await readFile(path.join(repo.root, out.file)), Buffer.from(makePng(64, 64)))).toBe(0);

    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/Árvore Grande.PNG", destName: "texturas/Arvore-Grande.png" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const again = await t.callTool("asset_import", { id: "demo", sourcePath: path.join(repo.root, "entrada/Árvore Grande.PNG"), destName: "texturas/Arvore-Grande.png", overwrite: true });
    expect(again.overwritten).toBe(true);

    // .gltf com externos: avisa que o .bin não foi junto.
    await put(repo.root, "entrada/cena.gltf", JSON.stringify(triangleGltfJson("cena.bin")));
    const gltf = await t.callTool("asset_import", { id: "demo", sourcePath: "entrada/cena.gltf", destName: "cena.gltf" });
    expect(gltf.warnings.map((w: any) => w.code)).toEqual(["GLTF_URI_MISSING"]);
  });

  it("asset_import: erros de caminho, extensão, tamanho e destino", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "engine-mcp-import-"));
    try {
      await writeFile(path.join(outside, "fora.png"), makePng(2, 2));
      await expect(t.callTool("asset_import", { id: "demo", sourcePath: path.join(outside, "fora.png"), destName: "fora.png" })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
      await expect(t.callTool("asset_import", { id: "demo", sourcePath: path.relative(repo.root, path.join(outside, "fora.png")), destName: "fora.png" })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
      if (!isWindows) {
        await symlink(path.join(outside, "fora.png"), path.join(repo.root, "entrada/link.png"));
        await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/link.png", destName: "link.png" })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
      }
      // Com ENGINE_MCP_IMPORT_DIR a mesma origem é aceita.
      const t2 = await createTestClient({ root: repo.root, config: { importDir: outside } });
      try {
        const ok = await t2.callTool("asset_import", { id: "demo", sourcePath: path.join(outside, "fora.png"), destName: "de-fora.png" });
        expect(ok.file).toBe(`${P}/assets/de-fora.png`);
      } finally {
        await t2.close();
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    await put(repo.root, "entrada/nota.txt", "oi");
    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/nota.txt", destName: "nota.png" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/nada.png", destName: "nada.png" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada", destName: "pasta.png" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/cena.gltf", destName: "../../escape.gltf" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("asset_import", { id: "demo", sourcePath: "entrada/cena.gltf", destName: "x.exe" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("asset_import", { id: "nada", sourcePath: "entrada/cena.gltf", destName: "x.gltf" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("asset_import em modo somente leitura → READONLY", async () => {
    const ro = await createTestClient({ root: repo.root, config: { readonly: true } });
    try {
      await expect(ro.callTool("asset_import", { id: "demo", sourcePath: "entrada/cena.gltf", destName: "ro.gltf" })).rejects.toMatchObject({ code: "READONLY" });
      // Leitura continua funcionando.
      expect((await ro.callTool("assets_list", { id: "demo" })).assets.length).toBeGreaterThan(5);
    } finally {
      await ro.close();
    }
  });
});

describe.skipIf(!HAS_SAMPLE_GAME)("assets: repo real (physics-sandbox)", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("assets_list e assets_validate enxergam os .wav públicos citados no código", async () => {
    const list = await t.callTool("assets_list", { id: "physics-sandbox" });
    expect(list.assets).toEqual(expect.arrayContaining([expect.objectContaining({ path: "public/projects/physics-sandbox/audio/jump.wav", type: "audio", url: "/projects/physics-sandbox/audio/jump.wav" })]));
    const val = await t.callTool("assets_validate", { id: "physics-sandbox" });
    expect(val.files.map((f: any) => f.path)).toContain("public/projects/physics-sandbox/audio/impact.wav");
    expect(val.orphans).not.toContain("public/projects/physics-sandbox/audio/jump.wav");
  });
});
