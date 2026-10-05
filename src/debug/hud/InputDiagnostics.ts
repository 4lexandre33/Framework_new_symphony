import type {
  InputApi,
} from "../../tokens/input";

export type InputActionState =
  | "-"
  | "PRESSED"
  | "HELD"
  | "RELEASED";

export interface InputDiagnosticsSnapshot {
  activeDevice:
    InputApi["activeDevice"];

  pointerLocked: boolean;

  moveForward: number;
  moveRight: number;

  jumpState:
    InputActionState;

  interactState:
    InputActionState;

  attackState:
    InputActionState;

  mouseDeltaX: number;
  mouseDeltaY: number;
}

export type InputDiagnosticLogger = (
  message: string,
) => void;

export class InputDiagnostics {
  private lastMoveForward = 0;
  private lastMoveRight = 0;

  private readonly snapshot:
    InputDiagnosticsSnapshot = {
      activeDevice:
        "keyboard_mouse",

      pointerLocked:
        false,

      moveForward:
        0,

      moveRight:
        0,

      jumpState:
        "-",

      interactState:
        "-",

      attackState:
        "-",

      mouseDeltaX:
        0,

      mouseDeltaY:
        0,
    };

  public constructor(
    private readonly log:
      InputDiagnosticLogger,
  ) {}

  public reset(): void {
    this.lastMoveForward = 0;
    this.lastMoveRight = 0;

    this.snapshot.activeDevice =
      "keyboard_mouse";

    this.snapshot.pointerLocked =
      false;

    this.snapshot.moveForward =
      0;

    this.snapshot.moveRight =
      0;

    this.snapshot.jumpState =
      "-";

    this.snapshot.interactState =
      "-";

    this.snapshot.attackState =
      "-";

    this.snapshot.mouseDeltaX =
      0;

    this.snapshot.mouseDeltaY =
      0;
  }

  public update(
    input: InputApi,
  ): Readonly<InputDiagnosticsSnapshot> {
    /*
     * Stage 78: o snapshot é atualizado pelo InputFramePump,
     * iniciado pelo plugin game.input em kernel.booted.
     *
     * Diagnostics é consumidor somente-leitura e não pode avançar
     * o frame de input, pois isso apagaria edges PRESSED/RELEASED.
     */

    const moveForward =
      input.getAxis(
        "MoveForward",
      );

    const moveRight =
      input.getAxis(
        "MoveRight",
      );

    const jumpPressed =
      input.isActionPressed(
        "Jump",
      );

    const jumpHeld =
      input.isActionHeld(
        "Jump",
      );

    const jumpReleased =
      input.isActionReleased(
        "Jump",
      );

    const interactPressed =
      input.isActionPressed(
        "Interact",
      );

    const interactHeld =
      input.isActionHeld(
        "Interact",
      );

    const interactReleased =
      input.isActionReleased(
        "Interact",
      );

    const attackPressed =
      input.isActionPressed(
        "Attack",
      );

    const attackHeld =
      input.isActionHeld(
        "Attack",
      );

    const attackReleased =
      input.isActionReleased(
        "Attack",
      );

    const mouseDelta =
      input.getMouseDelta();

    this.logTransitions(
      moveForward,
      moveRight,
      jumpPressed,
      jumpReleased,
      interactPressed,
      interactReleased,
      attackPressed,
      attackReleased,
    );

    this.snapshot.activeDevice =
      input.activeDevice;

    this.snapshot.pointerLocked =
      input.isPointerLocked;

    this.snapshot.moveForward =
      moveForward;

    this.snapshot.moveRight =
      moveRight;

    this.snapshot.jumpState =
      this.resolveActionState(
        jumpPressed,
        jumpHeld,
        jumpReleased,
      );

    this.snapshot.interactState =
      this.resolveActionState(
        interactPressed,
        interactHeld,
        interactReleased,
      );

    this.snapshot.attackState =
      this.resolveActionState(
        attackPressed,
        attackHeld,
        attackReleased,
      );

    this.snapshot.mouseDeltaX =
      mouseDelta.x;

    this.snapshot.mouseDeltaY =
      mouseDelta.y;

    return this.snapshot;
  }

  private resolveActionState(
    pressed: boolean,
    held: boolean,
    released: boolean,
  ): InputActionState {
    if (pressed) {
      return "PRESSED";
    }

    if (held) {
      return "HELD";
    }

    if (released) {
      return "RELEASED";
    }

    return "-";
  }

  private logTransitions(
    moveForward: number,
    moveRight: number,
    jumpPressed: boolean,
    jumpReleased: boolean,
    interactPressed: boolean,
    interactReleased: boolean,
    attackPressed: boolean,
    attackReleased: boolean,
  ): void {
    if (jumpPressed) {
      this.log(
        "⌨️ [Space] Jump PRESSED",
      );
    }

    if (jumpReleased) {
      this.log(
        "⌨️ [Space] Jump RELEASED",
      );
    }

    if (interactPressed) {
      this.log(
        "⌨️ [E] Interact PRESSED",
      );
    }

    if (interactReleased) {
      this.log(
        "⌨️ [E] Interact RELEASED",
      );
    }

    if (attackPressed) {
      this.log(
        "🖱️ Attack PRESSED",
      );
    }

    if (attackReleased) {
      this.log(
        "🖱️ Attack RELEASED",
      );
    }

    if (
      moveForward !==
      this.lastMoveForward
    ) {
      this.log(
        `⌨️ MoveForward: ${moveForward}`,
      );

      this.lastMoveForward =
        moveForward;
    }

    if (
      moveRight !==
      this.lastMoveRight
    ) {
      this.log(
        `⌨️ MoveRight: ${moveRight}`,
      );

      this.lastMoveRight =
        moveRight;
    }
  }
}