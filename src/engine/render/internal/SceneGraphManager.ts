import * as THREE from "three";

import type {
  AmbientLightConfig,
  DirectionalLightConfig,
} from "../../../contracts/render/types";

interface RenderResources {
  readonly geometries: Set<THREE.BufferGeometry>;
  readonly materials: Set<THREE.Material>;
  readonly textures: Set<THREE.Texture>;
}

function createRenderResources(): RenderResources {
  return {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>(),
  };
}

function assertFiniteIntensity(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} precisa ser finita e >= 0.`);
  }
}

function assertFinitePosition(
  x: number,
  y: number,
  z: number,
): void {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    throw new RangeError("Directional light position precisa ser finita.");
  }
}

export class SceneGraphManager {
  private readonly scene: THREE.Scene;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly directionalLight: THREE.DirectionalLight;

  private readonly meshRegistry = new Map<string, THREE.Object3D>();
  private readonly objectKeys = new WeakMap<THREE.Object3D, string>();

  private disposed = false;

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
    this.assertNotDisposed();
    assertFiniteIntensity(config.intensity, "Ambient light intensity");

    this.ambientLight.color.set(config.color);
    this.ambientLight.intensity = config.intensity;
  }

  public setDirectionalLight(config: DirectionalLightConfig): void {
    this.assertNotDisposed();
    assertFiniteIntensity(config.intensity, "Directional light intensity");

    assertFinitePosition(
      config.position.x,
      config.position.y,
      config.position.z,
    );

    this.directionalLight.color.set(config.color);
    this.directionalLight.intensity = config.intensity;

    this.directionalLight.position.set(
      config.position.x,
      config.position.y,
      config.position.z,
    );

    this.directionalLight.castShadow = config.castShadow;
  }

  public addMesh(key: string, object: THREE.Object3D): void {
    this.assertNotDisposed();

    if (key.trim().length === 0) {
      throw new RangeError("Scene mesh key não pode ser vazia.");
    }

    const currentKey = this.objectKeys.get(object);

    if (currentKey !== undefined && currentKey !== key) {
      throw new Error(
        `Object3D já registrado como "${currentKey}" e não pode pertencer também a "${key}".`,
      );
    }

    const previous = this.meshRegistry.get(key);

    if (previous === object) {
      return;
    }

    if (previous !== undefined) {
      this.removeMesh(key);
    }

    this.meshRegistry.set(key, object);
    this.objectKeys.set(object, key);
    this.scene.add(object);
  }

  public removeMesh(key: string): boolean {
    if (this.disposed) {
      return false;
    }

    const object = this.meshRegistry.get(key);

    if (object === undefined) {
      return false;
    }

    this.meshRegistry.delete(key);
    this.objectKeys.delete(object);
    this.scene.remove(object);

    const retained = this.collectRegistryResources();
    const disposed = createRenderResources();

    this.disposeObjectResources(
      object,
      retained,
      disposed,
    );

    return true;
  }

  public getMesh(key: string): THREE.Object3D | null {
    return this.meshRegistry.get(key) ?? null;
  }

  public clearScene(): void {
    if (this.disposed) {
      return;
    }

    const resources = createRenderResources();

    for (const object of this.meshRegistry.values()) {
      this.scene.remove(object);
      this.objectKeys.delete(object);
      this.collectObjectResources(object, resources);
    }

    this.meshRegistry.clear();
    this.disposeResourceSets(resources);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clearScene();
    this.scene.clear();
    this.disposed = true;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SceneGraphManager já foi disposed.");
    }
  }

  private collectRegistryResources(): RenderResources {
    const resources = createRenderResources();

    for (const object of this.meshRegistry.values()) {
      this.collectObjectResources(object, resources);
    }

    return resources;
  }

  private collectObjectResources(
    object: THREE.Object3D,
    resources: RenderResources,
  ): void {
    object.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      resources.geometries.add(child.geometry);

      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          this.collectMaterialResources(material, resources);
        }
      } else {
        this.collectMaterialResources(child.material, resources);
      }
    });
  }

  private collectMaterialResources(
    material: THREE.Material,
    resources: RenderResources,
  ): void {
    resources.materials.add(material);

    const values = Object.values(
      material as unknown as Record<string, unknown>,
    );

    for (const value of values) {
      this.collectTextureValue(value, resources.textures);
    }

    if (material instanceof THREE.ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        this.collectTextureValue(uniform.value, resources.textures);
      }
    }
  }

  private collectTextureValue(
    value: unknown,
    textures: Set<THREE.Texture>,
  ): void {
    if (value instanceof THREE.Texture) {
      textures.add(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry instanceof THREE.Texture) {
          textures.add(entry);
        }
      }
    }
  }

  private disposeObjectResources(
    object: THREE.Object3D,
    retained: RenderResources,
    disposed: RenderResources,
  ): void {
    const owned = createRenderResources();

    this.collectObjectResources(object, owned);

    for (const texture of owned.textures) {
      if (
        !retained.textures.has(texture) &&
        !disposed.textures.has(texture)
      ) {
        texture.dispose();
        disposed.textures.add(texture);
      }
    }

    for (const material of owned.materials) {
      if (
        !retained.materials.has(material) &&
        !disposed.materials.has(material)
      ) {
        material.dispose();
        disposed.materials.add(material);
      }
    }

    for (const geometry of owned.geometries) {
      if (
        !retained.geometries.has(geometry) &&
        !disposed.geometries.has(geometry)
      ) {
        geometry.dispose();
        disposed.geometries.add(geometry);
      }
    }
  }

  private disposeResourceSets(resources: RenderResources): void {
    for (const texture of resources.textures) {
      texture.dispose();
    }

    for (const material of resources.materials) {
      material.dispose();
    }

    for (const geometry of resources.geometries) {
      geometry.dispose();
    }
  }
}
