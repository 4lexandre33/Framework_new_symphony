// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 86 — resource lifecycle", () => {
  it("mantém release explícito dos owners principais", () => {
    const render = fs.readFileSync("src/engine/render/internal/ThreeRenderEngine.ts", "utf8");
    const scene = fs.readFileSync("src/engine/render/internal/SceneGraphManager.ts", "utf8");
    const stop = fs.readFileSync("src/core/runtime/stop.ts", "utf8");
    expect(render).toContain("this.viewportManager.dispose()");
    expect(render).toContain("this.renderer.dispose()");
    expect(scene).toContain("disposeResourceSets");
    expect(stop).toContain("disposeAll");
    expect(stop).toContain("capabilityWatchers.clear()");
  });

  it("mantém teardown de listeners e workers", () => {
    const viewport = fs.readFileSync("src/engine/render/internal/ViewportManager.ts", "utf8");
    const input = fs.readFileSync("src/engine/input/internal/KeyboardMouseDriver.ts", "utf8");
    const workers = fs.readFileSync("src/engine/terrain/internal/ProceduralWorkerPool.ts", "utf8");
    expect(viewport).toContain("removeEventListener");
    expect(input).toContain("removeEventListener");
    expect(workers).toContain("terminate(");
  });
});
