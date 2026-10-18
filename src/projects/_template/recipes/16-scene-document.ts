// Cena em dados (SceneDocument v1): opcional — spawn à mão continua valendo. Arquivos em
// src/projects/<id>/scenes/*.scene.json e prefabs/*.prefab.json (o MCP cria/valida esses arquivos).
// Mapeamento: id→entityId, type→type, position/rotation/scale iguais, tags→tags, data→customData.
import type { WorldApi } from "../../../tokens/world";
import { validateSceneDocument, type PrefabDocument, type SceneDocument } from "../../../contracts/world/types";

const jogador: PrefabDocument = {
  format: "engine.prefab", version: 1, prefabId: "jogador",
  type: "player", tags: ["player"], data: { vida: 3, velocidade: 5 },
  assets: [{ id: "jogador-modelo", url: "/assets/jogador.glb", type: "gltf" }],
};

const fase1: SceneDocument = {
  format: "engine.scene", version: 1, sceneId: "fase-1", sceneName: "Fase 1",
  assets: [{ id: "chao", url: "/assets/chao.png", type: "texture" }],
  entities: [
    // Campos da entidade vencem o prefab; tags = união; data = merge raso → { vida: 5, velocidade: 5 }.
    { id: "player", prefab: "jogador", position: { x: 0, y: 1, z: 0 }, data: { vida: 5 } },
    { id: "caixa-1", type: "prop", position: { x: 3, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
  ],
};

/** Valida → pré-carrega assets (cena + prefabs usados) → spawna. Falha: false e nada spawnado. */
export async function loadFase1(world: WorldApi): Promise<boolean> {
  const ok = await world.loadSceneDocument(fase1, { prefabs: [jogador], failOnAssetError: false });
  // Os spawns acontecem depois de `scene-loaded`: use a entidade só após o await.
  return ok && world.hasEntity("player");
}

/** Mesma validação usada pela engine e pelo MCP (pura, sem DOM): útil em testes do jogo. */
export function checkFase1(): string[] {
  const result = validateSceneDocument(fase1, { prefabs: [jogador] });
  return result.ok ? [] : result.errors.map((e) => `${e.path} ${e.code}: ${e.message}`);
}

// Erros de carga chegam também como evento (declare em permissions.events do seu plugin):
// ctx.events.on("game.world.scene-document-error", (env) => console.error((env.payload as SceneDocumentErrorPayload).errors /* tipo em contracts/world/types */));
