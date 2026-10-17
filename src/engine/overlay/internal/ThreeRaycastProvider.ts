import * as THREE from "three";

import type { OverlayRaycastProvider } from "../../../contracts/overlay/types";

/** Fonte mínima de cena/câmera/canvas (compatível com `Render3DApi`). */
export interface OverlayRaycastSource {
  getScene(): THREE.Scene;
  getActiveCamera(): THREE.Camera;
  getCanvas(): HTMLCanvasElement;
}

/**
 * G15: raycast 3D do hit-test do overlay. Um objeto é interativo se estiver
 * visível e não tiver `userData.overlayInteractive === false` (nele ou em
 * um ancestral). `entityId` vem de `userData.entityId` (subindo na árvore)
 * ou do `name`. Reutiliza Raycaster/vetor/array: zero alocação por chamada
 * depois da primeira (exceto o que o three aloca internamente).
 */
export function createThreeRaycastProvider(source: OverlayRaycastSource): OverlayRaycastProvider {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits: THREE.Intersection[] = [];
  const miss = { hit: false } as const;

  return (cursorX: number, cursorY: number) => {
    let canvas: HTMLCanvasElement;
    let scene: THREE.Scene;
    let camera: THREE.Camera;
    try {
      canvas = source.getCanvas();
      scene = source.getScene();
      camera = source.getActiveCamera();
    } catch {
      return miss;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return miss;
    const lx = cursorX - rect.left;
    const ly = cursorY - rect.top;
    if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return miss;

    ndc.set((lx / rect.width) * 2 - 1, -(ly / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    hits.length = 0;
    raycaster.intersectObjects(scene.children, true, hits);

    for (let i = 0; i < hits.length; i += 1) {
      const object = hits[i]!.object;
      if (!isInteractive(object)) continue;
      hits.length = 0;
      const entityId = findEntityId(object);
      return entityId !== undefined ? { hit: true, entityId } : { hit: true };
    }
    hits.length = 0;
    return miss;
  };
}

function isInteractive(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current.userData?.overlayInteractive === false) return false;
    current = current.parent;
  }
  return true;
}

function findEntityId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData?.entityId;
    if (typeof id === "string" && id.length > 0) return id;
    current = current.parent;
  }
  return object.name.length > 0 ? object.name : undefined;
}
