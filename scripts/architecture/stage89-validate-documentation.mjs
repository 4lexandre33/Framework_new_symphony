#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

const FOCUSED = Object.freeze([
  "tests/layer1-documentation-config.test.ts",
  "tests/layer1-documentation-selftest.test.ts",
]);

const REGRESSION = Object.freeze([
  "tests/layer1-desktop-production-config.test.ts",
  "tests/layer1-desktop-production-lifecycle.test.ts",
  "tests/layer1-desktop-production-selftest.test.ts",
]);

const REQUIRED = Object.freeze([
  "ETAPA88_AUTOMATED_PASS.json",
  "ETAPA89_MANIFEST.json",
  "LAYER1_DOCUMENTATION_BASELINE_V1.json",
  "scripts/architecture/lib/layer1-documentation-v1.mjs",
  "scripts/architecture/stage89-audit-documentation.mjs",
  "scripts/architecture/stage89-validate-documentation.mjs",
  "scripts/architecture/stage89-finalize-documentation.mjs",
  ...FOCUSED,
]);

function fail(message) {
  throw new Error(message);
}

function run(label, command, args) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: "1" },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) fail(`${label} falhou com exit code ${String(result.status)}`);
}

try {
  for (const relativePath of REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, ...relativePath.split("/")))) fail(`Arquivo Stage 89 ausente: ${relativePath}`);
  }

  run("STAGE89 DOCUMENTATION AUDIT", process.execPath, ["scripts/architecture/stage89-audit-documentation.mjs"]);
  run("STAGE89 FOCUSED", npx, ["vitest", "run", ...FOCUSED, "--no-file-parallelism"]);
  run("STAGE89 STAGE88 REGRESSION", npx, ["vitest", "run", ...REGRESSION, "--no-file-parallelism"]);
  run("ARCHITECTURE", npm, ["run", "arch:check"]);
  run("TYPESCRIPT", npx, ["tsc", "--noEmit"]);
  run("VITEST FULL", npx, ["vitest", "run", "--no-file-parallelism"]);
  run("CARGO CHECK", cargo, ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("VITE BUILD", npm, ["run", "build"]);

  console.log("\n============================================================");
  console.log("STAGE 89 PREFLIGHT: PASS");
  console.log("Layer 1 documentation validated against the code");
  console.log("============================================================\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
