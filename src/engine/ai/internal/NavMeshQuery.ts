import type {
  NavMeshGraph,
  NavMeshPathRequest,
  NavMeshPathResult,
  NavMeshPolygon,
  Vector3AI,
} from "../../../contracts/ai/types";

const EMPTY_WAYPOINTS: ReadonlyArray<Vector3AI> = Object.freeze([]);

/** Tolerância para arestas colineares (T-junction) e vértices "iguais". */
export const DEFAULT_PORTAL_EPSILON = 0.01;
const DEFAULT_VERTICAL_TOLERANCE = 2;

interface PolygonData {
  readonly id: number;
  readonly source: NavMeshPolygon;
  /** Vértices planos [x,y,z,...]. */
  readonly vertices: Float64Array;
  readonly count: number;
  readonly neighbors: ReadonlyArray<number>;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly area: string | undefined;
  readonly cost: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Plano: nx*x + ny*y + nz*z + d = 0. */
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly d: number;
}

interface Portal {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  readonly width: number;
}

/** Resultado mutável de localização (sem alocação). */
export interface NavMeshLocation {
  polygon: number;
  x: number;
  y: number;
  z: number;
  /** Distância 3D do ponto original ao ponto na navmesh (0 se estava sobre ela). */
  distance: number;
  /** true = o ponto estava fora da malha e foi preso à borda mais próxima. */
  snapped: boolean;
}

export function createNavMeshLocation(): NavMeshLocation {
  return { polygon: -1, x: 0, y: 0, z: 0, distance: 0, snapped: false };
}

/** Navmesh validada e indexada (imutável depois de construída). */
export class NavMesh {
  public readonly polygons: PolygonData[] = [];
  private readonly byId = new Map<number, PolygonData>();
  private readonly portals = new Map<number, Map<number, Portal>>();
  private readonly grid = new Map<number, number[]>();
  private readonly cellSize: number;

