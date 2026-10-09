// Cena 3D: objetos Three.js entram pela API de render (chave única) e SAEM no dispose.
import * as THREE from "three";
import type { Render3DApi } from "../../../tokens/render";

export function buildScene(render: Render3DApi): () => void {
  render.setAmbientLight({ color: 0xffffff, intensity: 0.6 });
  render.setDirectionalLight({ color: 0xffffff, intensity: 1.2, castShadow: false, position: { x: 5, y: 10, z: 5 } });

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3399ff }));
  render.addMeshToScene("meu-jogo:cube", cube);

  return (): void => {
    render.removeMeshFromScene("meu-jogo:cube");
    cube.geometry.dispose();
    cube.material.dispose(); // GPU não é coletada pelo GC
  };
}
// Sincronize mesh↔corpo: physics.syncMeshTransform(id, mesh) a cada tick (ver 03-physics-body.ts).
