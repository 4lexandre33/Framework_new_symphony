import type { EntityComponentState } from "../../../contracts/world/types";

export class EntityManager {
  private readonly entityMap = new Map<string, EntityComponentState>();
  private readonly pool: EntityComponentState[] = [];

  public get activeEntityCount(): number {
    return this.entityMap.size;
  }

  public spawnEntity(state: EntityComponentState): boolean {
    if (this.entityMap.has(state.entityId)) {
      this.despawnEntity(state.entityId);
    }

    let allocatedState: EntityComponentState;
    if (this.pool.length > 0) {
      allocatedState = this.pool.pop()!;
      (allocatedState as any).entityId = state.entityId;
      (allocatedState as any).type = state.type;
      (allocatedState as any).position = { ...state.position };
      (allocatedState as any).rotation = { ...state.rotation };
      (allocatedState as any).scale = { ...state.scale };
      (allocatedState as any).tags = [...state.tags];
      (allocatedState as any).customData = { ...state.customData };
    } else {
      allocatedState = { ...state };
    }

    this.entityMap.set(state.entityId, allocatedState);
    return true;
  }

  public despawnEntity(entityId: string): boolean {
    const state = this.entityMap.get(entityId);
    if (!state) return false;

    this.entityMap.delete(entityId);
    if (this.pool.length < 500) {
      this.pool.push(state);
    }
    return true;
  }

  public getEntityState(entityId: string): EntityComponentState | null {
    return this.entityMap.get(entityId) || null;
  }

  public getAllEntities(): EntityComponentState[] {
    return Array.from(this.entityMap.values());
  }

  public clear(): void {
    for (const state of this.entityMap.values()) {
      if (this.pool.length < 500) {
        this.pool.push(state);
      }
    }
    this.entityMap.clear();
  }
}