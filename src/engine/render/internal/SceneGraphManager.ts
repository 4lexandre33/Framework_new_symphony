import * as THREE from "three";
import type {
  AmbientLightConfig,
  DirectionalLightConfig,
} from "../../../contracts/render/types";

export class SceneGraphManager {
  private readonly scene: THREE.Scene;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly directionalLight: THREE.DirectionalLight;

  private readonly meshRegistry = new Map<string, THREE.Object3D>();

  public constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#050508");

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.directionalLight.position.set(10, 20, 10);
    this.directionalLight.castShadow = true;

    this.directionalLight.shadow.mapSize.width = 1024;
    this.directionalLight.shadow.mapSize.height = 1024;
    this.directionalLight.shadow.camera.near = 0.5;
    this.directionalLight.shadow.camera.far = 50;
    this.directionalLight.shadow.camera.left = -15;
    this.directionalLight.shadow.camera.right = 15;
    this.directionalLight.shadow.camera.top = 15;
    this.directionalLight.shadow.camera.bottom = -15;

    this.scene.add(this.directionalLight);
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public setAmbientLight(config: AmbientLightConfig): void {
    this.ambientLight.color.set(config.color);
    this.ambientLight.intensity = config.intensity;
  }

  public setDirectionalLight(config: DirectionalLightConfig): void {
    this.directionalLight.color.set(config.color);
    this.directionalLight.intensity = config.intensity;
    this.directionalLight.position.set(
      config.position.x,
      config.position.y,
      config.position.z
    );
    this.directionalLight.castShadow = config.castShadow;
  }

  public addMesh(key: string, object: THREE.Object3D): void {
    if (this.meshRegistry.has(key)) {
      this.removeMesh(key);
    }

    this.meshRegistry.set(key, object);
    this.scene.add(object);
  }

  public removeMesh(key: string): boolean {
    const object = this.meshRegistry.get(key);
    if (!object) return false;

    this.scene.remove(object);
    this.meshRegistry.delete(key);

    this.disposeObjectRecursively(object);
    return true;
  }

  public getMesh(key: string): THREE.Object3D | null {
    return this.meshRegistry.get(key) || null;
  }

  public clearScene(): void {
    for (const [_, object] of this.meshRegistry.entries()) {
      this.scene.remove(object);
      this.disposeObjectRecursively(object);
    }
    this.meshRegistry.clear();
  }

  private disposeObjectRecursively(object: THREE.Object3D): void {
    object.traverse((child: any) => {
      if (child.geometry && typeof child.geometry.dispose === "function") {
        child.geometry.dispose();
      }

      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat: any) => mat.dispose && mat.dispose());
        } else if (typeof child.material.dispose === "function") {
          child.material.dispose();
        }
      }
    });
  }

  public dispose(): void {
    this.clearScene();
    this.scene.clear();
  }
}