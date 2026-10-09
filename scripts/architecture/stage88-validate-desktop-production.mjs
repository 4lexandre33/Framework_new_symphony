#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";

const FOCUSED = Object.freeze([
  "tests/layer1-desktop-production-config.test.ts",
  "tests/layer1-desktop-production-lifecycle.test.ts",
  "tests/layer1-desktop-production-selftest.test.ts",
]);

const REGRESSION = Object.freeze([
  "tests/layer1-native-tauri-contract.test.ts",
  "tests/layer1-native-tauri-security.test.ts",
  "tests/layer1-steamworks-native-contract.test.ts",
  "tests/layer1-render-viewport-camera.test.ts",
  "tests/layer1-input-keyboard-mouse.test.ts",
]);

const REQUIRED = Object.freeze([
  "ETAPA86_AUTOMATED_PASS.json",
  "ETAPA87_AUTOMATED_PASS.json",
  "ETAPA88_MANIFEST.json",
  "LAYER1_DESKTOP_PRODUCTION_BASELINE_V1.json",
  "src-tauri/tauri.stage88.conf.json",
  "scripts/architecture/lib/layer1-desktop-production-v1.mjs",
  "scripts/architecture/stage88-audit-desktop-production.mjs",
  "scripts/architecture/stage88-validate-desktop-production.mjs",
  "scripts/architecture/stage88-finalize-desktop-production.mjs",
  "tests/run-stage88-release-smoke.mjs",
  "tests/run-stage88-windows-package-smoke.mjs",
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

  if (result.status !== 0) {
    fail(`${label} falhou com exit code ${String(result.status)}`);
  }
}

try {
  for (const relativePath of REQUIRED) {
    const full = path.join(ROOT, ...relativePath.split("/"));
    if (!fs.existsSync(full)) fail(`Arquivo Stage 88 ausente: ${relativePath}`);
  }

  run("STAGE88 SEMANTIC AUDIT", process.execPath, ["scripts/architecture/stage88-audit-desktop-production.mjs"]);
  run("STAGE88 FOCUSED 3 FILES / 9 TESTS", npx, ["vitest", "run", ...FOCUSED, "--no-file-parallelism"]);
  run("STAGE88 NATIVE REGRESSION", npx, ["vitest", "run", ...REGRESSION, "--no-file-parallelism"]);
  run("ARCHITECTURE", npm, ["run", "arch:check"]);
  run("TYPESCRIPT", npx, ["tsc", "--noEmit"]);
  run("VITEST FULL", npx, ["vitest", "run", "--no-file-parallelism"]);
  run("CARGO CHECK", cargo, ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("VITE BUILD", npm, ["run", "build"]);

  console.log("\n============================================================");
  console.log("STAGE 88 PREFLIGHT: PASS");
  console.log("Desktop / Steam production preflight certified");
  console.log("============================================================\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
