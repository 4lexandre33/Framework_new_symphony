import {
  defineCapability,
} from "@core";

import type {
  AABBBounds3D,
  EntityComponentState,
  EntitySpawnInput,
  EntityStatePatch,
  EntityTransformPatch,
  SceneDescriptor,
  SceneLoadOptions,
  SpatialPoint2D,
  SpatialQueryResult,
  WorldPosition3D,
} from "../contracts/world/types";

export interface WorldApi {
  readonly currentSceneId:
    string | null;

  readonly activeEntityCount:
    number;

  /**
   * Carrega a cena: descarrega a anterior (padrão), pré-carrega
   * `assetsToPreload` via `game.assets` (quando disponível; o progresso é
   * real) e emite scene-loading/scene-loaded. Os assets são liberados no
   * unload da cena.
   */
  loadScene(
    scene: SceneDescriptor,
    options?: SceneLoadOptions,
  ): Promise<boolean>;

  /**
   * Descarrega a cena ativa: emite `entity-despawned` para cada entidade,
   * libera os assets pré-carregados e emite `scene-unloaded`.
   */
  unloadScene(
    sceneId: string,
  ): Promise<boolean>;

  /**
   * Cria (ou substitui, com o mesmo id) uma entidade. Campos ausentes recebem
   * padrões; valores inválidos (não finitos etc.) retornam false sem lançar.
   */
  spawnEntity(
    state: EntitySpawnInput,
  ): boolean;

  despawnEntity(
    entityId: string,
  ): boolean;

  hasEntity(
    entityId: string,
  ): boolean;

  /**
   * Move/gira/escala uma entidade existente (índices espaciais atualizados na
   * hora, sem eventos). Retorna false se a entidade não existe ou o patch é
   * inválido. Adequado para chamar por tick.
   */
  updateEntityTransform(
    entityId: string,
    patch: EntityTransformPatch,
  ): boolean;

  /** Atualiza qualquer campo (type, tags, customData, transform). */
  patchEntity(
    entityId: string,
    patch: EntityStatePatch,
  ): boolean;

  /**
   * Snapshot IMUTÁVEL (congelado) da entidade. Nunca é alterado depois de
   * entregue: atualizações criam um snapshot novo. Seguro para guardar.
   */
  getEntityState(
    entityId: string,
  ): EntityComponentState | null;

  /** Snapshots imutáveis de todas as entidades (array novo). */
  getAllEntities():
    EntityComponentState[];

  /** Consulta 2D no plano XZ (ignora Y), ordenada por distância. */
  querySpatialGrid(
    center: SpatialPoint2D,
    radius: number,
  ): SpatialQueryResult[];

  /**
   * Consulta 3D por AABB (cobre o mundo todo: a octree se expande para
   * entidades fora de `worldBounds`). Ordenada pela distância ao centro do AABB.
   */
  queryOctree(
    bounds: AABBBounds3D,
  ): SpatialQueryResult[];

  /** Consulta 3D por esfera, ordenada por distância. */
  querySphere(
    center: WorldPosition3D,
    radius: number,
  ): SpatialQueryResult[];

  serializeWorldState():
    string;

  /**
   * Valida o JSON INTEIRO antes de tocar o mundo (em erro retorna false e o
   * estado atual fica intacto). Em sucesso emite entity-despawned para as
   * entidades antigas, entity-spawned para as restauradas, restaura o
   * sceneId e emite `state-restored`.
   */
  deserializeWorldState(
    serializedData: string,
  ): boolean;
}

export const WorldToken =
  defineCapability<WorldApi>(
    "game.world",
    "1.0.0",
  );
