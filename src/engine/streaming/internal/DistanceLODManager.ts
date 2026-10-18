import type {
  LODEntityDescriptor,
  LODLevel,
  LODLevelDescriptor,
  Vector3Streaming,
} from "../../../contracts/streaming/types";

export interface LODLevelChangeCallback {
  (entityId: string, previousLevel: LODLevel, newLevel: LODLevel, meshUrl: string): void;
}

interface LODRecord {
  readonly entityId: string;
  x: number;
  y: number;
  z: number;
  /** Ordenados por distanceThreshold crescente (G63). */
  readonly levels: ReadonlyArray<LODLevelDescriptor>;
  currentIndex: number;
  currentLevel: LODLevel;
  readonly hysteresis: number | undefined;
}

const DEFAULT_HYSTERESIS = 2;

/**
 * G132: `meshUrl` parece URL de asset (esquema http(s)/blob/data/file/asset/tauri, caminho `/` `./` `../` ou
 * extensão de arquivo no último segmento)? Chaves como `"tree-low"` não.
 */
export function isLikelyAssetUrl(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  if (/^(?:https?|blob|data|file|asset|tauri):/iu.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }

  const clean = value.split(/[?#]/u, 1)[0] ?? "";
  const slash = clean.lastIndexOf("/");
  return /\.[a-z0-9]{1,8}$/iu.test(slash >= 0 ? clean.slice(slash + 1) : clean);
}

export class DistanceLODManager {
  private readonly lodEntities = new Map<string, LODRecord>();
  private hysteresisMargin = DEFAULT_HYSTERESIS;

  public setHysteresis(margin: number): void {
    this.hysteresisMargin = Number.isFinite(margin) ? Math.max(0, margin) : DEFAULT_HYSTERESIS;
  }

  public getHysteresis(): number {
    return this.hysteresisMargin;
  }

  /**
   * Registra (ou substitui) a entidade. Com `center`, o nível real é avaliado
   * na hora (sem histerese) e `onLevelChange` é chamado se diferir do
   * `currentLevel` declarado (G63).
   */
  public registerEntity(
    descriptor: LODEntityDescriptor,
    center?: Vector3Streaming | null,
    onLevelChange?: LODLevelChangeCallback,
  ): void {
    const levels = [...descriptor.lodLevels].sort((a, b) => a.distanceThreshold - b.distanceThreshold);
    let currentIndex = levels.findIndex((level) => level.level === descriptor.currentLevel);

    if (currentIndex < 0) {
      currentIndex = 0;
    }

    const hysteresis = descriptor.hysteresis;
    const record: LODRecord = {
      entityId: descriptor.entityId,
      x: descriptor.worldPosition.x,
      y: descriptor.worldPosition.y,
      z: descriptor.worldPosition.z,
      levels,
      currentIndex,
      currentLevel: descriptor.currentLevel,
      hysteresis: typeof hysteresis === "number" && Number.isFinite(hysteresis) ? Math.max(0, hysteresis) : undefined,
    };

    this.lodEntities.set(descriptor.entityId, record);

    if (center && levels.length > 0) {
      const index = this.selectIndex(record, this.distance(center, record), 0);
      this.apply(record, index, onLevelChange);
    }
  }

  public unregisterEntity(entityId: string): boolean {
    return this.lodEntities.delete(entityId);
  }

  /** Move a entidade (G63). O nível é reavaliado no próximo update. */
  public updateEntityPosition(entityId: string, position: Vector3Streaming): boolean {
    const record = this.lodEntities.get(entityId);

    if (!record || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      return false;
    }

    record.x = position.x;
    record.y = position.y;
    record.z = position.z;
    return true;
  }

  public getEntityLOD(entityId: string): LODLevel | null {
    return this.lodEntities.get(entityId)?.currentLevel ?? null;
  }

  public getEntityLevelDescriptor(entityId: string): LODLevelDescriptor | null {
    const record = this.lodEntities.get(entityId);
    return record?.levels[record.currentIndex] ?? null;
  }

  public getEntityMeshUrl(entityId: string): string | null {
    const record = this.lodEntities.get(entityId);
    return record?.levels[record.currentIndex]?.meshUrl ?? null;
  }

  public get size(): number {
    return this.lodEntities.size;
  }

  public updateLODs(cameraPos: Vector3Streaming, onLevelChange: LODLevelChangeCallback): void {
    for (const record of this.lodEntities.values()) {
      if (record.levels.length === 0) {
        continue;
      }

      const margin = record.hysteresis ?? this.hysteresisMargin;
      const index = this.selectIndex(record, this.distance(cameraPos, record), margin);
      this.apply(record, index, onLevelChange);
    }
  }

  public clear(): void {
    this.lodEntities.clear();
  }

  private apply(record: LODRecord, index: number, onLevelChange?: LODLevelChangeCallback): void {
    if (index === record.currentIndex && record.levels[index]?.level === record.currentLevel) {
      return;
    }

    const level = record.levels[index];

    if (!level) {
      return;
    }

    const previous = record.currentLevel;
    record.currentIndex = index;
    record.currentLevel = level.level;

    if (previous !== level.level) {
      onLevelChange?.(record.entityId, previous, level.level, level.meshUrl);
    }
  }

  /**
   * Maior índice cujo limiar foi atingido. Subir de nível exige passar o
   * limiar + margem; manter/descer usa limiar - margem (sem oscilação).
   */
  private selectIndex(record: LODRecord, distance: number, margin: number): number {
    const levels = record.levels;
    let selected = 0;

    for (let index = 0; index < levels.length; index += 1) {
      const threshold = (levels[index] as LODLevelDescriptor).distanceThreshold;
      const effective = index > record.currentIndex ? threshold + margin : threshold - margin;

      if (distance >= effective) {
        selected = index;
      }
    }

    return selected;
  }

  private distance(position: Vector3Streaming, record: LODRecord): number {
    const dx = position.x - record.x;
    const dy = position.y - record.y;
    const dz = position.z - record.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
