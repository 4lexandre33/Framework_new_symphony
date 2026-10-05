// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  InputApi,
} from "../src/tokens/input";

import {
  InputDiagnostics,
} from "../src/debug/hud/InputDiagnostics";

describe(
  "Etapa 78 — InputDiagnostics ownership",
  () => {
    it(
      "é somente leitor e não chama InputApi.update()",
      (): void => {
        let updates =
          0;

        const input:
          InputApi = {
            activeDevice:
              "keyboard_mouse",

            isPointerLocked:
              false,

            update(): void {
              updates +=
                1;
            },

            isActionPressed():
              boolean {
              return false;
            },

            isActionHeld():
              boolean {
              return false;
            },

            isActionReleased():
              boolean {
              return false;
            },

            getAxis():
              number {
              return 0;
            },

            getMouseDelta() {
              return {
                x:
                  0,
                y:
                  0,
              };
            },

            setBindingMap(): void {},

            async requestPointerLock():
              Promise<boolean> {
              return false;
            },

            exitPointerLock(): void {},
          };

        const diagnostics =
          new InputDiagnostics(
            (): void => {},
          );

        diagnostics.update(
          input,
        );

        expect(
          updates,
        ).toBe(0);
      },
    );
  },
);
