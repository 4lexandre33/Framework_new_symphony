#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const FOCUSED = Object.freeze([
  "tests/layer1-failure-kernel.test.ts",
  "tests/layer1-failure-render-input.test.ts",
  "tests/layer1-failure-assets-workers.test.ts",
  "tests/layer1-failure-network-storage.test.ts",
  "tests/layer1-failure-timeout-disposal.test.ts",
]);
const REGRESSION = Object.freeze([
  "tests/layer1-lifecycle.test.ts",
  "tests/layer1-render-engine.test.ts",
  "tests/layer1-input-keyboard-mouse.test.ts",
  "tests/layer1-assets-runtime.test.ts",
  "tests/layer1-terrain-workers.test.ts",
  "tests/layer1-networking-runtime.test.ts",
  "tests/layer1-storage-runtime.test.ts",
]);
const REQUIRED = Object.freeze([
  "ETAPA86_AUTOMATED_PASS.json",
  "ETAPA87_MANIFEST.json",
  "LAYER1_FAILURE_RECOVERY_BASELINE_V1.json",
  "scripts/architecture/lib/layer1-failure-recovery-v1.mjs",
  "scripts/architecture/stage87-audit-failure-recovery.mjs",
  "scripts/architecture/stage87-validate-failure-recovery.mjs",
  "scripts/architecture/stage87-finalize-failure-recovery.mjs",
  "tests/run-stage87-resilience-smoke.mjs",
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
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(`${label} falhou com exit code ${String(result.status)}`);
  }
}

try {
  for (const relativePath of REQUIRED) {
    const full = path.join(ROOT, ...relativePath.split("/"));
    if (!fs.existsSync(full)) fail(`Arquivo Stage 87 ausente: ${relativePath}`);
  }

  run("STAGE87 SEMANTIC AUDIT", process.execPath, ["scripts/architecture/stage87-audit-failure-recovery.mjs"]);
  run("STAGE87 RESILIENCE SMOKE", process.execPath, ["tests/run-stage87-resilience-smoke.mjs"]);
  run("STAGE87 FOCUSED 5 FILES / 10 TESTS", process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", ...FOCUSED, "--no-file-parallelism"]);
  run("STAGE87 REGRESSION RECOVERY OWNERS", process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", ...REGRESSION, "--no-file-parallelism"]);
  run("ARCHITECTURE", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "arch:check"]);
  run("TYPESCRIPT", process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"]);
  run("VITEST FULL", process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "--no-file-parallelism"]);
  run("CARGO CHECK", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("VITE BUILD", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);

  console.log("\n============================================================");
  console.log("ETAPA 87: PASS");
  console.log("Failure Recovery & Resilience certified");
  console.log("============================================================\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
