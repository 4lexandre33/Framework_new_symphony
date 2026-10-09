// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 87 — render/input recovery", () => {
  it("suspende render no context lost e reinitializa estado no restore", () => {
    const source = fs.readFileSync("src/engine/render/internal/ThreeRenderEngine.ts", "utf8");
    expect(source).toContain('"webglcontextlost"');
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("this.contextLost = true");
    expect(source).toContain('"webglcontextrestored"');
    expect(source).toContain("this.renderer.resetState()");
    expect(source).toContain("this.handleResize(");
  });

  it("blur e visibility hidden liberam estado contínuo de input", () => {
    const source = fs.readFileSync("src/engine/input/internal/KeyboardMouseDriver.ts", "utf8");
    expect(source).toContain('"blur"');
    expect(source).toContain('"visibilitychange"');
    expect(source).toContain("this.releaseAllContinuousState()");
    expect(source).toContain("document.pointerLockElement ??");
  });
});
