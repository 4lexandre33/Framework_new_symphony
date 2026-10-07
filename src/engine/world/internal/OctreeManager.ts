import type {
  AABBBounds3D,
  SpatialQueryResult,
  WorldPosition3D,
} from "../../../contracts/world/types";

interface MutableWorldPosition3D {
  x: number;
  y: number;
  z: number;
}

interface OctreeEntry {
  readonly entityId: string;
  readonly position:
    MutableWorldPosition3D;
}

export interface OctreeNode {
  bounds: AABBBounds3D;
  entities: OctreeEntry[];
  children: OctreeNode[] | null;
}

const DEFAULT_BOUNDS:
  AABBBounds3D = {
    min: {
      x: -500,
      y: -500,
      z: -500,
    },

    max: {
      x: 500,
      y: 500,
      z: 500,
    },
  };

export class OctreeManager {
  private readonly entries =
    new Map<
      string,
      OctreeEntry
    >();

  private readonly root:
    OctreeNode;

  private readonly maxEntitiesPerNode =
    8;

  private readonly maxDepth =
    5;

  private indexDirty =
    false;

  public constructor(
    bounds:
      AABBBounds3D =
        DEFAULT_BOUNDS,
  ) {
    this.root = {
      bounds:
        this.cloneBounds(
          bounds,
        ),

      entities: [],
      children: null,
    };
  }

  public get entityCount():
    number {
    return this.entries.size;
  }

  public resetBounds(
    bounds: AABBBounds3D,
  ): void {
    this.root.bounds =
      this.cloneBounds(
        bounds,
      );

    this.root.entities.length =
      0;

    this.root.children =
      null;

    /*
     * Entries pertencem ao mundo, não à árvore materializada.
     * Isso preserva entidades quando uma SceneLoad usa
     * clearPreviousScene=false; a árvore será reconstruída lazily.
     */
    this.indexDirty =
      this.entries.size >
      0;
  }

  public insert(
    entityId: string,
    position: WorldPosition3D,
  ): void {
    const existing =
      this.entries.get(
        entityId,
      );

    if (existing) {
      this.writePosition(
        existing.position,
        position,
      );

      this.indexDirty =
        true;

      return;
    }

    this.entries.set(
      entityId,
      {
        entityId,

        position: {
          x:
            position.x,

          y:
            position.y,

          z:
            position.z,
        },
      },
    );

    this.indexDirty =
      true;
  }

  public update(
    entityId: string,
    position: WorldPosition3D,
  ): boolean {
    const entry =
      this.entries.get(
        entityId,
      );

    if (!entry) {
      return false;
    }

    if (
      entry.position.x ===
        position.x &&
      entry.position.y ===
        position.y &&
      entry.position.z ===
        position.z
    ) {
      return true;
    }

    this.writePosition(
      entry.position,
      position,
    );

    this.indexDirty =
      true;

    return true;
  }

  public remove(
    entityId: string,
  ): boolean {
    const removed =
      this.entries.delete(
        entityId,
      );

    if (removed) {
      this.indexDirty =
        true;
    }

    return removed;
  }

  public queryBounds(
    bounds: AABBBounds3D,
  ): SpatialQueryResult[] {
    this.ensureIndex();

    const results:
      SpatialQueryResult[] = [];

    this.queryNodeBounds(
      this.root,
      bounds,
      results,
    );

    return results;
  }

  public clear(): void {
    this.entries.clear();
    this.root.entities.length = 0;
    this.root.children = null;
    this.indexDirty = false;
  }

  public getNodeCount():
    number {
    this.ensureIndex();

    return this.countNodes(
      this.root,
    );
  }

  private ensureIndex(): void {
    if (!this.indexDirty) {
      return;
    }

    this.root.entities.length =
      0;

    this.root.children =
      null;

    for (
      const entry of
      this.entries.values()
    ) {
      this.insertIntoNode(
        this.root,
        entry,
        0,
      );
    }

    this.indexDirty =
      false;
  }

  private countNodes(
    node: OctreeNode,
  ): number {
    let count =
      1;

    const children =
      node.children;

    if (!children) {
      return count;
    }

    for (
      const child of
      children
    ) {
      count +=
        this.countNodes(
          child,
        );
    }

    return count;
  }

  private insertIntoNode(
    node: OctreeNode,
    entry: OctreeEntry,
    depth: number,
  ): boolean {
    if (
      !this.containsPoint(
        node.bounds,
        entry.position,
      )
    ) {
      return false;
    }

    const children =
      node.children;

    if (children) {
      for (
        const child of
        children
      ) {
        if (
          this.insertIntoNode(
            child,
            entry,
            depth + 1,
          )
        ) {
          return true;
        }
      }
    }

    node.entities.push(
      entry,
    );

    if (
      node.entities.length >
        this.maxEntitiesPerNode &&
      depth <
        this.maxDepth &&
      node.children ===
        null
    ) {
      this.subdivide(
        node,
      );

      this.redistributeNodeEntities(
        node,
        depth,
      );
    }

    return true;
  }

