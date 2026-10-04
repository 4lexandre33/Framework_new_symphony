import type { Vector2D } from "../../../contracts/input/types";

export class KeyboardMouseDriver {
  /*
   * Estado contínuo.
   *
   * Enquanto uma tecla estiver fisicamente pressionada,
   * ela permanece neste Set.
   */
  private readonly keysDown = new Set<string>();

  /*
   * Eventos recebidos pelo DOM desde o último update().
   */
  private readonly keysPressedPending = new Set<string>();
  private readonly keysReleasedPending = new Set<string>();

  /*
   * Snapshot público do frame atual.
   *
   * Gameplay consulta estes Sets.
   */
  private readonly keysPressedFrame = new Set<string>();
  private readonly keysReleasedFrame = new Set<string>();

  /*
   * Mouse contínuo.
   */
  private readonly mouseButtonsDown = new Set<number>();

  /*
   * Mouse pending.
   */
  private readonly mouseButtonsPressedPending = new Set<number>();
  private readonly mouseButtonsReleasedPending = new Set<number>();

  /*
   * Mouse snapshot do frame.
   */
  private readonly mouseButtonsPressedFrame = new Set<number>();
  private readonly mouseButtonsReleasedFrame = new Set<number>();

  /*
   * Delta recebido entre frames.
   */
  private readonly mouseDeltaPending: Vector2D = {
    x: 0,
    y: 0,
  };

  /*
   * Delta congelado para o frame atual.
   *
   * O objeto é reutilizado para não gerar garbage
   * no game loop.
   */
  private readonly mouseDeltaFrame: Vector2D = {
    x: 0,
    y: 0,
  };

  /*
   * Indica atividade de teclado/mouse no snapshot
   * atual.
   *
   * Usado pelo InputManager para alternar
   * activeDevice.
   */
  private activityThisFrame = false;

  private isLocked = false;
  private isBound = false;

  private targetElement: HTMLElement | null = null;

  public constructor() {
    this.handleKeyDown =
      this.handleKeyDown.bind(this);

    this.handleKeyUp =
      this.handleKeyUp.bind(this);

    this.handleMouseMove =
      this.handleMouseMove.bind(this);

    this.handleMouseDown =
      this.handleMouseDown.bind(this);

    this.handleMouseUp =
      this.handleMouseUp.bind(this);

    this.handlePointerLockChange =
      this.handlePointerLockChange.bind(this);

    this.handleContextMenu =
      this.handleContextMenu.bind(this);

    this.handleWindowBlur =
      this.handleWindowBlur.bind(this);
  }

  /* ==========================================================================
   * LIFECYCLE
   * ======================================================================== */

  public attach(
    element: HTMLElement = document.body,
  ): void {
    if (this.isBound) {
      return;
    }

    this.targetElement = element;

    window.addEventListener(
      "keydown",
      this.handleKeyDown,
    );

    window.addEventListener(
      "keyup",
      this.handleKeyUp,
    );

    window.addEventListener(
      "mousemove",
      this.handleMouseMove,
    );

    window.addEventListener(
      "mousedown",
      this.handleMouseDown,
    );

    window.addEventListener(
      "mouseup",
      this.handleMouseUp,
    );

    window.addEventListener(
      "contextmenu",
      this.handleContextMenu,
    );

    window.addEventListener(
      "blur",
      this.handleWindowBlur,
    );

    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );

