import { defineCapability } from "@core";
import type {
  InputDeviceType,
  Vector2D,
  InputBindingMap,
  InputGamepadInfo,
  InputFilterOptions,
  InputActionEventOptions,
} from "../contracts/input/types";

export interface InputApi {
  readonly activeDevice: InputDeviceType;
  readonly isPointerLocked: boolean;

  /**
   * NÃO chame em jogos: com o plugin `game.input` ativo a engine já avança
   * o frame de input por requestAnimationFrame e esta chamada é ignorada
   * (com aviso único), para não apagar bordas e o delta do mouse.
   * Só avança o frame em um InputManager usado sem o plugin (testes/headless).
   */
  update(): void;

  /**
   * true depois que o primeiro `game.loop.tick` foi observado: as consultas
   * `*InTick`/`getTick*` passam a usar o snapshot do tick fixo. Sem game loop
   * elas devolvem os valores do frame.
   */
  readonly isTickSynchronized: boolean;

  /**
   * Retorna verdadeiro se a ação lógica foi pressionada exatamente no frame atual
   * (frame de input/render). Dentro de `game.loop.tick` use `isActionPressedInTick`.
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
   * Borda de pressão vista UMA vez por tick fixo: verdadeiro no primeiro
   * `game.loop.tick` após a pressão, mesmo que vários frames tenham passado
   * ou vários ticks rodem no mesmo frame. Toques mais curtos que um tick
   * também aparecem. Pressões durante a pausa são descartadas.
   */
  isActionPressedInTick(action: string): boolean;

  /** Borda de soltura vista uma vez por tick fixo (ver `isActionPressedInTick`). */
  isActionReleasedInTick(action: string): boolean;

  /**
   * Valor analógico atual da ação (0..1): gatilhos/meio-eixos do gamepad
   * dão frações; teclas e botões digitais dão 0 ou 1.
   */
  getActionValue(action: string): number;

  /**
   * Retorna o valor de um eixo analógico normalizado entre -1.0 e +1.0.
   */
  getAxis(axisName: string): number;

  /**
   * Retorna a variação vetorial do mouse no frame (Delta X, Delta Y) para rotação de câmera 3D.
   * Leia em `game.loop.render`. No tick use `getTickMouseDelta()`.
   */
  getMouseDelta(): Readonly<Vector2D>;

  /** Delta do mouse acumulado desde o tick anterior (leia em `game.loop.tick`). Objeto reutilizado. */
  getTickMouseDelta(): Readonly<Vector2D>;

  /**
   * Roda do mouse no frame, em pixels (y > 0 = para baixo/afastar). Objeto reutilizado.
   * Também há os códigos de binding `WheelUp`/`WheelDown`/`WheelLeft`/`WheelRight`.
   */
  getWheelDelta(): Readonly<Vector2D>;

  /** Roda acumulada desde o tick anterior (leia em `game.loop.tick`). Objeto reutilizado. */
  getTickWheelDelta(): Readonly<Vector2D>;

  /** Última posição do ponteiro (clientX/clientY). Objeto reutilizado. */
  getPointerPosition(): Readonly<Vector2D>;

  /** Número de toques ativos na tela. */
  getTouchCount(): number;

  /** Posição (clientX/clientY) do i-ésimo toque ativo, ou null. Objeto reutilizado. */
  getTouchPosition(index: number): Readonly<Vector2D> | null;

  /** Gamepads conectados (novo array a cada chamada; não use por frame). */
  getConnectedGamepads(): readonly InputGamepadInfo[];

  /**
   * Eixo do gamepad com zona morta (−1..1). Sem `gamepadIndex`: o de maior
   * magnitude entre os controles. Standard: 0/1 = analógico esquerdo, 2/3 = direito.
   */
  getGamepadAxis(axisIndex: number, gamepadIndex?: number): number;

  /** Valor analógico do botão do gamepad (0..1; gatilhos = 6/7 no mapeamento standard). */
  getGamepadButtonValue(buttonIndex: number, gamepadIndex?: number): number;

  /** Zona morta atual dos eixos do gamepad. */
  readonly gamepadDeadZone: number;

  /** Define a zona morta (0 <= v < 1). Retorna false (sem mudar) se inválida. */
  setGamepadDeadZone(deadZone: number): boolean;

  /** Ajusta os filtros de foco/alvo do DOM (G51). Campos omitidos não mudam. */
  setFilterOptions(options: InputFilterOptions): void;

  /** Ajusta a emissão de `game.input.action` (ex.: `{ emitHeld: false }`). */
  setActionEventOptions(options: InputActionEventOptions): void;

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