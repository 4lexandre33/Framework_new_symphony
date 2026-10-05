import type {
  Vector2D,
} from "../../../contracts/input/types";

function finiteOrZero(
  value: number,
): number {
  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

export class KeyboardMouseDriver {
  private readonly keysDown =
    new Set<string>();

  private readonly keysPressedPending =
    new Set<string>();

  private readonly keysReleasedPending =
    new Set<string>();

  private readonly keysPressedFrame =
    new Set<string>();

  private readonly keysReleasedFrame =
    new Set<string>();

  private readonly mouseButtonsDown =
    new Set<number>();

  private readonly mouseButtonsPressedPending =
    new Set<number>();

  private readonly mouseButtonsReleasedPending =
    new Set<number>();

  private readonly mouseButtonsPressedFrame =
    new Set<number>();

  private readonly mouseButtonsReleasedFrame =
    new Set<number>();

  private readonly mouseDeltaPending:
    Vector2D = {
      x:
        0,
      y:
        0,
    };

  private readonly mouseDeltaFrame:
    Vector2D = {
      x:
        0,
      y:
        0,
    };

  private activityThisFrame =
    false;

  private isLocked =
    false;

  private isBound =
    false;

  private disposed =
    false;

  private targetElement:
    HTMLElement |
    null = null;

  public constructor() {
    this.handleKeyDown =
      this.handleKeyDown.bind(
        this,
      );

    this.handleKeyUp =
      this.handleKeyUp.bind(
        this,
      );

    this.handleMouseMove =
      this.handleMouseMove.bind(
        this,
      );

    this.handleMouseDown =
      this.handleMouseDown.bind(
        this,
      );

    this.handleMouseUp =
      this.handleMouseUp.bind(
        this,
      );

    this.handlePointerLockChange =
      this.handlePointerLockChange.bind(
        this,
      );

    this.handleContextMenu =
      this.handleContextMenu.bind(
        this,
      );

    this.handleWindowBlur =
      this.handleWindowBlur.bind(
        this,
      );

    this.handleVisibilityChange =
      this.handleVisibilityChange.bind(
        this,
      );
  }

  public attach(
    element:
      HTMLElement =
        document.body,
  ): void {
    if (
      this.disposed ||
      this.isBound
    ) {
      return;
    }

    this.targetElement =
      element;

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

    document.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );

    this.handlePointerLockChange();

    this.isBound =
      true;
  }

  public detach(): void {
    if (
      !this.isBound
    ) {
      return;
    }

    if (
      this.isPointerLocked
    ) {
      this.exitPointerLock();
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

    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );

    this.clearAllState();

    this.targetElement =
      null;

    this.isBound =
      false;
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.detach();

    this.disposed =
      true;
  }

  public update(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.keysPressedFrame.clear();
    this.keysReleasedFrame.clear();

    this.mouseButtonsPressedFrame.clear();
    this.mouseButtonsReleasedFrame.clear();

    for (
      const code of
      this.keysPressedPending
    ) {
      this.keysPressedFrame.add(
        code,
      );
    }

    for (
      const code of
      this.keysReleasedPending
    ) {
      this.keysReleasedFrame.add(
        code,
      );
    }

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

    this.mouseDeltaFrame.x =
      this.mouseDeltaPending.x;

    this.mouseDeltaFrame.y =
      this.mouseDeltaPending.y;

    this.activityThisFrame =
      this.keysDown.size >
        0 ||
      this.keysPressedFrame.size >
        0 ||
      this.keysReleasedFrame.size >
        0 ||
      this.mouseButtonsDown.size >
        0 ||
      this.mouseButtonsPressedFrame.size >
        0 ||
      this.mouseButtonsReleasedFrame.size >
        0 ||
      this.mouseDeltaFrame.x !==
        0 ||
      this.mouseDeltaFrame.y !==
        0;

    this.keysPressedPending.clear();
    this.keysReleasedPending.clear();

    this.mouseButtonsPressedPending.clear();
    this.mouseButtonsReleasedPending.clear();

    this.mouseDeltaPending.x =
      0;

    this.mouseDeltaPending.y =
      0;
  }

  public isKeyDown(
    code: string,
  ): boolean {
    return this.keysDown.has(
      code,
    );
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

  public getMouseDelta():
    Readonly<Vector2D> {
    return this.mouseDeltaFrame;
  }

  public get hasActivityThisFrame():
    boolean {
    return this.activityThisFrame;
  }

  public get isPointerLocked():
    boolean {
    return this.isLocked;
  }

  public async requestPointerLock(
    element?:
      HTMLElement,
  ): Promise<boolean> {
    if (
      this.disposed
    ) {
      return false;
    }

    const target =
      element ??
      this.targetElement ??
      document.body;

    const request =
      target.requestPointerLock;

    if (
      typeof request !==
      "function"
    ) {
      return false;
    }

    try {
      await request.call(
        target,
      );

      return true;
    } catch (
      error:
        unknown
    ) {
      console.warn(
        "[KeyboardMouseDriver] Pointer Lock recusado:",
        error,
      );

      return false;
    }
  }

  public exitPointerLock(): void {
    const exit =
      document.exitPointerLock;

    const lockedElement =
      document.pointerLockElement ??
      null;

    if (
      typeof exit ===
        "function" &&
      lockedElement !==
        null
    ) {
      exit.call(
        document,
      );
    }
  }

  private handleKeyDown(
    event:
      KeyboardEvent,
  ): void {
    if (
      event.repeat
    ) {
      return;
    }

    const code =
      event.code;

    if (
      code.length ===
        0 ||
      this.keysDown.has(
        code,
      )
    ) {
      return;
    }

    this.keysDown.add(
      code,
    );

    this.keysPressedPending.add(
      code,
    );
  }

  private handleKeyUp(
    event:
      KeyboardEvent,
  ): void {
    const code =
      event.code;

    const wasDown =
      this.keysDown.delete(
        code,
      );

    if (
      wasDown
    ) {
      this.keysReleasedPending.add(
        code,
      );
    }
  }

  private handleMouseMove(
    event:
      MouseEvent,
  ): void {
    this.mouseDeltaPending.x +=
      finiteOrZero(
        event.movementX,
      );

    this.mouseDeltaPending.y +=
      finiteOrZero(
        event.movementY,
      );
  }

  private handleMouseDown(
    event:
      MouseEvent,
  ): void {
    const button =
      event.button;

    if (
      !Number.isInteger(
        button,
      ) ||
      button <
        0 ||
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
    event:
      MouseEvent,
  ): void {
    const button =
      event.button;

    const wasDown =
      this.mouseButtonsDown.delete(
        button,
      );

    if (
      wasDown
    ) {
      this.mouseButtonsReleasedPending.add(
        button,
      );
    }
  }

  private handleContextMenu(
    event:
      MouseEvent,
  ): void {
    if (
      this.isLocked
    ) {
      event.preventDefault();
    }
  }

  private handlePointerLockChange(): void {
    const lockedElement =
      document.pointerLockElement ??
      null;

    this.isLocked =
      lockedElement !==
      null;
  }

  private handleWindowBlur(): void {
    this.releaseAllContinuousState();
  }

  private handleVisibilityChange(): void {
    if (
      document.visibilityState ===
      "hidden"
    ) {
      this.releaseAllContinuousState();
    }
  }

  private releaseAllContinuousState(): void {
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

    this.mouseDeltaPending.x =
      0;

    this.mouseDeltaPending.y =
      0;
  }

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

    this.mouseDeltaPending.x =
      0;

    this.mouseDeltaPending.y =
      0;

    this.mouseDeltaFrame.x =
      0;

    this.mouseDeltaFrame.y =
      0;

    this.activityThisFrame =
      false;

    this.isLocked =
      false;
  }
}
