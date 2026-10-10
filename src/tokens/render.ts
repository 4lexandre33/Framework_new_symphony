import * as THREE from "three";
import { defineCapability } from "@core";
import type {
  CameraMode,
  Vector3D,
  ViewportDimensions,
  AmbientLightConfig,
  DirectionalLightConfig,
  PerspectiveCameraOptions,
  OrthographicCameraOptions,
  RenderCameraSettings,
  ViewportOptions,
  SceneLightConfig,
  RemoveMeshOptions,
} from "../contracts/render/types";

/**
 * Desenho customizado do frame (ex.: pós-processamento do `game.vfx`).
 * Quando instalado via `setFrameRenderer`, a engine chama `render` NO LUGAR
 * de `renderer.render(scene, camera)`. Implementações não devem alocar por frame.
 */
export interface RenderFrameRenderer {
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    deltaSeconds: number,
  ): void;
  /** Chamado ao instalar e a cada resize, com o tamanho LÓGICO da área desenhada (CSS px). */
  setSize?(width: number, height: number, pixelRatio: number): void;
}

export interface Render3DApi {
  /**
   * Desenha a cena. A engine chama isto sozinha uma vez por `game.loop.render`,
   * DEPOIS dos handlers síncronos de `game.loop.render` (câmera e jogo), então
   * transforms alterados nesses handlers aparecem no mesmo frame (G41).
   *
   * `alphaInterpolation` interpola os objetos marcados com `setInterpolated`
   * entre o estado do tick anterior e o atual (G40); os transforms
   * autoritativos são restaurados logo após o desenho. `deltaSeconds` é
   * repassado ao `RenderFrameRenderer` instalado.
   */
  render(alphaInterpolation: number, deltaSeconds: number): void;

  /**
   * Define o tamanho lógico do viewport (CSS px). Com `autoResize: "window"`
   * (padrão) o próximo resize da janela sobrescreve este valor; use
   * `setViewportOptions({ autoResize: "none" })` para um tamanho fixo.
   */
  resize(width: number, height: number, pixelRatio?: number): void;

  /**
   * Retorna o elemento HTMLCanvasElement do WebGLRenderer.
   */
  getCanvas(): HTMLCanvasElement;

  /**
   * Retorna a instância nativa do THREE.WebGLRenderer.
   */
  getRenderer(): THREE.WebGLRenderer;

  /**
   * Retorna a câmera ativa no momento (Perspective ou Orthographic).
   * Com `game.camera` ativo e uma câmera virtual registrada, posição/rotação
   * (e fov) são escritas por ele a cada frame.
   */
  getActiveCamera(): THREE.Camera;

  /**
   * Retorna a cena 3D principal (THREE.Scene).
   */
  getScene(): THREE.Scene;

  /**
   * Retorna as dimensões atuais do Viewport (objeto INTERNO reutilizado; copie os números).
   */
  getViewportDimensions(): ViewportDimensions;

  /**
   * Modifica o modo da câmera (Perspective, Orthographic, Follow).
   */
  setCameraMode(mode: CameraMode, target?: Vector3D): void;

  /**
   * Atualiza a posição do alvo da câmera de acompanhamento (Follow Camera).
   */
  updateCameraTarget(target: Vector3D, offset?: Vector3D): void;

  /**
   * Configura a luz ambiente da cena.
   */
  setAmbientLight(config: AmbientLightConfig): void;

  /**
   * Configura a luz direcional da engine. Campos opcionais (`target`,
   * `shadowAreaSize`, `shadowMapSize`, `shadowNear/Far`, `shadowBias`,
   * `shadowNormalBias`) controlam alvo e sombra (G22).
   */
  setDirectionalLight(config: DirectionalLightConfig): void;

  /**
   * Move a luz direcional da engine e seu alvo juntos para `center`,
   * preservando a direção (posição − alvo). Chame com o foco da câmera
   * para manter sombras em mundos grandes (G22).
   */
  setShadowFocus(center: Vector3D): void;

