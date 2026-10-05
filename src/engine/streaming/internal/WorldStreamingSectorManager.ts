import type {
  SectorCoord,
  SectorLoadingState,
  StreamingSectorDescriptor,
  Vector3Streaming,
} from "../../../contracts/streaming/types";

const DEFAULT_LOAD_RADIUS = 100;
const DEFAULT_HYSTERESIS_MARGIN = 15;

export class WorldStreamingSectorManager {
  private readonly sectors = new Map<string, StreamingSectorDescriptor>();
  private readonly sectorStates = new Map<string, SectorLoadingState>();
  private loadRadius = DEFAULT_LOAD_RADIUS;
  private hysteresisMargin = DEFAULT_HYSTERESIS_MARGIN;

  public setStreamingRadius(
    loadRadius: number,
    hysteresisMargin = DEFAULT_HYSTERESIS_MARGIN,
  ): void {
    this.loadRadius = this.normalizeNonNegative(loadRadius, DEFAULT_LOAD_RADIUS);
    this.hysteresisMargin = this.normalizeNonNegative(
      hysteresisMargin,
      DEFAULT_HYSTERESIS_MARGIN,
    );
  }

  public registerSector(descriptor: StreamingSectorDescriptor): void {
    const key = this.getSectorKey(descriptor.sectorCoord);
    this.sectors.set(key, descriptor);

    if (!this.sectorStates.has(key)) {
      this.sectorStates.set(key, "unloaded");
    }
  }

  public hasSector(coord: SectorCoord): boolean {
    return this.sectors.has(this.getSectorKey(coord));
  }

  public getSectorDescriptor(coord: SectorCoord): StreamingSectorDescriptor | null {
    return this.sectors.get(this.getSectorKey(coord)) ?? null;
  }

  public getSectorKey(coord: SectorCoord): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  public getSectorState(coord: SectorCoord): SectorLoadingState {
    return this.sectorStates.get(this.getSectorKey(coord)) ?? "unloaded";
  }

  public setSectorState(coord: SectorCoord, state: SectorLoadingState): boolean {
    const key = this.getSectorKey(coord);

    if (!this.sectors.has(key)) {
      return false;
    }

    this.sectorStates.set(key, state);
    return true;
  }

  public updateStreamingSectors(
    centerPosition: Vector3Streaming,
    requestLoad: (coord: SectorCoord) => void,
    requestUnload: (coord: SectorCoord) => void,
  ): void {
    const loadThresholdSquared = this.loadRadius * this.loadRadius;
    const unloadRadius = this.loadRadius + this.hysteresisMargin;
    const unloadThresholdSquared = unloadRadius * unloadRadius;

    for (const sector of this.sectors.values()) {
      const key = this.getSectorKey(sector.sectorCoord);
      const currentState = this.sectorStates.get(key) ?? "unloaded";
      const distanceSquared = this.calculateSectorCenterDistanceSquared(
        centerPosition,
        sector,
      );

      if (
        distanceSquared <= loadThresholdSquared &&
        currentState === "unloaded"
      ) {
        this.sectorStates.set(key, "loading");
        requestLoad(sector.sectorCoord);
        continue;
      }

      if (
        distanceSquared > unloadThresholdSquared &&
        currentState === "loaded"
      ) {
        this.sectorStates.set(key, "unloading");
        requestUnload(sector.sectorCoord);
      }
    }
  }

  public getActiveSectors(): ReadonlyArray<SectorCoord> {
    const activeSectors: SectorCoord[] = [];

    for (const [key, state] of this.sectorStates.entries()) {
      if (state !== "loaded") {
        continue;
      }

      const sector = this.sectors.get(key);

      if (sector) {
        activeSectors.push(sector.sectorCoord);
      }
    }

    return activeSectors;
  }

  public clear(): void {
    this.sectors.clear();
    this.sectorStates.clear();
    this.loadRadius = DEFAULT_LOAD_RADIUS;
    this.hysteresisMargin = DEFAULT_HYSTERESIS_MARGIN;
  }

  private calculateSectorCenterDistanceSquared(
    centerPosition: Vector3Streaming,
    sector: StreamingSectorDescriptor,
  ): number {
    const centerX = (sector.boundsMin.x + sector.boundsMax.x) * 0.5;
    const centerY = (sector.boundsMin.y + sector.boundsMax.y) * 0.5;
    const centerZ = (sector.boundsMin.z + sector.boundsMax.z) * 0.5;

    const dx = centerPosition.x - centerX;
    const dy = centerPosition.y - centerY;
    const dz = centerPosition.z - centerZ;

    return dx * dx + dy * dy + dz * dz;
  }

  private normalizeNonNegative(value: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(0, value);
  }
}