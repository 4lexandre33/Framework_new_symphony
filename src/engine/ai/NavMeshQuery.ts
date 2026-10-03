import type {
  NavMeshGraph,
  NavMeshPathRequest,
  NavMeshPathResult,
  NavMeshPolygon,
  Vector3AI,
} from "../../contracts/ai/types";

const EPSILON =
  0.00001;

const EMPTY_WAYPOINTS:
  ReadonlyArray<Vector3AI> =
    Object.freeze([]);

const EMPTY_POLYGON_PATH:
  ReadonlyArray<NavMeshPolygon> =
    Object.freeze([]);

export class NavMeshQuery {
  private graph:
    NavMeshGraph | null =
      null;

  private readonly polygonById =
    new Map<
      number,
      NavMeshPolygon
    >();

  public loadGraph(
    graph: NavMeshGraph,
  ): void {
    this.polygonById.clear();

    for (
      let index = 0;
      index <
      graph.polygons.length;
      index += 1
    ) {
      const polygon =
        graph.polygons[
          index
        ];

      if (!polygon) {
        continue;
      }

      if (
        this.polygonById.has(
          polygon.id,
        )
      ) {
        throw new Error(
          `NavMesh contém id de polígono duplicado: ${polygon.id}.`,
        );
      }

      if (
        polygon.vertices.length <
        3
      ) {
        throw new Error(
          `Polígono ${polygon.id} precisa possuir pelo menos 3 vértices.`,
        );
      }

      this.polygonById.set(
        polygon.id,
        polygon,
      );
    }

    this.graph =
      graph;
  }

  public clear(): void {
    this.graph =
      null;

    this.polygonById.clear();
  }

  public findPath(
    request:
      NavMeshPathRequest,
  ): NavMeshPathResult {
    if (
      !this.graph ||
      this.graph.polygons.length ===
        0
    ) {
      return this.createFailureResult();
    }

    const startPolygon =
      this.findContainingOrNearestPolygon(
        request.start,
      );

    const targetPolygon =
      this.findContainingOrNearestPolygon(
        request.target,
      );

    if (
      !startPolygon ||
      !targetPolygon
    ) {
      return this.createFailureResult();
    }

    const polygonPath =
      this.searchAStar(
        startPolygon,
        targetPolygon,
      );

    if (
      polygonPath.length ===
      0
    ) {
      return this.createFailureResult();
    }

    const agentRadius =
      this.sanitizeNonNegative(
        request.agentRadius ??
          0,
      );

    const waypoints =
      this.buildPortalPath(
        request.start,
        request.target,
        polygonPath,
        agentRadius,
      );

    if (!waypoints) {
      return this.createFailureResult();
    }

    return {
      found:
        true,

      waypoints,

      totalDistance:
        this.calculatePathDistance(
          waypoints,
        ),
    };
  }

  private createFailureResult():
    NavMeshPathResult {
    return {
      found:
        false,

      waypoints:
        EMPTY_WAYPOINTS,

      totalDistance:
        0,
    };
  }

  private findContainingOrNearestPolygon(
    point: Vector3AI,
  ): NavMeshPolygon | null {
    if (!this.graph) {
      return null;
    }

    for (
      let index = 0;
      index <
      this.graph.polygons.length;
      index += 1
    ) {
      const polygon =
        this.graph.polygons[
          index
        ];

      if (
        polygon &&
        this.isPointInsidePolygonXZ(
          point,
          polygon.vertices,
        )
      ) {
        return polygon;
      }
    }

    let nearest:
      NavMeshPolygon | null =
        null;

    let nearestDistanceSquared =
      Number.POSITIVE_INFINITY;

    for (
      let index = 0;
      index <
      this.graph.polygons.length;
      index += 1
    ) {
      const polygon =
        this.graph.polygons[
          index
        ];

      if (!polygon) {
        continue;
      }

      const distanceSquared =
        this.distanceSquared(
          point,
          polygon.center,
        );

      if (
        distanceSquared <
        nearestDistanceSquared
      ) {
        nearestDistanceSquared =
          distanceSquared;

        nearest =
          polygon;
      }
    }

    return nearest;
  }

