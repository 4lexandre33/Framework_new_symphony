#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const REQUIRED = Object.freeze([
  "LAYER1_STEAMWORKS_BASELINE_V1.json",
  "ETAPA84_STEAMWORKS_INTEGRATION.txt",
  "ETAPA84_MANIFEST.json",
  "ETAPA84_SHA256SUMS.txt",
  "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
  "scripts/architecture/lib/layer1-steamworks-v1.mjs",
  "scripts/architecture/stage84-audit-steamworks.mjs",
  "scripts/architecture/stage84-validate-steamworks.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/src/steam.rs",
  "src-tauri/src/lib.rs",
  "src/engine/steam/internal/SteamBridgeService.ts",
  "src/plugins/steam/plugin.ts",
  "src/plugins/net/plugin.ts",
  "tests/layer1-steamworks-native-contract.test.ts",
  "tests/layer1-steamworks-selftest.test.ts",
  "tests/steam-integration.test.ts",
  "tests/steam-smoke-test.mjs",
  "tests/steam-p2p-smoke.mjs",
]);

function fail(message) {
  throw new Error(message);
}

function ensureFiles() {
  for (const relativePath of REQUIRED) {
    const target = path.join(ROOT, ...relativePath.split("/"));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      fail(`Arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function quote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/u.test(value)) return value;
  return `"${value.replace(/"/gu, '""')}"`;
}

function run(executable, args, label) {
  const options = {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  };

  const result = process.platform === "win32"
    ? spawnSync(
        process.env.ComSpec ?? process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/c", [executable, ...args].map(quote).join(" ")],
        options,
      )
    : spawnSync(executable, args, options);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${label} falhou com exit code ${String(result.status)}`);
  console.log(`[OK] ${label}`);
}

try {
  ensureFiles();
  console.log("============================================================");
  console.log(" ETAPA 84 — STEAMWORKS INTEGRATION VALIDATOR v3");
  console.log(" Reference snapshot: Projeto1_106");
  console.log("============================================================");

  run("node", ["scripts/architecture/stage84-audit-steamworks.mjs"], "Stage84 semantic audit");
  run("node", ["scripts/architecture/stage72-audit-public-apis.mjs"], "Stage72 public API regression");
  run("node", ["scripts/architecture/stage73-audit-capability-graph.mjs"], "Stage73 capability graph regression");
  run("node", ["scripts/architecture/stage74-audit-lifecycle.mjs"], "Stage74 lifecycle regression");
  run("node", ["scripts/architecture/stage83-audit-networking.mjs"], "Stage83 networking regression");
  run("npm", ["run", "arch:check"], "Architecture boundaries/dependencies");
  run("node", ["tests/steam-smoke-test.mjs"], "Steam smoke");
  run("node", ["tests/steam-p2p-smoke.mjs"], "Steam P2P smoke");
  run("npx", ["tsc", "--noEmit"], "TypeScript");
  run(
    "npx",
    [
      "vitest",
      "run",
      "tests/steam-integration.test.ts",
      "tests/layer1-steamworks-native-contract.test.ts",
      "tests/layer1-steamworks-selftest.test.ts",
    ],
    "Focused Steamworks Vitest",
  );
  run("npx", ["vitest", "run"], "Vitest full");
  run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"], "Cargo check");
  run("npm", ["run", "build"], "Production web build");

  console.log("============================================================");
  console.log(" ETAPA 84: PASS");
  console.log("============================================================");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error("ETAPA 84: FAIL");
  process.exitCode = 1;
}