  /** Valida TUDO e lança antes de qualquer efeito (G72: carga atômica). */
  public constructor(graph: NavMeshGraph, private readonly epsilon = DEFAULT_PORTAL_EPSILON) {
    if (!graph || !Array.isArray(graph.polygons)) {
      throw new Error("NavMesh inválida: `polygons` precisa ser um array.");
    }

    let extentSum = 0;

    for (const polygon of graph.polygons) {
      if (!polygon || !Number.isFinite(polygon.id)) {
        throw new Error("NavMesh inválida: polígono sem id numérico.");
      }

      if (this.byId.has(polygon.id)) {
        throw new Error(`NavMesh contém id de polígono duplicado: ${polygon.id}.`);
      }

      if (!Array.isArray(polygon.vertices) || polygon.vertices.length < 3) {
        throw new Error(`Polígono ${polygon.id} precisa possuir pelo menos 3 vértices.`);
      }

      const data = this.buildPolygon(polygon);
      this.byId.set(polygon.id, data);
      this.polygons.push(data);
      extentSum += Math.max(data.maxX - data.minX, data.maxZ - data.minZ);
    }

    for (const polygon of this.polygons) {
      const portals = new Map<number, Portal>();

      for (const neighborId of polygon.neighbors) {
        const neighbor = this.byId.get(neighborId);

        if (!neighbor) {
          throw new Error(`Polígono ${polygon.id} referencia vizinho inexistente ${neighborId}.`);
        }

        if (neighbor.id === polygon.id) {
          continue;
        }

        const portal = this.computePortal(polygon, neighbor);

        if (portal === null) {
          throw new Error(
            `Polígonos ${polygon.id} e ${neighborId} são vizinhos mas não compartilham aresta (tolerância ${this.epsilon}).`,
          );
        }

        portals.set(neighborId, portal);
      }

      this.portals.set(polygon.id, portals);
    }

    this.cellSize = Math.max(1, this.polygons.length > 0 ? extentSum / this.polygons.length : 1);

    for (let index = 0; index < this.polygons.length; index += 1) {
      const polygon = this.polygons[index] as PolygonData;
      const minCX = Math.floor(polygon.minX / this.cellSize);
      const maxCX = Math.floor(polygon.maxX / this.cellSize);
      const minCZ = Math.floor(polygon.minZ / this.cellSize);
      const maxCZ = Math.floor(polygon.maxZ / this.cellSize);

      for (let cx = minCX; cx <= maxCX; cx += 1) {
        for (let cz = minCZ; cz <= maxCZ; cz += 1) {
          const key = this.cellKey(cx, cz);
          let bucket = this.grid.get(key);

          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }

          bucket.push(index);
        }
      }
    }
  }

  public get size(): number {
    return this.polygons.length;
  }

  public getPolygon(id: number): PolygonData | undefined {
    return this.byId.get(id);
  }

  public getPortal(from: number, to: number): Portal | undefined {
    return this.portals.get(from)?.get(to);
  }

  /**
   * Localiza o ponto em 3D (G71): polígono que o contém em XZ e cujo plano
   * está dentro de `verticalTolerance`; senão o ponto mais próximo da malha
   * (3D) até `maxSnapDistance`. false se nada serve.
   */
  public locate(
    x: number,
    y: number,
    z: number,
    verticalTolerance: number,
    maxSnapDistance: number,
    out: NavMeshLocation,
    hintPolygon = -1,
  ): boolean {
    if (hintPolygon >= 0) {
      const hint = this.byId.get(hintPolygon);

      if (hint && this.containsXZ(hint, x, z)) {
        const planeY = this.planeY(hint, x, z, y);

        if (Math.abs(planeY - y) <= verticalTolerance) {
          return this.writeLocation(out, hint.id, x, planeY, z, Math.abs(planeY - y));
        }
      }
    }

    const bucket = this.grid.get(this.cellKey(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize)));
    let best = -1;
    let bestDy = Number.POSITIVE_INFINITY;
    let bestY = y;

    if (bucket) {
      for (let i = 0; i < bucket.length; i += 1) {
        const polygon = this.polygons[bucket[i] as number] as PolygonData;

        if (!this.containsXZ(polygon, x, z)) {
          continue;
        }

        const planeY = this.planeY(polygon, x, z, y);
        const dy = Math.abs(planeY - y);

        if (dy <= verticalTolerance && dy < bestDy) {
          bestDy = dy;
          best = polygon.id;
          bestY = planeY;
        }
      }
    }

    if (best >= 0) {
      return this.writeLocation(out, best, x, bestY, z, bestDy);
    }

    if (!(maxSnapDistance > 0)) {
      return false;
    }

    // Ponto mais próximo sobre a malha (bordas incluídas).
    let bestDistanceSq = maxSnapDistance === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxSnapDistance * maxSnapDistance;
    let found = false;

    for (const polygon of this.polygons) {
      // Poda por AABB em XZ.
      const ddx = x < polygon.minX ? polygon.minX - x : x > polygon.maxX ? x - polygon.maxX : 0;
      const ddz = z < polygon.minZ ? polygon.minZ - z : z > polygon.maxZ ? z - polygon.maxZ : 0;

      if (ddx * ddx + ddz * ddz > bestDistanceSq) {
        continue;
      }

      if (this.closestPointOnPolygon(polygon, x, y, z, scratchPoint)) {
        const dx = scratchPoint.x - x;
        const dy = scratchPoint.y - y;
        const dz = scratchPoint.z - z;
        const distanceSq = dx * dx + dy * dy + dz * dz;

        if (distanceSq <= bestDistanceSq) {
          bestDistanceSq = distanceSq;
          found = true;
          out.polygon = polygon.id;
          out.x = scratchPoint.x;
          out.y = scratchPoint.y;
          out.z = scratchPoint.z;
          out.distance = Math.sqrt(distanceSq);
          out.snapped = true;
        }
      }
    }

    return found;
  }

  private writeLocation(out: NavMeshLocation, polygon: number, x: number, y: number, z: number, distance: number): boolean {
    out.polygon = polygon;
    out.x = x;
    out.y = y;
    out.z = z;
    out.distance = distance;
    out.snapped = false;
    return true;
  }

  private buildPolygon(polygon: NavMeshPolygon): PolygonData {
    const count = polygon.vertices.length;
    const vertices = new Float64Array(count * 3);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < count; i += 1) {
      const vertex = polygon.vertices[i];

      if (!vertex || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || !Number.isFinite(vertex.z)) {
        throw new Error(`Polígono ${polygon.id} tem vértice inválido no índice ${i}.`);
      }

      vertices[i * 3] = vertex.x;
      vertices[i * 3 + 1] = vertex.y;
      vertices[i * 3 + 2] = vertex.z;
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minZ = Math.min(minZ, vertex.z);
      maxZ = Math.max(maxZ, vertex.z);
    }

    if (!Array.isArray(polygon.neighbors)) {
      throw new Error(`Polígono ${polygon.id} sem lista de vizinhos.`);
    }

    // Normal de Newell (robusta para polígonos quase planos).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count;
      const x0 = vertices[i * 3] as number;
      const y0 = vertices[i * 3 + 1] as number;
      const z0 = vertices[i * 3 + 2] as number;
      const x1 = vertices[j * 3] as number;
      const y1 = vertices[j * 3 + 1] as number;
      const z1 = vertices[j * 3 + 2] as number;
      nx += (y0 - y1) * (z0 + z1);
      ny += (z0 - z1) * (x0 + x1);
      nz += (x0 - x1) * (y0 + y1);
      cx += x0;
      cy += y0;
      cz += z0;
    }

    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);

    if (!(length > 1e-12)) {
      throw new Error(`Polígono ${polygon.id} é degenerado (área zero).`);
    }

    nx /= length;
    ny /= length;
    nz /= length;
    cx /= count;
    cy /= count;
    cz /= count;
    const center = polygon.center;
    const centerValid = center && Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z);
    const cost = polygon.cost;

    return {
      id: polygon.id,
      source: polygon,
      vertices,
      count,
      neighbors: polygon.neighbors,
      centerX: centerValid ? center.x : cx,
      centerY: centerValid ? center.y : cy,
      centerZ: centerValid ? center.z : cz,
      area: typeof polygon.area === "string" ? polygon.area : undefined,
      cost: typeof cost === "number" && Number.isFinite(cost) ? Math.max(0.01, cost) : 1,
      minX,
      maxX,
      minZ,
      maxZ,
      nx,
      ny,
      nz,
      d: -(nx * cx + ny * cy + nz * cz),
    };
  }

  /**
   * Portal entre A e B: maior trecho de sobreposição entre arestas colineares
   * (dentro de epsilon). Aceita T-junctions e vértices não idênticos (G72).
   */
  private computePortal(a: PolygonData, b: PolygonData): Portal | null {
    const eps = this.epsilon;
    let best: Portal | null = null;

    for (let i = 0; i < a.count; i += 1) {
      const i2 = (i + 1) % a.count;
      const ax = a.vertices[i * 3] as number;
      const ay = a.vertices[i * 3 + 1] as number;
      const az = a.vertices[i * 3 + 2] as number;
      const ex = (a.vertices[i2 * 3] as number) - ax;
      const ey = (a.vertices[i2 * 3 + 1] as number) - ay;
      const ez = (a.vertices[i2 * 3 + 2] as number) - az;
      const lengthSq = ex * ex + ey * ey + ez * ez;

      if (lengthSq <= eps * eps) {
        continue;
      }

      const edgeLength = Math.sqrt(lengthSq);

      for (let j = 0; j < b.count; j += 1) {
        const j2 = (j + 1) % b.count;
        const t1 = this.projectOnto(b.vertices, j, ax, ay, az, ex, ey, ez, lengthSq, eps);
        const t2 = this.projectOnto(b.vertices, j2, ax, ay, az, ex, ey, ez, lengthSq, eps);

        if (t1 === null || t2 === null) {
          continue;
        }

        const start = Math.max(0, Math.min(t1, t2));
        const end = Math.min(1, Math.max(t1, t2));
        const width = (end - start) * edgeLength;

        if (width <= eps || (best !== null && width <= best.width)) {
          continue;
        }

        best = {
          ax: ax + ex * start,
          ay: ay + ey * start,
          az: az + ez * start,
          bx: ax + ex * end,
          by: ay + ey * end,
          bz: az + ez * end,
          width,
        };
      }
    }

    return best;
  }

  /** Parâmetro t do vértice sobre a reta da aresta, ou null se fora da reta (> eps). */
  private projectOnto(
    vertices: Float64Array,
    index: number,
    ax: number,
    ay: number,
    az: number,
    ex: number,
    ey: number,
    ez: number,
    lengthSq: number,
    eps: number,
  ): number | null {
    const px = (vertices[index * 3] as number) - ax;
    const py = (vertices[index * 3 + 1] as number) - ay;
    const pz = (vertices[index * 3 + 2] as number) - az;
    const t = (px * ex + py * ey + pz * ez) / lengthSq;
    const dx = px - ex * t;
    const dy = py - ey * t;
    const dz = pz - ez * t;

    if (dx * dx + dy * dy + dz * dz > eps * eps) {
      return null;
    }

    return t;
  }

  /** Point-in-polygon em XZ com tolerância de borda (epsilon). */
  public containsXZ(polygon: PolygonData, x: number, z: number): boolean {
    if (x < polygon.minX - this.epsilon || x > polygon.maxX + this.epsilon || z < polygon.minZ - this.epsilon || z > polygon.maxZ + this.epsilon) {
      return false;
    }

    let inside = false;
    const v = polygon.vertices;
    const count = polygon.count;

    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const xi = v[i * 3] as number;
      const zi = v[i * 3 + 2] as number;
      const xj = v[j * 3] as number;
      const zj = v[j * 3 + 2] as number;

      if (this.segmentDistanceSqXZ(x, z, xj, zj, xi, zi) <= this.epsilon * this.epsilon) {
        return true;
      }

      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside;
      }
    }

    return inside;
  }

  public planeY(polygon: PolygonData, x: number, z: number, fallbackY: number): number {
    if (Math.abs(polygon.ny) < 1e-6) {
      return fallbackY;
    }

    return -(polygon.nx * x + polygon.nz * z + polygon.d) / polygon.ny;
  }

  private closestPointOnPolygon(polygon: PolygonData, x: number, y: number, z: number, out: { x: number; y: number; z: number }): boolean {
    if (this.containsXZ(polygon, x, z)) {
      out.x = x;
      out.z = z;
      out.y = this.planeY(polygon, x, z, y);
      return true;
    }

    let bestSq = Number.POSITIVE_INFINITY;
    const v = polygon.vertices;
    const count = polygon.count;

    for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
      const ax = v[j * 3] as number;
      const ay = v[j * 3 + 1] as number;
      const az = v[j * 3 + 2] as number;
      const ex = (v[i * 3] as number) - ax;
      const ey = (v[i * 3 + 1] as number) - ay;
      const ez = (v[i * 3 + 2] as number) - az;
      const lengthSq = ex * ex + ey * ey + ez * ez;
      let t = lengthSq > 0 ? ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / lengthSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t;
      const py = ay + ey * t;
      const pz = az + ez * t;
      const dx = px - x;
      const dy = py - y;
      const dz = pz - z;
      const distanceSq = dx * dx + dy * dy + dz * dz;

      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        // Puxa levemente para dentro para não cair exatamente na borda.
        out.x = px + (polygon.centerX - px) * 1e-4;
        out.y = py + (polygon.centerY - py) * 1e-4;
        out.z = pz + (polygon.centerZ - pz) * 1e-4;
      }
    }

    return bestSq < Number.POSITIVE_INFINITY;
  }

  private segmentDistanceSqXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const ex = bx - ax;
    const ez = bz - az;
    const lengthSq = ex * ex + ez * ez;
    let t = lengthSq > 0 ? ((px - ax) * ex + (pz - az) * ez) / lengthSq : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - px;
    const dz = az + ez * t - pz;
    return dx * dx + dz * dz;
  }

  private cellKey(cx: number, cz: number): number {
    return cx * 73856093 + cz * 19349663;
  }
}

