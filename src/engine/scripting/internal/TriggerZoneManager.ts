import type {
  TriggerZoneConfig,
  Vector3Scripting,
} from "../../../contracts/scripting/types";

export type TriggerZoneExitReason = "left" | "zone-removed" | "entity-removed";

export interface TriggerZoneCallback {
  (
    type: "enter" | "exit",
    zoneId: string,
    entityId: string,
    position: Vector3Scripting,
    exitReason?: TriggerZoneExitReason,
  ): void;
}

/** Máximo de amostras por zona/entidade na varredura contínua. */
const MAX_SWEEP_SAMPLES = 32;

const ORIGIN: Vector3Scripting = Object.freeze({ x: 0, y: 0, z: 0 });

interface ZoneRecord {
  readonly config: TriggerZoneConfig;
  readonly inside: Set<string>;
  /** Entidades que já dispararam uma zona triggerOnce (escopo "entity"). */
  readonly firedEntities: Set<string>;
  zoneConsumed: boolean;
  readonly onceScope: "entity" | "zone";
  readonly sweep: boolean;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;
  readonly radius: number;
  /** Conjugado normalizado da rotação (para levar o ponto ao espaço local). */
  readonly hasRotation: boolean;
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  /** Menor extensão da zona (passo máximo da varredura). */
  readonly minExtent: number;
  readonly tags: ReadonlyArray<string> | null;
}

interface EntityRecord {
  x: number;
  y: number;
  z: number;
  hasPosition: boolean;
}

export class TriggerZoneManager {
  private readonly zones = new Map<string, ZoneRecord>();
  private readonly entities = new Map<string, EntityRecord>();

  /** Registra (ou re-registra) uma zona. Re-registro emite `exit` de quem estava dentro. */
  public registerZone(config: TriggerZoneConfig, onZoneEvent?: TriggerZoneCallback): boolean {
    const record = createZoneRecord(config);
    if (record === null) return false;

    this.releaseZone(config.zoneId, onZoneEvent);
    this.zones.set(config.zoneId, record);
    return true;
  }

  /** Remove a zona emitindo `exit` (reason "zone-removed") para quem estava dentro. */
  public unregisterZone(zoneId: string, onZoneEvent?: TriggerZoneCallback): boolean {
    return this.releaseZone(zoneId, onZoneEvent);
  }

  public hasZone(zoneId: string): boolean {
    return this.zones.has(zoneId);
  }

  public getZoneConfig(zoneId: string): TriggerZoneConfig | null {
    return this.zones.get(zoneId)?.config ?? null;
  }

  public getEntitiesInZone(zoneId: string): string[] {
    const zone = this.zones.get(zoneId);
    return zone ? Array.from(zone.inside) : [];
  }

  /** true se alguma zona registrada filtra por uma destas tags. */
  public anyZoneTargetsTags(tags: ReadonlyArray<string> | null | undefined): boolean {
    if (!tags || tags.length === 0) return false;
    for (const zone of this.zones.values()) {
      if (zone.tags !== null && tagsMatch(zone.tags, tags)) return true;
    }
    return false;
  }

  /**
   * Verifica a entidade contra todas as zonas. Sem alocação no caminho
   * comum (o registro da entidade é criado uma única vez).
   */
  public checkEntityInZones(
    entityId: string,
    position: Vector3Scripting,
    onZoneEvent: TriggerZoneCallback,
    tags?: ReadonlyArray<string> | null,
    sweep?: boolean,
  ): void {
    if (!isFinitePosition(position)) return;

    const entity = this.getOrCreateEntity(entityId);
    const hadPosition = entity.hasPosition;
    const fromX = entity.x;
    const fromY = entity.y;
    const fromZ = entity.z;

    entity.x = position.x;
    entity.y = position.y;
    entity.z = position.z;
    entity.hasPosition = true;

    for (const zone of this.zones.values()) {
      const wasInside = zone.inside.has(entityId);

      if (wasInside) {
        if (!isInsideZone(zone, position.x, position.y, position.z)) {
          zone.inside.delete(entityId);
          onZoneEvent("exit", zone.config.zoneId, entityId, position, "left");
        }
        continue;
      }

      if (!this.canTrigger(zone, entityId, tags)) continue;

      if (isInsideZone(zone, position.x, position.y, position.z)) {
        this.markEntered(zone, entityId);
        onZoneEvent("enter", zone.config.zoneId, entityId, position);
        continue;
      }

      // Entidade rápida que atravessou a zona entre dois checks (G129).
      if (
        hadPosition &&
        sweep !== false &&
        zone.sweep &&
        segmentCrossesZone(zone, fromX, fromY, fromZ, position.x, position.y, position.z)
      ) {
        this.markEntered(zone, entityId);
        onZoneEvent("enter", zone.config.zoneId, entityId, position);
        zone.inside.delete(entityId);
        onZoneEvent("exit", zone.config.zoneId, entityId, position, "left");
      }
    }
  }