  /**
   * Adiciona (ou substitui, mesmo id) uma luz extra gerenciada pela engine.
   */
  addLight(lightId: string, config: SceneLightConfig): void;

  /** Remove uma luz criada por `addLight` (libera shadow map). */
  removeLight(lightId: string): boolean;

  /**
   * Adiciona uma malha/objeto 3D no Grafo de Cena com uma chave única.
   */
  addMeshToScene(key: string, object: THREE.Object3D): void;

  /**
   * Remove uma malha/objeto 3D do Grafo de Cena pelo seu identificador.
   *
   * Por padrão libera geometria/material/texturas de `Mesh`, `InstancedMesh`,
   * `Points`, `Line` e `Sprite` do objeto (G42), EXCETO:
   * - recursos ainda usados por outro objeto registrado (contagem de
   *   referências feita no `addMeshToScene`; recursos trocados DEPOIS do
   *   registro não entram na contagem);
   * - recursos (ou nós) com `userData.renderRetain === true`;
   * - a geometria padrão compartilhada de `THREE.Sprite`;
   * - tudo, se `options.disposeResources === false` (use para cache de assets).
   * Custo O(tamanho do objeto removido).
   */
  removeMeshFromScene(key: string, options?: RemoveMeshOptions): void;

  /** Objeto registrado com a chave, ou null. */
  getMeshFromScene(key: string): THREE.Object3D | null;

  /**
   * Liga/desliga a interpolação de transform do objeto registrado `key` (G40).
   * O estado anterior é capturado no início de cada `game.loop.tick`; mova o
   * objeto no tick. Retorna false se a chave não existe.
   */
  setInterpolated(key: string, enabled: boolean): boolean;

  /**
   * Descarta o estado anterior do objeto interpolado (use após teleporte
   * para não "deslizar" do ponto antigo).
   */
  snapInterpolation(key: string): void;

  /**
   * Captura o estado anterior de todos os objetos interpolados. A engine
   * chama isto no início de cada `game.loop.tick`; jogos não chamam.
   */
  captureInterpolationState(): void;

  /**
   * Configura a câmera de perspectiva (fov/near/far/posição/alvo). Os valores
   * persistem entre resizes (G43). Lança RangeError para far <= near ou fov fora de (0,180).
   */
  configurePerspectiveCamera(options: Partial<PerspectiveCameraOptions>): void;

  /**
   * Configura a câmera ortográfica; `size` é a meia-altura visível em
   * unidades de mundo e persiste entre resizes (G43).
   */
  configureOrthographicCamera(options: Partial<OrthographicCameraOptions>): void;

  /** Leitura dos parâmetros atuais das câmeras (objeto novo). */
  getCameraSettings(): RenderCameraSettings;

  /**
   * Política de tamanho do viewport: auto-resize (janela/elemento pai/nenhum),
   * limite de pixelRatio e sub-retângulo de desenho (G43). Dispara
   * `game.render.resize` quando as dimensões mudam.
   */
  setViewportOptions(options: ViewportOptions): void;

  /**
   * Instala (ou remove com null) um desenhista de frame — usado pelo
   * pós-processamento do `game.vfx`. Só um por vez; o último vence.
   */
  setFrameRenderer(frameRenderer: RenderFrameRenderer | null): void;

  /** true entre `webglcontextlost` e `webglcontextrestored` (ver eventos `game.render.context-*`). */
  isContextLost(): boolean;

  /**
   * Reservado ao plugin `game.render` (shutdown do kernel).
   * Pelo token é NO-OP com aviso (G44): um jogo não pode destruir o renderer
   * compartilhado. Libere só os SEUS objetos com `removeMeshFromScene`.
   */
  dispose(): void;
}

export const RenderToken = defineCapability<Render3DApi>("game.render", "1.0.0");
