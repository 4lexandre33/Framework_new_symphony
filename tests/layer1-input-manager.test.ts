// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  InputActionPayload,
  InputBindingMap,
  InputDeviceChangedPayload,
} from "../src/contracts/input/types";

import {
  InputManager,
} from "../src/engine/input/internal/InputManager";

function createGamepad(
  pressed:
    boolean,
): Gamepad {
  return {
    axes: [
      0,
      0,
    ],
    buttons: [
      {
        pressed,
        touched:
          pressed,
        value:
          pressed
            ? 1
            : 0,
      },
    ],
    connected:
      true,
    hapticActuators:
      [],
    id:
      "Stage78 Pad",
    index:
      0,
    mapping:
      "standard",
    timestamp:
      0,
    vibrationActuator:
      null,
  } as unknown as
    Gamepad;
}

describe(
  "Etapa 78 — InputManager",
  () => {
    let gamepads:
      Array<
        Gamepad |
        null
      >;

    let originalDescriptor:
      PropertyDescriptor |
      undefined;

    beforeEach(
      (): void => {
        gamepads =
          [];

        originalDescriptor =
          Object.getOwnPropertyDescriptor(
            navigator,
            "getGamepads",
          );

        Object.defineProperty(
          navigator,
          "getGamepads",
          {
            configurable:
              true,
            value:
              (): Array<
                Gamepad |
                null
              > =>
                gamepads,
          },
        );
      },
    );

    afterEach(
      (): void => {
        if (
          originalDescriptor ===
          undefined
        ) {
          Reflect.deleteProperty(
            navigator,
            "getGamepads",
          );
        } else {
          Object.defineProperty(
            navigator,
            "getGamepads",
            originalDescriptor,
          );
        }
      },
    );

    it(
      "publica pressed/held/released reais de gamepad e troca activeDevice",
      (): void => {
        const actions:
          InputActionPayload[] =
          [];

        const devices:
          InputDeviceChangedPayload[] =
          [];

        const input =
          new InputManager({
            onAction(
              payload,
            ): void {
              actions.push(
                payload,
              );
            },

            onDeviceChanged(
              payload,
            ): void {
              devices.push(
                payload,
              );
            },
          });

        const bindings:
          InputBindingMap = {
            actions: {
              Jump: [
                "GamepadButton0",
              ],
            },
            axes: {},
          };

        input.setBindingMap(
          bindings,
        );

        gamepads = [
          createGamepad(
            true,
          ),
        ];

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "gamepad",
        );

        expect(
          input.isActionPressed(
            "Jump",
          ),
        ).toBe(true);

        expect(
          actions.at(
            -1,
          ),
        ).toMatchObject({
          action:
            "Jump",
          state:
            "pressed",
          device:
            "gamepad",
          value:
            1,
        });

        expect(
          devices.at(
            -1,
          ),
        ).toEqual({
          currentDevice:
            "gamepad",
          deviceName:
            "Stage78 Pad",
        });

        input.update();

        expect(
          actions.at(
            -1,
          )?.state,
        ).toBe(
          "held",
        );

        gamepads = [
          createGamepad(
            false,
          ),
        ];

        input.update();

        expect(
          input.isActionReleased(
            "Jump",
          ),
        ).toBe(true);

        expect(
          actions.at(
            -1,
          )?.state,
        ).toBe(
          "released",
        );

        gamepads = [
          createGamepad(
            true,
          ),
        ];

        input.update();

        gamepads =
          [];

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "keyboard_mouse",
        );

        expect(
          actions.at(
            -1,
          ),
        ).toMatchObject({
          action:
            "Jump",
          state:
            "released",
          device:
            "gamepad",
        });

        expect(
          devices.at(
            -1,
          ),
        ).toEqual({
          currentDevice:
            "keyboard_mouse",
          deviceName:
            "Keyboard + Mouse",
        });

        input.dispose();
      },
    );

    it(
      "keyboard/mouse tem prioridade no frame e gamepad pode reassumir no frame seguinte",
      (): void => {
        const input =
          new InputManager();

        gamepads = [
          createGamepad(
            true,
          ),
        ];

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "gamepad",
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyW",
            },
          ),
        );

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "keyboard_mouse",
        );

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "keyboard_mouse",
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "KeyW",
            },
          ),
        );

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "keyboard_mouse",
        );

        input.update();

        expect(
          input.activeDevice,
        ).toBe(
          "gamepad",
        );

        input.dispose();
      },
    );

    it(
      "setBindingMap copia configuração e não depende de mutação externa posterior",
      (): void => {
        const input =
          new InputManager();

        const bindings:
          InputBindingMap = {
            actions: {
              Jump: [
                "Space",
              ],
            },
            axes: {},
          };

        input.setBindingMap(
          bindings,
        );

        bindings.actions.Jump?.push(
          "KeyQ",
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyQ",
            },
          ),
        );

        input.update();

        expect(
          input.isActionPressed(
            "Jump",
          ),
        ).toBe(false);

        input.dispose();
        input.dispose();
      },
    );
  },
);