const scratchPoint = { x: 0, y: 0, z: 0 };

interface FunnelPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Consulta de caminhos sobre várias navmeshes (G7): A* com heap e custo por
 * área, raio do agente (G72), localização 3D com clamp (G71) e funnel /
 * string pulling (G73).
 */
export class NavMeshQuery {
  public static readonly DEFAULT_ID = "default";

  private readonly meshes = new Map<string, NavMesh>();
  private readonly startLocation = createNavMeshLocation();
  private readonly targetLocation = createNavMeshLocation();

  /** Valida e troca atomicamente (inválida = lança e mantém a anterior). */
  public loadGraph(graph: NavMeshGraph, navMeshId: string = NavMeshQuery.DEFAULT_ID, epsilon = DEFAULT_PORTAL_EPSILON): void {
    const mesh = new NavMesh(graph, epsilon);
    this.meshes.set(navMeshId, mesh);
  }

  public unload(navMeshId: string): boolean {
    return this.meshes.delete(navMeshId);
  }

  public getMesh(navMeshId: string = NavMeshQuery.DEFAULT_ID): NavMesh | null {
    return this.meshes.get(navMeshId) ?? null;
  }

  public getIds(): string[] {
    return [...this.meshes.keys()];
  }

  public clear(): void {
    this.meshes.clear();
  }

