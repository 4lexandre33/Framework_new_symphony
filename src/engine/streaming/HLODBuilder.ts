import type {
  HLODClusterDescriptor,
  SectorCoord,
} from "../../contracts/streaming/types";

export class HLODBuilder {
  private readonly clusters = new Map<string, HLODClusterDescriptor>();
  private totalDrawCallsSaved = 0;

  public registerCluster(descriptor: HLODClusterDescriptor): void {
    const key = this.getSectorKey(descriptor.sectorCoord);
    this.clusters.set(key, descriptor);

    // Cada cluster substitui N malhas por 1 única malha consolidada
    const saved = Math.max(0, descriptor.staticMeshUrls.length - 1);
    this.totalDrawCallsSaved += saved;
  }

  public getCluster(sectorCoord: SectorCoord): HLODClusterDescriptor | null {
    const key = this.getSectorKey(sectorCoord);
    return this.clusters.get(key) || null;
  }

  public getStats(): { totalClusters: number; drawCallsSaved: number; mergedMeshCount: number } {
    let totalMergedMeshes = 0;
    for (const cluster of this.clusters.values()) {
      totalMergedMeshes += cluster.staticMeshUrls.length;
    }

    return {
      totalClusters: this.clusters.size,
      drawCallsSaved: this.totalDrawCallsSaved,
      mergedMeshCount: totalMergedMeshes,
    };
  }

  private getSectorKey(coord: SectorCoord): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  public clear(): void {
    this.clusters.clear();
    this.totalDrawCallsSaved = 0;
  }
}