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
  /** Nó onde a entrada está na árvore materializada (G67: atualização incremental). */
  node: OctreeNode | null;
  /** Índice em `node.entities` (remoção O(1) por troca com o último). */
  slot: number;
}

export interface OctreeNode {
  bounds: AABBBounds3D;
  entities: OctreeEntry[];
  children: OctreeNode[] | null;
  /** Pai (null na raiz). */
  parent?: OctreeNode | null;
  /** Entradas nesta subárvore (para colapsar filhos esvaziados). */
  count?: number;
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

function compareResultsByDistance(
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

  private rebuilds =
    0;

  /**
   * Limites configurados pela cena. A raiz real é a união destes limites com
   * a extensão das entidades: nada fica fora do índice (G64).
   */
  private configuredBounds:
    AABBBounds3D;

  public constructor(
    bounds:
      AABBBounds3D =
        DEFAULT_BOUNDS,
  ) {
    this.configuredBounds =
      this.cloneBounds(
        bounds,
      );

    this.root = {
      bounds:
        this.cloneBounds(
          bounds,
        ),

      entities: [],
      children: null,
      parent: null,
      count: 0,
    };
  }

  public get entityCount():
    number {
    return this.entries.size;
  }

  public resetBounds(
    bounds: AABBBounds3D,
  ): void {
    this.configuredBounds =
      this.cloneBounds(
        bounds,
      );

    this.root.bounds =
      this.cloneBounds(
        bounds,
      );

    this.detachAll();

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
      this.update(
        entityId,
        position,
      );

      return;
    }

    const entry: OctreeEntry = {
      entityId,

      position: {
        x:
          position.x,

        y:
          position.y,

        z:
          position.z,
      },

      node: null,
      slot: -1,
    };

    this.entries.set(
      entityId,
      entry,
    );

    this.placeIncrementally(
      entry,
    );
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

    if (this.indexDirty) {
      return true;
    }

    // G67: continua no mesmo nó folha ⇒ nada estrutural muda.
    const node =
      entry.node;

    if (
      node !== null &&
      node.children === null &&
      this.containsPoint(
        node.bounds,
        entry.position,
      )
    ) {
      return true;
    }

    this.detachEntry(
      entry,
    );

    this.placeIncrementally(
      entry,
    );

    return true;
  }

  public remove(
    entityId: string,
  ): boolean {
    const entry =
      this.entries.get(
        entityId,
      );

    if (!entry) {
      return false;
    }

    this.entries.delete(
      entityId,
    );

    if (!this.indexDirty) {
      this.detachEntry(
        entry,
      );
    }

    return true;
  }

  /** Reconstruções completas da árvore (diagnóstico/testes, G67). */
  public get rebuildCount():
    number {
    return this.rebuilds;
  }

  public get configuredWorldBounds():
    AABBBounds3D {
    return this.cloneBounds(
      this.configuredBounds,
    );
  }

  /** Limites efetivos da raiz (configurados ∪ extensão das entidades). */
  public getEffectiveBounds():
    AABBBounds3D {
    this.ensureIndex();

    return this.cloneBounds(
      this.root.bounds,
    );
  }

  /**
   * Entidades dentro do AABB, ordenadas pela distância 3D ao centro do AABB.
   */
  public queryBounds(
    bounds: AABBBounds3D,
  ): SpatialQueryResult[] {
    this.ensureIndex();

    const results:
      SpatialQueryResult[] = [];

    this.queryNodeBounds(
      this.root,
      bounds,
      (bounds.min.x + bounds.max.x) * 0.5,
      (bounds.min.y + bounds.max.y) * 0.5,
      (bounds.min.z + bounds.max.z) * 0.5,
      Number.POSITIVE_INFINITY,
      results,
    );

    results.sort(
      compareResultsByDistance,
    );

    return results;
  }

  /** Entidades a até `radius` (3D) do centro, ordenadas por distância. */
  public querySphere(
    center: WorldPosition3D,
    radius: number,
  ): SpatialQueryResult[] {
    if (
      !Number.isFinite(radius) ||
      radius < 0 ||
      !Number.isFinite(center.x) ||
      !Number.isFinite(center.y) ||
      !Number.isFinite(center.z)
    ) {
      return [];
    }

    this.ensureIndex();

    const results:
      SpatialQueryResult[] = [];

    this.queryNodeBounds(
      this.root,
      {
        min: {
          x: center.x - radius,
          y: center.y - radius,
          z: center.z - radius,
        },
        max: {
          x: center.x + radius,
          y: center.y + radius,
          z: center.z + radius,
        },
      },
      center.x,
      center.y,
      center.z,
      radius,
      results,
    );

    results.sort(
      compareResultsByDistance,
    );

    return results;
  }