  public findPath(request: NavMeshPathRequest): NavMeshPathResult {
    const mesh = this.meshes.get(request.navMeshId ?? NavMeshQuery.DEFAULT_ID);

    if (!mesh || mesh.size === 0) {
      return this.failure();
    }

    const policy = request.offMeshPolicy ?? "clamp";
    const verticalTolerance =
      typeof request.verticalTolerance === "number" && request.verticalTolerance >= 0
        ? request.verticalTolerance
        : DEFAULT_VERTICAL_TOLERANCE;
    const maxSnap =
      policy === "fail"
        ? 0
        : typeof request.maxSnapDistance === "number" && request.maxSnapDistance >= 0
          ? request.maxSnapDistance
          : Number.POSITIVE_INFINITY;
    const start = this.startLocation;
    const target = this.targetLocation;

    if (
      !this.isFiniteVector(request.start) ||
      !this.isFiniteVector(request.target) ||
      !mesh.locate(request.start.x, request.start.y, request.start.z, verticalTolerance, maxSnap, start) ||
      !mesh.locate(request.target.x, request.target.y, request.target.z, verticalTolerance, maxSnap, target)
    ) {
      return this.failure();
    }

    const agentRadius = this.sanitizeNonNegative(request.agentRadius ?? 0);
    const corridor = this.searchAStar(mesh, start.polygon, target.polygon, agentRadius, request);

    if (corridor === null) {
      return this.failure();
    }

    const waypoints = this.stringPull(mesh, corridor, start, target, agentRadius);
    const clamped = target.snapped;

    return {
      found: true,
      waypoints,
      totalDistance: this.calculatePathDistance(waypoints),
      ...(clamped ? { clampedTarget: { x: target.x, y: target.y, z: target.z } } : {}),
    };
  }

