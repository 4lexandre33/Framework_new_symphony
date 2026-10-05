import type {
  InputApi,
} from "../../../tokens/input";

import type {
  InputActionPayload,
  InputBindingMap,
  InputDeviceChangedPayload,
  InputDeviceType,
  Vector2D,
} from "../../../contracts/input/types";

import {
  GamepadDriver,
} from "./GamepadDriver";

import {
  KeyboardMouseDriver,
} from "./KeyboardMouseDriver";

const KEYBOARD_MOUSE_DEVICE_NAME =
  "Keyboard + Mouse";

const DEFAULT_BINDING_MAP:
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
        positive:
          "KeyW",
        negative:
          "KeyS",
      },

      MoveRight: {
        positive:
          "KeyD",
        negative:
          "KeyA",
      },
    },
  };

export interface InputEventSink {
  onAction(
    payload:
      InputActionPayload,
  ): void;

  onDeviceChanged(
    payload:
      InputDeviceChangedPayload,
  ): void;
}

interface ActionRuntimeEntry {
  readonly action:
    string;

  readonly bindings:
    readonly string[];

  readonly keyboardPressed:
    InputActionPayload;

  readonly keyboardHeld:
    InputActionPayload;

  readonly keyboardReleased:
    InputActionPayload;

  readonly gamepadPressed:
    InputActionPayload;

  readonly gamepadHeld:
    InputActionPayload;

  readonly gamepadReleased:
    InputActionPayload;
}

function assertNonEmpty(
  value: string,
  label: string,
): void {
  if (
    value.trim()
      .length ===
    0
  ) {
    throw new RangeError(
      `${label} não pode ser vazio.`,
    );
  }
}

function createActionPayload(
  action:
    string,
  state:
    InputActionPayload["state"],
  value:
    number,
  device:
    InputDeviceType,
): InputActionPayload {
  return Object.freeze({
    action,
    state,
    value,
    device,
  });
}

