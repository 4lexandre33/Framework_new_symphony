import {
  describe,
  expect,
  it,
} from "vitest";

import {
  NATIVE_TAURI_RUNTIME_FILES,
  auditLayer1NativeTauri,
} from "../scripts/architecture/lib/layer1-native-tauri-v1.mjs";

describe(
  "Layer 1 Stage 85 — audit selftest",
  (): void => {
    it(
      "não possui runtime files duplicados",
      (): void => {
        expect(
          new Set(
            NATIVE_TAURI_RUNTIME_FILES,
          ).size,
        ).toBe(
          NATIVE_TAURI_RUNTIME_FILES.length,
        );
      },
    );

    it(
      "audita o snapshot aplicado sem violações",
      async (): Promise<void> => {
        const result =
          await auditLayer1NativeTauri({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.violations,
        ).toEqual(
          [],
        );

        expect(
          result.compatibility,
        ).toEqual({
          stage72:
            true,

          stage73:
            true,

          stage74:
            true,

          stage84:
            true,
        });

        expect(
          result.ok,
        ).toBe(
          true,
        );
      },
    );
  },
);