  public clear(): void {
    this.detachAll();
    this.entries.clear();
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

    this.rebuilds += 1;

    this.detachAll();

    this.root.bounds =
      this.computeRootBounds();

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

  /**
   * G67: insere na árvore já materializada; só agenda reconstrução se o
   * ponto sai da raiz (a raiz cresce com folga, amortizando).
   */
  private placeIncrementally(
    entry: OctreeEntry,
  ): void {
    if (this.indexDirty) {
      return;
    }

    if (
      !this.containsPoint(
        this.root.bounds,
        entry.position,
      )
    ) {
      // Posição não finita nunca entra na árvore (nem na reconstrução).
      if (
        Number.isFinite(entry.position.x) &&
        Number.isFinite(entry.position.y) &&
        Number.isFinite(entry.position.z)
      ) {
        this.indexDirty =
          true;
      }

      return;
    }

    this.insertIntoNode(
      this.root,
      entry,
      0,
    );
  }

  private addToNode(
    node: OctreeNode,
    entry: OctreeEntry,
  ): void {
    entry.node = node;
    entry.slot = node.entities.length;
    node.entities.push(entry);

    let cursor: OctreeNode | null | undefined = node;

    while (cursor) {
      cursor.count = (cursor.count ?? 0) + 1;
      cursor = cursor.parent;
    }
  }

  /** Tira a entrada do nó (troca com o último) e colapsa filhos esvaziados. */
  private detachEntry(
    entry: OctreeEntry,
  ): void {
    const node =
      entry.node;

    if (node === null) {
      return;
    }

    const list =
      node.entities;

    const last =
      list[list.length - 1]!;

    list[entry.slot] =
      last;

    last.slot =
      entry.slot;

    list.pop();

    entry.node =
      null;

    entry.slot =
      -1;

    let collapse: OctreeNode | null = null;
    let cursor: OctreeNode | null | undefined = node;

    while (cursor) {
      cursor.count = (cursor.count ?? 1) - 1;

      if (
        cursor.children !== null &&
        cursor.count <= this.maxEntitiesPerNode >> 1
      ) {
        collapse = cursor;
      }

      cursor = cursor.parent;
    }

    if (collapse !== null) {
      this.collapse(
        collapse,
      );
    }
  }

  /** Junta a subárvore no próprio nó (poucas entradas restantes). */
  private collapse(
    node: OctreeNode,
  ): void {
    const children =
      node.children;

    if (children === null) {
      return;
    }

    node.children =
      null;

    for (
      const child of
      children
    ) {
      this.gatherInto(
        child,
        node,
      );
    }
  }

  private gatherInto(
    source: OctreeNode,
    target: OctreeNode,
  ): void {
    for (
      const entry of
      source.entities
    ) {
      entry.node = target;
      entry.slot = target.entities.length;
      target.entities.push(entry);
    }

    source.entities.length =
      0;

    const children =
      source.children;

    if (children !== null) {
      for (
        const child of
        children
      ) {
        this.gatherInto(
          child,
          target,
        );
      }
    }
  }

  private detachAll(): void {
    for (
      const entry of
      this.entries.values()
    ) {
      entry.node = null;
      entry.slot = -1;
    }

    this.root.entities.length =
      0;

    this.root.children =
      null;

    this.root.count =
      0;
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

    this.addToNode(
      node,
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

    // As entradas saem deste nó (a contagem da subárvore é refeita ao inserir).
    let cursor: OctreeNode | null | undefined = node;

    while (cursor) {
      cursor.count = (cursor.count ?? 0) - pending.length;
      cursor = cursor.parent;
    }

    for (
      const entry of
      pending
    ) {
      entry.node = null;
      entry.slot = -1;

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
        this.addToNode(
          node,
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

    const parent =
      node;

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

    for (
      const child of
      node.children
    ) {
      child.parent =
        parent;
    }
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
      parent: null,
      count: 0,
    };
  }

  private queryNodeBounds(
    node: OctreeNode,
    queryBounds: AABBBounds3D,
    centerX: number,
    centerY: number,
    centerZ: number,
    maxDistance: number,
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

    const maxDistanceSquared =
      maxDistance *
      maxDistance;

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

      const dx =
        item.position.x -
        centerX;
      const dy =
        item.position.y -
        centerY;
      const dz =
        item.position.z -
        centerZ;
      const distanceSquared =
        dx * dx +
        dy * dy +
        dz * dz;

      if (
        distanceSquared >
        maxDistanceSquared
      ) {
        continue;
      }

      results.push({
        entityId:
          item.entityId,

        distance:
          Math.sqrt(
            distanceSquared,
          ),

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
        centerX,
        centerY,
        centerZ,
        maxDistance,
        results,
      );
    }
  }

  /**
   * União dos limites configurados com a extensão das entidades (com folga),
   * para que nenhuma entidade fique fora da raiz.
   */
  private computeRootBounds():
    AABBBounds3D {
    let minX = this.configuredBounds.min.x;
    let minY = this.configuredBounds.min.y;
    let minZ = this.configuredBounds.min.z;
    let maxX = this.configuredBounds.max.x;
    let maxY = this.configuredBounds.max.y;
    let maxZ = this.configuredBounds.max.z;
    let expanded = false;

    for (
      const entry of
      this.entries.values()
    ) {
      const position =
        entry.position;

      if (
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.z)
      ) {
        continue;
      }

      if (position.x < minX) { minX = position.x; expanded = true; }
      if (position.y < minY) { minY = position.y; expanded = true; }
      if (position.z < minZ) { minZ = position.z; expanded = true; }
      if (position.x > maxX) { maxX = position.x; expanded = true; }
      if (position.y > maxY) { maxY = position.y; expanded = true; }
      if (position.z > maxZ) { maxZ = position.z; expanded = true; }
    }

    if (!expanded) {
      return this.cloneBounds(
        this.configuredBounds,
      );
    }

    // Folga (≥ 1 u, 25% da extensão) para que entidades andando para fora
    // não forcem reconstruções seguidas (G67).
    const padX = Math.max(1, (maxX - minX) * 0.25);
    const padY = Math.max(1, (maxY - minY) * 0.25);
    const padZ = Math.max(1, (maxZ - minZ) * 0.25);

    return {
      min: {
        x: minX - padX,
        y: minY - padY,
        z: minZ - padZ,
      },
      max: {
        x: maxX + padX,
        y: maxY + padY,
        z: maxZ + padZ,
      },
    };
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