  private redistributeNodeEntities(
    node: OctreeNode,
    depth: number,
  ): void {
    const children =
      node.children;

    if (!children) {
      return;
    }

    const pending =
      node.entities;

    node.entities =
      [];

    for (
      const entry of
      pending
    ) {
      let inserted =
        false;

      for (
        const child of
        children
      ) {
        if (
          this.insertIntoNode(
            child,
            entry,
            depth + 1,
          )
        ) {
          inserted =
            true;

          break;
        }
      }

      if (!inserted) {
        node.entities.push(
          entry,
        );
      }
    }
  }

  private subdivide(
    node: OctreeNode,
  ): void {
    const min =
      node.bounds.min;

    const max =
      node.bounds.max;

    const midX =
      (
        min.x +
        max.x
      ) *
      0.5;

    const midY =
      (
        min.y +
        max.y
      ) *
      0.5;

    const midZ =
      (
        min.z +
        max.z
      ) *
      0.5;

    node.children = [
      this.createNode(
        min.x,
        min.y,
        min.z,
        midX,
        midY,
        midZ,
      ),
      this.createNode(
        midX,
        min.y,
        min.z,
        max.x,
        midY,
        midZ,
      ),
      this.createNode(
        min.x,
        midY,
        min.z,
        midX,
        max.y,
        midZ,
      ),
      this.createNode(
        midX,
        midY,
        min.z,
        max.x,
        max.y,
        midZ,
      ),
      this.createNode(
        min.x,
        min.y,
        midZ,
        midX,
        midY,
        max.z,
      ),
      this.createNode(
        midX,
        min.y,
        midZ,
        max.x,
        midY,
        max.z,
      ),
      this.createNode(
        min.x,
        midY,
        midZ,
        midX,
        max.y,
        max.z,
      ),
      this.createNode(
        midX,
        midY,
        midZ,
        max.x,
        max.y,
        max.z,
      ),
    ];
  }

  private createNode(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ): OctreeNode {
    return {
      bounds: {
        min: {
          x:
            minX,

          y:
            minY,

          z:
            minZ,
        },

        max: {
          x:
            maxX,

          y:
            maxY,

          z:
            maxZ,
        },
      },

      entities: [],
      children: null,
    };
  }

  private queryNodeBounds(
    node: OctreeNode,
    queryBounds: AABBBounds3D,
    results: SpatialQueryResult[],
  ): void {
    if (
      !this.intersectsBounds(
        node.bounds,
        queryBounds,
      )
    ) {
      return;
    }

    for (
      const item of
      node.entities
    ) {
      if (
        !this.containsPoint(
          queryBounds,
          item.position,
        )
      ) {
        continue;
      }

      results.push({
        entityId:
          item.entityId,

        distance:
          0,

        position: {
          x:
            item.position.x,

          y:
            item.position.y,

          z:
            item.position.z,
        },
      });
    }

    const children =
      node.children;

    if (!children) {
      return;
    }

    for (
      const child of
      children
    ) {
      this.queryNodeBounds(
        child,
        queryBounds,
        results,
      );
    }
  }

  private writePosition(
    target: MutableWorldPosition3D,
    source: WorldPosition3D,
  ): void {
    target.x =
      source.x;

    target.y =
      source.y;

    target.z =
      source.z;
  }

  private cloneBounds(
    bounds: AABBBounds3D,
  ): AABBBounds3D {
    return {
      min: {
        x:
          bounds.min.x,

        y:
          bounds.min.y,

        z:
          bounds.min.z,
      },

      max: {
        x:
          bounds.max.x,

        y:
          bounds.max.y,

        z:
          bounds.max.z,
      },
    };
  }

  private containsPoint(
    bounds: AABBBounds3D,
    point: WorldPosition3D,
  ): boolean {
    return (
      point.x >=
        bounds.min.x &&
      point.x <=
        bounds.max.x &&
      point.y >=
        bounds.min.y &&
      point.y <=
        bounds.max.y &&
      point.z >=
        bounds.min.z &&
      point.z <=
        bounds.max.z
    );
  }

  private intersectsBounds(
    first: AABBBounds3D,
    second: AABBBounds3D,
  ): boolean {
    return (
      first.min.x <=
        second.max.x &&
      first.max.x >=
        second.min.x &&
      first.min.y <=
        second.max.y &&
      first.max.y >=
        second.min.y &&
      first.min.z <=
        second.max.z &&
      first.max.z >=
        second.min.z
    );
  }
}
