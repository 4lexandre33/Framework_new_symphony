import * as THREE from "three";

import type {
  HLODClusterDescriptor,
  SectorCoord,
} from "../../../contracts/streaming/types";

export interface MergedHLOD {
  readonly object: THREE.Group;
  readonly sourceMeshCount: number;
  readonly mergedDrawCalls: number;
  readonly vertexCount: number;
  readonly skippedMeshCount: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
}

interface MaterialBucket {
  readonly material: THREE.Material;
  readonly meshes: THREE.Mesh[];
}

const scratchNormalMatrix = new THREE.Matrix3();
const scratchVector = new THREE.Vector3();

/**
 * HLOD real (G61): funde as malhas estáticas de um setor em UMA malha por
 * material (posições em espaço de mundo), reduzindo draw calls. Malhas
 * skinned/instanced/multi-material ficam de fora (contadas em `skipped`).
 */
export class HLODBuilder {
  private readonly clusters = new Map<string, HLODClusterDescriptor>();

  public registerCluster(descriptor: HLODClusterDescriptor): void {
    this.clusters.set(this.getSectorKey(descriptor.sectorCoord), descriptor);
  }

  public getCluster(sectorCoord: SectorCoord): HLODClusterDescriptor | null {
    return this.clusters.get(this.getSectorKey(sectorCoord)) ?? null;
  }

  public removeCluster(sectorCoord: SectorCoord): boolean {
    return this.clusters.delete(this.getSectorKey(sectorCoord));
  }

  public get clusterCount(): number {
    return this.clusters.size;
  }

  /** Estatística dos descritores registrados (nada fundido aqui; ver StreamingService.getHLODStats). */
  public getStats(): { totalClusters: number; drawCallsSaved: number; mergedMeshCount: number } {
    return {
      totalClusters: this.clusters.size,
      drawCallsSaved: 0,
      mergedMeshCount: 0,
    };
  }

  public merge(sources: ReadonlyArray<THREE.Object3D>, name: string): MergedHLOD | null {
    const buckets = new Map<string, MaterialBucket>();
    let sourceMeshCount = 0;
    let skippedMeshCount = 0;

    for (const source of sources) {
      source.updateWorldMatrix(true, true);
      source.traverse((node): void => {
        const mesh = node as THREE.Mesh;

        if (!mesh.isMesh) {
          return;
        }

        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;

        if (
          (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ||
          (mesh as unknown as THREE.InstancedMesh).isInstancedMesh ||
          Array.isArray(mesh.material) ||
          !geometry ||
          !geometry.getAttribute("position")
        ) {
          skippedMeshCount += 1;
          return;
        }

        const material = mesh.material as THREE.Material;
        let bucket = buckets.get(material.uuid);

        if (!bucket) {
          bucket = { material, meshes: [] };
          buckets.set(material.uuid, bucket);
        }

        bucket.meshes.push(mesh);
        sourceMeshCount += 1;
      });
    }

    if (sourceMeshCount === 0) {
      return null;
    }

    const group = new THREE.Group();
    group.name = name;
    const box = new THREE.Box3();
    let vertexCount = 0;

    for (const bucket of buckets.values()) {
      const geometry = this.mergeBucket(bucket.meshes);
      vertexCount += geometry.getAttribute("position").count;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      if (geometry.boundingBox) {
        box.union(geometry.boundingBox);
      }

      const merged = new THREE.Mesh(geometry, bucket.material);
      merged.name = `${name}_${bucket.material.uuid}`;
      merged.matrixAutoUpdate = false;
      merged.updateMatrix();
      group.add(merged);
    }

    const center = box.getCenter(new THREE.Vector3());

    return {
      object: group,
      sourceMeshCount,
      mergedDrawCalls: buckets.size,
      vertexCount,
      skippedMeshCount,
      centerX: center.x,
      centerY: center.y,
      centerZ: center.z,
    };
  }

  public clear(): void {
    this.clusters.clear();
  }

  private mergeBucket(meshes: ReadonlyArray<THREE.Mesh>): THREE.BufferGeometry {
    let totalVertices = 0;
    let totalIndices = 0;
    let allNormals = true;
    let allUvs = true;

    for (const mesh of meshes) {
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const count = geometry.getAttribute("position").count;
      totalVertices += count;
      totalIndices += geometry.index ? geometry.index.count : count;
      allNormals &&= geometry.getAttribute("normal") !== undefined;
      allUvs &&= geometry.getAttribute("uv") !== undefined;
    }

    const positions = new Float32Array(totalVertices * 3);
    const normals = allNormals ? new Float32Array(totalVertices * 3) : null;
    const uvs = allUvs ? new Float32Array(totalVertices * 2) : null;
    const indices = new Uint32Array(totalIndices);
    let vertexOffset = 0;
    let indexOffset = 0;

    for (const mesh of meshes) {
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      const matrix = mesh.matrixWorld;
      scratchNormalMatrix.getNormalMatrix(matrix);
      // Matriz com determinante negativo inverte a ordem dos triângulos.
      const flip = matrix.determinant() < 0;

      for (let i = 0; i < position.count; i += 1) {
        scratchVector.fromBufferAttribute(position, i).applyMatrix4(matrix);
        positions[(vertexOffset + i) * 3] = scratchVector.x;
        positions[(vertexOffset + i) * 3 + 1] = scratchVector.y;
        positions[(vertexOffset + i) * 3 + 2] = scratchVector.z;

        if (normals && normal) {
          scratchVector.fromBufferAttribute(normal, i).applyMatrix3(scratchNormalMatrix).normalize();
          normals[(vertexOffset + i) * 3] = scratchVector.x;
          normals[(vertexOffset + i) * 3 + 1] = scratchVector.y;
          normals[(vertexOffset + i) * 3 + 2] = scratchVector.z;
        }

        if (uvs && uv) {
          uvs[(vertexOffset + i) * 2] = uv.getX(i);
          uvs[(vertexOffset + i) * 2 + 1] = uv.getY(i);
        }
      }

      const index = geometry.index;
      const indexCount = index ? index.count : position.count;

      for (let i = 0; i < indexCount; i += 3) {
        const a = index ? index.getX(i) : i;
        const b = index ? index.getX(i + 1) : i + 1;
        const c = index ? index.getX(i + 2) : i + 2;
        indices[indexOffset + i] = vertexOffset + a;
        indices[indexOffset + i + 1] = vertexOffset + (flip ? c : b);
        indices[indexOffset + i + 2] = vertexOffset + (flip ? b : c);
      }

      vertexOffset += position.count;
      indexOffset += indexCount;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    if (normals) {
      merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    }

    if (uvs) {
      merged.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    }

    merged.setIndex(new THREE.BufferAttribute(indices, 1));

    if (!normals) {
      merged.computeVertexNormals();
    }

    return merged;
  }

  private getSectorKey(coord: SectorCoord): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }
}
