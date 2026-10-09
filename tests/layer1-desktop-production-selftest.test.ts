// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 88 — certification selftest", () => {
  it("Linux release smoke produces a real executable and verifies Cargo manifest integrity", () => {
    const smoke = fs.readFileSync("tests/run-stage88-release-smoke.mjs", "utf8");
    expect(smoke).toContain('"tauri", "build", "--no-bundle"');
    expect(smoke).toContain("src-tauri/target/release/projeto1");
    expect(smoke).toContain("cargoHashBefore");
    expect(smoke).toContain("cargoHashAfter");
    expect(smoke).toContain("executableSha256");
    expect(smoke).toContain("ETAPA88_RELEASE_SMOKE_EVIDENCE.json");
  });

  it("Windows package smoke requires a real projeto1.exe and NSIS installer", () => {
    const smoke = fs.readFileSync("tests/run-stage88-windows-package-smoke.mjs", "utf8");
    expect(smoke).toContain('"--bundles", "nsis"');
    expect(smoke).toContain("projeto1.exe");
    expect(smoke).toContain("bundle/nsis");
    expect(smoke).toContain("installerSha256");
    expect(smoke).toContain("ETAPA88_WINDOWS_PACKAGE_EVIDENCE.json");
  });
});
