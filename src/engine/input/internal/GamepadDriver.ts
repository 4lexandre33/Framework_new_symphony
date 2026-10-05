const DEFAULT_DEADZONE =
  0.15;

const BUTTON_DOWN_THRESHOLD =
  0.5;

const DEVICE_ACTIVITY_AXIS_THRESHOLD =
  0.1;

const NO_GAMEPAD_NAME =
  "Nenhum Gamepad Conectado";

function clampUnit(
  value: number,
): number {
  if (
    value >
    1
  ) {
    return 1;
  }

  if (
    value <
    -1
  ) {
    return -1;
  }

  return value;
}

function sanitizeDeadzone(
  value: number,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0 ||
    value >=
      1
  ) {
    throw new RangeError(
      "deadzone precisa ser finita e estar em 0 <= deadzone < 1.",
    );
  }

  return value;
}

export class GamepadDriver {
  private readonly deadzone:
    number;

  private activeGamepadIndex:
    number |
    null = null;

  private activeGamepadName =
    NO_GAMEPAD_NAME;

  private connected =
    false;

  private isBound =
    false;

  private disposed =
    false;

  private meaningfulInputThisFrame =
    false;

  private buttonsDown =
    new Uint8Array(
      0,
    );

  private buttonsPressedFrame =
    new Uint8Array(
      0,
    );

  private buttonsReleasedFrame =
    new Uint8Array(
      0,
    );

  private axesFrame =
    new Float32Array(
      0,
    );

  public constructor(
    deadzone:
      number =
        DEFAULT_DEADZONE,
  ) {
    this.deadzone =
      sanitizeDeadzone(
        deadzone,
      );

    this.handleGamepadConnected =
      this.handleGamepadConnected.bind(
        this,
      );

    this.handleGamepadDisconnected =
      this.handleGamepadDisconnected.bind(
        this,
      );
  }

  public attach(): void {
    if (
      this.disposed ||
      this.isBound
    ) {
      return;
    }

    window.addEventListener(
      "gamepadconnected",
      this.handleGamepadConnected,
    );

    window.addEventListener(
      "gamepaddisconnected",
      this.handleGamepadDisconnected,
    );

    this.isBound =
      true;

    this.resolveActiveGamepad();
  }

  public detach(): void {
    if (
      !this.isBound
    ) {
      return;
    }

    window.removeEventListener(
      "gamepadconnected",
      this.handleGamepadConnected,
    );

    window.removeEventListener(
      "gamepaddisconnected",
      this.handleGamepadDisconnected,
    );

    this.resetAllState();

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

    this.clearFrameEdges();

    const gamepad =
      this.resolveActiveGamepad();

    if (
      gamepad ===
      null
    ) {
      this.releaseButtonsAfterDisconnect();
      this.clearAxes();

      this.connected =
        false;

      this.activeGamepadName =
        NO_GAMEPAD_NAME;

      this.meaningfulInputThisFrame =
        this.hasReleasedButtonThisFrame();

      return;
    }

    this.connected =
      true;

    this.activeGamepadName =
      gamepad.id;

    this.ensureButtonCapacity(
      gamepad.buttons.length,
    );

    this.ensureAxisCapacity(
      gamepad.axes.length,
    );

    let hasMeaningfulInput =
      false;

    for (
      let index =
        0;
      index <
      this.buttonsDown.length;
      index +=
        1
    ) {
      const button =
        gamepad.buttons[
          index
        ];

      const nextDown =
        button !==
          undefined &&
        (
          button.pressed ||
          (
            Number.isFinite(
              button.value,
            ) &&
            button.value >=
              BUTTON_DOWN_THRESHOLD
          )
        );

      const wasDown =
        this.buttonsDown[
          index
        ] ===
        1;

      this.buttonsPressedFrame[
        index
      ] =
        nextDown &&
        !wasDown
          ? 1
          : 0;

      this.buttonsReleasedFrame[
        index
      ] =
        !nextDown &&
        wasDown
          ? 1
          : 0;

      this.buttonsDown[
        index
      ] =
        nextDown
          ? 1
          : 0;

      if (
        nextDown ||
        this.buttonsPressedFrame[
          index
        ] ===
          1 ||
        this.buttonsReleasedFrame[
          index
        ] ===
          1
      ) {
        hasMeaningfulInput =
          true;
      }
    }

    for (
      let index =
        0;
      index <
      this.axesFrame.length;
      index +=
        1
    ) {
      const raw =
        gamepad.axes[
          index
        ] ??
        0;

      const value =
        this.applyDeadzone(
          raw,
        );

      this.axesFrame[
        index
      ] =
        value;

      if (
        Math.abs(
          value,
        ) >
        DEVICE_ACTIVITY_AXIS_THRESHOLD
      ) {
        hasMeaningfulInput =
          true;
      }
    }

    this.meaningfulInputThisFrame =
      hasMeaningfulInput;
  }

