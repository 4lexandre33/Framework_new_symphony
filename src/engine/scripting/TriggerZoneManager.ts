import type {
  TriggerZoneConfig,
  Vector3Scripting,
} from "../../contracts/scripting/types";

export interface TriggerZoneCallback {
  (type: "enter" | "exit", zoneId: string, entityId: string, position: Vector3Scripting): void;
}

export class TriggerZoneManager {
  private readonly zones = new Map<string, TriggerZoneConfig>();
  private readonly entityInsideZones = new Map<string, Set<string>>();
  private readonly triggeredOnceZones = new Set<string>();

  public registerZone(config: TriggerZoneConfig): void {
    this.zones.set(config.zoneId, config);
    this.entityInsideZones.set(config.zoneId, new Set<string>());
    this.triggeredOnceZones.delete(config.zoneId);
  }

  public unregisterZone(zoneId: string): boolean {
    this.entityInsideZones.delete(zoneId);
    this.triggeredOnceZones.delete(zoneId);
    return this.zones.delete(zoneId);
  }

  public checkEntityInZones(
    entityId: string,
    position: Vector3Scripting,
    onZoneEvent: TriggerZoneCallback,
  ): void {
    for (const zone of this.zones.values()) {
      if (zone.triggerOnce && this.triggeredOnceZones.has(zone.zoneId)) {
        continue;
      }

      let insideSet = this.entityInsideZones.get(zone.zoneId);
      if (!insideSet) {
        insideSet = new Set<string>();
        this.entityInsideZones.set(zone.zoneId, insideSet);
      }

      const isInside = this.isPositionInsideZone(position, zone);
      const wasInside = insideSet.has(entityId);

      if (isInside && !wasInside) {
        insideSet.add(entityId);
        onZoneEvent("enter", zone.zoneId, entityId, position);

        if (zone.triggerOnce) {
          this.triggeredOnceZones.add(zone.zoneId);
          insideSet.clear();
        }

        continue;
      }

      if (!isInside && wasInside) {
        insideSet.delete(entityId);
        onZoneEvent("exit", zone.zoneId, entityId, position);
      }
    }
  }

  public get activeZoneCount(): number {
    return this.zones.size;
  }

  public clear(): void {
    this.zones.clear();
    this.entityInsideZones.clear();
    this.triggeredOnceZones.clear();
  }

  private isPositionInsideZone(position: Vector3Scripting, zone: TriggerZoneConfig): boolean {
    switch (zone.shape) {
      case "box":
        return this.isInsideBox(position, zone);
      case "sphere":
        return this.isInsideSphere(position, zone);
      case "cylinder":
        return this.isInsideCylinder(position, zone);
    }
  }

  private isInsideBox(position: Vector3Scripting, zone: TriggerZoneConfig): boolean {
    const halfWidth = Math.abs(zone.dimensions.x) * 0.5;
    const halfHeight = Math.abs(zone.dimensions.y) * 0.5;
    const halfDepth = Math.abs(zone.dimensions.z) * 0.5;

    return (
      position.x >= zone.position.x - halfWidth &&
      position.x <= zone.position.x + halfWidth &&
      position.y >= zone.position.y - halfHeight &&
      position.y <= zone.position.y + halfHeight &&
      position.z >= zone.position.z - halfDepth &&
      position.z <= zone.position.z + halfDepth
    );
  }

  private isInsideSphere(position: Vector3Scripting, zone: TriggerZoneConfig): boolean {
    const radius = Math.abs(zone.dimensions.z);
    const dx = position.x - zone.position.x;
    const dy = position.y - zone.position.y;
    const dz = position.z - zone.position.z;

    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }

  private isInsideCylinder(position: Vector3Scripting, zone: TriggerZoneConfig): boolean {
    const radius = Math.abs(zone.dimensions.z);
    const halfHeight = Math.abs(zone.dimensions.y) * 0.5;
    const dx = position.x - zone.position.x;
    const dz = position.z - zone.position.z;
    const relativeY = Math.abs(position.y - zone.position.y);

    return dx * dx + dz * dz <= radius * radius && relativeY <= halfHeight;
  }
}