  /**
   * Entidade destruída/removida: `exit` (reason "entity-removed") de todas as
   * zonas onde estava e esquece a posição anterior.
   */
  public removeEntity(entityId: string, onZoneEvent?: TriggerZoneCallback): void {
    const entity = this.entities.get(entityId);
    const position: Vector3Scripting = entity ? { x: entity.x, y: entity.y, z: entity.z } : ORIGIN;

    for (const zone of this.zones.values()) {
      if (zone.inside.delete(entityId)) {
        onZoneEvent?.("exit", zone.config.zoneId, entityId, position, "entity-removed");
      }
      zone.firedEntities.delete(entityId);
    }

    this.entities.delete(entityId);
  }

  public get activeZoneCount(): number {
    return this.zones.size;
  }

  /**
   * Remove todas as zonas. Com callback, emite `exit` ("zone-removed") de
   * quem estava dentro; sem callback, limpa em silêncio (teardown).
   */
  public clear(onZoneEvent?: TriggerZoneCallback): void {
    if (onZoneEvent) {
      for (const zoneId of Array.from(this.zones.keys())) {
        this.releaseZone(zoneId, onZoneEvent);
      }
    }

    this.zones.clear();
    this.entities.clear();
  }

  private releaseZone(zoneId: string, onZoneEvent?: TriggerZoneCallback): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) return false;

    this.zones.delete(zoneId);

    if (onZoneEvent) {
      for (const entityId of zone.inside) {
        const entity = this.entities.get(entityId);
        const position: Vector3Scripting = entity ? { x: entity.x, y: entity.y, z: entity.z } : ORIGIN;
        onZoneEvent("exit", zoneId, entityId, position, "zone-removed");
      }
    }

    zone.inside.clear();
    return true;
  }

  private canTrigger(zone: ZoneRecord, entityId: string, tags: ReadonlyArray<string> | null | undefined): boolean {
    if (zone.config.triggerOnce) {
      if (zone.onceScope === "zone" ? zone.zoneConsumed : zone.firedEntities.has(entityId)) {
        return false;
      }
    }

    if (zone.tags !== null) {
      if (!tags || !tagsMatch(zone.tags, tags)) return false;
    }

    return true;
  }

  private markEntered(zone: ZoneRecord, entityId: string): void {
    zone.inside.add(entityId);
    if (zone.config.triggerOnce) {
      if (zone.onceScope === "zone") {
        zone.zoneConsumed = true;
      } else {
        zone.firedEntities.add(entityId);
      }
    }
  }

  private getOrCreateEntity(entityId: string): EntityRecord {
    let entity = this.entities.get(entityId);
    if (!entity) {
      entity = { x: 0, y: 0, z: 0, hasPosition: false };
      this.entities.set(entityId, entity);
    }
    return entity;
  }
}

