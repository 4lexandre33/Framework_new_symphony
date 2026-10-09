// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Layer 1 Stage 88 — desktop lifecycle", () => {
  it("handles DPI/resize deterministically and releases resize listeners", () => {
    const viewport = fs.readFileSync("src/engine/render/internal/ViewportManager.ts", "utf8");
    expect(viewport).toContain("const MAX_PIXEL_RATIO = 2");
    expect(viewport).toContain("hostWindow.devicePixelRatio");
    expect(viewport).toContain('"resize"');
    expect(viewport).toContain("removeEventListener(");
    expect(viewport).toContain("this.callbacks.clear()");
  });

  it("releases continuous input state on focus/visibility changes and owns pointer-lock cleanup", () => {
    const input = fs.readFileSync("src/engine/input/internal/KeyboardMouseDriver.ts", "utf8");
    expect(input).toContain('"blur"');
    expect(input).toContain('"visibilitychange"');
    expect(input).toContain('"pointerlockchange"');
    expect(input).toContain("this.releaseAllContinuousState()");
    expect(input).toContain("this.exitPointerLock()");
  });
});
