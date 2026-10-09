// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 87 — assets/workers recovery", () => {
  it("remove in-flight em finally e rejeita conclusão tardia após dispose", () => {
    const source = fs.readFileSync("src/engine/assets/internal/AssetsManagerService.ts", "utf8");
    expect(source).toContain("finally {");
    expect(source).toContain("this.inFlight.delete(");
    expect(source).toContain("this.disposeUncachedResult(");
    expect(source).toContain("foi descartado durante o carregamento");
  });

  it("falha de worker cai em fallback e clear rejeita/termina pendências", () => {
    const source = fs.readFileSync("src/engine/terrain/internal/ProceduralWorkerPool.ts", "utf8");
    expect(source).toContain("handleWorkerError(");
    expect(source).toContain("finishJobWithFallback(");
    expect(source).toContain('"messageerror"');
    expect(source).toContain(".terminate()");
    expect(source).toContain("this.pendingJobs.clear()");
  });
});
