import type {
  SpatialPoint2D,
  SpatialQueryResult,
  WorldPosition3D,
} from "../../../contracts/world/types";

interface SpatialGridEntry {
  readonly entityId: string;
  x: number;
  y: number;
  z: number;
  cellX: number;
  cellZ: number;
}

export function compareByDistance(
  first: SpatialQueryResult,
  second: SpatialQueryResult,
): number {
  return first.distance - second.distance ||
    (first.entityId < second.entityId
      ? -1
      : first.entityId > second.entityId
        ? 1
        : 0);
}

/**
 * Grade uniforme 2D no plano XZ (Y é ignorado nas consultas).
 *
 * As células são indexadas por coordenadas numéricas em mapas aninhados
 * (sem string por célula). Consultas com raio grande varrem as entidades
 * diretamente quando isso é mais barato que varrer as células.
 */
export class SpatialGrid {
  private readonly grid =
    new Map<
      number,
      Map<number, Set<string>>
    >();

  private readonly entities =
    new Map<
      string,
      SpatialGridEntry
    >();

  private occupiedCellCount = 0;

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

  public get entityCount():
    number {
    return this.entities.size;
  }

  public insert(
    entityId: string,
    position: WorldPosition3D,
  ): void {
    if (
      entityId.length ===
      0
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

  public update(
    entityId: string,
    position: WorldPosition3D,
  ): boolean {
    const entry =
      this.entities.get(
        entityId,
      );

    if (!entry) {
      return false;
    }

    const newCellX =
      this.getCellCoordinate(
        position.x,
      );

    const newCellZ =
      this.getCellCoordinate(
        position.z,
      );

    this.updateExistingEntry(
      entry,
      position,
      newCellX,
      newCellZ,
    );

    return true;
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

  /**
   * Entidades a até `radius` do centro no plano XZ, ordenadas por distância.
   */
  public queryRadius(
    center: SpatialPoint2D,
    radius: number,
  ): SpatialQueryResult[] {
    if (
      !Number.isFinite(
        radius,
      ) ||
      radius < 0 ||
      !Number.isFinite(
        center.x,
      ) ||
      !Number.isFinite(
        center.z,
      )
    ) {
      return [];
    }

    const results:
      SpatialQueryResult[] =
        [];

    const radiusSquared =
      radius *
      radius;

    const minCellX =
      this.getCellCoordinate(
        center.x -
          radius,
      );

    const maxCellX =
      this.getCellCoordinate(
        center.x +
          radius,
      );

    const minCellZ =
      this.getCellCoordinate(
        center.z -
          radius,
      );

    const maxCellZ =
      this.getCellCoordinate(
        center.z +
          radius,
      );

    const cellsToScan =
      (
        maxCellX -
        minCellX +
        1
      ) *
      (
        maxCellZ -
        minCellZ +
        1
      );

    if (
      cellsToScan >
      this.occupiedCellCount
    ) {
      // Raio grande: varrer entidades é mais barato que varrer células vazias.
      for (
        const entry of
        this.entities.values()
      ) {
        this.collectIfInside(
          entry,
          center,
          radiusSquared,
          results,
        );
      }
    } else {
      for (
        let cellX = minCellX;
        cellX <= maxCellX;
        cellX += 1
      ) {
        const column =
          this.grid.get(
            cellX,
          );

        if (!column) {
          continue;
        }

        for (
          let cellZ = minCellZ;
          cellZ <= maxCellZ;
          cellZ += 1
        ) {
          const cell =
            column.get(
              cellZ,
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

            if (entry) {
              this.collectIfInside(
                entry,
                center,
                radiusSquared,
                results,
              );
            }
          }
        }
      }
    }

    results.sort(
      compareByDistance,
    );

    return results;
  }

  public clear(): void {
    this.grid.clear();
    this.entities.clear();
    this.occupiedCellCount = 0;
  }

  private collectIfInside(
    entry: SpatialGridEntry,
    center: SpatialPoint2D,
    radiusSquared: number,
    results: SpatialQueryResult[],
  ): void {
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
      return;
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
    let column =
      this.grid.get(
        cellX,
      );

    if (!column) {
      column =
        new Map<number, Set<string>>();

      this.grid.set(
        cellX,
        column,
      );
    }

    let cell =
      column.get(
        cellZ,
      );

    if (!cell) {
      cell =
        new Set<string>();

      column.set(
        cellZ,
        cell,
      );

      this.occupiedCellCount += 1;
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
    const column =
      this.grid.get(
        cellX,
      );

    const cell =
      column?.get(
        cellZ,
      );

    if (
      !column ||
      !cell
    ) {
      return;
    }

    cell.delete(
      entityId,
    );

    if (
      cell.size ===
      0
    ) {
      column.delete(
        cellZ,
      );

      this.occupiedCellCount -= 1;

      if (
        column.size ===
        0
      ) {
        this.grid.delete(
          cellX,
        );
      }
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
}
