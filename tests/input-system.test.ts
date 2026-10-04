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
  InputManager,
} from "../src/engine/input/internal/InputManager";

import {
  createInputPlugin,
} from "../src/plugins/input/plugin";

import {
  InputToken,
} from "../src/tokens/input";

import type {
  InputBindingMap,
} from "../src/contracts/input/types";

describe(
  "Camada 2: Input Manager & Abstraction System Tests",
  (): void => {
    let inputManager:
      InputManager;

    beforeEach(
      (): void => {
        vi.clearAllMocks();

        inputManager =
          new InputManager();
      },
    );

    afterEach(
      (): void => {
        inputManager.dispose();

        vi.restoreAllMocks();
      },
    );

    it(
      "deve inicializar com o dispositivo padrão 'keyboard_mouse'",
      (): void => {
        expect(
          inputManager
            .activeDevice,
        ).toBe(
          "keyboard_mouse",
        );

        expect(
          inputManager
            .isPointerLocked,
        ).toBe(
          false,
        );
      },
    );

    it(
      "deve mapear e responder a ações lógicas de teclado entre PRESSED, HELD e RELEASED",
      (): void => {
        const customBindings:
          InputBindingMap = {
            actions: {
              Jump: [
                "Space",
              ],

              Fire: [
                "Mouse0",
              ],
            },

            axes: {
              MoveForward: {
                positive:
                  "KeyW",

                negative:
                  "KeyS",
              },
            },
          };

        inputManager
          .setBindingMap(
            customBindings,
          );

        expect(
          inputManager
            .isActionPressed(
              "Jump",
            ),
        ).toBe(
          false,
        );

        expect(
          inputManager
            .isActionHeld(
              "Jump",
            ),
        ).toBe(
          false,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "Space",

              key:
                " ",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager
            .isActionPressed(
              "Jump",
            ),
        ).toBe(
          true,
        );

        expect(
          inputManager
            .isActionHeld(
              "Jump",
            ),
        ).toBe(
          true,
        );

        expect(
          inputManager
            .isActionReleased(
              "Jump",
            ),
        ).toBe(
          false,
        );

        inputManager.update();

        expect(
          inputManager
            .isActionPressed(
              "Jump",
            ),
        ).toBe(
          false,
        );

        expect(
          inputManager
            .isActionHeld(
              "Jump",
            ),
        ).toBe(
          true,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "Space",

              key:
                " ",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager
            .isActionPressed(
              "Jump",
            ),
        ).toBe(
          false,
        );

        expect(
          inputManager
            .isActionHeld(
              "Jump",
            ),
        ).toBe(
          false,
        );

        expect(
          inputManager
            .isActionReleased(
              "Jump",
            ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve calcular corretamente os eixos digitais combinados (+1.0 e -1.0)",
      (): void => {
        const customBindings:
          InputBindingMap = {
            actions: {},

            axes: {
              Horizontal: {
                positive:
                  "KeyD",

                negative:
                  "KeyA",
              },

              Vertical: {
                positive:
                  "KeyW",

                negative:
                  "KeyS",
              },
            },
          };

        inputManager
          .setBindingMap(
            customBindings,
          );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyD",

              key:
                "d",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager.getAxis(
            "Horizontal",
          ),
        ).toBe(
          1,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "KeyD",

              key:
                "d",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager.getAxis(
            "Horizontal",
          ),
        ).toBe(
          0,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyA",

              key:
                "a",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager.getAxis(
            "Horizontal",
          ),
        ).toBe(
          -1,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "KeyA",

              key:
                "a",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyW",

              key:
                "w",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager.getAxis(
            "Vertical",
          ),
        ).toBe(
          1,
        );

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "KeyW",

              key:
                "w",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyS",

              key:
                "s",

              bubbles:
                true,
            },
          ),
        );

        inputManager.update();

        expect(
          inputManager.getAxis(
            "Vertical",
          ),
        ).toBe(
          -1,
        );
      },
    );

    it(
      "deve retornar o delta do mouse como um vetor 2D zerado por padrão",
      (): void => {
        const delta =
          inputManager
            .getMouseDelta();

        expect(
          delta,
        ).toEqual({
          x: 0,
          y: 0,
        });
      },
    );

    it(
      "deve registrar o plugin de Input no Kernel com o manifesto e capability corretos",
      (): void => {
        const plugin =
          createInputPlugin();

        expect(
          plugin.manifest.id,
        ).toBe(
          "game.input",
        );

        expect(
          plugin.manifest.version,
        ).toBe(
          "1.0.0",
        );

        const providedCapabilities =
          plugin.manifest
            .capabilities
            ?.provides ??
          [];

        expect(
          providedCapabilities.some(
            (
              capability,
            ): boolean =>
              capability.id ===
                InputToken.id &&
              capability.version ===
                "1.0.0",
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);