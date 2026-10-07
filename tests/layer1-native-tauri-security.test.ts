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
  "Layer 1 Stage 85 — IPC validation/security",
  (): void => {
    it(
      "remove sucesso sintético e segredo hardcoded do boundary monetário",
      (): void => {
        const native =
          read(
            "src-tauri/src/monetization.rs",
          );

        const driver =
          read(
            "src/engine/monetization/internal/TauriMonetizationDriver.ts",
          );

        expect(
          native,
        ).toContain(
          "fail-closed",
        );

        expect(
          native,
        ).toContain(
          "validate_sku",
        );

        expect(
          native,
        ).toContain(
          "validate_quantity",
        );

        expect(
          native,
        ).not.toMatch(
          /STEAM_SECRET|SECRET_SALT|76561198000000000/u,
        );

        expect(
          driver,
        ).toContain(
          "isValidAmount",
        );

        expect(
          driver,
        ).toContain(
          "isValidQuantity",
        );

        expect(
          driver,
        ).not.toMatch(
          /catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,500}?return\s+true\s*;/u,
        );
      },
    );

    it(
      "governa tamanho e traversal do boundary de mods",
      (): void => {
        const native =
          read(
            "src-tauri/src/modding.rs",
          );

        const driver =
          read(
            "src/engine/modding/internal/TauriModdingDriver.ts",
          );

        expect(
          native,
        ).toContain(
          "MAX_MOD_MANIFEST_BYTES",
        );

        expect(
          native,
        ).toContain(
          "validate_relative_mod_path",
        );

        expect(
          native,
        ).toContain(
          "Component::ParentDir",
        );

        expect(
          native,
        ).toContain(
          "canonicalize()",
        );

        expect(
          driver,
        ).toContain(
          "WORKSHOP_ITEM_ID_PATTERN",
        );

        expect(
          driver,
        ).toContain(
          "steam_workshop_download_item",
        );
      },
    );

    it(
      "mantém crash dumps confinados e sanitizados",
      (): void => {
        const native =
          read(
            "src-tauri/src/security.rs",
          );

        expect(
          native,
        ).toContain(
          "MAX_CRASH_DUMP_BYTES",
        );

        expect(
          native,
        ).toContain(
          "validate_crash_id",
        );

        expect(
          native,
        ).toContain(
          ".app_log_dir()",
        );

        expect(
          native,
        ).not.toContain(
          "PathBuf::from(crash_id)",
        );
      },
    );
  },
);
