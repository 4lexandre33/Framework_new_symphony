// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThanOrEqual(0);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`método sem fechamento: ${signature}`);
}

describe("Layer 1 Stage 86 — hot paths", () => {
  it("render principal não cria estruturas transitórias", () => {
    const source = fs.readFileSync("src/engine/render/internal/ThreeRenderEngine.ts", "utf8");
    const render = methodBody(source, "public render(");
    expect(render).not.toMatch(/(^|[^A-Za-z])new\s+/u);
    expect(render).not.toContain(".map(");
    expect(render).not.toContain(".filter(");
    expect(render).not.toContain(".reduce(");
  });
});