function createZoneRecord(config: TriggerZoneConfig): ZoneRecord | null {
  if (
    !config ||
    typeof config.zoneId !== "string" ||
    config.zoneId.length === 0 ||
    (config.shape !== "box" && config.shape !== "sphere" && config.shape !== "cylinder") ||
    !isFinitePosition(config.position)
  ) {
    return null;
  }

  const dims = config.dimensions ?? ORIGIN;
  const dx = finiteAbs(dims.x);
  const dy = finiteAbs(dims.y);
  const dz = finiteAbs(dims.z);

  const radius =
    config.radius !== undefined && Number.isFinite(config.radius)
      ? Math.abs(config.radius)
      : dz;

  const height =
    config.height !== undefined && Number.isFinite(config.height)
      ? Math.abs(config.height)
      : dy;

  let qx = 0;
  let qy = 0;
  let qz = 0;
  let qw = 1;
  let hasRotation = false;

  const rotation = config.rotation;
  if (rotation && Number.isFinite(rotation.x) && Number.isFinite(rotation.y) && Number.isFinite(rotation.z) && Number.isFinite(rotation.w)) {
    const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
    if (length > 1e-9) {
      // Conjugado normalizado: leva o ponto do mundo para o espaço local.
      qx = -rotation.x / length;
      qy = -rotation.y / length;
      qz = -rotation.z / length;
      qw = rotation.w / length;
      hasRotation = Math.abs(qw) < 1 - 1e-12;
    }
  }

  const halfX = config.shape === "box" ? dx * 0.5 : radius;
  const halfY = config.shape === "box" ? dy * 0.5 : config.shape === "cylinder" ? height * 0.5 : radius;
  const halfZ = config.shape === "box" ? dz * 0.5 : radius;

  const minExtent = Math.max(1e-3, Math.min(halfX, halfY, halfZ) * 2);
  const tags = config.targetTags && config.targetTags.length > 0 ? config.targetTags.slice() : null;

  return {
    config,
    inside: new Set<string>(),
    firedEntities: new Set<string>(),
    zoneConsumed: false,
    onceScope: config.triggerOnceScope === "zone" ? "zone" : "entity",
    sweep: config.sweep !== false,
    cx: config.position.x,
    cy: config.position.y,
    cz: config.position.z,
    halfX,
    halfY,
    halfZ,
    radius,
    hasRotation,
    qx,
    qy,
    qz,
    qw,
    minExtent,
    tags,
  };
}

function isInsideZone(zone: ZoneRecord, px: number, py: number, pz: number): boolean {
  let x = px - zone.cx;
  let y = py - zone.cy;
  let z = pz - zone.cz;

  if (zone.hasRotation && zone.config.shape !== "sphere") {
    // v' = q * v * q^-1 (q já é o conjugado da rotação da zona), sem alocar.
    const qx = zone.qx;
    const qy = zone.qy;
    const qz = zone.qz;
    const qw = zone.qw;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  }

  switch (zone.config.shape) {
    case "box":
      return Math.abs(x) <= zone.halfX && Math.abs(y) <= zone.halfY && Math.abs(z) <= zone.halfZ;
    case "sphere":
      return x * x + y * y + z * z <= zone.radius * zone.radius;
    case "cylinder":
      return x * x + z * z <= zone.radius * zone.radius && Math.abs(y) <= zone.halfY;
    default:
      return false;
  }
}

/**
 * Amostra o segmento com passo <= metade da menor extensão da zona (máx.
 * MAX_SWEEP_SAMPLES amostras). Ignora as extremidades (já testadas).
 */
function segmentCrossesZone(
  zone: ZoneRecord,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(length > zone.minExtent * 0.5)) return false;

  // Rejeição rápida pela esfera envolvente da zona.
  const boundRadius = Math.sqrt(zone.halfX * zone.halfX + zone.halfY * zone.halfY + zone.halfZ * zone.halfZ);
  const t0 = Math.max(0, Math.min(1, ((zone.cx - ax) * dx + (zone.cy - ay) * dy + (zone.cz - az) * dz) / (length * length)));
  const nx = ax + dx * t0 - zone.cx;
  const ny = ay + dy * t0 - zone.cy;
  const nz = az + dz * t0 - zone.cz;
  if (nx * nx + ny * ny + nz * nz > boundRadius * boundRadius) return false;

  const samples = Math.min(MAX_SWEEP_SAMPLES, Math.ceil(length / (zone.minExtent * 0.5)));
  for (let index = 1; index < samples; index += 1) {
    const t = index / samples;
    if (isInsideZone(zone, ax + dx * t, ay + dy * t, az + dz * t)) return true;
  }

  // Ponto mais próximo do centro (cobre segmentos muito longos).
  return isInsideZone(zone, ax + dx * t0, ay + dy * t0, az + dz * t0);
}

function tagsMatch(required: ReadonlyArray<string>, tags: ReadonlyArray<string>): boolean {
  for (let i = 0; i < required.length; i += 1) {
    const tag = required[i];
    for (let j = 0; j < tags.length; j += 1) {
      if (tags[j] === tag) return true;
    }
  }
  return false;
}

function isFinitePosition(position: Vector3Scripting | null | undefined): position is Vector3Scripting {
  return (
    position !== null &&
    position !== undefined &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
  );
}

function finiteAbs(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 0;
}
