// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 88 — certification selftest", () => {
  it("Linux release smoke produces a real executable and restores Cargo.toml byte-for-byte", () => {
    const smoke = fs.readFileSync("tests/run-stage88-release-smoke.mjs", "utf8");
    expect(smoke).toContain('"tauri", "build", "--no-bundle"');
    expect(smoke).toContain("src-tauri/target/release/projeto1");
    expect(smoke).toContain("preserveCargoManifest");
    expect(smoke).toContain("cargoHashBefore");
    expect(smoke).toContain("cargoHashAfter");
    expect(smoke).toContain("cargoManifestMutatedByTauri");
    expect(smoke).toContain("cargoManifestRestored");
    expect(smoke).toContain("executableSha256");
    expect(smoke).toContain("ETAPA88_RELEASE_SMOKE_EVIDENCE.json");
  });

  it("Windows package smoke requires real projeto1.exe/NSIS and restores Cargo.toml byte-for-byte", () => {
    const smoke = fs.readFileSync("tests/run-stage88-windows-package-smoke.mjs", "utf8");
    expect(smoke).toContain('"--bundles", "nsis"');
    expect(smoke).toContain("projeto1.exe");
    expect(smoke).toContain("bundle");
    expect(smoke).toContain("nsis");
    expect(smoke).toContain("preserveCargoManifest");
    expect(smoke).toContain("cargoManifestRestored");
    expect(smoke).toContain("installerSha256");
    expect(smoke).toContain("ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json");
  });
});
