import * as THREE from "three";
import type { Render3DApi } from "../../../tokens/render";
import type {
  PhysicsSandboxViewPort,
  Position3,
  Rotation4,
} from "../ports/PhysicsSandboxViewPort";

const CUBE_MESH_ID = "example.physics-sandbox.visual-cube";
const FLOOR_MESH_ID = "example.physics-sandbox.visual-floor";

/** Adapter específico do backend Three.js. Nada dele entra no Domain. */
export class ThreeSandboxView implements PhysicsSandboxViewPort {
  private readonly cube: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly previousBackground: THREE.Scene["background"];
  private cubeRegistered = false;
  private floorRegistered = false;
  private disposed = false;

  public constructor(private readonly render: Render3DApi) {
    this.previousBackground = render.getScene().background;
    this.cube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({
        color: "#00cfff",
        metalness: 0.25,
        roughness: 0.4,
      }),
    );
    this.cube.position.set(0, 5, 0);
    this.cube.castShadow = true;
    this.cube.receiveShadow = true;

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.85 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;

    try {
      this.render.addMeshToScene(FLOOR_MESH_ID, this.floor);
      this.floorRegistered = true;
      this.render.addMeshToScene(CUBE_MESH_ID, this.cube);
      this.cubeRegistered = true;
      this.render.getScene().background = new THREE.Color("#10192a");
    } catch (error: unknown) {
      this.dispose();
      throw error;
    }
  }

  public setCubeTransform(position: Position3, rotation: Rotation4): void {
    if (this.disposed) return;
    this.cube.position.set(position.x, position.y, position.z);
    this.cube.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.cubeRegistered) {
      this.render.removeMeshFromScene(CUBE_MESH_ID);
    } else {
      this.cube.geometry.dispose();
      this.cube.material.dispose();
    }
    if (this.floorRegistered) {
      this.render.removeMeshFromScene(FLOOR_MESH_ID);
    } else {
      this.floor.geometry.dispose();
      this.floor.material.dispose();
    }
    this.render.getScene().background = this.previousBackground;
  }
}
