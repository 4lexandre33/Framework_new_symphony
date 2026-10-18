// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import { Kernel, type Plugin, type PluginContext } from "@core";

import {
  collectSceneAssets,
  resolveSceneEntities,
  toEntitySpawnInput,
  validatePrefabDocument,
  validateSceneDocument,
  type PrefabDocument,
  type SceneDocument,
  type SceneDocumentErrorCode,
} from "../src/contracts/world/scene-document";
import * as worldContracts from "../src/contracts/world/types";
import { WorldService } from "../src/engine/world/internal/WorldService";
import { createWorldPlugin, worldManifest } from "../src/plugins/world/plugin";
import { WorldToken, type WorldApi } from "../src/tokens/world";

/* ---------------------------------------------------------------- fixtures */

const prefabJogador: PrefabDocument = {
  format: "engine.prefab",
  version: 1,
  prefabId: "jogador",
  type: "player",
  tags: ["player", "vivo"],
  data: { vida: 3, velocidade: 5 },
  assets: [{ id: "jogador-glb", url: "/assets/jogador.glb", type: "gltf" }],
};

function validScene(): SceneDocument {
  return {
    format: "engine.scene",
    version: 1,
    sceneId: "fase-1",
    sceneName: "Fase 1",
    assets: [{ id: "trem", url: "/assets/trem.glb", type: "gltf" }],
    worldBounds: { min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } },
    entities: [
      {
        id: "player",
        prefab: "jogador",
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        tags: ["player", "heroi"],
        data: { vida: 5 },
      },
      { id: "caixa-1", type: "prop", position: { x: 3, y: 0.5, z: -2 } },
      { id: "vazio" },
    ],
  };
}

/** Clona e aplica uma mutação arbitrária (fixtures inválidas). */
function mutate(fn: (doc: Record<string, any>) => void): unknown {
  const doc = JSON.parse(JSON.stringify(validScene())) as Record<string, any>;
  fn(doc);
  return doc;
}

function codesOf(result: { ok: boolean; errors?: ReadonlyArray<{ code: string }> }): string[] {
  return result.ok ? [] : (result.errors ?? []).map((e) => e.code);
}

/* ---------------------------------------------------------------- validação */

