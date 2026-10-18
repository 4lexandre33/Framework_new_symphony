// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginContext } from "@core";
import type { PrefabDocument, SceneDocument } from "../../src/contracts/world/scene-document.ts";
import { WorldService } from "../../src/engine/world/internal/WorldService.ts";
import { mergePatch } from "../../tools/mcp/src/tools/scenes.ts";
import { makeGlb, makePng } from "./fixtures/assets/builders.ts";
import { createTestClient, HAS_SAMPLE_GAME, makeTempRepo, ToolCallError, type TempRepo, type TestClient } from "./harness.ts";

const P = "src/projects/demo";

async function put(root: string, rel: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), data);
}

/** Erro esperado + códigos do validador em details.errors. */
async function schemaErrorCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolCallError);
    const e = error as ToolCallError;
    expect(e.code).toBe("SCHEMA_INVALID");
    return ((e.details as { errors: Array<{ code: string }> }).errors ?? []).map((x) => x.code);
  }
  throw new Error("esperava SCHEMA_INVALID");
}

/** WorldService real com contexto mínimo (como tests/scene-document.test.ts). */
function createWorld(): { world: WorldService; emitted: Array<{ type: string; payload: Record<string, unknown> }>; loaded: string[] } {
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const loaded: string[] = [];
  const load = async (url: string): Promise<unknown> => {
    loaded.push(url);
    return {};
  };
  const assets = { loadGLTF: load, loadTexture: load, loadAudio: load, releaseAsset(): void {}, getAsset: () => null, clearCache(): void {} };
  const ctx = {
    events: { emit: (type: string, payload: Record<string, unknown>) => void emitted.push({ type, payload }) },
    caps: { get: (token: { id: string }) => (token.id === "game.assets" ? assets : undefined) },
  } as unknown as PluginContext;
  return { world: new WorldService(ctx), emitted, loaded };
}

describe("mergePatch (RFC 7386)", () => {
  it("mescla objetos, null remove, arrays/escalares substituem", () => {
    expect(mergePatch({ a: 1, b: { c: 2, d: 3 }, e: [1] }, { b: { c: null, x: 9 }, e: [2], f: "n" })).toEqual({ a: 1, b: { d: 3, x: 9 }, e: [2], f: "n" });
    expect(mergePatch({ a: 1 }, 5)).toBe(5);
  });
});

