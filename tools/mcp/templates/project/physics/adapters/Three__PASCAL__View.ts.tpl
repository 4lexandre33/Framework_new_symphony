import * as THREE from "three";
import type { Render3DApi } from "../../../tokens/render";
import type { Quat, Vec3, __PASCAL__ViewPort } from "../ports/__PASCAL__ViewPort";

const BOX_MESH_ID = "__ID__.box-mesh";
const FLOOR_MESH_ID = "__ID__.floor-mesh";

/** Adapter Three.js da porta de visualização. Nada dele entra na lógica do jogo. */
export class Three__PASCAL__View implements __PASCAL__ViewPort {
  private readonly box: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private boxRegistered = false;
  private floorRegistered = false;
  private disposed = false;

  public constructor(private readonly render: Render3DApi) {
    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.5 }),
    );
    this.box.position.set(0, 5, 0);
    this.box.castShadow = true;

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.9 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;

    try {
      this.render.addMeshToScene(FLOOR_MESH_ID, this.floor);
      this.floorRegistered = true;
      this.render.addMeshToScene(BOX_MESH_ID, this.box);
      this.boxRegistered = true;
    } catch (error: unknown) {
      this.dispose();
      throw error;
    }
  }

  public setBoxTransform(position: Vec3, rotation: Quat): void {
    if (this.disposed) return;
    this.box.position.set(position.x, position.y, position.z);
    this.box.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // removeMeshFromScene já libera geometria/material não compartilhados.
    if (this.boxRegistered) this.render.removeMeshFromScene(BOX_MESH_ID);
    else {
      this.box.geometry.dispose();
      this.box.material.dispose();
    }
    if (this.floorRegistered) this.render.removeMeshFromScene(FLOOR_MESH_ID);
    else {
      this.floor.geometry.dispose();
      this.floor.material.dispose();
    }
  }
}
