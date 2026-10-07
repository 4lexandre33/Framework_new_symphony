import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

function read(
  relativePath:
    string,
): string {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      ...relativePath.split(
        "/",
      ),
    ),
    "utf8",
  );
}

describe(
  "Layer 1 Stage 85 — Native/Tauri contract",
  (): void => {
    it(
      "mantém Tauri global desabilitado, CSP de produção e capability limitada à main",
      (): void => {
        const config =
          JSON.parse(
            read(
              "src-tauri/tauri.conf.json",
            ),
          );

        const capability =
          JSON.parse(
            read(
              "src-tauri/capabilities/default.json",
            ),
          );

        expect(
          config.app.withGlobalTauri,
        ).toBe(
          false,
        );

        expect(
          typeof config.app.security.csp,
        ).toBe(
          "string",
        );

        expect(
          config.app.security.csp.length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          capability.windows,
        ).toEqual([
          "main",
        ]);

        expect(
          capability.permissions.some(
            (
              permission:
                string,
            ): boolean =>
              permission.includes(
                "*",
              ) ||
              permission.startsWith(
                "shell:",
              ) ||
              permission.startsWith(
                "fs:",
              ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "mantém shutdown nativo explícito e sem AppID hardcoded no host",
      (): void => {
        const host =
          read(
            "src-tauri/src/lib.rs",
          );

        const steam =
          read(
            "src-tauri/src/steam.rs",
          );

        expect(
          host,
        ).toContain(
          "app_handle.state::<SteamState>().shutdown()",
        );

        expect(
          host,
        ).not.toContain(
          'std::env::set_var("SteamAppId"',
        );

        expect(
          steam,
        ).toContain(
          "callback_stop.store",
        );

        expect(
          steam,
        ).toContain(
          "handle.join()",
        );

        expect(
          steam,
        ).toContain(
          "impl Drop for SteamState",
        );
      },
    );
  },
);
