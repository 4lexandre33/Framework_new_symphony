import type {
  EntitySpawnInput,
  PrefabCollection,
  SceneDescriptor,
  SceneDocumentError,
} from "../../../contracts/world/types";

import {
  collectSceneAssets,
  resolveSceneEntities,
  toEntitySpawnInput,
  validateSceneDocument,
} from "../../../contracts/world/scene-document";

import {
  normalizeEntityInput,
} from "./EntityManager";

export type PreparedSceneDocument =
  | {
    readonly ok: true;
    readonly descriptor: SceneDescriptor;
    readonly spawns: ReadonlyArray<EntitySpawnInput>;
  }
  | {
    readonly ok: false;
    readonly sceneId: string | null;
    readonly errors: ReadonlyArray<SceneDocumentError>;
  };

function readSceneId(
  doc: unknown,
): string | null {
  if (
    typeof doc === "object" &&
    doc !== null
  ) {
    const sceneId =
      (doc as Record<string, unknown>)["sceneId"];

    return typeof sceneId === "string"
      ? sceneId
      : null;
  }

  return null;
}

/**
 * Prepara um SceneDocument para carga SEM tocar o mundo: valida documento e
 * prefabs, resolve prefab → entidade, monta o SceneDescriptor (assets da cena
 * + dos prefabs usados) e confere cada spawn com o MESMO normalizador do
 * EntityManager. Se algo falhar, nada deve ser spawnado (carga atômica).
 */
export function prepareSceneDocument(
  doc: unknown,
  prefabs?: PrefabCollection,
): PreparedSceneDocument {
  const sceneId =
    readSceneId(
      doc,
    );

  try {
    const validation =
      validateSceneDocument(
        doc,
        // Sempre com prefabs (vazio se ausente): `entity.prefab` sem o
        // prefab correspondente vira UNKNOWN_PREFAB em vez de exceção.
        { prefabs: prefabs ?? [] },
      );

    if (!validation.ok) {
      return {
        ok: false,
        sceneId,
        errors:
          validation.errors,
      };
    }

    const scene =
      validation.value;

    const spawns =
      resolveSceneEntities(
        scene,
        prefabs,
      ).map(
        toEntitySpawnInput,
      );

    const errors:
      SceneDocumentError[] = [];

    spawns.forEach(
      (spawn, index): void => {
        if (
          normalizeEntityInput(
            spawn,
          ) === null
        ) {
          errors.push({
            path:
              `entities[${String(index)}]`,
            code:
              "SPAWN_REJECTED",
            message:
              `entidade '${spawn.entityId}' recusada pelo spawn`,
          });
        }
      },
    );

    if (errors.length > 0) {
      return {
        ok: false,
        sceneId,
        errors,
      };
    }

    return {
      ok: true,
      descriptor: {
        sceneId:
          scene.sceneId,
        sceneName:
          scene.sceneName,
        assetsToPreload:
          collectSceneAssets(
            scene,
            prefabs,
          ),
        initialEntitiesCount:
          spawns.length,
        ...(scene.worldBounds
          ? { worldBounds: scene.worldBounds }
          : {}),
      },
      spawns,
    };
  } catch (error) {
    return {
      ok: false,
      sceneId,
      errors: [
        {
          path: "",
          code:
            "INTERNAL",
          message:
            `falha ao preparar a cena: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
