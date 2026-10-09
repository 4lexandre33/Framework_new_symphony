// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 87 — timeout/disposal recovery", () => {
  it("withTimeout sempre limpa timer no finally", () => {
    const source = fs.readFileSync("src/core/internal/ttl.ts", "utf8");
    expect(source).toContain("Promise.race([promise, timeout])");
    expect(source).toContain("finally {");
    expect(source).toContain("clearTimeout(timer)");
  });

  it("dispose aborta trabalho antes de desmontar owners", () => {
    const source = fs.readFileSync("src/core/runtime/dispose.ts", "utf8");
    const abort = source.indexOf("state.abortControllers.get(id)?.abort()");
    const disposers = source.indexOf("await runDisposers(state, id)");
    const scope = source.indexOf("await runScope(state, id)");
    const timers = source.indexOf("stopTimers(state, id)");
    const subsystems = source.indexOf("detachSubsystems(state, id)");
    expect(abort).toBeGreaterThanOrEqual(0);
    expect(disposers).toBeGreaterThan(abort);
    expect(scope).toBeGreaterThan(disposers);
    expect(timers).toBeGreaterThan(scope);
    expect(subsystems).toBeGreaterThan(timers);
  });
});