describe("validateSceneDocument", () => {
  it("aceita a cena válida (com e sem prefabs) e devolve cópia", () => {
    const doc = validScene();
    const result = validateSceneDocument(doc, { prefabs: [prefabJogador] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(doc);
    expect(result.value).not.toBe(doc);
    expect(result.value.entities[0]?.data).not.toBe(doc.entities[0]?.data);
    // Sem prefabs, a referência ao prefab não é checada.
    expect(validateSceneDocument(doc).ok).toBe(true);
  });

  it("aceita cena mínima e chaves $schema", () => {
    const result = validateSceneDocument({ $schema: "x", format: "engine.scene", version: 1, sceneId: "a", sceneName: "A", entities: [] });
    expect(result.ok).toBe(true);
  });

  it("normaliza quaternion não unitário e rejeita comprimento zero", () => {
    const result = validateSceneDocument(mutate((d) => (d["entities"][0].rotation = { x: 0, y: 2, z: 0, w: 0 })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entities[0]?.rotation).toEqual({ x: 0, y: 1, z: 0, w: 0 });
    expect(codesOf(validateSceneDocument(mutate((d) => (d["entities"][0].rotation = { x: 0, y: 0, z: 0, w: 0 }))))).toEqual(["ZERO_QUATERNION"]);
  });

  const cases: Array<[string, SceneDocumentErrorCode, (d: Record<string, any>) => void, string?]> = [
    ["format errado", "INVALID_FORMAT", (d) => (d["format"] = "engine.prefab"), "format"],
    ["format ausente", "REQUIRED", (d) => delete d["format"], "format"],
    ["versão 2", "UNSUPPORTED_VERSION", (d) => (d["version"] = 2), "version"],
    ["sceneId ausente", "REQUIRED", (d) => delete d["sceneId"], "sceneId"],
    ["sceneId vazio", "INVALID_ID", (d) => (d["sceneId"] = ""), "sceneId"],
    ["sceneId com espaço", "INVALID_ID", (d) => (d["sceneId"] = "fase 1"), "sceneId"],
    ["sceneId > 128", "INVALID_ID", (d) => (d["sceneId"] = "a".repeat(129)), "sceneId"],
    ["sceneId não string", "INVALID_TYPE", (d) => (d["sceneId"] = 3), "sceneId"],
    ["sceneName vazio", "INVALID_NAME", (d) => (d["sceneName"] = "  "), "sceneName"],
    ["campo desconhecido", "UNKNOWN_FIELD", (d) => (d["entites"] = []), "entites"],
    ["campo desconhecido na entidade", "UNKNOWN_FIELD", (d) => (d["entities"][1].postion = {}), "entities[1].postion"],
    ["entities ausente", "REQUIRED", (d) => delete d["entities"], "entities"],
    ["entities não lista", "INVALID_TYPE", (d) => (d["entities"] = {}), "entities"],
    ["entidade não objeto", "NOT_OBJECT", (d) => (d["entities"][1] = 5), "entities[1]"],
    ["entity id inválido", "INVALID_ID", (d) => (d["entities"][1].id = "caixa/1"), "entities[1].id"],
    ["entity id repetido", "DUPLICATE_ENTITY_ID", (d) => (d["entities"][2].id = "player"), "entities[2].id"],
    ["NaN na posição", "NON_FINITE_NUMBER", (d) => (d["entities"][1].position.x = Number.NaN), "entities[1].position.x"],
    ["Infinity na escala", "NON_FINITE_NUMBER", (d) => (d["entities"][0].scale.y = Number.POSITIVE_INFINITY), "entities[0].scale.y"],
    ["componente faltando", "REQUIRED", (d) => delete d["entities"][1].position.z, "entities[1].position.z"],
    ["componente string", "INVALID_TYPE", (d) => (d["entities"][1].position.z = "1"), "entities[1].position.z"],
    ["escala zero", "ZERO_SCALE", (d) => (d["entities"][0].scale.z = 0), "entities[0].scale.z"],
    ["tag vazia", "INVALID_TAG", (d) => (d["entities"][0].tags = [""]), "entities[0].tags[0]"],
    ["tag não string", "INVALID_TYPE", (d) => (d["entities"][0].tags = [1]), "entities[0].tags[0]"],
    ["tipo de asset", "INVALID_ASSET_TYPE", (d) => (d["assets"][0].type = "mesh"), "assets[0].type"],
    ["asset id repetido", "DUPLICATE_ASSET_ID", (d) => d["assets"].push({ id: "trem", url: "/b.glb", type: "gltf" }), "assets[1].id"],
    ["asset url vazia", "INVALID_URL", (d) => (d["assets"][0].url = ""), "assets[0].url"],
    ["asset sem id", "REQUIRED", (d) => delete d["assets"][0].id, "assets[0].id"],
    ["bounds invertidos", "INVALID_BOUNDS", (d) => (d["worldBounds"].min.y = 99), "worldBounds.y"],
    ["data não objeto", "NOT_OBJECT", (d) => (d["entities"][0].data = [1]), "entities[0].data"],
    ["data muito grande", "DATA_TOO_LARGE", (d) => (d["entities"][0].data = { s: "x".repeat(70_000) }), "entities[0].data"],
    ["muitas entidades", "TOO_MANY_ENTITIES", (d) => (d["entities"] = Array.from({ length: 10_001 }, (_, i) => ({ id: `e${String(i)}` }))), "entities"],
  ];

  it.each(cases)("%s → %s", (_name, code, fn, path) => {
    const result = validateSceneDocument(mutate(fn));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.code)).toContain(code);
    if (path !== undefined) expect(result.errors.find((e) => e.code === code)?.path).toBe(path);
    for (const error of result.errors) expect(error.message.length).toBeGreaterThan(0);
  });

  it("raiz não objeto → NOT_OBJECT", () => {
    expect(codesOf(validateSceneDocument(null))).toEqual(["NOT_OBJECT"]);
    expect(codesOf(validateSceneDocument([]))).toEqual(["NOT_OBJECT"]);
  });

  it("data precisa ser JSON puro, com profundidade ≤ 16 e sem ciclos", () => {
    const withFn = mutate(() => {}) as Record<string, any>;
    withFn["entities"][0].data = { f: (): void => {} };
    expect(codesOf(validateSceneDocument(withFn))).toEqual(["DATA_NOT_JSON"]);

    const withDate = mutate(() => {}) as Record<string, any>;
    withDate["entities"][0].data = { d: new Date() };
    expect(codesOf(validateSceneDocument(withDate))).toEqual(["DATA_NOT_JSON"]);

    const withUndefined = mutate(() => {}) as Record<string, any>;
    withUndefined["entities"][0].data = { u: undefined, n: Number.NaN };
    expect(codesOf(validateSceneDocument(withUndefined))).toEqual(["DATA_NOT_JSON", "DATA_NOT_JSON"]);

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const withCycle = mutate(() => {}) as Record<string, any>;
    withCycle["entities"][0].data = cyclic;
    expect(codesOf(validateSceneDocument(withCycle))).toEqual(["DATA_NOT_JSON"]);

    const deep = (n: number): Record<string, unknown> => (n === 1 ? { leaf: 1 } : { child: deep(n - 1) });
    const ok16 = mutate((d) => (d["entities"][0].data = deep(16)));
    expect(validateSceneDocument(ok16).ok).toBe(true);
    const deep17 = mutate((d) => (d["entities"][0].data = deep(17)));
    expect(codesOf(validateSceneDocument(deep17))).toEqual(["DATA_TOO_DEEP"]);
  });

  it("com prefabs: UNKNOWN_PREFAB, prefab inválido, id divergente, repetido e conflito de asset", () => {
    const unknown = validateSceneDocument(mutate((d) => (d["entities"][0].prefab = "inimigo")), { prefabs: [prefabJogador] });
    expect(codesOf(unknown)).toEqual(["UNKNOWN_PREFAB"]);
    if (!unknown.ok) expect(unknown.errors[0]?.path).toBe("entities[0].prefab");

    expect(codesOf(validateSceneDocument(validScene(), { prefabs: { outro: prefabJogador } }))).toEqual(["PREFAB_ID_MISMATCH"]);
    expect(codesOf(validateSceneDocument(validScene(), { prefabs: [prefabJogador, prefabJogador] }))).toEqual(["DUPLICATE_PREFAB_ID"]);
    const badPrefab = { ...prefabJogador, version: 3 } as unknown as PrefabDocument;
    const bad = validateSceneDocument(validScene(), { prefabs: [badPrefab] });
    expect(codesOf(bad)).toEqual(["UNSUPPORTED_VERSION"]);
    if (!bad.ok) expect(bad.errors[0]?.path).toBe("prefabs[0].version");

    const conflicting: PrefabDocument = { ...prefabJogador, assets: [{ id: "trem", url: "/outro.glb", type: "gltf" }] };
    expect(codesOf(validateSceneDocument(validScene(), { prefabs: [conflicting] }))).toEqual(["ASSET_CONFLICT"]);

    const big: PrefabDocument = { ...prefabJogador, data: { a: "x".repeat(40_000) } };
    const bigScene = mutate((d) => (d["entities"][0].data = { b: "y".repeat(40_000) }));
    expect(validateSceneDocument(bigScene).ok).toBe(true);
    expect(codesOf(validateSceneDocument(bigScene, { prefabs: [big] }))).toEqual(["DATA_TOO_LARGE"]);
  });

  it("assetExists: ASSET_NOT_FOUND na cena e nos prefabs; exceção conta como inexistente", () => {
    const result = validateSceneDocument(validScene(), { prefabs: [prefabJogador], assetExists: (a) => a.id !== "jogador-glb" });
    expect(codesOf(result)).toEqual(["ASSET_NOT_FOUND"]);
    if (!result.ok) expect(result.errors[0]?.path).toBe("prefabs[0].assets[0].url");
    expect(codesOf(validateSceneDocument(validScene(), { assetExists: () => { throw new Error("x"); } }))).toEqual(["ASSET_NOT_FOUND"]);
    expect(validateSceneDocument(validScene(), { assetExists: () => true }).ok).toBe(true);
  });

  it("trunca listas enormes de erros com TOO_MANY_ERRORS", () => {
    const doc = mutate((d) => (d["entities"] = Array.from({ length: 500 }, () => ({ id: "" }))));
    const result = validateSceneDocument(doc);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(201);
    expect(result.errors.at(-1)?.code).toBe("TOO_MANY_ERRORS");
  });
});

describe("validatePrefabDocument", () => {
  it("aceita prefab válido e mínimo", () => {
    expect(validatePrefabDocument(prefabJogador)).toEqual({ ok: true, value: prefabJogador });
    expect(validatePrefabDocument({ format: "engine.prefab", version: 1, prefabId: "p" }).ok).toBe(true);
  });

  it.each<[string, unknown, SceneDocumentErrorCode]>([
    ["format", { ...prefabJogador, format: "engine.scene" }, "INVALID_FORMAT"],
    ["versão", { ...prefabJogador, version: 0 }, "UNSUPPORTED_VERSION"],
    ["sem prefabId", { format: "engine.prefab", version: 1 }, "REQUIRED"],
    ["prefabId inválido", { ...prefabJogador, prefabId: "a b" }, "INVALID_ID"],
    ["campo de transform (não existe em prefab v1)", { ...prefabJogador, position: { x: 0, y: 0, z: 0 } }, "UNKNOWN_FIELD"],
    ["tags", { ...prefabJogador, tags: "player" }, "INVALID_TYPE"],
    ["asset", { ...prefabJogador, assets: [{ id: "a", url: "/a", type: "video" }] }, "INVALID_ASSET_TYPE"],
    ["data", { ...prefabJogador, data: { f: Symbol("x") } }, "DATA_NOT_JSON"],
    ["não objeto", "jogador", "NOT_OBJECT"],
  ])("%s → %s", (_name, doc, code) => {
    expect(codesOf(validatePrefabDocument(doc))).toContain(code);
  });
});

/* ---------------------------------------------------------------- merge */

describe("resolveSceneEntities / collectSceneAssets", () => {
  it("entidade sobrescreve, tags união, data merge raso, assets do prefab", () => {
    const [player, caixa, vazio] = resolveSceneEntities(validScene(), [prefabJogador]);
    expect(player).toEqual({
      id: "player",
      type: "player",
      prefab: "jogador",
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      tags: ["player", "vivo", "heroi"],
      data: { vida: 5, velocidade: 5 },
      assets: [{ id: "jogador-glb", url: "/assets/jogador.glb", type: "gltf" }],
    });
    expect(caixa?.type).toBe("prop");
    expect(vazio).toMatchObject({ type: "entity", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, tags: [], data: {} });
  });

  it("type da entidade vence o do prefab; data é clonado (sem aliasing)", () => {
    const scene: SceneDocument = { ...validScene(), entities: [{ id: "x", prefab: "jogador", type: "boss", data: { obj: { a: 1 } } }] };
    const [x] = resolveSceneEntities(scene, { jogador: prefabJogador });
    expect(x?.type).toBe("boss");
    expect(x?.data["obj"]).toEqual({ a: 1 });
    expect(x?.data["obj"]).not.toBe(scene.entities[0]?.data?.["obj"]);
  });

  it("prefab inexistente lança RangeError (use validateSceneDocument antes)", () => {
    expect(() => resolveSceneEntities(validScene(), [])).toThrow(RangeError);
  });

  it("assets = cena ∪ prefabs usados, sem repetição", () => {
    const unused: PrefabDocument = { format: "engine.prefab", version: 1, prefabId: "nao-usado", assets: [{ id: "z", url: "/z.png", type: "texture" }] };
    expect(collectSceneAssets(validScene(), [prefabJogador, unused]).map((a) => a.id)).toEqual(["trem", "jogador-glb"]);
  });

  it("toEntitySpawnInput mapeia id→entityId e data→customData", () => {
    const [player] = resolveSceneEntities(validScene(), [prefabJogador]);
    expect(player).toBeDefined();
    if (player === undefined) return;
    expect(toEntitySpawnInput(player)).toEqual({
      entityId: "player",
      type: "player",
      position: player.position,
      rotation: player.rotation,
      scale: player.scale,
      tags: player.tags,
      customData: { vida: 5, velocidade: 5 },
    });
  });

  it("é re-exportado por contracts/world/types (fachada pública)", () => {
    expect(worldContracts.validateSceneDocument).toBe(validateSceneDocument);
    expect(worldContracts.SceneDocumentErrorEvent.id ?? worldContracts.SceneDocumentErrorEvent).toBeTruthy();
  });
});

/* ---------------------------------------------------------------- WorldService */

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function createWorld(capabilities: Record<string, unknown> = {}): { world: WorldService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const ctx = {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
    },
    caps: {
      get(token: { id: string }): unknown {
        return capabilities[token.id];
      },
    },
  } as unknown as PluginContext;
  return { world: new WorldService(ctx), emitted };
}

