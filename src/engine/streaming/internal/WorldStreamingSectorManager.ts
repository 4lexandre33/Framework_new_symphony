import type {
  SectorCoord,
  SectorLoadingState,
  StreamingSectorDescriptor,
  Vector3Streaming,
} from "../../../contracts/streaming/types";

const DEFAULT_LOAD_RADIUS = 100;
const DEFAULT_HYSTERESIS_MARGIN = 15;

export interface LoadedSectorAsset {
  readonly url: string;
  readonly value: unknown;
}

export interface SectorRecord {
  readonly key: string;
  descriptor: StreamingSectorDescriptor;
  state: SectorLoadingState;
  /** `sector-loaded` emitido e ainda não descarregado. */
  loaded: boolean;
  /** Carregado à mão: a regra de raio não descarrega (G60). */
  pinned: boolean;
  /** Descarregado à mão dentro do raio: a regra não recarrega até sair do raio (G60). */
  suppressed: boolean;
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Na fila de carga (estado "loading" sem carga iniciada). */
  queued: boolean;
  queuePriority: number;
  /** Incrementado a cada carga/descarga: cargas antigas são descartadas. */
  token: number;
  startedAt: number;
  assets: LoadedSectorAsset[];
  waiters: Array<(loaded: boolean) => void>;
}

export class WorldStreamingSectorManager {
  private readonly records = new Map<string, SectorRecord>();
  private loadRadius = DEFAULT_LOAD_RADIUS;
  private hysteresisMargin = DEFAULT_HYSTERESIS_MARGIN;

  public setStreamingRadius(loadRadius: number, hysteresisMargin = DEFAULT_HYSTERESIS_MARGIN): void {
    this.loadRadius = this.normalizeNonNegative(loadRadius, DEFAULT_LOAD_RADIUS);
    this.hysteresisMargin = this.normalizeNonNegative(hysteresisMargin, DEFAULT_HYSTERESIS_MARGIN);
  }

  public getLoadRadius(): number {
    return this.loadRadius;
  }

  public getHysteresisMargin(): number {
    return this.hysteresisMargin;
  }

  public registerSector(descriptor: StreamingSectorDescriptor): SectorRecord {
    const key = this.getSectorKey(descriptor.sectorCoord);
    const existing = this.records.get(key);
    const centerX = (descriptor.boundsMin.x + descriptor.boundsMax.x) * 0.5;
    const centerY = (descriptor.boundsMin.y + descriptor.boundsMax.y) * 0.5;
    const centerZ = (descriptor.boundsMin.z + descriptor.boundsMax.z) * 0.5;

    if (existing) {
      // Re-registro atualiza bounds/assets sem perder estado.
      existing.descriptor = descriptor;
      existing.centerX = centerX;
      existing.centerY = centerY;
      existing.centerZ = centerZ;
      return existing;
    }

    const record: SectorRecord = {
      key,
      descriptor,
      state: "unloaded",
      loaded: false,
      pinned: false,
      suppressed: false,
      centerX,
      centerY,
      centerZ,
      queued: false,
      queuePriority: 0,
      token: 0,
      startedAt: 0,
      assets: [],
      waiters: [],
    };

    this.records.set(key, record);
    return record;
  }

  public removeRecord(coord: SectorCoord): SectorRecord | null {
    const key = this.getSectorKey(coord);
    const record = this.records.get(key) ?? null;
    this.records.delete(key);
    return record;
  }

  public getRecord(coord: SectorCoord): SectorRecord | null {
    return this.records.get(this.getSectorKey(coord)) ?? null;
  }

  public values(): IterableIterator<SectorRecord> {
    return this.records.values();
  }

  public get size(): number {
    return this.records.size;
  }

  public hasSector(coord: SectorCoord): boolean {
    return this.records.has(this.getSectorKey(coord));
  }

  public getSectorDescriptor(coord: SectorCoord): StreamingSectorDescriptor | null {
    return this.records.get(this.getSectorKey(coord))?.descriptor ?? null;
  }

  public getSectorKey(coord: SectorCoord): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  public getSectorState(coord: SectorCoord): SectorLoadingState {
    return this.records.get(this.getSectorKey(coord))?.state ?? "unloaded";
  }

  public setSectorState(coord: SectorCoord, state: SectorLoadingState): boolean {
    const record = this.records.get(this.getSectorKey(coord));

    if (!record) {
      return false;
    }

    record.state = state;
    return true;
  }

  /**
   * Regra de raio: pede carga de setores não fixados/suprimidos dentro do
   * raio e descarga dos não fixados fora de raio + histerese.
   */
  public updateStreamingSectors(
    centerPosition: Vector3Streaming,
    requestLoad: (coord: SectorCoord) => void,
    requestUnload: (coord: SectorCoord) => void,
  ): void {
    const loadThresholdSquared = this.loadRadius * this.loadRadius;
    const unloadRadius = this.loadRadius + this.hysteresisMargin;
    const unloadThresholdSquared = unloadRadius * unloadRadius;

    for (const record of this.records.values()) {
      const dx = centerPosition.x - record.centerX;
      const dy = centerPosition.y - record.centerY;
      const dz = centerPosition.z - record.centerZ;
      const distanceSquared = dx * dx + dy * dy + dz * dz;

      if (record.suppressed) {
        if (distanceSquared > unloadThresholdSquared) {
          record.suppressed = false;
        }

        continue;
      }

      if (distanceSquared <= loadThresholdSquared && record.state === "unloaded") {
        record.state = "loading";
        requestLoad(record.descriptor.sectorCoord);
        continue;
      }

      if (
        distanceSquared > unloadThresholdSquared &&
        !record.pinned &&
        (record.state === "loaded" || record.state === "loading")
      ) {
        record.state = "unloading";
        requestUnload(record.descriptor.sectorCoord);
      }
    }
  }

  public getActiveSectors(): ReadonlyArray<SectorCoord> {
    const activeSectors: SectorCoord[] = [];

    for (const record of this.records.values()) {
      if (record.state === "loaded") {
        activeSectors.push(record.descriptor.sectorCoord);
      }
    }

    return activeSectors;
  }

  /** Remove todos os setores (não mexe no raio: G62). */
  public clear(): void {
    this.records.clear();
  }

  private normalizeNonNegative(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(0, value);
  }
}
