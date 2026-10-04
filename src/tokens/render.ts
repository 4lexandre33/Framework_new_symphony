import * as THREE from "three";
import { defineCapability } from "@core";
import type {
  CameraMode,
  Vector3D,
  ViewportDimensions,
  AmbientLightConfig,
  DirectionalLightConfig,
} from "../contracts/render/types";

export interface Render3DApi {
  /**
   * Renderiza a cena WebGL com interpolação alpha do GameLoop.
   */
  render(alphaInterpolation: number, deltaSeconds: number): void;

  /**
   * Atualiza as dimensões do viewport do renderer e das câmeras ativas.
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
   */
  getActiveCamera(): THREE.Camera;

  /**
   * Retorna a cena 3D principal (THREE.Scene).
   */
  getScene(): THREE.Scene;

  /**
   * Retorna as dimensões atuais do Viewport.
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
   * Configura a luz direcional com suporte a sombras.
   */
  setDirectionalLight(config: DirectionalLightConfig): void;

  /**
   * Adiciona uma malha/objeto 3D no Grafo de Cena com uma chave única.
   */
  addMeshToScene(key: string, object: THREE.Object3D): void;

  /**
   * Remove uma malha/objeto 3D do Grafo de Cena pelo seu identificador.
   */
  removeMeshFromScene(key: string): void;

  /**
   * Limpa recursos, materiais, contextos WebGL e desvincula manipuladores de eventos DOM.
   */
  dispose(): void;
}

export const RenderToken = defineCapability<Render3DApi>("game.render", "1.0.0");