export class InputManager
  implements InputApi {
  private readonly kmDriver:
    KeyboardMouseDriver;

  private readonly gamepadDriver:
    GamepadDriver;

  private eventSink:
    InputEventSink |
    null;

  private currentDevice:
    InputDeviceType =
      "keyboard_mouse";

  private bindingMap:
    InputBindingMap =
      DEFAULT_BINDING_MAP;

  private actionEntries:
    readonly ActionRuntimeEntry[] =
      [];

  private disposed =
    false;

  public constructor(
    eventSink:
      InputEventSink |
      null =
        null,
    kmDriver:
      KeyboardMouseDriver =
        new KeyboardMouseDriver(),
    gamepadDriver:
      GamepadDriver =
        new GamepadDriver(),
  ) {
    this.eventSink =
      eventSink;

    this.kmDriver =
      kmDriver;

    this.gamepadDriver =
      gamepadDriver;

    this.installBindingMap(
      DEFAULT_BINDING_MAP,
    );

    this.kmDriver.attach();
    this.gamepadDriver.attach();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.eventSink =
      null;

    this.kmDriver.dispose();
    this.gamepadDriver.dispose();

    this.currentDevice =
      "keyboard_mouse";
  }

  public get activeDevice():
    InputDeviceType {
    return this.currentDevice;
  }

  public get isPointerLocked():
    boolean {
    return (
      !this.disposed &&
      this.kmDriver
        .isPointerLocked
    );
  }

  public update(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.kmDriver.update();
    this.gamepadDriver.update();

    this.updateActiveDevice();
    this.publishActionSnapshot();
  }

  public isActionPressed(
    action: string,
  ): boolean {
    const bindings =
      this.bindingMap.actions[
        action
      ];

    if (
      bindings ===
      undefined
    ) {
      return false;
    }

    for (
      let index =
        0;
      index <
      bindings.length;
      index +=
        1
    ) {
      const binding =
        bindings[
          index
        ];

      if (
        binding !==
          undefined &&
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

    if (
      bindings ===
      undefined
    ) {
      return false;
    }

    for (
      let index =
        0;
      index <
      bindings.length;
      index +=
        1
    ) {
      const binding =
        bindings[
          index
        ];

      if (
        binding !==
          undefined &&
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

    if (
      bindings ===
      undefined
    ) {
      return false;
    }

    let released =
      false;

    for (
      let index =
        0;
      index <
      bindings.length;
      index +=
        1
    ) {
      const binding =
        bindings[
          index
        ];

      if (
        binding ===
        undefined
      ) {
        continue;
      }

      if (
        this.isBindingHeld(
          binding,
        )
      ) {
        return false;
      }

      if (
        this.isBindingReleased(
          binding,
        )
      ) {
        released =
          true;
      }
    }

    return released;
  }

  public getAxis(
    axisName: string,
  ): number {
    const axisBinding =
      this.bindingMap.axes[
        axisName
      ];

    if (
      axisBinding ===
      undefined
    ) {
      return 0;
    }

    let value =
      0;

    if (
      this.kmDriver.isKeyDown(
        axisBinding.positive,
      )
    ) {
      value +=
        1;
    }

    if (
      this.kmDriver.isKeyDown(
        axisBinding.negative,
      )
    ) {
      value -=
        1;
    }

    if (
      value ===
        0 &&
      this.gamepadDriver
        .isConnected
    ) {
      if (
        axisName ===
        "MoveForward"
      ) {
        value =
          -this.gamepadDriver
            .getAxisValue(
              1,
            );
      } else if (
        axisName ===
        "MoveRight"
      ) {
        value =
          this.gamepadDriver
            .getAxisValue(
              0,
            );
      }
    }

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

  public getMouseDelta():
    Readonly<Vector2D> {
    return this.kmDriver
      .getMouseDelta();
  }

  public setBindingMap(
    map:
      InputBindingMap,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.installBindingMap(
      map,
    );
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

    return this.kmDriver
      .requestPointerLock(
        element,
      );
  }

  public exitPointerLock(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.kmDriver
      .exitPointerLock();
  }

  public getActiveDeviceName():
    string {
    if (
      this.currentDevice ===
      "gamepad"
    ) {
      return this.gamepadDriver
        .getGamepadName();
    }

    return KEYBOARD_MOUSE_DEVICE_NAME;
  }

  private updateActiveDevice(): void {
    const previousDevice =
      this.currentDevice;

    if (
      this.kmDriver
        .hasActivityThisFrame
    ) {
      this.currentDevice =
        "keyboard_mouse";
    } else if (
      this.gamepadDriver
        .isConnected &&
      this.gamepadDriver
        .hasActivityThisFrame
    ) {
      this.currentDevice =
        "gamepad";
    } else if (
      this.currentDevice ===
        "gamepad" &&
      !this.gamepadDriver
        .isConnected
    ) {
      this.currentDevice =
        "keyboard_mouse";
    }

    if (
      previousDevice !==
      this.currentDevice
    ) {
      this.publishDeviceChanged();
    }
  }

  private publishDeviceChanged(): void {
    const sink =
      this.eventSink;

    if (
      sink ===
      null
    ) {
      return;
    }

    sink.onDeviceChanged({
      currentDevice:
        this.currentDevice,
      deviceName:
        this.getActiveDeviceName(),
    });
  }

  private publishActionSnapshot(): void {
    const sink =
      this.eventSink;

    if (
      sink ===
      null
    ) {
      return;
    }

    for (
      let index =
        0;
      index <
      this.actionEntries.length;
      index +=
        1
    ) {
      const entry =
        this.actionEntries[
          index
        ];

      if (
        entry ===
        undefined
      ) {
        continue;
      }

      const payload =
        this.resolveActionPayload(
          entry,
        );

      if (
        payload !==
        null
      ) {
        sink.onAction(
          payload,
        );
      }
    }
  }

  private resolveActionPayload(
    entry:
      ActionRuntimeEntry,
  ): InputActionPayload |
    null {
    let keyboardPressed =
      false;

    let keyboardHeld =
      false;

    let keyboardReleased =
      false;

    let gamepadPressed =
      false;

    let gamepadHeld =
      false;

    let gamepadReleased =
      false;

    for (
      let index =
        0;
      index <
      entry.bindings.length;
      index +=
        1
    ) {
      const binding =
        entry.bindings[
          index
        ];

      if (
        binding ===
        undefined
      ) {
        continue;
      }

      const isGamepad =
        binding.startsWith(
          "GamepadButton",
        );

      if (
        this.isBindingPressed(
          binding,
        )
      ) {
        if (
          isGamepad
        ) {
          gamepadPressed =
            true;
        } else {
          keyboardPressed =
            true;
        }
      }

      if (
        this.isBindingHeld(
          binding,
        )
      ) {
        if (
          isGamepad
        ) {
          gamepadHeld =
            true;
        } else {
          keyboardHeld =
            true;
        }
      }

      if (
        this.isBindingReleased(
          binding,
        )
      ) {
        if (
          isGamepad
        ) {
          gamepadReleased =
            true;
        } else {
          keyboardReleased =
            true;
        }
      }
    }

    if (
      keyboardPressed ||
      gamepadPressed
    ) {
      if (
        this.currentDevice ===
          "gamepad" &&
        gamepadPressed
      ) {
        return entry
          .gamepadPressed;
      }

      if (
        keyboardPressed
      ) {
        return entry
          .keyboardPressed;
      }

      return entry
        .gamepadPressed;
    }

    if (
      keyboardHeld ||
      gamepadHeld
    ) {
      if (
        this.currentDevice ===
          "gamepad" &&
        gamepadHeld
      ) {
        return entry
          .gamepadHeld;
      }

      if (
        keyboardHeld
      ) {
        return entry
          .keyboardHeld;
      }

      return entry
        .gamepadHeld;
    }

    if (
      keyboardReleased ||
      gamepadReleased
    ) {
      if (
        this.currentDevice ===
          "gamepad" &&
        gamepadReleased
      ) {
        return entry
          .gamepadReleased;
      }

      if (
        keyboardReleased
      ) {
        return entry
          .keyboardReleased;
      }

      return entry
        .gamepadReleased;
    }

    return null;
  }

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
        button !==
          null &&
        this.kmDriver
          .isMouseButtonPressed(
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
        button !==
          null &&
        this.gamepadDriver
          .isButtonPressed(
            button,
          )
      );
    }

    return this.kmDriver
      .isKeyPressed(
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
        button !==
          null &&
        this.kmDriver
          .isMouseButtonDown(
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
        button !==
          null &&
        this.gamepadDriver
          .isButtonDown(
            button,
          )
      );
    }

    return this.kmDriver
      .isKeyDown(
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
        button !==
          null &&
        this.kmDriver
          .isMouseButtonReleased(
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
        button !==
          null &&
        this.gamepadDriver
          .isButtonReleased(
            button,
          )
      );
    }

    return this.kmDriver
      .isKeyReleased(
        binding,
      );
  }

  private parseBindingIndex(
    binding:
      string,
    prefix:
      string,
  ): number |
    null {
    if (
      binding.length <=
      prefix.length
    ) {
      return null;
    }

    let value =
      0;

    for (
      let index =
        prefix.length;
      index <
      binding.length;
      index +=
        1
    ) {
      const code =
        binding.charCodeAt(
          index,
        );

      if (
        code <
          48 ||
        code >
          57
      ) {
        return null;
      }

      value =
        value *
          10 +
        (
          code -
          48
        );
    }

    return value;
  }

  private installBindingMap(
    map:
      InputBindingMap,
  ): void {
    const actions:
      Record<
        string,
        string[]
      > = {};

    const axes:
      InputBindingMap["axes"] =
        {};

    const entries:
      ActionRuntimeEntry[] =
        [];

    const actionNames =
      Object.keys(
        map.actions,
      );

    for (
      let actionIndex =
        0;
      actionIndex <
      actionNames.length;
      actionIndex +=
        1
    ) {
      const action =
        actionNames[
          actionIndex
        ];

      if (
        action ===
        undefined
      ) {
        continue;
      }

      assertNonEmpty(
        action,
        "action",
      );

      const sourceBindings =
        map.actions[
          action
        ];

      const bindings:
        string[] =
        [];

      for (
        let bindingIndex =
          0;
        bindingIndex <
        sourceBindings.length;
        bindingIndex +=
          1
      ) {
        const binding =
          sourceBindings[
            bindingIndex
          ];

        if (
          binding ===
          undefined
        ) {
          continue;
        }

        assertNonEmpty(
          binding,
          `binding ${action}`,
        );

        bindings.push(
          binding,
        );
      }

      actions[
        action
      ] =
        bindings;

      entries.push({
        action,
        bindings,
        keyboardPressed:
          createActionPayload(
            action,
            "pressed",
            1,
            "keyboard_mouse",
          ),
        keyboardHeld:
          createActionPayload(
            action,
            "held",
            1,
            "keyboard_mouse",
          ),
        keyboardReleased:
          createActionPayload(
            action,
            "released",
            0,
            "keyboard_mouse",
          ),
        gamepadPressed:
          createActionPayload(
            action,
            "pressed",
            1,
            "gamepad",
          ),
        gamepadHeld:
          createActionPayload(
            action,
            "held",
            1,
            "gamepad",
          ),
        gamepadReleased:
          createActionPayload(
            action,
            "released",
            0,
            "gamepad",
          ),
      });
    }

    const axisNames =
      Object.keys(
        map.axes,
      );

    for (
      let axisIndex =
        0;
      axisIndex <
      axisNames.length;
      axisIndex +=
        1
    ) {
      const axisName =
        axisNames[
          axisIndex
        ];

      if (
        axisName ===
        undefined
      ) {
        continue;
      }

      assertNonEmpty(
        axisName,
        "axis",
      );

      const axis =
        map.axes[
          axisName
        ];

      assertNonEmpty(
        axis.positive,
        `${axisName}.positive`,
      );

      assertNonEmpty(
        axis.negative,
        `${axisName}.negative`,
      );

      axes[
        axisName
      ] = {
        positive:
          axis.positive,
        negative:
          axis.negative,
      };
    }

    this.bindingMap = {
      actions,
      axes,
    };

    this.actionEntries =
      entries;
  }
}
