import * as THREE from "three";

import type {
  AmbientLightConfig,
  DirectionalLightConfig,
  SceneLightConfig,
  Vector3D,
} from "../../../contracts/render/types";

/**
 * Geometria padrão compartilhada por TODOS os `THREE.Sprite` criados sem
 * geometria própria. Nunca é liberada pelo grafo de cena (G42).
 */
const SHARED_SPRITE_GEOMETRY: THREE.BufferGeometry =
  new THREE.Sprite().geometry;

const RETAIN_FLAG = "renderRetain";

interface DrawableLike extends THREE.Object3D {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

function isRetained(target: { userData?: Record<string, unknown> }): boolean {
  return target.userData?.[RETAIN_FLAG] === true;
}

function hasDrawableResources(object: THREE.Object3D): object is DrawableLike {
  const candidate = object as DrawableLike;

  return (
    candidate.geometry instanceof THREE.BufferGeometry ||
    candidate.material instanceof THREE.Material ||
    Array.isArray(candidate.material)
  );
}

function incrementRef<T>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrementRef<T>(map: Map<T, number>, key: T): number {
  const next = (map.get(key) ?? 0) - 1;

  if (next <= 0) {
    map.delete(key);
    return 0;
  }

  map.set(key, next);
  return next;
}

function finiteVector(value: Vector3D, label: string): void {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.z)
  ) {
    throw new RangeError(`${label} precisa ser finito.`);
  }
}

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

  // G42: contagem de referências dos recursos dos objetos registrados.
  // Calculada no addMesh/removeMesh, custo O(tamanho do objeto).
  private readonly geometryRefs = new Map<THREE.BufferGeometry, number>();
  private readonly materialRefs = new Map<THREE.Material, number>();
  private readonly textureRefs = new Map<THREE.Texture, number>();
  private readonly registeredResources = new Map<THREE.Object3D, RenderResources>();

  // G22: luzes extras e direção da luz direcional da engine.
  private readonly extraLights = new Map<string, THREE.Light>();
  private readonly directionalOffset = new THREE.Vector3(10, 20, 10);

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
    // O alvo precisa estar na cena para ter matrixWorld atualizada (G22).
    this.scene.add(this.directionalLight.target);
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

    if (config.target !== undefined) {
      finiteVector(config.target, "Directional light target");
      this.directionalLight.target.position.set(
        config.target.x,
        config.target.y,
        config.target.z,
      );
    }

    this.directionalOffset
      .copy(this.directionalLight.position)
      .sub(this.directionalLight.target.position);

    const shadow = this.directionalLight.shadow;
    const shadowCamera = shadow.camera;
    let shadowCameraChanged = false;

    if (config.shadowAreaSize !== undefined) {
      if (!Number.isFinite(config.shadowAreaSize) || config.shadowAreaSize <= 0) {
        throw new RangeError("shadowAreaSize precisa ser finito e > 0.");
      }

      shadowCamera.left = -config.shadowAreaSize;
      shadowCamera.right = config.shadowAreaSize;
      shadowCamera.top = config.shadowAreaSize;
      shadowCamera.bottom = -config.shadowAreaSize;
      shadowCameraChanged = true;
    }

    if (config.shadowNear !== undefined) {
      if (!Number.isFinite(config.shadowNear) || config.shadowNear <= 0) {
        throw new RangeError("shadowNear precisa ser finito e > 0.");
      }

      shadowCamera.near = config.shadowNear;
      shadowCameraChanged = true;
    }

    if (config.shadowFar !== undefined) {
      if (!Number.isFinite(config.shadowFar) || config.shadowFar <= shadowCamera.near) {
        throw new RangeError("shadowFar precisa ser finito e > shadowNear.");
      }

      shadowCamera.far = config.shadowFar;
      shadowCameraChanged = true;
    }

    if (shadowCameraChanged) {
      shadowCamera.updateProjectionMatrix();
    }

    if (config.shadowMapSize !== undefined) {
      if (!Number.isInteger(config.shadowMapSize) || config.shadowMapSize <= 0) {
        throw new RangeError("shadowMapSize precisa ser inteiro e > 0.");
      }

      if (
        shadow.mapSize.width !== config.shadowMapSize ||
        shadow.mapSize.height !== config.shadowMapSize
      ) {
        shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);

        // O shadow map antigo é recriado no próximo frame com o novo tamanho.
        if (shadow.map !== null) {
          shadow.map.dispose();
          shadow.map = null;
        }
      }
    }

    if (config.shadowBias !== undefined && Number.isFinite(config.shadowBias)) {
      shadow.bias = config.shadowBias;
    }

    if (
      config.shadowNormalBias !== undefined &&
      Number.isFinite(config.shadowNormalBias)
    ) {
      shadow.normalBias = config.shadowNormalBias;
    }
  }

  /** Move luz direcional + alvo juntos mantendo a direção. Sem alocação. */
  public setShadowFocus(center: Vector3D): void {
    this.assertNotDisposed();
    finiteVector(center, "Shadow focus");

    this.directionalLight.target.position.set(center.x, center.y, center.z);
    this.directionalLight.position
      .copy(this.directionalLight.target.position)
      .add(this.directionalOffset);
  }

  public getDirectionalLight(): THREE.DirectionalLight {
    return this.directionalLight;
  }

  public addLight(lightId: string, config: SceneLightConfig): void {
    this.assertNotDisposed();

    if (lightId.trim().length === 0) {
      throw new RangeError("lightId não pode ser vazio.");
    }

    const intensity = config.intensity ?? 1;
    assertFiniteIntensity(intensity, "Light intensity");

    const color = config.color ?? 0xffffff;
    let light: THREE.Light;

    switch (config.type) {
      case "directional": {
        const directional = new THREE.DirectionalLight(color, intensity);
        const size = config.shadowAreaSize ?? 15;

        if (!Number.isFinite(size) || size <= 0) {
          throw new RangeError("shadowAreaSize precisa ser finito e > 0.");
        }

        directional.shadow.camera.left = -size;
        directional.shadow.camera.right = size;
        directional.shadow.camera.top = size;
        directional.shadow.camera.bottom = -size;
        directional.shadow.camera.updateProjectionMatrix();
        light = directional;
        break;
      }
      case "point":
        light = new THREE.PointLight(
          color,
          intensity,
          config.distance ?? 0,
          config.decay ?? 2,
        );
        break;
      case "spot":
        light = new THREE.SpotLight(
          color,
          intensity,
          config.distance ?? 0,
          config.angle ?? Math.PI / 3,
          config.penumbra ?? 0,
          config.decay ?? 2,
        );
        break;
      case "hemisphere":
        light = new THREE.HemisphereLight(
          color,
          config.groundColor ?? 0x444444,
          intensity,
        );
        break;
      case "ambient":
        light = new THREE.AmbientLight(color, intensity);
        break;
      default:
        throw new RangeError(
          `Tipo de luz inválido: ${String((config as { type: unknown }).type)}.`,
        );
    }

    if (config.position !== undefined) {
      finiteVector(config.position, "Light position");
      light.position.set(config.position.x, config.position.y, config.position.z);
    }

    if (
      (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) &&
      config.target !== undefined
    ) {
      finiteVector(config.target, "Light target");
      light.target.position.set(config.target.x, config.target.y, config.target.z);
    }

    if (config.castShadow === true && light.shadow !== undefined) {
      light.castShadow = true;

      if (config.shadowMapSize !== undefined) {
        if (!Number.isInteger(config.shadowMapSize) || config.shadowMapSize <= 0) {
          throw new RangeError("shadowMapSize precisa ser inteiro e > 0.");
        }

        light.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
      }
    }

    this.removeLight(lightId);
    this.extraLights.set(lightId, light);
    this.scene.add(light);

    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
      this.scene.add(light.target);
    }
  }

  public removeLight(lightId: string): boolean {
    const light = this.extraLights.get(lightId);

    if (light === undefined) {
      return false;
    }

    this.extraLights.delete(lightId);
    this.scene.remove(light);

    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
      this.scene.remove(light.target);
    }

    light.dispose();
    return true;
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

    const resources = createRenderResources();
    this.collectObjectResources(object, resources);
    this.registeredResources.set(object, resources);

    for (const geometry of resources.geometries) {
      incrementRef(this.geometryRefs, geometry);
    }

    for (const material of resources.materials) {
      incrementRef(this.materialRefs, material);
    }

    for (const texture of resources.textures) {
      incrementRef(this.textureRefs, texture);
    }
  }

  /**
   * Remove o objeto da cena. Com `disposeResources` (padrão) libera os
   * recursos que nenhum outro objeto registrado usa (G42).
   */
  public removeMesh(key: string, disposeResources = true): boolean {
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

    const registered =
      this.registeredResources.get(object) ?? createRenderResources();
    this.registeredResources.delete(object);

    // Recursos ainda referenciados por OUTROS objetos registrados.
    const retained = createRenderResources();

    for (const geometry of registered.geometries) {
      if (decrementRef(this.geometryRefs, geometry) > 0) {
        retained.geometries.add(geometry);
      }
    }

    for (const material of registered.materials) {
      if (decrementRef(this.materialRefs, material) > 0) {
        retained.materials.add(material);
      }
    }

    for (const texture of registered.textures) {
      if (decrementRef(this.textureRefs, texture) > 0) {
        retained.textures.add(texture);
      }
    }

    if (!disposeResources || isRetained(object)) {
      return true;
    }

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

      if (!isRetained(object)) {
        this.collectObjectResources(object, resources);
        this.disposeInstancedBuffers(object);
      }
    }

    this.meshRegistry.clear();
    this.registeredResources.clear();
    this.geometryRefs.clear();
    this.materialRefs.clear();
    this.textureRefs.clear();
    this.disposeResourceSets(resources);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clearScene();

    for (const lightId of [...this.extraLights.keys()]) {
      this.removeLight(lightId);
    }

    this.directionalLight.dispose();
    this.ambientLight.dispose();
    this.scene.clear();
    this.disposed = true;
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SceneGraphManager já foi disposed.");
    }
  }

  private collectObjectResources(
    object: THREE.Object3D,
    resources: RenderResources,
  ): void {
    object.traverse((child: THREE.Object3D): void => {
      // Mesh, InstancedMesh, SkinnedMesh, Points, Line(s) e Sprite (G42).
      if (!hasDrawableResources(child) || isRetained(child)) {
        return;
      }

      const geometry = child.geometry;

      if (
        geometry instanceof THREE.BufferGeometry &&
        geometry !== SHARED_SPRITE_GEOMETRY &&
        !isRetained(geometry)
      ) {
        resources.geometries.add(geometry);
      }

      const material = child.material;

      if (Array.isArray(material)) {
        for (const entry of material) {
          this.collectMaterialResources(entry, resources);
        }
      } else if (material instanceof THREE.Material) {
        this.collectMaterialResources(material, resources);
      }
    });
  }

  private collectMaterialResources(
    material: THREE.Material,
    resources: RenderResources,
  ): void {
    if (isRetained(material)) {
      return;
    }

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
      if (!isRetained(value)) {
        textures.add(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry instanceof THREE.Texture && !isRetained(entry)) {
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
    this.disposeInstancedBuffers(object);

    for (const texture of owned.textures) {
      if (
        !retained.textures.has(texture) &&
        !this.textureRefs.has(texture) &&
        !disposed.textures.has(texture)
      ) {
        texture.dispose();
        disposed.textures.add(texture);
      }
    }

    for (const material of owned.materials) {
      if (
        !retained.materials.has(material) &&
        !this.materialRefs.has(material) &&
        !disposed.materials.has(material)
      ) {
        material.dispose();
        disposed.materials.add(material);
      }
    }

    for (const geometry of owned.geometries) {
      if (
        !retained.geometries.has(geometry) &&
        !this.geometryRefs.has(geometry) &&
        !disposed.geometries.has(geometry)
      ) {
        geometry.dispose();
        disposed.geometries.add(geometry);
      }
    }
  }

  /** Libera os buffers de instância (instanceMatrix/instanceColor) do objeto. */
  private disposeInstancedBuffers(object: THREE.Object3D): void {
    object.traverse((child: THREE.Object3D): void => {
      if (child instanceof THREE.InstancedMesh && !isRetained(child)) {
        child.dispose();
      }
    });
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
