// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  GamepadDriver,
} from "../src/engine/input/internal/GamepadDriver";

function createGamepad(
  buttons:
    readonly boolean[],
  axes:
    readonly number[],
  id =
    "Test Gamepad",
): Gamepad {
  return {
    axes: [
      ...axes,
    ],
    buttons:
      buttons.map(
        (
          pressed,
        ): GamepadButton => ({
          pressed,
          touched:
            pressed,
          value:
            pressed
              ? 1
              : 0,
        }),
      ),
    connected:
      true,
    hapticActuators:
      [],
    id,
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
  "Etapa 78 — GamepadDriver snapshots",
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

        vi.restoreAllMocks();
      },
    );

    it(
      "distingue pressed, held e released em frames consecutivos",
      (): void => {
        const driver =
          new GamepadDriver();

        driver.attach();

        gamepads = [
          createGamepad(
            [
              true,
            ],
            [
              0,
              0,
            ],
          ),
        ];

        driver.update();

        expect(
          driver.isConnected,
        ).toBe(true);

        expect(
          driver.isButtonPressed(
            0,
          ),
        ).toBe(true);

        expect(
          driver.isButtonDown(
            0,
          ),
        ).toBe(true);

        expect(
          driver.isButtonReleased(
            0,
          ),
        ).toBe(false);

        driver.update();

        expect(
          driver.isButtonPressed(
            0,
          ),
        ).toBe(false);

        expect(
          driver.isButtonDown(
            0,
          ),
        ).toBe(true);

        gamepads = [
          createGamepad(
            [
              false,
            ],
            [
              0,
              0,
            ],
          ),
        ];

        driver.update();

        expect(
          driver.isButtonReleased(
            0,
          ),
        ).toBe(true);

        expect(
          driver.isButtonDown(
            0,
          ),
        ).toBe(false);

        driver.update();

        expect(
          driver.isButtonReleased(
            0,
          ),
        ).toBe(false);

        driver.dispose();
      },
    );

    it(
      "aplica deadzone contínua e clamp em axes",
      (): void => {
        const driver =
          new GamepadDriver(
            0.15,
          );

        driver.attach();

        gamepads = [
          createGamepad(
            [],
            [
              0.1,
              0.575,
              -2,
              Number.NaN,
            ],
          ),
        ];

        driver.update();

        expect(
          driver.getAxisValue(
            0,
          ),
        ).toBe(0);

        expect(
          driver.getAxisValue(
            1,
          ),
        ).toBeCloseTo(
          0.5,
          5,
        );

        expect(
          driver.getAxisValue(
            2,
          ),
        ).toBe(-1);

        expect(
          driver.getAxisValue(
            3,
          ),
        ).toBe(0);

        driver.dispose();
      },
    );

    it(
      "desconexão libera botões que estavam down",
      (): void => {
        const driver =
          new GamepadDriver();

        driver.attach();

        gamepads = [
          createGamepad(
            [
              true,
            ],
            [],
          ),
        ];

        driver.update();

        gamepads =
          [];

        driver.update();

        expect(
          driver.isConnected,
        ).toBe(false);

        expect(
          driver.isButtonReleased(
            0,
          ),
        ).toBe(true);

        expect(
          driver.hasActivityThisFrame,
        ).toBe(true);

        driver.dispose();
        driver.dispose();
      },
    );
  },
);
