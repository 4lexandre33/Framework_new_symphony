#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REQUIRED = Object.freeze([
  "ETAPA85_AUTOMATED_PASS.json",
  "ETAPA86_MANIFEST.json",
  "LAYER1_PERFORMANCE_RESOURCE_BASELINE_V1.json",
  "scripts/architecture/lib/layer1-performance-lifecycle-v1.mjs",
  "scripts/architecture/stage86-audit-performance-lifecycle.mjs",
  "scripts/architecture/stage86-validate-performance-lifecycle.mjs",
  "scripts/architecture/stage86-finalize-performance-lifecycle.mjs",
  "tests/layer1-performance-resource-lifecycle.test.ts",
  "tests/layer1-performance-hotpaths.test.ts",
  "tests/run-stage86-performance-smoke.mjs"
]);

function fail(message) { throw new Error(message); }
function run(label, command, args) {
  console.log(`\n===== ${label} =====`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`${label} falhou com exit code ${String(result.status)}`);
}

try {
  for (const relativePath of REQUIRED) {
    const full = path.join(ROOT, ...relativePath.split("/"));
    if (!fs.existsSync(full)) fail(`Arquivo Stage 86 ausente: ${relativePath}`);
  }
  run("STAGE86 SEMANTIC AUDIT", process.execPath, ["scripts/architecture/stage86-audit-performance-lifecycle.mjs"]);
  run("STAGE86 PERFORMANCE SMOKE", process.execPath, ["tests/run-stage86-performance-smoke.mjs"]);
  run("STAGE86 FOCUSED TESTS", process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "tests/layer1-performance-resource-lifecycle.test.ts", "tests/layer1-performance-hotpaths.test.ts"]);
  run("ARCHITECTURE", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "arch:check"]);
  run("TYPESCRIPT", process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "--noEmit"]);
  run("VITEST FULL", process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "--no-file-parallelism"]);
  run("CARGO CHECK", "cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
  run("VITE BUILD", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
  console.log("\n============================================");
  console.log("ETAPA 86: PASS");
  console.log("Performance & Resource Lifecycle certified");
  console.log("============================================\n");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
