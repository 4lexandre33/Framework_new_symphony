import * as THREE from "three";
import type { DecalConfig } from "../../../contracts/vfx/types";

export interface ActiveDecalInstance {
  readonly config: DecalConfig;
  readonly mesh: THREE.Mesh;
  createdAtTime: number;
}

export class DecalManager {
  private readonly activeDecals: ActiveDecalInstance[] = [];
  private readonly maxDecalsLimit = 200;

  // Scratch Objects pré-alocados para cálculo de matriz de alinhamento com a normal sem GC
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchMatrix = new THREE.Matrix4();
  private readonly scratchQuaternion = new THREE.Quaternion();

  public projectDecal(
    config: DecalConfig,
    texture: THREE.Texture,
    targetScene: THREE.Scene
  ): THREE.Mesh {
    // 1. Reciclagem circular em Ring Buffer (FIFO) ao atingir limite rígido de VRAM
    if (this.activeDecals.length >= this.maxDecalsLimit) {
      const oldest = this.activeDecals.shift();
      if (oldest) {
        targetScene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        if (oldest.mesh.material instanceof THREE.Material) {
          oldest.mesh.material.dispose();
        }
      }
    }

    // 2. Cálculo da Rotação Alinhada à Normal da Superfície
    this.scratchPosition.set(config.position.x, config.position.y, config.position.z);
    this.scratchNormal.set(config.orientationNormal.x, config.orientationNormal.y, config.orientationNormal.z).normalize();

    this.scratchMatrix.lookAt(
      this.scratchPosition,
      this.scratchPosition.clone().add(this.scratchNormal),
      Math.abs(this.scratchNormal.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : this.scratchUp
    );
    this.scratchQuaternion.setFromRotationMatrix(this.scratchMatrix);

    // 3. Geometria da Caixa Projetora
    const geometry = new THREE.BoxGeometry(config.size.x, config.size.y, config.size.z);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });

    const decalMesh = new THREE.Mesh(geometry, material);
    decalMesh.position.copy(this.scratchPosition);
    decalMesh.quaternion.copy(this.scratchQuaternion);

    targetScene.add(decalMesh);

    this.activeDecals.push({
      config,
      mesh: decalMesh,
      createdAtTime: performance.now(),
    });

    return decalMesh;
  }

  public getActiveDecalCount(): number {
    return this.activeDecals.length;
  }

  public clear(targetScene?: THREE.Scene): void {
    for (const decal of this.activeDecals) {
      if (targetScene) targetScene.remove(decal.mesh);
      decal.mesh.geometry.dispose();
      if (decal.mesh.material instanceof THREE.Material) {
        decal.mesh.material.dispose();
      }
    }
    this.activeDecals.length = 0;
  }
}