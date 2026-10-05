// @vitest-environment jsdom

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  KeyboardMouseDriver,
} from "../src/engine/input/internal/KeyboardMouseDriver";

describe(
  "Etapa 78 — KeyboardMouseDriver",
  () => {
    const drivers:
      KeyboardMouseDriver[] =
      [];

    afterEach(
      (): void => {
        for (
          const driver of
          drivers
        ) {
          driver.dispose();
        }

        drivers.length =
          0;

        vi.restoreAllMocks();
      },
    );

    function createDriver():
      KeyboardMouseDriver {
      const driver =
        new KeyboardMouseDriver();

      drivers.push(
        driver,
      );

      driver.attach(
        document.body,
      );

      return driver;
    }

    it(
      "inicia desbloqueado quando pointerLockElement está ausente no ambiente",
      (): void => {
        const pointerLockDescriptor =
          Object.getOwnPropertyDescriptor(
            document,
            "pointerLockElement",
          );

        Reflect.deleteProperty(
          document,
          "pointerLockElement",
        );

        const driver =
          createDriver();

        expect(
          driver.isPointerLocked,
        ).toBe(false);

        driver.detach();

        if (
          pointerLockDescriptor !==
          undefined
        ) {
          Object.defineProperty(
            document,
            "pointerLockElement",
            pointerLockDescriptor,
          );
        }
      },
    );

    it(
      "mantém pressed/held/released estáveis por snapshot",
      (): void => {
        const driver =
          createDriver();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "Space",
            },
          ),
        );

        driver.update();

        expect(
          driver.isKeyPressed(
            "Space",
          ),
        ).toBe(true);

        expect(
          driver.isKeyDown(
            "Space",
          ),
        ).toBe(true);

        driver.update();

        expect(
          driver.isKeyPressed(
            "Space",
          ),
        ).toBe(false);

        expect(
          driver.isKeyDown(
            "Space",
          ),
        ).toBe(true);

        window.dispatchEvent(
          new KeyboardEvent(
            "keyup",
            {
              code:
                "Space",
            },
          ),
        );

        driver.update();

        expect(
          driver.isKeyReleased(
            "Space",
          ),
        ).toBe(true);

        expect(
          driver.isKeyDown(
            "Space",
          ),
        ).toBe(false);
      },
    );

    it(
      "ignora keydown repeat e acumula mouse delta apenas até update",
      (): void => {
        const driver =
          createDriver();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyW",
              repeat:
                true,
            },
          ),
        );

        const move =
          new MouseEvent(
            "mousemove",
          );

        Object.defineProperty(
          move,
          "movementX",
          {
            configurable:
              true,
            value:
              4,
          },
        );

        Object.defineProperty(
          move,
          "movementY",
          {
            configurable:
              true,
            value:
              -3,
          },
        );

        window.dispatchEvent(
          move,
        );

        driver.update();

        expect(
          driver.isKeyPressed(
            "KeyW",
          ),
        ).toBe(false);

        expect(
          driver.getMouseDelta(),
        ).toEqual({
          x:
            4,
          y:
            -3,
        });

        driver.update();

        expect(
          driver.getMouseDelta(),
        ).toEqual({
          x:
            0,
          y:
            0,
        });
      },
    );

    it(
      "blur converte continuous down em released para evitar stuck input",
      (): void => {
        const driver =
          createDriver();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyA",
            },
          ),
        );

        window.dispatchEvent(
          new MouseEvent(
            "mousedown",
            {
              button:
                0,
            },
          ),
        );

        driver.update();

        window.dispatchEvent(
          new Event(
            "blur",
          ),
        );

        driver.update();

        expect(
          driver.isKeyDown(
            "KeyA",
          ),
        ).toBe(false);

        expect(
          driver.isKeyReleased(
            "KeyA",
          ),
        ).toBe(true);

        expect(
          driver.isMouseButtonDown(
            0,
          ),
        ).toBe(false);

        expect(
          driver.isMouseButtonReleased(
            0,
          ),
        ).toBe(true);
      },
    );

    it(
      "requestPointerLock ausente retorna false e detach é idempotente",
      async (): Promise<void> => {
        const driver =
          createDriver();

        expect(
          await driver.requestPointerLock(
            document.body,
          ),
        ).toBe(false);

        driver.detach();
        driver.detach();

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "KeyD",
            },
          ),
        );

        driver.update();

        expect(
          driver.isKeyDown(
            "KeyD",
          ),
        ).toBe(false);
      },
    );
  },
);
