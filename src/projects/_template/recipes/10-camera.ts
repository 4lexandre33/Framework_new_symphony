// Câmera virtual: registre, ative com blend, siga um alvo.
import type { CameraApi } from "../../../tokens/camera";

export function setupCamera(camera: CameraApi): () => void {
  camera.registerVirtualCamera({
    id: "main",
    priority: 1,
    fov: 60,
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  });
  camera.setActiveCamera("main", 0.5);
  return (): void => {
    camera.unregisterVirtualCamera("main");
  };
}
export function follow(camera: CameraApi, x: number, y: number, z: number): void {
  camera.setFollowTarget("main", { x, y, z });
}
