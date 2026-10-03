import type {
  SpatialPoint2D,
  SpatialQueryResult,
  WorldPosition3D,
} from "../../contracts/world/types";

interface SpatialGridEntry {
  readonly entityId: string;

  x: number;
  y: number;
  z: number;

  cellX: number;
  cellZ: number;
}

export class SpatialGrid {
  private readonly grid =
    new Map<
      string,
      Set<string>
    >();

  private readonly entities =
    new Map<
      string,
      SpatialGridEntry
    >();

  public constructor(
    private readonly cellSize = 16,
  ) {
    if (
      !Number.isFinite(
        cellSize,
      ) ||
      cellSize <= 0
    ) {
      throw new RangeError(
        "SpatialGrid.cellSize deve ser um número finito maior que zero.",
      );
    }
  }

  public get entityCount(): number {
    return this.entities.size;
  }

  public insert(
    entityId: string,
    position: WorldPosition3D,
  ): void {
    if (
      entityId.length === 0
    ) {
      throw new Error(
        "SpatialGrid.insert requer um entityId válido.",
      );
    }

    const newCellX =
      this.getCellCoordinate(
        position.x,
      );

    const newCellZ =
      this.getCellCoordinate(
        position.z,
      );

    const existing =
      this.entities.get(
        entityId,
      );

    if (existing) {
      this.updateExistingEntry(
        existing,
        position,
        newCellX,
        newCellZ,
      );

      return;
    }

    const entry:
      SpatialGridEntry = {
        entityId,

        x:
          position.x,

        y:
          position.y,

        z:
          position.z,

        cellX:
          newCellX,

        cellZ:
          newCellZ,
      };

    this.entities.set(
      entityId,
      entry,
    );

    this.addToCell(
      entityId,
      newCellX,
      newCellZ,
    );
  }

  public remove(
    entityId: string,
  ): boolean {
    const entry =
      this.entities.get(
        entityId,
      );

    if (!entry) {
      return false;
    }

    this.removeFromCell(
      entityId,
      entry.cellX,
      entry.cellZ,
    );

    this.entities.delete(
      entityId,
    );

    return true;
  }

  public queryRadius(
    center: SpatialPoint2D,
    radius: number,
  ): SpatialQueryResult[] {
    if (
      !Number.isFinite(
        radius,
      ) ||
      radius < 0
    ) {
      return [];
    }

    const results:
      SpatialQueryResult[] = [];

    const minCellX =
      this.getCellCoordinate(
        center.x - radius,
      );

    const maxCellX =
      this.getCellCoordinate(
        center.x + radius,
      );

    const minCellZ =
      this.getCellCoordinate(
        center.z - radius,
      );

    const maxCellZ =
      this.getCellCoordinate(
        center.z + radius,
      );

    const radiusSquared =
      radius * radius;

    for (
      let cellX = minCellX;
      cellX <= maxCellX;
      cellX += 1
    ) {
      for (
        let cellZ = minCellZ;
        cellZ <= maxCellZ;
        cellZ += 1
      ) {
        const cell =
          this.grid.get(
            this.getCellKey(
              cellX,
              cellZ,
            ),
          );

        if (!cell) {
          continue;
        }

        for (
          const entityId of
          cell
        ) {
          const entry =
            this.entities.get(
              entityId,
            );

          if (!entry) {
            continue;
          }

          const dx =
            entry.x -
            center.x;

          const dz =
            entry.z -
            center.z;

          const distanceSquared =
            dx * dx +
            dz * dz;

          if (
            distanceSquared >
            radiusSquared
          ) {
            continue;
          }

          results.push({
            entityId:
              entry.entityId,

            distance:
              Math.sqrt(
                distanceSquared,
              ),

            position: {
              x:
                entry.x,

              y:
                entry.y,

              z:
                entry.z,
            },
          });
        }
      }
    }

    return results;
  }

  public clear(): void {
    this.grid.clear();
    this.entities.clear();
  }

  private updateExistingEntry(
    entry: SpatialGridEntry,
    position: WorldPosition3D,
    newCellX: number,
    newCellZ: number,
  ): void {
    const cellChanged =
      entry.cellX !==
        newCellX ||
      entry.cellZ !==
        newCellZ;

    if (cellChanged) {
      this.removeFromCell(
        entry.entityId,
        entry.cellX,
        entry.cellZ,
      );

      this.addToCell(
        entry.entityId,
        newCellX,
        newCellZ,
      );

      entry.cellX =
        newCellX;

      entry.cellZ =
        newCellZ;
    }

    /*
     * Atualização in-place.
     *
     * Evita destruir/recriar o registro espacial
     * a cada tick enquanto a entidade continua
     * dentro da mesma célula.
     */
    entry.x =
      position.x;

    entry.y =
      position.y;

    entry.z =
      position.z;
  }

  private addToCell(
    entityId: string,
    cellX: number,
    cellZ: number,
  ): void {
    const key =
      this.getCellKey(
        cellX,
        cellZ,
      );

    let cell =
      this.grid.get(
        key,
      );

    if (!cell) {
      cell =
        new Set<string>();

      this.grid.set(
        key,
        cell,
      );
    }

    cell.add(
      entityId,
    );
  }

  private removeFromCell(
    entityId: string,
    cellX: number,
    cellZ: number,
  ): void {
    const key =
      this.getCellKey(
        cellX,
        cellZ,
      );

    const cell =
      this.grid.get(
        key,
      );

    if (!cell) {
      return;
    }

    cell.delete(
      entityId,
    );

    if (
      cell.size === 0
    ) {
      this.grid.delete(
        key,
      );
    }
  }

  private getCellCoordinate(
    value: number,
  ): number {
    return Math.floor(
      value /
        this.cellSize,
    );
  }

  private getCellKey(
    cellX: number,
    cellZ: number,
  ): string {
    return `${cellX}:${cellZ}`;
  }
}