  private isPointInsidePolygonXZ(
    point: Vector3AI,
    vertices:
      ReadonlyArray<Vector3AI>,
  ): boolean {
    let inside =
      false;

    for (
      let currentIndex = 0,
        previousIndex =
          vertices.length - 1;
      currentIndex <
      vertices.length;
      previousIndex =
        currentIndex,
        currentIndex += 1
    ) {
      const current =
        vertices[
          currentIndex
        ];

      const previous =
        vertices[
          previousIndex
        ];

      if (
        !current ||
        !previous
      ) {
        continue;
      }

      const crossesZ =
        (
          current.z >
          point.z
        ) !==
        (
          previous.z >
          point.z
        );

      if (!crossesZ) {
        continue;
      }

      const deltaZ =
        previous.z -
        current.z;

      if (
        Math.abs(
          deltaZ,
        ) <=
        EPSILON
      ) {
        continue;
      }

      const intersectionX =
        (
          (
            previous.x -
            current.x
          ) *
          (
            point.z -
            current.z
          )
        ) /
          deltaZ +
        current.x;

      if (
        point.x <
        intersectionX
      ) {
        inside =
          !inside;
      }
    }

    return inside;
  }

  private searchAStar(
    start:
      NavMeshPolygon,
    target:
      NavMeshPolygon,
  ): ReadonlyArray<NavMeshPolygon> {
    if (
      start.id ===
      target.id
    ) {
      return [
        start,
      ];
    }

    const openSet =
      new Set<number>([
        start.id,
      ]);

    const cameFrom =
      new Map<
        number,
        number
      >();

    const gScore =
      new Map<
        number,
        number
      >();

    const fScore =
      new Map<
        number,
        number
      >();

    gScore.set(
      start.id,
      0,
    );

    fScore.set(
      start.id,
      this.distance(
        start.center,
        target.center,
      ),
    );

    while (
      openSet.size >
      0
    ) {
      let currentId =
        -1;

      let lowestScore =
        Number.POSITIVE_INFINITY;

      for (
        const candidateId of
        openSet
      ) {
        const candidateScore =
          fScore.get(
            candidateId,
          ) ??
          Number.POSITIVE_INFINITY;

        if (
          candidateScore <
          lowestScore
        ) {
          lowestScore =
            candidateScore;

          currentId =
            candidateId;
        }
      }

      if (
        currentId <
        0
      ) {
        return EMPTY_POLYGON_PATH;
      }

      if (
        currentId ===
        target.id
      ) {
        return this.reconstructPath(
          cameFrom,
          currentId,
        );
      }

      openSet.delete(
        currentId,
      );

      const currentPolygon =
        this.polygonById.get(
          currentId,
        );

      if (!currentPolygon) {
        continue;
      }

      const currentGScore =
        gScore.get(
          currentId,
        ) ??
        Number.POSITIVE_INFINITY;

      for (
        let neighborIndex = 0;
        neighborIndex <
        currentPolygon
          .neighbors.length;
        neighborIndex += 1
      ) {
        const neighborId =
          currentPolygon
            .neighbors[
              neighborIndex
            ];

        if (
          neighborId ===
          undefined
        ) {
          continue;
        }

        const neighbor =
          this.polygonById.get(
            neighborId,
          );

        if (!neighbor) {
          continue;
        }

        const tentativeG =
          currentGScore +
          this.distance(
            currentPolygon.center,
            neighbor.center,
          );

        const neighborG =
          gScore.get(
            neighborId,
          ) ??
          Number.POSITIVE_INFINITY;

        if (
          tentativeG >=
          neighborG
        ) {
          continue;
        }

        cameFrom.set(
          neighborId,
          currentId,
        );

        gScore.set(
          neighborId,
          tentativeG,
        );

        fScore.set(
          neighborId,
          tentativeG +
            this.distance(
              neighbor.center,
              target.center,
            ),
        );

        openSet.add(
          neighborId,
        );
      }
    }

    return EMPTY_POLYGON_PATH;
  }

  private reconstructPath(
    cameFrom:
      ReadonlyMap<
        number,
        number
      >,
    currentId: number,
  ): ReadonlyArray<NavMeshPolygon> {
    const path:
      NavMeshPolygon[] = [];

    let current:
      number | undefined =
        currentId;

    while (
      current !==
      undefined
    ) {
      const polygon =
        this.polygonById.get(
          current,
        );

      if (!polygon) {
        return EMPTY_POLYGON_PATH;
      }

      path.unshift(
        polygon,
      );

      current =
        cameFrom.get(
          current,
        );
    }

    return path;
  }