function createFakeAssets(failing: ReadonlySet<string> = new Set()): { loaded: string[]; api: Record<string, unknown> } {
  const loaded: string[] = [];
  const load = async (url: string): Promise<unknown> => {
    if (failing.has(url)) throw new Error(`404 ${url}`);
    loaded.push(url);
    return {};
  };
  return {
    loaded,
    api: { loadGLTF: load, loadTexture: load, loadAudio: load, releaseAsset(): void {}, getAsset: () => null, clearCache(): void {} },
  };
}

describe("WorldService.loadSceneDocument", () => {
  it("gera os mesmos snapshots que spawns manuais, pré-carrega assets e usa worldBounds", async () => {
    const assets = createFakeAssets();
    const { world, emitted } = createWorld({ "game.assets": assets.api });
    expect(await world.loadSceneDocument(validScene(), { prefabs: [prefabJogador] })).toBe(true);

    const manual = createWorld().world;
    expect(await manual.loadScene({ sceneId: "fase-1", sceneName: "Fase 1", assetsToPreload: [] })).toBe(true);
    manual.spawnEntity({ entityId: "player", type: "player", position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, tags: ["player", "vivo", "heroi"], customData: { vida: 5, velocidade: 5 } });
    manual.spawnEntity({ entityId: "caixa-1", type: "prop", position: { x: 3, y: 0.5, z: -2 } });
    manual.spawnEntity({ entityId: "vazio" });

    expect(world.getAllEntities()).toEqual(manual.getAllEntities());
    expect(world.currentSceneId).toBe("fase-1");
    expect(assets.loaded.sort()).toEqual(["/assets/jogador.glb", "/assets/trem.glb"]);
    expect(emitted.filter((e) => e.type === "game.world.entity-spawned").map((e) => e.payload["entityId"])).toEqual(["player", "caixa-1", "vazio"]);
    expect(emitted.some((e) => e.type === "game.world.scene-document-error")).toBe(false);
    // Índices espaciais atualizados.
    expect(world.querySphere({ x: 3, y: 0.5, z: -2 }, 0.1).map((r) => r.entityId)).toEqual(["caixa-1"]);
    expect(JSON.parse(world.serializeWorldState()).worldBounds).toEqual(validScene().worldBounds);
  });

  it("falha de validação: false, evento com erros e NADA spawnado (cena anterior intacta)", async () => {
    const { world, emitted } = createWorld();
    await world.loadScene({ sceneId: "anterior", sceneName: "A", assetsToPreload: [] });
    world.spawnEntity({ entityId: "velho" });
    emitted.length = 0;

    const bad = mutate((d) => (d["entities"][2].scale = { x: 0, y: 1, z: 1 })) as SceneDocument;
    expect(await world.loadSceneDocument(bad, { prefabs: [prefabJogador] })).toBe(false);

    expect(emitted.map((e) => e.type)).toEqual(["game.world.scene-document-error"]);
    expect(emitted[0]?.payload).toEqual({ sceneId: "fase-1", errors: [{ path: "entities[2].scale.x", code: "ZERO_SCALE", message: expect.any(String) }] });
    expect(world.currentSceneId).toBe("anterior");
    expect(world.getAllEntities().map((e) => e.entityId)).toEqual(["velho"]);
  });

  it("prefab ausente nas opções → UNKNOWN_PREFAB", async () => {
    const { world, emitted } = createWorld();
    expect(await world.loadSceneDocument(validScene(), { prefabs: [] })).toBe(false);
    expect((emitted[0]?.payload["errors"] as Array<{ code: string }>).map((e) => e.code)).toEqual(["UNKNOWN_PREFAB"]);
    expect(world.activeEntityCount).toBe(0);
  });

  it("sem prefabs nas opções e entidade com prefab → UNKNOWN_PREFAB (falha atômica)", async () => {
    const { world, emitted } = createWorld();
    expect(await world.loadSceneDocument(validScene())).toBe(false);
    expect((emitted[0]?.payload["errors"] as Array<{ code: string }>).map((e) => e.code)).toEqual(["UNKNOWN_PREFAB"]);
    expect(world.activeEntityCount).toBe(0);
  });

  it("failOnAssetError com asset quebrado → SCENE_LOAD_FAILED e nada spawnado", async () => {
    const assets = createFakeAssets(new Set(["/assets/trem.glb"]));
    const { world, emitted } = createWorld({ "game.assets": assets.api });
    expect(await world.loadSceneDocument(validScene(), { prefabs: [prefabJogador], failOnAssetError: true })).toBe(false);
    const error = emitted.find((e) => e.type === "game.world.scene-document-error");
    expect((error?.payload["errors"] as Array<{ code: string }>).map((e) => e.code)).toEqual(["SCENE_LOAD_FAILED"]);
    expect(world.activeEntityCount).toBe(0);
    expect(world.currentSceneId).toBeNull();
  });

  it("clearPreviousScene=false mantém entidades anteriores", async () => {
    const { world } = createWorld();
    await world.loadScene({ sceneId: "anterior", sceneName: "A", assetsToPreload: [] });
    world.spawnEntity({ entityId: "velho" });
    const scene: SceneDocument = { ...validScene(), entities: [{ id: "novo" }] };
    expect(await world.loadSceneDocument(scene, { clearPreviousScene: false })).toBe(true);
    expect(world.getAllEntities().map((e) => e.entityId).sort()).toEqual(["novo", "velho"]);
  });
});

