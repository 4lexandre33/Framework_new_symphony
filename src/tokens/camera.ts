import { defineCapability } from "@core";
import type {
  VirtualCameraDescriptor,
  SpringArmConfig,
  Vector3Camera,
  CameraTransformSnapshot,
} from "../contracts/camera/types";

/**
 * Câmeras virtuais que dirigem a câmera do `game.render`.
 *
 * Controle do render (G4): enquanto houver ao menos uma câmera virtual
 * registrada e `setEnabled(true)` (padrão), posição/rotação (e fov da
 * perspectiva) da câmera ativa do render são escritas a cada
 * `game.loop.render`. Sem câmera registrada ou com `setEnabled(false)` a
 * câmera do render NÃO é tocada (use `RenderApi.configurePerspectiveCamera`).
 *
 * Tempo: usa o `deltaSeconds` do frame; com o jogo pausado (delta 0) blends,
 * suavização do braço e decaimento do shake congelam.
 */
export interface CameraApi {
  /**
   * Registra (ou substitui, mesmo id) uma câmera. Substituir preserva o
   * trauma global, os alvos definidos por `setFollowTarget`/`setLookAtTarget`
   * e o status de ativa. Pode ativar a câmera conforme `priority` (G46),
   * emitindo `game.camera.state-changed`.
   */
  registerVirtualCamera(descriptor: VirtualCameraDescriptor): void;
  unregisterVirtualCamera(cameraId: string): boolean;
  /**
   * Ativa a câmera. Sem `blendDurationSeconds` usa o
   * `descriptor.blendDurationSeconds` da câmera de destino (padrão 0,5 s).
   */
  setActiveCamera(cameraId: string, blendDurationSeconds?: number): boolean;
  /**
   * Trauma GLOBAL (G48): sobrevive à troca/re-registro de câmeras; o ruído
   * usa o `shakeConfig` da câmera ativa.
   */
  addTrauma(traumaAmount: number): void;
  /**
   * Alvo de seguimento manual (os números são COPIADOS; G48). Tem
   * precedência sobre `followTargetId` até `clearFollowTarget`.
   */
  setFollowTarget(cameraId: string, targetPosition: Vector3Camera): void;
  configureSpringArm(cameraId: string, config: Partial<SpringArmConfig>): void;
  getActiveCameraId(): string | null;
  getCurrentCameraSnapshot(): CameraTransformSnapshot | null;

  /** Remove o alvo manual (volta a usar `followTargetId`, se houver). */
  clearFollowTarget(cameraId: string): boolean;
  /**
   * Ponto para onde a câmera olha (copiado); sobrescreve `rotation`.
   * null remove (volta a `lookAtTargetId`/`rotation`).
   */
  setLookAtTarget(cameraId: string, targetPosition: Vector3Camera | null): boolean;
  /** Muda a prioridade e reavalia qual câmera fica ativa (G46). */
  setCameraPriority(cameraId: string, priority: number): boolean;
  /** Liga/desliga a escrita na câmera do render (G4). */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  /** Trauma global atual (0..maxTrauma). */
  getTrauma(): number;
}

export const CameraToken = defineCapability<CameraApi>("game.camera", "1.0.0");
