import * as THREE from "three";
import type { ParallaxLayerConfig } from "../../../contracts/sprites/types";

interface ActiveParallaxLayer {
  readonly config: ParallaxLayerConfig;
  readonly mesh: THREE.Mesh;
  readonly initialPosition: { x: number; y: number; z: number };
}

export class ParallaxController {
  private readonly layers = new Map<string, ActiveParallaxLayer>();

  public createLayer(
    config: ParallaxLayerConfig,
    texture: THREE.Texture,
    width = 100,
    height = 50
  ): THREE.Mesh {
    texture.wrapS = config.repeatX !== false ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = config.repeatY ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    const depthZ = config.depthZ !== undefined ? config.depthZ : -10;
    mesh.position.set(0, 0, depthZ);

    this.layers.set(config.layerId, {
      config,
      mesh,
      initialPosition: { x: 0, y: 0, z: depthZ },
    });

    return mesh;
  }

  public update(cameraX: number, cameraY: number): void {
    for (const layer of this.layers.values()) {
      const { config, mesh, initialPosition } = layer;
      const offsetX = cameraX * config.factorX;
      const offsetY = cameraY * config.factorY;

      mesh.position.x = initialPosition.x + cameraX - offsetX;
      mesh.position.y = initialPosition.y + cameraY - offsetY;

      if (mesh.material instanceof THREE.MeshBasicMaterial && mesh.material.map) {
        mesh.material.map.offset.x = (cameraX * config.factorX) / 100;
      }
    }
  }

  public removeLayer(layerId: string): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;

    layer.mesh.geometry.dispose();
    if (layer.mesh.material instanceof THREE.Material) {
      layer.mesh.material.dispose();
    }
    this.layers.delete(layerId);
    return true;
  }

  public clear(): void {
    for (const layerId of this.layers.keys()) {
      this.removeLayer(layerId);
    }
  }
}