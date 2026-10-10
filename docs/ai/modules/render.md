# render — Render Runtime
capability: game.render@1.0.0 | category: runtime | engine plugin id: game.render
use (from src/projects/<jogo>/**):
  import { RenderToken } from "../../tokens/render";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/render.ts
```ts
interface Render3DApi {
  render(alphaInterpolation: number, deltaSeconds: number): void; // Renderiza a cena WebGL com interpolação alpha do GameLoop.
  resize(width: number, height: number, pixelRatio?: number): void; // Atualiza as dimensões do viewport do renderer e das câmeras ativas.
  getCanvas(): HTMLCanvasElement; // Retorna o elemento HTMLCanvasElement do WebGLRenderer.
  getRenderer(): THREE.WebGLRenderer; // Retorna a instância nativa do THREE.WebGLRenderer.
  getActiveCamera(): THREE.Camera; // Retorna a câmera ativa no momento (Perspective ou Orthographic).
  getScene(): THREE.Scene; // Retorna a cena 3D principal (THREE.Scene).
  getViewportDimensions(): ViewportDimensions; // Retorna as dimensões atuais do Viewport.
  setCameraMode(mode: CameraMode, target?: Vector3D): void; // Modifica o modo da câmera (Perspective, Orthographic, Follow).
  updateCameraTarget(target: Vector3D, offset?: Vector3D): void; // Atualiza a posição do alvo da câmera de acompanhamento (Follow Camera).
  setAmbientLight(config: AmbientLightConfig): void; // Configura a luz ambiente da cena.
  setDirectionalLight(config: DirectionalLightConfig): void; // Configura a luz direcional com suporte a sombras.
  addMeshToScene(key: string, object: THREE.Object3D): void; // Adiciona uma malha/objeto 3D no Grafo de Cena com uma chave única.
  removeMeshFromScene(key: string): void; // Remove uma malha/objeto 3D do Grafo de Cena pelo seu identificador.
  dispose(): void; // Limpa recursos, materiais, contextos WebGL e desvincula manipuladores de eventos DOM.
}
capability RenderToken = "game.render"@1.0.0 api Render3DApi
```
## contract src/contracts/render/types.ts
```ts
export type CameraMode = "perspective" | "orthographic" | "follow";
interface Vector3D {
  x: number;
  y: number;
  z: number;
}
interface PerspectiveCameraOptions {
  fov: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}
interface OrthographicCameraOptions {
  size: number;
  near: number;
  far: number;
  position: Vector3D;
  target: Vector3D;
}
interface ViewportDimensions {
  width: number;
  height: number;
  aspectRatio: number;
  pixelRatio: number;
}
interface AmbientLightConfig {
  color: number | string;
  intensity: number;
}
interface DirectionalLightConfig {
  color: number | string;
  intensity: number;
  position: Vector3D;
  castShadow: boolean;
}
interface RenderFramePayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
}
event RenderFrameEvent = "game.render.frame" payload RenderFramePayload
interface ViewportResizePayload {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly pixelRatio: number;
}
event ViewportResizeEvent = "game.render.resize" payload ViewportResizePayload
interface SetCameraModeRequest {
  readonly mode: CameraMode;
  readonly target?: Vector3D;
}
command SetCameraModeCommand = "game.render.set-camera-mode" request SetCameraModeRequest
```
## notas verificadas (comportamento)
- A câmera do render é sobrescrita por `game.camera` a cada frame (ver `modules/camera.md`). Use `getScene()`/`addMeshToScene` para conteúdo e `game.camera` para enquadramento.
- Three.js é permitido nos adapters do jogo: crie geometrias/materiais e adicione com `addMeshToScene(chaveÚnica, obj)`; no dispose `removeMeshFromScene` + `geometry.dispose()`/`material.dispose()`.
- Voxel: prefira `THREE.InstancedMesh` (um por cor/material) ou geometria mesclada; evite milhares de `Mesh` separados.
- A luz direcional da engine é UMA só e seu alvo fica na origem: longe de (0,0,0) a direção muda e a sombra some. Para mundos grandes, desligue a da engine (`setDirectionalLight({...intensity:0, castShadow:false})`) e adicione a SUA `THREE.DirectionalLight` via `addMeshToScene`, movendo luz e `light.target` junto com o foco da câmera (e adicionando o target também).
