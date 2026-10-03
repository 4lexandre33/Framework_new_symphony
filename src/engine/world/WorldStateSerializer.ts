import type { EntityComponentState } from "../../contracts/world/types";
import { EntityManager } from "./EntityManager";

export interface SerializedWorldSnapshot {
  readonly version: string;
  readonly sceneId: string | null;
  readonly timestamp: number;
  readonly entities: EntityComponentState[];
}

export class WorldStateSerializer {
  public static serialize(sceneId: string | null, entityManager: EntityManager): string {
    const entities = entityManager.getAllEntities();
    const snapshot: SerializedWorldSnapshot = {
      version: "1.0.0",
      sceneId,
      timestamp: Date.now(),
      entities,
    };

    return JSON.stringify(snapshot);
  }

  public static deserialize(serializedData: string, entityManager: EntityManager): boolean {
    try {
      const snapshot: SerializedWorldSnapshot = JSON.parse(serializedData);
      if (!snapshot || !Array.isArray(snapshot.entities)) {
        return false;
      }

      entityManager.clear();
      for (const entityState of snapshot.entities) {
        entityManager.spawnEntity(entityState);
      }

      console.log(`[WorldStateSerializer] ✅ Restauradas ${snapshot.entities.length} entidades no estado do mundo.`);
      return true;
    } catch (err) {
      console.error("[WorldStateSerializer] ❌ Falha ao desserializar estado do mundo:", err);
      return false;
    }
  }
}