  public get isConnected():
    boolean {
    return (
      this.connected &&
      this.activeGamepadIndex !==
        null
    );
  }

  public get hasActivityThisFrame():
    boolean {
    return this.meaningfulInputThisFrame;
  }

  public getGamepadName():
    string {
    return this.activeGamepadName;
  }

  public isButtonDown(
    buttonIndex:
      number,
  ): boolean {
    return (
      Number.isInteger(
        buttonIndex,
      ) &&
      buttonIndex >=
        0 &&
      buttonIndex <
        this.buttonsDown.length &&
      this.buttonsDown[
        buttonIndex
      ] ===
        1
    );
  }

  public isButtonPressed(
    buttonIndex:
      number,
  ): boolean {
    return (
      Number.isInteger(
        buttonIndex,
      ) &&
      buttonIndex >=
        0 &&
      buttonIndex <
        this.buttonsPressedFrame.length &&
      this.buttonsPressedFrame[
        buttonIndex
      ] ===
        1
    );
  }

  public isButtonReleased(
    buttonIndex:
      number,
  ): boolean {
    return (
      Number.isInteger(
        buttonIndex,
      ) &&
      buttonIndex >=
        0 &&
      buttonIndex <
        this.buttonsReleasedFrame.length &&
      this.buttonsReleasedFrame[
        buttonIndex
      ] ===
        1
    );
  }

  public getAxisValue(
    axisIndex:
      number,
  ): number {
    if (
      !Number.isInteger(
        axisIndex,
      ) ||
      axisIndex <
        0 ||
      axisIndex >=
        this.axesFrame.length
    ) {
      return 0;
    }

    return (
      this.axesFrame[
        axisIndex
      ] ??
      0
    );
  }

  private applyDeadzone(
    rawValue:
      number,
  ): number {
    if (
      !Number.isFinite(
        rawValue,
      )
    ) {
      return 0;
    }

    const clamped =
      clampUnit(
        rawValue,
      );

    const magnitude =
      Math.abs(
        clamped,
      );

    if (
      magnitude <=
      this.deadzone
    ) {
      return 0;
    }

    const normalized =
      (
        magnitude -
        this.deadzone
      ) /
      (
        1 -
        this.deadzone
      );

    return (
      clamped <
      0
        ? -normalized
        : normalized
    );
  }

  private resolveActiveGamepad():
    Gamepad |
    null {
    const gamepads =
      this.readGamepads();

    if (
      gamepads ===
      null
    ) {
      this.activeGamepadIndex =
        null;

      return null;
    }

    if (
      this.activeGamepadIndex !==
      null
    ) {
      const current =
        gamepads[
          this.activeGamepadIndex
        ];

      if (
        current !==
          null &&
        current !==
          undefined &&
        current.connected
      ) {
        return current;
      }
    }

    const previousIndex =
      this.activeGamepadIndex;

    this.activeGamepadIndex =
      null;

    for (
      let index =
        0;
      index <
      gamepads.length;
      index +=
        1
    ) {
      const candidate =
        gamepads[
          index
        ];

      if (
        candidate !==
          null &&
        candidate !==
          undefined &&
        candidate.connected
      ) {
        this.activeGamepadIndex =
          candidate.index;

        if (
          previousIndex !==
          candidate.index
        ) {
          this.resetSnapshotArrays();
        }

        return candidate;
      }
    }

    return null;
  }

