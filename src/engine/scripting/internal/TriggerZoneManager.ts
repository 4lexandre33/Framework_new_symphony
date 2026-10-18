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

      // Entidade rápida que atravessou a zona entre dois checks (G129: teste exato do segmento).
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
    tags,
  };
}

/** Saída de `toLocal` (sem alocação; uso síncrono imediato). */
let localX = 0;
let localY = 0;
let localZ = 0;

/** Leva o ponto do mundo ao espaço local da zona (translação + rotação inversa). */
function toLocal(zone: ZoneRecord, px: number, py: number, pz: number): void {
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

  localX = x;
  localY = y;
  localZ = z;
}

function isInsideZone(zone: ZoneRecord, px: number, py: number, pz: number): boolean {
  toLocal(zone, px, py, pz);
  const x = localX;
  const y = localY;
  const z = localZ;

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

/** Intervalo paramétrico atual do segmento (recortado pelas lajes). */
let clipLo = 0;
let clipHi = 1;

/** Recorta [clipLo, clipHi] pela laje |a + t*d| <= half; false se vazio. */
function clipSlab(a: number, d: number, half: number): boolean {
  if (Math.abs(d) < 1e-12) {
    return Math.abs(a) <= half;
  }

  let t0 = (-half - a) / d;
  let t1 = (half - a) / d;

  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }

  if (t0 > clipLo) clipLo = t0;
  if (t1 < clipHi) clipHi = t1;
  return clipLo <= clipHi;
}

/**
 * Teste EXATO segmento x zona (G129) no espaço local: caixa = lajes
 * (slab test), esfera = distância do ponto mais próximo, cilindro = laje em
 * Y + mínimo da quadrática radial no intervalo. Sem alocação.
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
  toLocal(zone, ax, ay, az);
  const lax = localX;
  const lay = localY;
  const laz = localZ;
  toLocal(zone, bx, by, bz);
  const dx = localX - lax;
  const dy = localY - lay;
  const dz = localZ - laz;

  clipLo = 0;
  clipHi = 1;

  switch (zone.config.shape) {
    case "box":
      return clipSlab(lax, dx, zone.halfX) && clipSlab(lay, dy, zone.halfY) && clipSlab(laz, dz, zone.halfZ);
    case "sphere": {
      const lengthSq = dx * dx + dy * dy + dz * dz;
      const t = lengthSq > 1e-24 ? Math.max(0, Math.min(1, -(lax * dx + lay * dy + laz * dz) / lengthSq)) : 0;
      const nx = lax + dx * t;
      const ny = lay + dy * t;
      const nz = laz + dz * t;
      return nx * nx + ny * ny + nz * nz <= zone.radius * zone.radius;
    }
    case "cylinder": {
      if (!clipSlab(lay, dy, zone.halfY)) return false;
      // Mínimo de |(ax,az) + t*(dx,dz)|^2 com t em [clipLo, clipHi].
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq > 1e-24 ? -(lax * dx + laz * dz) / lengthSq : clipLo;
      if (t < clipLo) t = clipLo;
      if (t > clipHi) t = clipHi;
      const nx = lax + dx * t;
      const nz = laz + dz * t;
      return nx * nx + nz * nz <= zone.radius * zone.radius;
    }
    default:
      return false;
  }
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