  private buildPortalPath(
    start: Vector3AI,
    target: Vector3AI,
    polygons:
      ReadonlyArray<NavMeshPolygon>,
    agentRadius: number,
  ): ReadonlyArray<Vector3AI> | null {
    const waypoints:
      Vector3AI[] = [
        this.cloneVector(
          start,
        ),
      ];

    for (
      let index = 0;
      index <
      polygons.length - 1;
      index += 1
    ) {
      const current =
        polygons[
          index
        ];

      const next =
        polygons[
          index + 1
        ];

      if (
        !current ||
        !next
      ) {
        return null;
      }

      const portal =
        this.findSharedEdge(
          current,
          next,
        );

      if (!portal) {
        return null;
      }

      const portalWidth =
        this.distance(
          portal[0],
          portal[1],
        );

      if (
        agentRadius >
          0 &&
        portalWidth <=
          agentRadius *
            2 +
          EPSILON
      ) {
        return null;
      }

      waypoints.push({
        x:
          (
            portal[0].x +
            portal[1].x
          ) *
          0.5,

        y:
          (
            portal[0].y +
            portal[1].y
          ) *
          0.5,

        z:
          (
            portal[0].z +
            portal[1].z
          ) *
          0.5,
      });
    }

    waypoints.push(
      this.cloneVector(
        target,
      ),
    );

    return waypoints;
  }

  private findSharedEdge(
    first:
      NavMeshPolygon,
    second:
      NavMeshPolygon,
  ): readonly [
    Vector3AI,
    Vector3AI,
  ] | null {
    for (
      let firstIndex = 0;
      firstIndex <
      first.vertices.length;
      firstIndex += 1
    ) {
      const firstA =
        first.vertices[
          firstIndex
        ];

      const firstB =
        first.vertices[
          (
            firstIndex +
            1
          ) %
          first.vertices.length
        ];

      if (
        !firstA ||
        !firstB
      ) {
        continue;
      }

      for (
        let secondIndex = 0;
        secondIndex <
        second.vertices.length;
        secondIndex += 1
      ) {
        const secondA =
          second.vertices[
            secondIndex
          ];

        const secondB =
          second.vertices[
            (
              secondIndex +
              1
            ) %
            second.vertices.length
          ];

        if (
          !secondA ||
          !secondB
        ) {
          continue;
        }

        const sameDirection =
          this.samePoint(
            firstA,
            secondA,
          ) &&
          this.samePoint(
            firstB,
            secondB,
          );

        const reverseDirection =
          this.samePoint(
            firstA,
            secondB,
          ) &&
          this.samePoint(
            firstB,
            secondA,
          );

        if (
          sameDirection ||
          reverseDirection
        ) {
          return [
            firstA,
            firstB,
          ];
        }
      }
    }

    return null;
  }

  private samePoint(
    first: Vector3AI,
    second: Vector3AI,
  ): boolean {
    return (
      Math.abs(
        first.x -
          second.x,
      ) <=
        EPSILON &&
      Math.abs(
        first.y -
          second.y,
      ) <=
        EPSILON &&
      Math.abs(
        first.z -
          second.z,
      ) <=
        EPSILON
    );
  }

  private calculatePathDistance(
    points:
      ReadonlyArray<Vector3AI>,
  ): number {
    let totalDistance =
      0;

    for (
      let index = 0;
      index <
      points.length - 1;
      index += 1
    ) {
      const current =
        points[
          index
        ];

      const next =
        points[
          index + 1
        ];

      if (
        !current ||
        !next
      ) {
        continue;
      }

      totalDistance +=
        this.distance(
          current,
          next,
        );
    }

    return totalDistance;
  }

  private distanceSquared(
    first: Vector3AI,
    second: Vector3AI,
  ): number {
    const dx =
      first.x -
      second.x;

    const dy =
      first.y -
      second.y;

    const dz =
      first.z -
      second.z;

    return (
      dx * dx +
      dy * dy +
      dz * dz
    );
  }

  private distance(
    first: Vector3AI,
    second: Vector3AI,
  ): number {
    return Math.sqrt(
      this.distanceSquared(
        first,
        second,
      ),
    );
  }

  private cloneVector(
    source: Vector3AI,
  ): Vector3AI {
    return {
      x:
        source.x,

      y:
        source.y,

      z:
        source.z,
    };
  }

  private sanitizeNonNegative(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      value,
    );
  }
}