  private readGamepads():
    Gamepad[] |
    null {
    const read =
      navigator.getGamepads;

    if (
      typeof read !==
      "function"
    ) {
      return null;
    }

    try {
      const source =
        read.call(
          navigator,
        );

      return source as
        unknown as
        Gamepad[];
    } catch {
      return null;
    }
  }

  private ensureButtonCapacity(
    required:
      number,
  ): void {
    if (
      required <=
      this.buttonsDown.length
    ) {
      return;
    }

    const nextDown =
      new Uint8Array(
        required,
      );

    nextDown.set(
      this.buttonsDown,
    );

    this.buttonsDown =
      nextDown;

    this.buttonsPressedFrame =
      new Uint8Array(
        required,
      );

    this.buttonsReleasedFrame =
      new Uint8Array(
        required,
      );
  }

  private ensureAxisCapacity(
    required:
      number,
  ): void {
    if (
      required ===
      this.axesFrame.length
    ) {
      return;
    }

    this.axesFrame =
      new Float32Array(
        required,
      );
  }

  private clearFrameEdges(): void {
    this.buttonsPressedFrame.fill(
      0,
    );

    this.buttonsReleasedFrame.fill(
      0,
    );

    this.meaningfulInputThisFrame =
      false;
  }

  private releaseButtonsAfterDisconnect(): void {
    for (
      let index =
        0;
      index <
      this.buttonsDown.length;
      index +=
        1
    ) {
      const wasDown =
        this.buttonsDown[
          index
        ] ===
        1;

      this.buttonsReleasedFrame[
        index
      ] =
        wasDown
          ? 1
          : 0;

      this.buttonsDown[
        index
      ] =
        0;
    }
  }

  private hasReleasedButtonThisFrame():
    boolean {
    for (
      let index =
        0;
      index <
      this.buttonsReleasedFrame.length;
      index +=
        1
    ) {
      if (
        this.buttonsReleasedFrame[
          index
        ] ===
        1
      ) {
        return true;
      }
    }

    return false;
  }

  private clearAxes(): void {
    this.axesFrame.fill(
      0,
    );
  }

  private resetSnapshotArrays(): void {
    this.buttonsDown.fill(
      0,
    );

    this.buttonsPressedFrame.fill(
      0,
    );

    this.buttonsReleasedFrame.fill(
      0,
    );

    this.axesFrame.fill(
      0,
    );
  }

  private resetAllState(): void {
    this.activeGamepadIndex =
      null;

    this.activeGamepadName =
      NO_GAMEPAD_NAME;

    this.connected =
      false;

    this.meaningfulInputThisFrame =
      false;

    this.buttonsDown =
      new Uint8Array(
        0,
      );

    this.buttonsPressedFrame =
      new Uint8Array(
        0,
      );

    this.buttonsReleasedFrame =
      new Uint8Array(
        0,
      );

    this.axesFrame =
      new Float32Array(
        0,
      );
  }

  private handleGamepadConnected(
    event:
      GamepadEvent,
  ): void {
    if (
      this.activeGamepadIndex ===
      null
    ) {
      this.activeGamepadIndex =
        event.gamepad.index;

      this.resetSnapshotArrays();
    }
  }

  private handleGamepadDisconnected(
    event:
      GamepadEvent,
  ): void {
    if (
      this.activeGamepadIndex ===
      event.gamepad.index
    ) {
      this.activeGamepadIndex =
        null;
    }
  }
}
