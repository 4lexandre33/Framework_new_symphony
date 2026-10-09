// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 87 — kernel recovery", () => {
  it("rollback estrito preserva a falha original e encerra a fase", () => {
    const source = fs.readFileSync("src/core/runtime/boot.ts", "utf8");
    expect(source).toContain("await rollbackFailedBoot(");
    expect(source).toContain('state.status =\n      "failed"');
    expect(source).toContain('state.phase =\n      "stopped"');
    expect(source).toContain("throw error;");
  });

  it("modo tolerante quarentena failed entries e permite rebind", () => {
    const source = fs.readFileSync("src/core/runtime/boot.ts", "utf8");
    expect(source).toContain("quarantineFailedEntries(");
    expect(source).toContain("rebindConsumers:");
    expect(source).toContain("true,");
    expect(source).toContain("disposePlugin(");
  });
});
