import type {
  AABBBounds3D,
  EntityComponentState,
} from "../../../contracts/world/types";
import {
  EntityManager,
  normalizeEntityInput,
} from "./EntityManager";

export const WORLD_SNAPSHOT_VERSION = "1.1.0";

export interface SerializedWorldSnapshot {
  readonly version: string;
  readonly sceneId: string | null;
  readonly timestamp: number;
  readonly entities: EntityComponentState[];
  /** Limites configurados da cena (1.1.0+). */
  readonly worldBounds?: AABBBounds3D | null;
}

/** Snapshot validado e normalizado, pronto para aplicar. */
export interface ParsedWorldSnapshot {
  readonly sceneId: string | null;
  readonly entities: ReadonlyArray<EntityComponentState>;
  readonly worldBounds: AABBBounds3D | null;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function parseBounds(
  value: unknown,
): AABBBounds3D | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    !isRecord(value["min"]) ||
    !isRecord(value["max"])
  ) {
    return undefined;
  }

  const min = value["min"];
  const max = value["max"];
  const numbers = [min["x"], min["y"], min["z"], max["x"], max["y"], max["z"]];

  for (const number of numbers) {
    if (typeof number !== "number" || !Number.isFinite(number)) {
      return undefined;
    }
  }

  return {
    min: { x: min["x"] as number, y: min["y"] as number, z: min["z"] as number },
    max: { x: max["x"] as number, y: max["y"] as number, z: max["z"] as number },
  };
}

export class WorldStateSerializer {
  public static serialize(
    sceneId: string | null,
    entityManager: EntityManager,
    worldBounds: AABBBounds3D | null = null,
  ): string {
    const entities = entityManager.getAllEntities();
    const snapshot: SerializedWorldSnapshot = {
      version: WORLD_SNAPSHOT_VERSION,
      sceneId,
      timestamp: Date.now(),
      entities,
      worldBounds,
    };

    return JSON.stringify(snapshot);
  }

  /**
   * Valida o snapshot INTEIRO sem efeitos colaterais. Retorna null se o JSON
   * for inválido, se qualquer entidade for inválida ou se houver ids
   * duplicados.
   */
  public static parse(
    serializedData: string,
  ): ParsedWorldSnapshot | null {
    if (typeof serializedData !== "string") {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(serializedData);
    } catch {
      return null;
    }

    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed["entities"])
    ) {
      return null;
    }

    const sceneId = parsed["sceneId"];

    if (
      sceneId !== undefined &&
      sceneId !== null &&
      typeof sceneId !== "string"
    ) {
      return null;
    }

    const worldBounds = parseBounds(parsed["worldBounds"]);

    if (worldBounds === undefined) {
      return null;
    }

    const seen = new Set<string>();
    const entities: EntityComponentState[] = [];

    for (const raw of parsed["entities"] as unknown[]) {
      const entity = normalizeEntityInput(raw);

      if (entity === null || seen.has(entity.entityId)) {
        return null;
      }

      seen.add(entity.entityId);
      entities.push(entity);
    }

    return {
      sceneId: typeof sceneId === "string" ? sceneId : null,
      entities,
      worldBounds,
    };
  }

  /**
   * Compatibilidade: valida antes e só então substitui o conteúdo do
   * EntityManager. Em erro retorna false e não altera nada.
   */
  public static deserialize(
    serializedData: string,
    entityManager: EntityManager,
  ): boolean {
    const snapshot = WorldStateSerializer.parse(serializedData);

    if (snapshot === null) {
      console.error("[WorldStateSerializer] ❌ Snapshot de mundo inválido; estado atual preservado.");
      return false;
    }

    entityManager.clear();

    for (const entityState of snapshot.entities) {
      entityManager.spawnEntity(entityState);
    }

    return true;
  }
}
