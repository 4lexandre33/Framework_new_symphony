// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "devbridge-prod-"));

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("DevBridge fora do bundle de produção (SPEC §5.4)", () => {
  it("vite build não contém devbridge/DevBridge em nenhum JS", () => {
    execFileSync(
      process.execPath,
      [join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
      { cwd: root, stdio: "pipe", timeout: 240_000, env: { ...process.env, NODE_ENV: "production" } },
    );
    const jsFiles = listFiles(outDir).filter((f) => /\.(m?js)$/.test(f));
    expect(jsFiles.length).toBeGreaterThan(0);
    const offenders = jsFiles.filter((f) => /devbridge|devtoken/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  }, 300_000);
});
