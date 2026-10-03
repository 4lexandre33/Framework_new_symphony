import type {
  LODEntityDescriptor,
  LODLevel,
  Vector3Streaming,
} from "../../contracts/streaming/types";

export interface LODLevelChangeCallback {
  (entityId: string, previousLevel: LODLevel, newLevel: LODLevel): void;
}

export class DistanceLODManager {
  private readonly lodEntities = new Map<string, LODEntityDescriptor>();
  private readonly hysteresisMargin = 2.0; // Margem para evitar oscilações de LOD nas bordas

  public registerEntity(descriptor: LODEntityDescriptor): void {
    this.lodEntities.set(descriptor.entityId, descriptor);
  }

  public unregisterEntity(entityId: string): boolean {
    return this.lodEntities.delete(entityId);
  }

  public getEntityLOD(entityId: string): LODLevel | null {
    const entity = this.lodEntities.get(entityId);
    return entity ? entity.currentLevel : null;
  }

  public updateLODs(
    cameraPos: Vector3Streaming,
    onLevelChange: LODLevelChangeCallback
  ): void {
    for (const entity of this.lodEntities.values()) {
      const distance = this.calculateDistance(cameraPos, entity.worldPosition);
      const newLevel = this.evaluateLODLevel(distance, entity);

      if (newLevel !== entity.currentLevel) {
        const prevLevel = entity.currentLevel;
        const updatedEntity: LODEntityDescriptor = {
          ...entity,
          currentLevel: newLevel,
        };

        this.lodEntities.set(entity.entityId, updatedEntity);
        onLevelChange(entity.entityId, prevLevel, newLevel);
      }
    }
  }

  private evaluateLODLevel(distance: number, entity: LODEntityDescriptor): LODLevel {
    const levels = entity.lodLevels;
    if (levels.length === 0) return 0;

    let selectedLevel: LODLevel = 0;

    for (const lod of levels) {
      // Aplica a margem de histerese se for uma transição para um nível mais distante
      const effectiveThreshold =
        lod.level > entity.currentLevel
          ? lod.distanceThreshold + this.hysteresisMargin
          : lod.distanceThreshold - this.hysteresisMargin;

      if (distance >= effectiveThreshold) {
        selectedLevel = lod.level;
      }
    }

    return selectedLevel;
  }

  private calculateDistance(posA: Vector3Streaming, posB: Vector3Streaming): number {
    const dx = posA.x - posB.x;
    const dy = posA.y - posB.y;
    const dz = posA.z - posB.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  public clear(): void {
    this.lodEntities.clear();
  }
}