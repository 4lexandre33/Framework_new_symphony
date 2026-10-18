// @vitest-environment node
// G81: GPU compartilhada entre o GLTF em cache e seus clones (e texturas do
// cache) não é liberada pelo render enquanto o cache a referencia.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { AssetsManagerService, type AssetLoaderSet } from "../src/engine/assets/internal/AssetsManagerService";
import { SceneGraphManager } from "../src/engine/render/internal/SceneGraphManager";
import { RENDER_SHARED_RESOURCE } from "../src/contracts/render/types";

const shared = (resource: object): boolean => (resource as Record<symbol, unknown>)[RENDER_SHARED_RESOURCE] === true;

function makeGLTF(): {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: unknown[];
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
} {
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, scenes: [scene], animations: [], geometry, material, texture };
}

function loaders(gltf: unknown, texture?: THREE.Texture): Partial<AssetLoaderSet> {
  return {
    disposeAudio(): void {},
    loadGLTF: async () => gltf as never,
    loadTexture: async () => texture ?? new THREE.Texture(),
  };
}

describe("G81 GPU compartilhada entre cache e clones", () => {
  it("removeMeshFromScene de um clone não libera o que o cache e outros clones usam", async () => {
    const template = makeGLTF();
    const disposeGeometry = vi.spyOn(template.geometry, "dispose");
    const disposeMaterial = vi.spyOn(template.material, "dispose");
    const disposeTexture = vi.spyOn(template.texture, "dispose");
    const assets = new AssetsManagerService(undefined, loaders(template), { baseUrl: "http://game.local/" });
    const scene = new SceneGraphManager();

    const a = await assets.loadGLTF("hero.glb");
    const b = await assets.loadGLTF("hero.glb");
    expect(shared(template.geometry)).toBe(true);
    expect(shared(template.material)).toBe(true);
    expect(shared(template.texture)).toBe(true);
    expect(JSON.stringify(template.geometry.userData)).toBe("{}"); // nada no userData

    // Recurso próprio da instância (o jogo clonou o material): o render libera
    // (a marca não passa para o clone, ao contrário do userData).
    const ownMaterial = template.material.clone();
    expect(shared(ownMaterial)).toBe(false);
    expect(shared(template.geometry.clone())).toBe(false);
    const disposeOwn = vi.spyOn(ownMaterial, "dispose");
    (b.scene.children[0] as THREE.Mesh).material = ownMaterial;

    scene.addMesh("a", a.scene);
    scene.addMesh("b", b.scene);
    scene.removeMesh("a"); // padrão: disposeResources = true
    scene.removeMesh("b");
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(disposeTexture).not.toHaveBeenCalled();
    expect(disposeOwn).toHaveBeenCalledTimes(1);

    // Liberação por instância: idempotente; a GPU sai com a última.
    expect(assets.getRefCount("hero.glb")).toBe(2);
    expect(assets.releaseInstance(a)).toBe(true);
    expect(assets.releaseInstance(a)).toBe(false);
    expect(assets.releaseInstance(a.scene)).toBe(false); // mesmo ticket
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(assets.releaseInstance(b.scene)).toBe(true);
    expect(assets.getRefCount("hero.glb")).toBe(0);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(shared(template.geometry)).toBe(false); // marca retirada
    expect(assets.releaseInstance({})).toBe(false);
    scene.dispose();
  });

  it("textura do cache usada num material do jogo sobrevive ao removeMesh; sai no clearCache", async () => {
    const texture = new THREE.Texture();
    const disposeTexture = vi.spyOn(texture, "dispose");
    const assets = new AssetsManagerService(undefined, loaders(null, texture), { baseUrl: "http://game.local/" });
    const scene = new SceneGraphManager();
    const loaded = await assets.loadTexture("grass.png");
    const material = new THREE.MeshBasicMaterial({ map: loaded });
    const disposeMaterial = vi.spyOn(material, "dispose");
    scene.addMesh("ground", new THREE.Mesh(new THREE.PlaneGeometry(), material));
    scene.removeMesh("ground");
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeTexture).not.toHaveBeenCalled();
    assets.releaseAsset("grass.png");
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    scene.dispose();
  });

  it("userData.renderRetain do jogo é preservado; recurso compartilhado por 2 assets só perde a marca com o último", async () => {
    const template = makeGLTF();
    template.texture.userData.renderRetain = true; // o jogo já protegia esta textura
    const assets = new AssetsManagerService(undefined, {
      ...loaders(template, template.texture),
    }, { baseUrl: "http://game.local/" });
    const instance = await assets.loadGLTF("x.glb");
    await assets.loadTexture("same.png"); // mesma textura, outro asset
    const disposeTexture = vi.spyOn(template.texture, "dispose");
    assets.releaseInstance(instance);
    expect(disposeTexture).not.toHaveBeenCalled(); // same.png ainda usa
    expect(template.texture.userData.renderRetain).toBe(true);
    expect(shared(template.geometry)).toBe(false);
    expect(shared(template.texture)).toBe(true); // ainda dona: same.png
    assets.releaseAsset("same.png");
    expect(shared(template.texture)).toBe(false);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
  });
});
