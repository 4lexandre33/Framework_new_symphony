import { defineCapability } from "@core";
import type { InputDeviceType, Vector2D, InputBindingMap } from "../contracts/input/types";

export interface InputApi {
  readonly activeDevice: InputDeviceType;
  readonly isPointerLocked: boolean;

  /**
   * Atualiza o estado interno do input manager (deve ser chamado 1x por frame no Game Loop).
   */
  update(): void;

  /**
   * Retorna verdadeiro se a ação lógica foi pressionada exatamente no frame atual.
   */
  isActionPressed(action: string): boolean;

  /**
   * Retorna verdadeiro se a ação lógica continua mantida pressionada.
   */
  isActionHeld(action: string): boolean;

  /**
   * Retorna verdadeiro se a ação lógica foi liberada no frame atual.
   */
  isActionReleased(action: string): boolean;

  /**
   * Retorna o valor de um eixo analógico normalizado entre -1.0 e +1.0.
   */
  getAxis(axisName: string): number;

  /**
   * Retorna a variação vetorial do mouse no frame (Delta X, Delta Y) para rotação de câmera 3D.
   */
  getMouseDelta(): Readonly<Vector2D>;

  /**
   * Define o mapa de vinculação de teclas/botões para ações lógicas.
   */
  setBindingMap(map: InputBindingMap): void;

  /**
   * Solicita a trava do ponteiro do mouse na janela do Tauri para jogos 3D.
   */
  requestPointerLock(element?: HTMLElement): Promise<boolean>;

  /**
   * Libera a trava do ponteiro do mouse.
   */
  exitPointerLock(): void;
}

export const InputToken = defineCapability<InputApi>("game.input", "1.0.0");