/* ---------------------------------------------------------------- Kernel real */

describe("game.world no Kernel real", () => {
  const originalRaf = globalThis.requestAnimationFrame;
  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
  });

  it("declara o evento scene-document-error e o entrega a assinantes", async () => {
    expect(worldManifest.permissions?.events).toContain("game.world.scene-document-error");

    let world: WorldApi | undefined;
    const received: unknown[] = [];
    const probe: Plugin = {
      manifest: {
        id: "test.scene-document-probe",
        name: "SceneDocument probe",
        version: "1.0.0",
        kind: "preloaded",
        permissions: { capabilities: [WorldToken.id], events: ["game.world.scene-document-error", "game.world.entity-spawned"] },
        capabilities: {
          provides: [],
          consumes: [{ id: WorldToken.id, range: "^1.0.0", optional: false }],
          conflicts: [],
        },
        lifecycleHooks: {
          onBoot(ctx): void {
            world = ctx.caps.require(WorldToken);
          },
        },
      },
      setup(ctx): void {
        ctx.events.on("game.world.scene-document-error", (env) => {
          received.push(env.payload);
        });
        ctx.lifecycle.ready();
      },
    };

    const kernel = new Kernel();
    kernel.register(createWorldPlugin());
    kernel.register(probe);
    await kernel.boot();
    expect(world).toBeDefined();
    if (world === undefined) return;

    expect(await world.loadSceneDocument({ ...validScene(), sceneId: "" } as SceneDocument, { prefabs: [prefabJogador] })).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ sceneId: "", errors: [{ path: "sceneId", code: "INVALID_ID" }] });

    expect(await world.loadSceneDocument(validScene(), { prefabs: [prefabJogador] })).toBe(true);
    expect(world.getEntityState("player")?.customData).toEqual({ vida: 5, velocidade: 5 });
  });
});
