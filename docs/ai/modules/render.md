# render — Render Runtime
capability: game.render@1.0.0 | category: runtime | engine plugin id: game.render
use (from src/projects/<jogo>/**):
  import { RenderToken } from "../../tokens/render";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/render.ts
```ts
interface RenderFrameRenderer { // Desenho customizado do frame (ex.: pós-processamento do `game.vfx`).
  render( renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, deltaSeconds: number, ): void;
  setSize?(width: number, height: number, pixelRatio: number): void; // Chamado ao instalar e a cada resize, com o tamanho LÓGICO da área desenhada (CSS px).
}
interface Render3DApi {
  render(alphaInterpolation: number, deltaSeconds: number): void; // Desenha a cena.
  resize(width: number, height: number, pixelRatio?: number): void; // Define o tamanho lógico do viewport (CSS px).
  getCanvas(): HTMLCanvasElement; // Retorna o elemento HTMLCanvasElement do WebGLRenderer.
  getRenderer(): THREE.WebGLRenderer; // Retorna a instância nativa do THREE.WebGLRenderer.
  getActiveCamera(): THREE.Camera; // Retorna a câmera ativa no momento (Perspective ou Orthographic).
  getScene(): THREE.Scene; // Retorna a cena 3D principal (THREE.Scene).
  getViewportDimensions(): ViewportDimensions; // Retorna as dimensões atuais do Viewport (objeto INTERNO reutilizado; copie os números com `copyViewportDimens…
  setCameraMode(mode: CameraMode, target?: Vector3D): void; // Modifica o modo da câmera (Perspective, Orthographic, Follow).
  updateCameraTarget(target: Vector3D, offset?: Vector3D): void; // Atualiza a posição do alvo da câmera de acompanhamento (Follow Camera).
  setAmbientLight(config: AmbientLightConfig): void; // Configura a luz ambiente da cena.
  setDirectionalLight(config: DirectionalLightConfig): void; // Configura a luz direcional da engine.
  setShadowFocus(center: Vector3D): void; // Move a luz direcional da engine e seu alvo juntos para `center`, preservando a direção (posição − alvo).
  addLight(lightId: string, config: SceneLightConfig): void; // Adiciona (ou substitui, mesmo id) uma luz extra gerenciada pela engine.
  removeLight(lightId: string): boolean; // Remove uma luz criada por `addLight` (libera shadow map).
  addMeshToScene(key: string, object: THREE.Object3D): void; // Adiciona uma malha/objeto 3D no Grafo de Cena com uma chave única.
  removeMeshFromScene(key: string, options?: RemoveMeshOptions): void; // Remove uma malha/objeto 3D do Grafo de Cena pelo seu identificador.
  getMeshFromScene(key: string): THREE.Object3D | null; // Objeto registrado com a chave, ou null.
  setInterpolated(key: string, enabled: boolean): boolean; // Liga/desliga a interpolação de transform do objeto registrado `key` (G40).
  snapInterpolation(key: string): void; // Descarta o estado anterior do objeto interpolado (use após teleporte para não "deslizar" do ponto antigo).
  captureInterpolationState(): void; // Captura o estado anterior de todos os objetos interpolados.
  configurePerspectiveCamera(options: Partial<PerspectiveCameraOptions>): void; // Configura a câmera de perspectiva (fov/near/far/posição/alvo).
  configureOrthographicCamera(options: Partial<OrthographicCameraOptions>): void; // Configura a câmera ortográfica; `size` é a meia-altura visível em unidades de mundo e persiste entre resizes …
  getCameraSettings(): RenderCameraSettings; // Leitura dos parâmetros atuais das câmeras (objeto novo).
  setViewportOptions(options: ViewportOptions): void; // Política de tamanho do viewport: auto-resize (janela/elemento pai/nenhum), limite de pixelRatio e sub-retângu…
  setFrameRenderer(frameRenderer: RenderFrameRenderer | null): void; // Instala (ou remove com null) um desenhista de frame — usado pelo pós-processamento do `game.vfx`.
  isContextLost(): boolean; // true entre `webglcontextlost` e `webglcontextrestored` (ver eventos `game.render.context-*`).
  dispose(): void; // Reservado ao plugin `game.render` (shutdown do kernel).
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
function copyViewportDimensions(src: Readonly<ViewportDimensions>, out: ViewportDimensions = { width: 0, height: 0, aspectRatio: 1, pixelRatio: 1 }): ViewportDimensions; // G31: `getViewportDimensions()` devolve o objeto INTERNO reutilizado.
interface AmbientLightConfig {
  color: number | string;
  intensity: number;
}
interface DirectionalLightConfig extends DirectionalLightShadowOptions { // Luz direcional da engine.
  color: number | string;
  intensity: number;
  position: Vector3D;
  castShadow: boolean;
}
interface RenderFramePayload {
  readonly alphaInterpolation: number;
  readonly deltaSeconds: number;
  readonly realDeltaSeconds?: number; // Presentes quando o frame vem do `game.loop.render` (repassados como recebidos).
  readonly isPaused?: boolean;
}
const RENDER_SHARED_RESOURCE: unique symbol; // G81: marca de recurso de GPU COMPARTILHADO e com dono (ex.: cache de assets).
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
interface DirectionalLightShadowOptions { // Campos opcionais extras da luz direcional da engine (G22).
  readonly target?: Vector3D; // Ponto para onde a luz aponta.
  readonly shadowAreaSize?: number; // Meia-largura (em unidades de mundo) da caixa ortográfica de sombra.
  readonly shadowMapSize?: number; // Resolução do shadow map (potência de 2 recomendada).
  readonly shadowNear?: number;
  readonly shadowFar?: number; // Padrão 50.
  readonly shadowBias?: number;
  readonly shadowNormalBias?: number;
}
export type SceneLightType = | "directional" | "point" | "spot" | "hemisphere" | "ambient";
interface SceneLightConfig { // Luz adicional gerenciada pelo render (`addLight`).
  readonly type: SceneLightType;
  readonly color?: number | string;
  readonly intensity?: number;
  readonly position?: Vector3D;
  readonly target?: Vector3D; // directional/spot: alvo da luz.
  readonly distance?: number; // point/spot: alcance (0 = infinito).
  readonly decay?: number; // point/spot: decaimento físico (padrão 2).
  readonly angle?: number; // spot: ângulo do cone em radianos.
  readonly penumbra?: number; // spot: suavidade da borda 0..1.
  readonly groundColor?: number | string; // hemisphere: cor do chão.
  readonly castShadow?: boolean;
  readonly shadowAreaSize?: number; // directional: meia-largura da caixa de sombra.
  readonly shadowMapSize?: number;
}
interface ViewportRect { // Retângulo normalizado (0..1, origem no canto inferior esquerdo) dentro do canvas.
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type ViewportAutoResizeMode = "window" | "parent" | "none"; // Política de dimensionamento do viewport (G43).
interface ViewportOptions {
  readonly autoResize?: ViewportAutoResizeMode;
  readonly maxPixelRatio?: number; // Limite do devicePixelRatio aplicado ao renderer.
  readonly rect?: ViewportRect | null; // Sub-retângulo do canvas onde a cena é desenhada; null = canvas inteiro.
}
interface RenderCameraSettings { // Leitura (objeto NOVO a cada chamada) dos parâmetros das câmeras do render.
  readonly mode: CameraMode;
  readonly perspective: { readonly fov: number; readonly near: number; readonly far: number; readonly aspect: number; };
  readonly orthographic: { /** Meia-altura visível (unidades de mundo). */ readonly size: number; readonly near: number; readonly far: number; readonly zoom: number; };
}
interface RemoveMeshOptions {
  readonly disposeResources?: boolean; // false = só tira o objeto da cena, sem liberar geometria/material/textura (use para objetos cujo recurso é cac…
}
interface RenderContextPayload {
  readonly contextLost: boolean; // true após `webglcontextlost`; false após `webglcontextrestored`.
}
event RenderContextLostEvent = "game.render.context-lost" payload RenderContextPayload // Emitido quando o navegador perde o contexto WebGL (o desenho é suspenso).
event RenderContextRestoredEvent = "game.render.context-restored" payload RenderContextPayload // Emitido quando o contexto WebGL é restaurado (o desenho volta sozinho).
```
## notas verificadas (comportamento)
- O desenho acontece DEPOIS dos handlers síncronos de `game.loop.render`: posicionar malhas no render aparece no mesmo frame.
- Interpolação opcional: mova o objeto no tick e marque `setInterpolated(chave, true)`; a engine desenha entre o tick anterior e o atual e restaura o valor real. Após teleporte: `snapInterpolation(chave)`.
- Conteúdo: Three.js nos adapters do jogo + `addMeshToScene(chaveÚnica, obj)`. `removeMeshFromScene` libera geometria/material/texturas de Mesh/InstancedMesh/Points/Line/Sprite, EXCETO recursos usados por outro objeto registrado, marcados `userData.renderRetain = true` ou `RENDER_SHARED_RESOURCE` (GPU do cache de assets: GLTF/texturas — não precisa de `{ disposeResources: false }` para instâncias de `loadGLTF`), ou com `{ disposeResources: false }`. Para esconder use `visible = false`.
- Câmera: com câmera virtual registrada, `game.camera` escreve posição/rotação/fov a cada frame (enquadre por ela; `setCameraMode`/`updateCameraTarget` só valem sem câmera virtual). near/far/tamanho ortográfico: `configurePerspectiveCamera`/`configureOrthographicCamera` (persistem em resize); leitura em `getCameraSettings()`.
- Viewport: `setViewportOptions({ autoResize, maxPixelRatio, rect })`; `game.render.resize` sai no boot e a cada mudança; `getViewportDimensions()` é objeto reutilizado (`copyViewportDimensions`).
- Luzes: `setAmbientLight`; a direcional da engine aceita `target`/`shadowAreaSize`/`shadowMapSize`; `setShadowFocus(centro)` move luz e alvo juntos (mundos grandes: chame seguindo o foco). Extras: `addLight(id, { type: "point" | "spot" | "hemisphere" | … })` / `removeLight`.
- Muitos objetos (voxel): `THREE.InstancedMesh` ou geometria mesclada; evite milhares de `Mesh`.
- `dispose()` do token é no-op para jogos. Perda de contexto WebGL: eventos `game.render.context-lost/restored` (`isContextLost()`).