    this.isBound = true;
  }

  public detach(): void {
    if (!this.isBound) {
      return;
    }

    window.removeEventListener(
      "keydown",
      this.handleKeyDown,
    );

    window.removeEventListener(
      "keyup",
      this.handleKeyUp,
    );

    window.removeEventListener(
      "mousemove",
      this.handleMouseMove,
    );

    window.removeEventListener(
      "mousedown",
      this.handleMouseDown,
    );

    window.removeEventListener(
      "mouseup",
      this.handleMouseUp,
    );

    window.removeEventListener(
      "contextmenu",
      this.handleContextMenu,
    );

    window.removeEventListener(
      "blur",
      this.handleWindowBlur,
    );

    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );

    this.clearAllState();

    this.targetElement = null;
    this.isBound = false;
  }

  /* ==========================================================================
   * FRAME UPDATE
   * ======================================================================== */

  /**
   * Cria o snapshot do input para o frame atual.
   *
   * Ordem:
   *
   * pending DOM
   *      ↓
   * frame snapshot
   *      ↓
   * pending.clear()
   *
   * Dessa forma pressed/released permanecem disponíveis
   * até o próximo update().
   */
  public update(): void {
    /*
     * Limpa apenas o snapshot anterior.
     */
    this.keysPressedFrame.clear();
    this.keysReleasedFrame.clear();

    this.mouseButtonsPressedFrame.clear();
    this.mouseButtonsReleasedFrame.clear();

    /*
     * Transfere teclado pending → frame.
     */
    for (
      const code of
      this.keysPressedPending
    ) {
      this.keysPressedFrame.add(code);
    }

    for (
      const code of
      this.keysReleasedPending
    ) {
      this.keysReleasedFrame.add(code);
    }

    /*
     * Transfere mouse pending → frame.
     */
    for (
      const button of
      this.mouseButtonsPressedPending
    ) {
      this.mouseButtonsPressedFrame.add(
        button,
      );
    }

    for (
      const button of
      this.mouseButtonsReleasedPending
    ) {
      this.mouseButtonsReleasedFrame.add(
        button,
      );
    }

    /*
     * Congela o delta acumulado para este frame.
     */
    this.mouseDeltaFrame.x =
      this.mouseDeltaPending.x;

    this.mouseDeltaFrame.y =
      this.mouseDeltaPending.y;

    /*
     * Detecta atividade antes de limpar pending.
     */
    this.activityThisFrame =
      this.keysPressedFrame.size > 0 ||
      this.keysReleasedFrame.size > 0 ||
      this.mouseButtonsPressedFrame.size > 0 ||
      this.mouseButtonsReleasedFrame.size > 0 ||
      this.mouseDeltaFrame.x !== 0 ||
      this.mouseDeltaFrame.y !== 0;

    /*
     * Agora sim podemos liberar o pending.
     */
    this.keysPressedPending.clear();
    this.keysReleasedPending.clear();

    this.mouseButtonsPressedPending.clear();
    this.mouseButtonsReleasedPending.clear();

    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;
  }

  /* ==========================================================================
   * KEYBOARD QUERIES
   * ======================================================================== */

  public isKeyDown(
    code: string,
  ): boolean {
    return this.keysDown.has(code);
  }

  public isKeyPressed(
    code: string,
  ): boolean {
    return this.keysPressedFrame.has(
      code,
    );
  }

  public isKeyReleased(
    code: string,
  ): boolean {
    return this.keysReleasedFrame.has(
      code,
    );
  }

  /* ==========================================================================
   * MOUSE QUERIES
   * ======================================================================== */

  public isMouseButtonDown(
    button: number,
  ): boolean {
    return this.mouseButtonsDown.has(
      button,
    );
  }

  public isMouseButtonPressed(
    button: number,
  ): boolean {
    return this.mouseButtonsPressedFrame.has(
      button,
    );
  }

  public isMouseButtonReleased(
    button: number,
  ): boolean {
    return this.mouseButtonsReleasedFrame.has(
      button,
    );
  }

  public getMouseDelta(): Readonly<Vector2D> {
    return this.mouseDeltaFrame;
  }

  public get hasActivityThisFrame(): boolean {
    return this.activityThisFrame;
  }

  /* ==========================================================================
   * POINTER LOCK
   * ======================================================================== */

  public get isPointerLocked(): boolean {
    return this.isLocked;
  }

  public async requestPointerLock(
    element?: HTMLElement,
  ): Promise<boolean> {
    const target =
      element ??
      this.targetElement ??
      document.body;

    try {
      await target.requestPointerLock();

      return true;
    } catch (error: unknown) {
      console.warn(
        "[KeyboardMouseDriver] Pointer Lock recusado:",
        error,
      );

      return false;
    }
  }

  public exitPointerLock(): void {
    if (
      document.pointerLockElement !== null
    ) {
      document.exitPointerLock();
    }
  }

  /* ==========================================================================
   * DOM EVENTS
   * ======================================================================== */

  private handleKeyDown(
    event: KeyboardEvent,
  ): void {
    /*
     * Não gera múltiplos "pressed" enquanto
     * a tecla estiver sendo mantida.
     */
    if (event.repeat) {
      return;
    }

    const code =
      event.code;

    if (
      this.keysDown.has(code)
    ) {
      return;
    }

    this.keysDown.add(code);

    this.keysPressedPending.add(
      code,
    );
  }

  private handleKeyUp(
    event: KeyboardEvent,
  ): void {
    const code =
      event.code;

    const wasDown =
      this.keysDown.delete(code);

    /*
     * Só gera released se realmente conhecíamos
     * a tecla como pressionada.
     */
    if (wasDown) {
      this.keysReleasedPending.add(
        code,
      );
    }
  }

  private handleMouseMove(
    event: MouseEvent,
  ): void {
    this.mouseDeltaPending.x +=
      event.movementX;

    this.mouseDeltaPending.y +=
      event.movementY;
  }

  private handleMouseDown(
    event: MouseEvent,
  ): void {
    const button =
      event.button;

    if (
      this.mouseButtonsDown.has(
        button,
      )
    ) {
      return;
    }

    this.mouseButtonsDown.add(
      button,
    );

    this.mouseButtonsPressedPending.add(
      button,
    );
  }

  private handleMouseUp(
    event: MouseEvent,
  ): void {
    const button =
      event.button;

    const wasDown =
      this.mouseButtonsDown.delete(
        button,
      );

    if (wasDown) {
      this.mouseButtonsReleasedPending.add(
        button,
      );
    }
  }

  private handleContextMenu(
    event: MouseEvent,
  ): void {
    event.preventDefault();
  }

  private handlePointerLockChange(): void {
    this.isLocked =
      document.pointerLockElement !== null;
  }

  /**
   * Quando a janela perde foco não podemos manter
   * teclas "presas" no estado Down.
   *
   * Isso é especialmente importante no Tauri:
   * Alt+Tab pode fazer o keyup acontecer fora da WebView.
   */
  private handleWindowBlur(): void {
    for (
      const code of
      this.keysDown
    ) {
      this.keysReleasedPending.add(
        code,
      );
    }

    for (
      const button of
      this.mouseButtonsDown
    ) {
      this.mouseButtonsReleasedPending.add(
        button,
      );
    }

    this.keysDown.clear();

    this.mouseButtonsDown.clear();

    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;
  }

  /* ==========================================================================
   * STATE RESET
   * ======================================================================== */

  private clearAllState(): void {
    this.keysDown.clear();

    this.keysPressedPending.clear();
    this.keysReleasedPending.clear();

    this.keysPressedFrame.clear();
    this.keysReleasedFrame.clear();

    this.mouseButtonsDown.clear();

    this.mouseButtonsPressedPending.clear();
    this.mouseButtonsReleasedPending.clear();

    this.mouseButtonsPressedFrame.clear();
    this.mouseButtonsReleasedFrame.clear();

    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;

    this.mouseDeltaFrame.x = 0;
    this.mouseDeltaFrame.y = 0;

    this.activityThisFrame = false;
    this.isLocked = false;
  }
}