import type {
  EntityComponentState,
} from "../../../contracts/world/types";

export type EntityStateVisitor = (
  state: EntityComponentState,
) => void;

export class EntityManager {
  private readonly entityMap =
    new Map<
      string,
      EntityComponentState
    >();

  public get activeEntityCount():
    number {
    return this.entityMap.size;
  }

  public spawnEntity(
    state: EntityComponentState,
  ): boolean {
    if (
      state.entityId.length ===
      0
    ) {
      return false;
    }

    /*
     * O EntityManager mantém ownership do snapshot técnico.
     *
     * Não reutilizamos objetos previamente despawnados: referências
     * readonly entregues por getEntityState() nunca podem "renascer"
     * como outra entidade depois de um pool reuse. Spawn/despawn são
     * operações discretas, portanto a cópia acontece fora do hot path.
     */
    const ownedState:
      EntityComponentState = {
        entityId:
          state.entityId,

        type:
          state.type,

        position: {
          x:
            state.position.x,

          y:
            state.position.y,

          z:
            state.position.z,
        },

        rotation: {
          x:
            state.rotation.x,

          y:
            state.rotation.y,

          z:
            state.rotation.z,

          w:
            state.rotation.w,
        },

        scale: {
          x:
            state.scale.x,

          y:
            state.scale.y,

          z:
            state.scale.z,
        },

        tags: [
          ...state.tags,
        ],

        customData: {
          ...state.customData,
        },
      };

    this.entityMap.set(
      ownedState.entityId,
      ownedState,
    );

    return true;
  }

  public despawnEntity(
    entityId: string,
  ): boolean {
    return this.entityMap.delete(
      entityId,
    );
  }

  public getEntityState(
    entityId: string,
  ): EntityComponentState | null {
    return this.entityMap.get(
      entityId,
    ) ?? null;
  }

  public getAllEntities():
    EntityComponentState[] {
    return Array.from(
      this.entityMap.values(),
    );
  }

  public forEachEntity(
    visitor: EntityStateVisitor,
  ): void {
    for (
      const state of
      this.entityMap.values()
    ) {
      visitor(
        state,
      );
    }
  }

  public clear(): void {
    this.entityMap.clear();
  }
}
