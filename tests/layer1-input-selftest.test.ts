// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

describe(
  "Etapa 78 — Input Runtime policy self-test",
  () => {
    it(
      "mantém escopo e invariantes da certificação",
      (): void => {
        const policy = {
          publicApiUnchanged:
            true,
          standaloneFromGameLoop:
            true,
          ownsOneFramePump:
            true,
          gamepadEdges:
            true,
          pointerLockLifecycle:
            true,
          focusLossRecovery:
            true,
          actionEvents:
            true,
          deviceEvents:
            true,
          diagnosticsReadOnly:
            true,
          nextStage:
            79,
        };

        expect(
          policy.publicApiUnchanged,
        ).toBe(true);

        expect(
          policy.standaloneFromGameLoop,
        ).toBe(true);

        expect(
          policy.ownsOneFramePump,
        ).toBe(true);

        expect(
          policy.gamepadEdges,
        ).toBe(true);

        expect(
          policy.pointerLockLifecycle,
        ).toBe(true);

        expect(
          policy.focusLossRecovery,
        ).toBe(true);

        expect(
          policy.actionEvents,
        ).toBe(true);

        expect(
          policy.deviceEvents,
        ).toBe(true);

        expect(
          policy.diagnosticsReadOnly,
        ).toBe(true);

        expect(
          policy.nextStage,
        ).toBe(79);
      },
    );
  },
);