describe("scenes: tools no repo temporário", () => {
  let repo: TempRepo;
  let t: TestClient;

  beforeAll(async () => {
    repo = await makeTempRepo();
    await put(repo.root, `${P}/index.ts`, `export const project = { id: "demo", name: "Demo" };\n`);
    await put(repo.root, "public/assets/trem.glb", makeGlb());
    t = await createTestClient({ root: repo.root });
  });

  afterAll(async () => {
    await t.close();
    await repo.cleanup();
  });

  it("listas vazias; jogo inexistente → NOT_FOUND; id inválido → INVALID_INPUT", async () => {
    expect(await t.callTool("scene_list", { id: "demo" })).toEqual({ scenes: [] });
    expect(await t.callTool("prefab_list", { id: "demo" })).toEqual({ prefabs: [] });
    await expect(t.callTool("scene_list", { id: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("prefab_list", { id: "_template" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("prefab_create: preenche format/version, avisa asset ausente, recusa duplicado e inválido", async () => {
    const out = await t.callTool("prefab_create", {
      id: "demo",
      prefab: { prefabId: "jogador", type: "player", tags: ["player", "vivo"], data: { vida: 3, velocidade: 5 }, assets: [{ id: "jogador-glb", url: "/assets/jogador.glb", type: "gltf" }], $nota: "criado no teste" },
    });
    expect(out.file).toBe(`${P}/prefabs/jogador.prefab.json`);
    expect(out.document).toMatchObject({ format: "engine.prefab", version: 1, prefabId: "jogador", $nota: "criado no teste" });
    expect(out.warnings.map((w: any) => w.code)).toEqual(["ASSET_NOT_FOUND"]);
    const text = await readFile(path.join(repo.root, out.file), "utf8");
    expect(text).toBe(`${JSON.stringify(out.document, null, 2)}\n`);

    await expect(t.callTool("prefab_create", { id: "demo", prefab: { prefabId: "jogador" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await schemaErrorCodes(t.callTool("prefab_create", { id: "demo", prefab: { prefabId: "ruim", tags: [""], extra: 1 } }))).toEqual(expect.arrayContaining(["INVALID_TAG", "UNKNOWN_FIELD"]));
    expect(existsSync(path.join(repo.root, P, "prefabs/ruim.prefab.json"))).toBe(false);
    await expect(t.callTool("prefab_create", { id: "demo", prefab: { prefabId: "a:b" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await schemaErrorCodes(t.callTool("prefab_create", { id: "demo", prefab: { type: "x" } }))).toEqual(["REQUIRED"]);
  });

  it("scene_create + scene_entity_add/update/remove com validação total antes de gravar", async () => {
    const created = await t.callTool("scene_create", {
      id: "demo",
      sceneId: "fase-1",
      sceneName: "Fase 1",
      worldBounds: { min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } },
    });
    expect(created.file).toBe(`${P}/scenes/fase-1.scene.json`);
    expect(created.document).toEqual({ format: "engine.scene", version: 1, sceneId: "fase-1", sceneName: "Fase 1", entities: [], worldBounds: { min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } } });
    await expect(t.callTool("scene_create", { id: "demo", sceneId: "fase-1", sceneName: "De novo" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await schemaErrorCodes(t.callTool("scene_create", { id: "demo", sceneId: "limites", sceneName: "L", worldBounds: { min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } } }))).toEqual(["INVALID_BOUNDS"]);
    await expect(t.callTool("scene_create", { id: "demo", sceneId: "../fuga", sceneName: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const added = await t.callTool("scene_entity_add", {
      id: "demo",
      scene: "fase-1",
      entity: { id: "player", prefab: "jogador", position: { x: 0, y: 1, z: 0 }, tags: ["heroi"], data: { vida: 5, inventario: { espada: 1, escudo: 1 } }, $comentario: "spawn" },
    });
    expect(added.document.entities).toHaveLength(1);
    expect(added.warnings.map((w: any) => w.code)).toEqual(["ASSET_NOT_FOUND"]); // asset do prefab: aviso, não bloqueia
    await t.callTool("scene_entity_add", { id: "demo", scene: "fase-1.scene.json", entity: { id: "caixa-1", type: "prop", position: { x: 3, y: 0.5, z: -2 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } });

    // Erros: id repetido, entidade inválida, prefab inexistente, campo desconhecido — nada é gravado.
    const before = await readFile(path.join(repo.root, P, "scenes/fase-1.scene.json"), "utf8");
    expect(await schemaErrorCodes(t.callTool("scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "caixa-1" } }))).toEqual(["DUPLICATE_ENTITY_ID"]);
    expect(await schemaErrorCodes(t.callTool("scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "zero", scale: { x: 0, y: 1, z: 1 } } }))).toEqual(["ZERO_SCALE"]);
    expect(await schemaErrorCodes(t.callTool("scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "fantasma", prefab: "nao-existe" } }))).toEqual(["UNKNOWN_PREFAB"]);
    expect(await schemaErrorCodes(t.callTool("scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "x", cor: "azul" } }))).toEqual(["UNKNOWN_FIELD"]);
    expect(await readFile(path.join(repo.root, P, "scenes/fase-1.scene.json"), "utf8")).toBe(before);
    await expect(t.callTool("scene_entity_add", { id: "demo", scene: "nao-existe", entity: { id: "x" } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Update: merge profundo em position/data (null remove), tags substituem.
    const updated = await t.callTool("scene_entity_update", {
      id: "demo",
      scene: "fase-1",
      entityId: "player",
      patch: { position: { y: 2 }, data: { vida: 10, inventario: { escudo: null, arco: 1 } }, tags: ["heroi", "lider"] },
    });
    const player = updated.document.entities.find((e: any) => e.id === "player");
    expect(player).toEqual({ id: "player", prefab: "jogador", position: { x: 0, y: 2, z: 0 }, tags: ["heroi", "lider"], data: { vida: 10, inventario: { espada: 1, arco: 1 } }, $comentario: "spawn" });
    expect(await schemaErrorCodes(t.callTool("scene_entity_update", { id: "demo", scene: "fase-1", entityId: "player", patch: { rotation: { x: 0, y: 0, z: 0, w: 0 } } }))).toEqual(["ZERO_QUATERNION"]);
    expect(await schemaErrorCodes(t.callTool("scene_entity_update", { id: "demo", scene: "fase-1", entityId: "player", patch: { id: "caixa-1" } }))).toEqual(["DUPLICATE_ENTITY_ID"]);
    await expect(t.callTool("scene_entity_update", { id: "demo", scene: "fase-1", entityId: "ninguem", patch: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Remove.
    await t.callTool("scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "temporaria" } });
    const removed = await t.callTool("scene_entity_remove", { id: "demo", scene: "fase-1", entityId: "temporaria" });
    expect(removed.document.entities.map((e: any) => e.id)).toEqual(["player", "caixa-1"]);
    await expect(t.callTool("scene_entity_remove", { id: "demo", scene: "fase-1", entityId: "temporaria" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const read = await t.callTool("scene_read", { id: "demo", scene: "fase-1" });
    expect(read.document).toEqual(removed.document);
    const text = await readFile(path.join(repo.root, read.file), "utf8");
    expect(text).toBe(`${JSON.stringify(read.document, null, 2)}\n`);
    await expect(t.callTool("scene_read", { id: "demo", scene: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await t.callTool("prefab_read", { id: "demo", prefab: "jogador" })).document.prefabId).toBe("jogador");
    await expect(t.callTool("prefab_read", { id: "demo", prefab: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scene_validate: assets (public, só do projeto, remoto, ausente), prefab e documento avulso", async () => {
    let v = await t.callTool("scene_validate", { id: "demo", scene: "fase-1" });
    expect(v.valid).toBe(false);
    expect(v.errors).toEqual([{ path: "prefabs.jogador.assets[0].url", code: "ASSET_NOT_FOUND", message: expect.any(String) }]);
    expect(v.prefabsUsed).toEqual(["jogador"]);

    // Asset só em src/projects/<id>/assets → válido com aviso ASSET_PROJECT_ONLY.
    await put(repo.root, `${P}/assets/jogador.glb`, makeGlb());
    v = await t.callTool("scene_validate", { id: "demo", scene: "fase-1" });
    expect(v.valid).toBe(true);
    expect(v.warnings.map((w: any) => w.code)).toEqual(["ASSET_PROJECT_ONLY"]);
    expect(v.assets).toEqual([{ id: "jogador-glb", url: "/assets/jogador.glb", type: "gltf", status: "found", file: `${P}/assets/jogador.glb`, location: "project" }]);

    const doc = {
      format: "engine.scene",
      version: 1,
      sceneId: "avulsa",
      sceneName: "Avulsa",
      assets: [
        { id: "trem", url: "/assets/trem.glb", type: "gltf" },
        { id: "cdn", url: "https://cdn.example.com/x.glb", type: "gltf" },
        { id: "rel", url: "assets/jogador.glb", type: "gltf" },
        { id: "embutido", url: "data:image/png;base64,AAAA", type: "texture" },
        { id: "sumiu", url: "/texturas/sumiu.png", type: "texture" },
        { id: "fuga", url: "/../../etc/passwd", type: "texture" },
      ],
      entities: [{ id: "a" }, { id: "a" }],
    };
    v = await t.callTool("scene_validate", { id: "demo", document: doc });
    expect(v.file).toBeNull();
    expect(v.errors.map((e: any) => `${e.path} ${e.code}`)).toEqual(["assets[4].url ASSET_NOT_FOUND", "assets[5].url ASSET_NOT_FOUND", "entities[1].id DUPLICATE_ENTITY_ID"]);
    expect(v.warnings.map((w: any) => w.code)).toEqual(["ASSET_UNVERIFIABLE", "ASSET_PROJECT_ONLY"]);
    expect(Object.fromEntries(v.assets.map((a: any) => [a.id, a.status]))).toEqual({ trem: "found", cdn: "unverifiable", rel: "found", embutido: "embedded", sumiu: "missing", fuga: "missing" });

    await expect(t.callTool("scene_validate", { id: "demo" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("scene_validate", { id: "demo", scene: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scene_create from copia entidades; listas mostram resumo; arquivo com sceneId ≠ nome é inválido", async () => {
    const copy = await t.callTool("scene_create", { id: "demo", sceneId: "fase-2", sceneName: "Fase 2", from: "fase-1" });
    expect(copy.document.sceneId).toBe("fase-2");
    expect(copy.document.entities.map((e: any) => e.id)).toEqual(["player", "caixa-1"]);
    expect(copy.document.worldBounds).toEqual({ min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } });
    await expect(t.callTool("scene_create", { id: "demo", sceneId: "fase-3", sceneName: "F3", from: "nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await put(repo.root, `${P}/scenes/trocada.scene.json`, JSON.stringify({ format: "engine.scene", version: 1, sceneId: "outra", sceneName: "T", entities: [] }));
    await put(repo.root, `${P}/scenes/quebrada.scene.json`, "{ nem json");
    const list = await t.callTool("scene_list", { id: "demo" });
    const byId = Object.fromEntries(list.scenes.map((s: any) => [s.sceneId, s]));
    expect(byId["fase-1"]).toMatchObject({ entities: 2, prefabs: ["jogador"], valid: true, sceneName: "Fase 1" });
    expect(byId["trocada"]).toMatchObject({ valid: false, errorCount: 1 });
    expect(byId["quebrada"]).toMatchObject({ valid: false, sceneName: null });
    const v = await t.callTool("scene_validate", { id: "demo", scene: "trocada" });
    expect(v.errors.map((e: any) => e.code)).toEqual(["FILE_NAME_MISMATCH"]);
    expect((await t.callTool("scene_validate", { id: "demo", scene: "quebrada" })).errors.map((e: any) => e.code)).toEqual(["INVALID_JSON"]);
    await expect(t.callTool("scene_read", { id: "demo", scene: "quebrada" })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });

    const prefabs = await t.callTool("prefab_list", { id: "demo" });
    expect(prefabs.prefabs).toEqual([
      { prefabId: "jogador", file: `${P}/prefabs/jogador.prefab.json`, type: "player", tags: ["player", "vivo"], assets: ["jogador-glb"], usedBy: ["fase-1", "fase-2"], valid: true, errors: [] },
    ]);
  });

  it("prefab_update: merge de data, tags substituem, devolve cenas que usam; recusa id e inválido", async () => {
    const out = await t.callTool("prefab_update", { id: "demo", prefabId: "jogador", patch: { data: { velocidade: 7, pulo: 2 }, tags: ["player"] } });
    expect(out.document).toMatchObject({ prefabId: "jogador", tags: ["player"], data: { vida: 3, velocidade: 7, pulo: 2 }, $nota: "criado no teste" });
    expect(out.scenesUsing).toEqual([{ sceneId: "fase-1", valid: true }, { sceneId: "fase-2", valid: true }]);
    await expect(t.callTool("prefab_update", { id: "demo", prefabId: "jogador", patch: { prefabId: "outro" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await schemaErrorCodes(t.callTool("prefab_update", { id: "demo", prefabId: "jogador", patch: { assets: [{ id: "x", url: "/x.glb", type: "video" }] } }))).toEqual(["INVALID_ASSET_TYPE"]);
    await expect(t.callTool("prefab_update", { id: "demo", prefabId: "nada", patch: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Prefab quebrado no disco: cenas que o usam ficam inválidas com mensagem clara.
    await put(repo.root, `${P}/prefabs/inimigo.prefab.json`, JSON.stringify({ format: "engine.prefab", version: 1, prefabId: "inimigo", tags: [""] }));
    const v = await t.callTool("scene_validate", { id: "demo", document: { format: "engine.scene", version: 1, sceneId: "x", sceneName: "X", entities: [{ id: "e", prefab: "inimigo" }] } });
    expect(v.errors).toEqual([{ path: "entities[0].prefab", code: "UNKNOWN_PREFAB", message: expect.stringContaining("existe em") }]);
    // ...mas não afetam cenas que não o usam.
    expect((await t.callTool("scene_validate", { id: "demo", scene: "fase-1" })).valid).toBe(true);
  });

  it("round-trip: cena + prefab criados pelo MCP carregam no WorldService.loadSceneDocument", async () => {
    const scene = JSON.parse(await readFile(path.join(repo.root, P, "scenes/fase-1.scene.json"), "utf8")) as SceneDocument;
    const prefab = JSON.parse(await readFile(path.join(repo.root, P, "prefabs/jogador.prefab.json"), "utf8")) as PrefabDocument;
    const { world, emitted, loaded } = createWorld();
    expect(await world.loadSceneDocument(scene, { prefabs: [prefab] })).toBe(true);
    expect(emitted.some((e) => e.type === "game.world.scene-document-error")).toBe(false);
    expect(world.currentSceneId).toBe("fase-1");
    expect(loaded).toEqual(["/assets/jogador.glb"]);
    expect(world.getAllEntities().map((e) => e.entityId)).toEqual(["player", "caixa-1"]);
    const player = world.getEntityState("player");
    expect(player).toMatchObject({ type: "player", position: { x: 0, y: 2, z: 0 }, tags: ["player", "heroi", "lider"] });
    expect(player?.customData).toEqual({ vida: 10, velocidade: 7, pulo: 2, inventario: { espada: 1, arco: 1 } });
    expect(world.getEntityState("caixa-1")).toMatchObject({ type: "prop", position: { x: 3, y: 0.5, z: -2 } });
    expect(JSON.parse(world.serializeWorldState()).worldBounds).toEqual({ min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } });
  });

  it("modo somente leitura: todas as escritas → READONLY; leituras funcionam", async () => {
    const ro = await createTestClient({ root: repo.root, config: { readonly: true } });
    try {
      const calls: Array<[string, Record<string, unknown>]> = [
        ["scene_create", { id: "demo", sceneId: "ro", sceneName: "RO" }],
        ["scene_entity_add", { id: "demo", scene: "fase-1", entity: { id: "ro" } }],
        ["scene_entity_update", { id: "demo", scene: "fase-1", entityId: "player", patch: {} }],
        ["scene_entity_remove", { id: "demo", scene: "fase-1", entityId: "player" }],
        ["prefab_create", { id: "demo", prefab: { prefabId: "ro" } }],
        ["prefab_update", { id: "demo", prefabId: "jogador", patch: {} }],
      ];
      for (const [name, args] of calls) await expect(ro.callTool(name, args), name).rejects.toMatchObject({ code: "READONLY" });
      expect((await ro.callTool("scene_read", { id: "demo", scene: "fase-1" })).document.entities).toHaveLength(2);
    } finally {
      await ro.close();
    }
  });

  it("escrita em _template é proibida (id inválido) e png de teste não vira cena", async () => {
    await put(repo.root, `${P}/scenes/imagem.png`, makePng(1, 1));
    const list = await t.callTool("scene_list", { id: "demo" });
    expect(list.scenes.map((s: any) => s.sceneId)).not.toContain("imagem");
    await expect(t.callTool("scene_create", { id: "_template", sceneId: "x", sceneName: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe.skipIf(!HAS_SAMPLE_GAME)("scenes: repo real (physics-sandbox, somente leitura)", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("scene_validate com documento avulso resolve /projects/physics-sandbox/audio/jump.wav em public/", async () => {
    const v = await t.callTool("scene_validate", {
      id: "physics-sandbox",
      document: { format: "engine.scene", version: 1, sceneId: "teste", sceneName: "Teste", assets: [{ id: "pulo", url: "/projects/physics-sandbox/audio/jump.wav", type: "audio" }], entities: [] },
    });
    expect(v).toMatchObject({ valid: true, warnings: [], assets: [{ id: "pulo", status: "found", location: "public", file: "public/projects/physics-sandbox/audio/jump.wav" }] });
    expect(Array.isArray((await t.callTool("scene_list", { id: "physics-sandbox" })).scenes)).toBe(true);
  });
});