  private failure(): NavMeshPathResult {
    return {
      found: false,
      waypoints: EMPTY_WAYPOINTS,
      totalDistance: 0,
    };
  }

  private searchAStar(
    mesh: NavMesh,
    startId: number,
    targetId: number,
    agentRadius: number,
    request: NavMeshPathRequest,
  ): number[] | null {
    if (startId === targetId) {
      return [startId];
    }

    const target = mesh.getPolygon(targetId);

    if (!target) {
      return null;
    }

    const excluded = request.excludedAreas;
    const areaCosts = request.areaCosts;
    const gScore = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();
    const heapIds: number[] = [];
    const heapScores: number[] = [];
    const push = (id: number, score: number): void => {
      heapIds.push(id);
      heapScores.push(score);
      let index = heapIds.length - 1;

      while (index > 0) {
        const parent = (index - 1) >> 1;

        if ((heapScores[parent] as number) <= score) {
          break;
        }

        heapIds[index] = heapIds[parent] as number;
        heapScores[index] = heapScores[parent] as number;
        index = parent;
      }

      heapIds[index] = id;
      heapScores[index] = score;
    };
    const pop = (): number => {
      const top = heapIds[0] as number;
      const lastId = heapIds.pop() as number;
      const lastScore = heapScores.pop() as number;

      if (heapIds.length > 0) {
        let index = 0;

        for (;;) {
          const left = index * 2 + 1;
          const right = left + 1;
          let smallest = index;
          let smallestScore = lastScore;

          if (left < heapIds.length && (heapScores[left] as number) < smallestScore) {
            smallest = left;
            smallestScore = heapScores[left] as number;
          }

          if (right < heapIds.length && (heapScores[right] as number) < smallestScore) {
            smallest = right;
            smallestScore = heapScores[right] as number;
          }

          if (smallest === index) {
            break;
          }

          heapIds[index] = heapIds[smallest] as number;
          heapScores[index] = heapScores[smallest] as number;
          index = smallest;
        }

        heapIds[index] = lastId;
        heapScores[index] = lastScore;
      }

      return top;
    };

    gScore.set(startId, 0);
    push(startId, 0);

    while (heapIds.length > 0) {
      const currentId = pop();

      if (currentId === targetId) {
        const path: number[] = [];
        let cursor: number | undefined = currentId;

        while (cursor !== undefined) {
          path.push(cursor);
          cursor = cameFrom.get(cursor);
        }

        return path.reverse();
      }

      if (closed.has(currentId)) {
        continue;
      }

      closed.add(currentId);
      const current = mesh.getPolygon(currentId);

      if (!current) {
        continue;
      }

      const currentG = gScore.get(currentId) ?? Number.POSITIVE_INFINITY;

      for (const neighborId of current.neighbors) {
        if (closed.has(neighborId)) {
          continue;
        }

        const neighbor = mesh.getPolygon(neighborId);
        const portal = mesh.getPortal(currentId, neighborId);

        if (!neighbor || !portal) {
          continue;
        }

        // G72: portal estreito demais para o raio do agente.
        if (agentRadius > 0 && portal.width < agentRadius * 2 - 1e-9) {
          continue;
        }

        if (neighbor.area !== undefined && excluded && excluded.includes(neighbor.area)) {
          continue;
        }

        const areaMultiplier = neighbor.area !== undefined && areaCosts ? areaCosts[neighbor.area] ?? 1 : 1;

        if (!(areaMultiplier > 0) || !Number.isFinite(areaMultiplier)) {
          continue;
        }

        const midX = (portal.ax + portal.bx) * 0.5;
        const midY = (portal.ay + portal.by) * 0.5;
        const midZ = (portal.az + portal.bz) * 0.5;
        const step =
          this.distance3(current.centerX, current.centerY, current.centerZ, midX, midY, midZ) * current.cost +
          this.distance3(midX, midY, midZ, neighbor.centerX, neighbor.centerY, neighbor.centerZ) * neighbor.cost * areaMultiplier;
        const tentative = currentG + step;

        if (tentative >= (gScore.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }

        cameFrom.set(neighborId, currentId);
        gScore.set(neighborId, tentative);
        push(
          neighborId,
          tentative + this.distance3(neighbor.centerX, neighbor.centerY, neighbor.centerZ, target.centerX, target.centerY, target.centerZ),
        );
      }
    }

    return null;
  }

  /**
   * Funnel (simple stupid funnel algorithm) sobre os portais do corredor,
   * com portais encolhidos pelo raio do agente.
   */
  private stringPull(
    mesh: NavMesh,
    corridor: ReadonlyArray<number>,
    start: NavMeshLocation,
    target: NavMeshLocation,
    agentRadius: number,
  ): Vector3AI[] {
    const lefts: FunnelPoint[] = [{ x: start.x, y: start.y, z: start.z }];
    const rights: FunnelPoint[] = [{ x: start.x, y: start.y, z: start.z }];

    for (let index = 0; index < corridor.length - 1; index += 1) {
      const fromId = corridor[index] as number;
      const toId = corridor[index + 1] as number;
      const portal = mesh.getPortal(fromId, toId) as Portal;
      const from = mesh.getPolygon(fromId) as PolygonData;
      let ax = portal.ax;
      let ay = portal.ay;
      let az = portal.az;
      let bx = portal.bx;
      let by = portal.by;
      let bz = portal.bz;

      if (agentRadius > 0 && portal.width > agentRadius * 2) {
        const t = agentRadius / portal.width;
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        ax += dx * t;
        ay += dy * t;
        az += dz * t;
        bx -= dx * t;
        by -= dy * t;
        bz -= dz * t;
      } else if (agentRadius > 0) {
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        const mz = (az + bz) * 0.5;
        ax = bx = mx;
        ay = by = my;
        az = bz = mz;
      }

      // Lado: olhando do centro do polígono de origem para o portal.
      if (triarea2(from.centerX, from.centerZ, ax, az, bx, bz) > 0) {
        lefts.push({ x: ax, y: ay, z: az });
        rights.push({ x: bx, y: by, z: bz });
      } else {
        lefts.push({ x: bx, y: by, z: bz });
        rights.push({ x: ax, y: ay, z: az });
      }
    }

    lefts.push({ x: target.x, y: target.y, z: target.z });
    rights.push({ x: target.x, y: target.y, z: target.z });

    const path: Vector3AI[] = [{ x: start.x, y: start.y, z: start.z }];
    let apex = lefts[0] as FunnelPoint;
    let left = lefts[0] as FunnelPoint;
    let right = rights[0] as FunnelPoint;
    let apexIndex = 0;
    let leftIndex = 0;
    let rightIndex = 0;
    const count = lefts.length;

    for (let i = 1; i < count; i += 1) {
      const nextLeft = lefts[i] as FunnelPoint;
      const nextRight = rights[i] as FunnelPoint;

      // Aperta o lado direito.
      if (triarea2(apex.x, apex.z, right.x, right.z, nextRight.x, nextRight.z) <= 0) {
        if (samePoint(apex, right) || triarea2(apex.x, apex.z, left.x, left.z, nextRight.x, nextRight.z) > 0) {
          right = nextRight;
          rightIndex = i;
        } else {
          // Cruzou a esquerda: a esquerda vira o novo ápice.
          this.pushPoint(path, left);
          apex = left;
          apexIndex = leftIndex;
          left = apex;
          right = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }

      // Aperta o lado esquerdo.
      if (triarea2(apex.x, apex.z, left.x, left.z, nextLeft.x, nextLeft.z) >= 0) {
        if (samePoint(apex, left) || triarea2(apex.x, apex.z, right.x, right.z, nextLeft.x, nextLeft.z) < 0) {
          left = nextLeft;
          leftIndex = i;
        } else {
          this.pushPoint(path, right);
          apex = right;
          apexIndex = rightIndex;
          left = apex;
          right = apex;
          leftIndex = apexIndex;
          rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
    }

    this.pushPoint(path, { x: target.x, y: target.y, z: target.z });
    return path;
  }

  private pushPoint(path: Vector3AI[], point: FunnelPoint): void {
    const last = path[path.length - 1];

    if (last && Math.abs(last.x - point.x) < 1e-9 && Math.abs(last.y - point.y) < 1e-9 && Math.abs(last.z - point.z) < 1e-9) {
      return;
    }

    path.push({ x: point.x, y: point.y, z: point.z });
  }

  private calculatePathDistance(points: ReadonlyArray<Vector3AI>): number {
    let total = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index] as Vector3AI;
      const b = points[index + 1] as Vector3AI;
      total += this.distance3(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    return total;
  }

  private distance3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private isFiniteVector(vector: Vector3AI | undefined): vector is Vector3AI {
    return !!vector && Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
  }

  private sanitizeNonNegative(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
}

/** Área (×2) do triângulo a-b-c em XZ (sinal = lado). */
function triarea2(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const acx = cx - ax;
  const acz = cz - az;
  return acx * abz - abx * acz;
}

function samePoint(a: FunnelPoint, b: FunnelPoint): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;
}
