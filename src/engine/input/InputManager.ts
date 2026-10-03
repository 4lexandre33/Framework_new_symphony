import type {
  InputApi,
} from "../../tokens/input";

import type {
  InputDeviceType,
  Vector2D,
  InputBindingMap,
} from "../../contracts/input/types";

import {
  KeyboardMouseDriver,
} from "./KeyboardMouseDriver";

import {
  GamepadDriver,
} from "./GamepadDriver";

export class InputManager
  implements InputApi
{
  private readonly kmDriver =
    new KeyboardMouseDriver();

  private readonly gamepadDriver =
    new GamepadDriver();

  private currentDevice:
    InputDeviceType =
      "keyboard_mouse";

  private bindingMap:
    InputBindingMap = {
      actions: {
        Jump: [
          "Space",
          "GamepadButton0",
        ],

        Interact: [
          "KeyE",
          "GamepadButton2",
        ],

        Attack: [
          "Mouse0",
          "GamepadButton1",
        ],
      },

      axes: {
        MoveForward: {
          positive: "KeyW",
          negative: "KeyS",
        },

        MoveRight: {
          positive: "KeyD",
          negative: "KeyA",
        },
      },
    };

  public constructor() {
    this.kmDriver.attach();
  }

  /* ==========================================================================
   * LIFECYCLE
   * ======================================================================== */

  public dispose(): void {
    this.kmDriver.detach();

    this.gamepadDriver.dispose();
  }

  /* ==========================================================================
   * DEVICE
   * ======================================================================== */

  public get activeDevice():
    InputDeviceType {
    return this.currentDevice;
  }

  public get isPointerLocked(): boolean {
    return this.kmDriver.isPointerLocked;
  }

  /* ==========================================================================
   * FRAME UPDATE
   * ======================================================================== */

  /**
   * Deve ser chamado exatamente uma vez por frame.
   *
   * Produz o snapshot de teclado/mouse e depois
   * detecta qual dispositivo está ativo.
   */
  public update(): void {
    this.kmDriver.update();

    /*
     * Teclado/mouse teve atividade neste frame.
     *
     * Isso permite retornar de gamepad para KB/M.
     */
    if (
      this.kmDriver.hasActivityThisFrame
    ) {
      this.currentDevice =
        "keyboard_mouse";

      return;
    }

    /*
     * Só considera gamepad ativo quando realmente
     * existe alguma entrada significativa.
     */
    if (
      this.hasGamepadActivity()
    ) {
      this.currentDevice =
        "gamepad";
    }
  }

  /* ==========================================================================
   * ACTIONS
   * ======================================================================== */

  public isActionPressed(
    action: string,
  ): boolean {
    const bindings =
      this.bindingMap.actions[
        action
      ];

    if (!bindings) {
      return false;
    }

    for (
      const binding of
      bindings
    ) {
      if (
        this.isBindingPressed(
          binding,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  public isActionHeld(
    action: string,
  ): boolean {
    const bindings =
      this.bindingMap.actions[
        action
      ];

    if (!bindings) {
      return false;
    }

    for (
      const binding of
      bindings
    ) {
      if (
        this.isBindingHeld(
          binding,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  public isActionReleased(
    action: string,
  ): boolean {
    const bindings =
      this.bindingMap.actions[
        action
      ];

    if (!bindings) {
      return false;
    }

    for (
      const binding of
      bindings
    ) {
      if (
        this.isBindingReleased(
          binding,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  /* ==========================================================================
   * AXES
   * ======================================================================== */

  public getAxis(
    axisName: string,
  ): number {
    const axisBinding =
      this.bindingMap.axes[
        axisName
      ];

    if (!axisBinding) {
      return 0;
    }

    let value = 0;

    if (
      this.kmDriver.isKeyDown(
        axisBinding.positive,
      )
    ) {
      value += 1;
    }

    if (
      this.kmDriver.isKeyDown(
        axisBinding.negative,
      )
    ) {
      value -= 1;
    }

    /*
     * Teclado tem prioridade.
     *
     * Se nenhuma tecla do eixo estiver ativa,
     * consulta o analógico.
     */
    if (
      value === 0 &&
      this.gamepadDriver.isConnected
    ) {
      if (
        axisName ===
        "MoveForward"
      ) {
        value =
          -this.gamepadDriver.getAxisValue(
            1,
          );
      } else if (
        axisName ===
        "MoveRight"
      ) {
        value =
          this.gamepadDriver.getAxisValue(
            0,
          );
      }
    }

    return Math.max(
      -1,
      Math.min(1, value),
    );
  }

  /* ==========================================================================
   * MOUSE
   * ======================================================================== */

  public getMouseDelta():
    Readonly<Vector2D> {
    return this.kmDriver.getMouseDelta();
  }

  /* ==========================================================================
   * BINDINGS
   * ======================================================================== */

  public setBindingMap(
    map: InputBindingMap,
  ): void {
    this.bindingMap = map;
  }

  /* ==========================================================================
   * POINTER LOCK
   * ======================================================================== */

  public async requestPointerLock(
    element?: HTMLElement,
  ): Promise<boolean> {
    return this.kmDriver.requestPointerLock(
      element,
    );
  }

  public exitPointerLock(): void {
    this.kmDriver.exitPointerLock();
  }

  /* ==========================================================================
   * BINDING RESOLUTION
   * ======================================================================== */

  private isBindingPressed(
    binding: string,
  ): boolean {
    if (
      binding.startsWith(
        "Mouse",
      )
    ) {
      const button =
        this.parseBindingIndex(
          binding,
          "Mouse",
        );

      return (
        button !== null &&
        this.kmDriver.isMouseButtonPressed(
          button,
        )
      );
    }

    if (
      binding.startsWith(
        "GamepadButton",
      )
    ) {
      const button =
        this.parseBindingIndex(
          binding,
          "GamepadButton",
        );

      /*
       * GamepadDriver atualmente trabalha com
       * estado Down, não possui edge buffer.
       *
       * Mantemos a semântica existente até
       * implementar snapshots de gamepad.
       */
      return (
        button !== null &&
        this.gamepadDriver.isButtonDown(
          button,
        )
      );
    }

    return this.kmDriver.isKeyPressed(
      binding,
    );
  }

  private isBindingHeld(
    binding: string,
  ): boolean {
    if (
      binding.startsWith(
        "Mouse",
      )
    ) {
      const button =
        this.parseBindingIndex(
          binding,
          "Mouse",
        );

      return (
        button !== null &&
        this.kmDriver.isMouseButtonDown(
          button,
        )
      );
    }

    if (
      binding.startsWith(
        "GamepadButton",
      )
    ) {
      const button =
        this.parseBindingIndex(
          binding,
          "GamepadButton",
        );

      return (
        button !== null &&
        this.gamepadDriver.isButtonDown(
          button,
        )
      );
    }

    return this.kmDriver.isKeyDown(
      binding,
    );
  }

  private isBindingReleased(
    binding: string,
  ): boolean {
    if (
      binding.startsWith(
        "Mouse",
      )
    ) {
      const button =
        this.parseBindingIndex(
          binding,
          "Mouse",
        );

      return (
        button !== null &&
        this.kmDriver.isMouseButtonReleased(
          button,
        )
      );
    }

    /*
     * Gamepad ainda não possui snapshot
     * released neste estágio.
     */
    if (
      binding.startsWith(
        "GamepadButton",
      )
    ) {
      return false;
    }

    return this.kmDriver.isKeyReleased(
      binding,
    );
  }

  private parseBindingIndex(
    binding: string,
    prefix: string,
  ): number | null {
    const value =
      Number.parseInt(
        binding.slice(
          prefix.length,
        ),
        10,
      );

    if (
      !Number.isInteger(value) ||
      value < 0
    ) {
      return null;
    }

    return value;
  }

  /* ==========================================================================
   * GAMEPAD ACTIVITY
   * ======================================================================== */

  private hasGamepadActivity(): boolean {
    if (
      !this.gamepadDriver.isConnected
    ) {
      return false;
    }

    for (
      let axis = 0;
      axis < 4;
      axis += 1
    ) {
      if (
        Math.abs(
          this.gamepadDriver.getAxisValue(
            axis,
          ),
        ) > 0.1
      ) {
        return true;
      }
    }

    for (
      let button = 0;
      button < 16;
      button += 1
    ) {
      if (
        this.gamepadDriver.isButtonDown(
          button,
        )
      ) {
        return true;
      }
    }

    return false;
  }
}