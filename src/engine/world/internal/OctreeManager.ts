import type { AABBBounds3D, SpatialQueryResult } from "../../../contracts/world/types";

export interface OctreeNode {
  bounds: AABBBounds3D;
  entities: Array<{ entityId: string; position: { x: number; y: number; z: number } }>;
  children: OctreeNode[] | null;
}

export class OctreeManager {
  private root: OctreeNode;
  private readonly maxEntitiesPerNode = 8;
  private readonly maxDepth = 5;

  public constructor(bounds?: AABBBounds3D) {
    this.root = {
      bounds: bounds || {
        min: { x: -500, y: -500, z: -500 },
        max: { x: 500, y: 500, z: 500 },
      },
      entities: [],
      children: null,
    };
  }

  public resetBounds(bounds: AABBBounds3D): void {
    this.clear();
    this.root.bounds = { ...bounds };
  }

  public insert(entityId: string, position: { x: number; y: number; z: number }): void {
    this.insertIntoNode(this.root, entityId, position, 0);
  }

  public queryBounds(bounds: AABBBounds3D): SpatialQueryResult[] {
    const results: SpatialQueryResult[] = [];
    this.queryNodeBounds(this.root, bounds, results);
    return results;
  }

  public clear(): void {
    this.root.entities = [];
    this.root.children = null;
  }

  public getNodeCount(): number {
    return this.countNodes(this.root);
  }

  private countNodes(node: OctreeNode): number {
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += this.countNodes(child);
      }
    }
    return count;
  }

  private insertIntoNode(
    node: OctreeNode,
    entityId: string,
    position: { x: number; y: number; z: number },
    depth: number
  ): boolean {
    if (!this.containsPoint(node.bounds, position)) {
      return false;
    }

    if (node.children) {
      for (const child of node.children) {
        if (this.insertIntoNode(child, entityId, position, depth + 1)) {
          return true;
        }
      }
    }

    node.entities.push({ entityId, position: { ...position } });

    if (node.entities.length > this.maxEntitiesPerNode && depth < this.maxDepth && !node.children) {
      this.subdivide(node);
      const tempEntities = [...node.entities];
      node.entities = [];

      for (const item of tempEntities) {
        let inserted = false;
        for (const child of node.children!) {
          if (this.insertIntoNode(child, item.entityId, item.position, depth + 1)) {
            inserted = true;
            break;
          }
        }
        if (!inserted) {
          node.entities.push(item);
        }
      }
    }

    return true;
  }

  private subdivide(node: OctreeNode): void {
    const min = node.bounds.min;
    const max = node.bounds.max;
    const mid = {
      x: (min.x + max.x) * 0.5,
      y: (min.y + max.y) * 0.5,
      z: (min.z + max.z) * 0.5,
    };

    node.children = [
      { bounds: { min: { x: min.x, y: min.y, z: min.z }, max: { x: mid.x, y: mid.y, z: mid.z } }, entities: [], children: null },
      { bounds: { min: { x: mid.x, y: min.y, z: min.z }, max: { x: max.x, y: mid.y, z: mid.z } }, entities: [], children: null },
      { bounds: { min: { x: min.x, y: mid.y, z: min.z }, max: { x: mid.x, y: max.y, z: mid.z } }, entities: [], children: null },
      { bounds: { min: { x: mid.x, y: mid.y, z: min.z }, max: { x: max.x, y: max.y, z: mid.z } }, entities: [], children: null },
      { bounds: { min: { x: min.x, y: min.y, z: mid.z }, max: { x: mid.x, y: mid.y, z: max.z } }, entities: [], children: null },
      { bounds: { min: { x: mid.x, y: min.y, z: mid.z }, max: { x: max.x, y: mid.y, z: max.z } }, entities: [], children: null },
      { bounds: { min: { x: min.x, y: mid.y, z: mid.z }, max: { x: mid.x, y: max.y, z: max.z } }, entities: [], children: null },
      { bounds: { min: { x: mid.x, y: mid.y, z: mid.z }, max: { x: max.x, y: max.y, z: max.z } }, entities: [], children: null },
    ];
  }

  private queryNodeBounds(node: OctreeNode, queryBounds: AABBBounds3D, results: SpatialQueryResult[]): void {
    if (!this.intersectsBounds(node.bounds, queryBounds)) {
      return;
    }

    for (const item of node.entities) {
      if (this.containsPoint(queryBounds, item.position)) {
        results.push({
          entityId: item.entityId,
          distance: 0,
          position: item.position,
        });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        this.queryNodeBounds(child, queryBounds, results);
      }
    }
  }

  private containsPoint(bounds: AABBBounds3D, p: { x: number; y: number; z: number }): boolean {
    return (
      p.x >= bounds.min.x && p.x <= bounds.max.x &&
      p.y >= bounds.min.y && p.y <= bounds.max.y &&
      p.z >= bounds.min.z && p.z <= bounds.max.z
    );
  }

  private intersectsBounds(a: AABBBounds3D, b: AABBBounds3D): boolean {
    return (
      a.min.x <= b.max.x && a.max.x >= b.min.x &&
      a.min.y <= b.max.y && a.max.y >= b.min.y &&
      a.min.z <= b.max.z && a.max.z >= b.min.z
    );
  }
}