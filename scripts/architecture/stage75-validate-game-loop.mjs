#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED = Object.freeze([
  "LAYER1_BASELINE_V1.json",
  "LAYER1_PUBLIC_API_BASELINE_V1.json",
  "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
  "LAYER1_LIFECYCLE_BASELINE_V1.json",
  "ETAPA74_MANIFEST.json",
  "scripts/architecture/stage74-audit-lifecycle.mjs",
]);

const STAGE_REQUIRED = Object.freeze([
  "LAYER1_GAME_LOOP_BASELINE_V1.json",
  "ETAPA75_DETERMINISTIC_GAME_LOOP.txt",
  "ETAPA75_MANIFEST.json",
  "ETAPA75_SHA256SUMS.txt",
  "src/engine/game-loop/internal/DeterministicGameLoop.ts",
  "scripts/architecture/lib/layer1-game-loop-v1.mjs",
  "scripts/architecture/stage75-audit-game-loop.mjs",
  "scripts/architecture/stage75-validate-game-loop.mjs",
  "tests/layer1-game-loop.test.ts",
  "tests/layer1-game-loop-selftest.test.ts",
  "tests/layer1-game-loop-plugin.test.ts",
]);

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function ensureFiles(paths, label) {
  for (const relativePath of paths) {
    const target = abs(relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      fail(`${label}: arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function assertNoStage76() {
  const forbidden = [
    "ETAPA76_MANIFEST.json",
    "ETAPA76_SHA256SUMS.txt",
    "scripts/architecture/stage76-audit-rendering-runtime.mjs",
    "scripts/architecture/stage76-validate-rendering-runtime.mjs",
    "tests/layer1-rendering-runtime.test.ts",
  ];

  const present = forbidden.filter((relativePath) => fs.existsSync(abs(relativePath)));
  if (present.length > 0) {
    fail(["Etapa 76 encontrada antes da hora:", ...present.map((value) => `- ${value}`)].join("\n"));
  }

  console.log("[OK] Etapa 76 não foi antecipada.");
}

function quoteCmdPart(value) {
  return /^[A-Za-z0-9_./:@=-]+$/u.test(value)
    ? value
    : `"${value.replace(/"/gu, '""')}"`;
}

function spawnPortable(executable, args) {
  const options = {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  };

  if (process.platform !== "win32") {
    return spawnSync(executable, args, options);
  }

  const commandProcessor = process.env.ComSpec ?? process.env.COMSPEC ?? "C:\\Windows\\System32\\cmd.exe";
  const command = [executable, ...args].map(quoteCmdPart).join(" ");
  return spawnSync(commandProcessor, ["/d", "/s", "/c", command], options);
}

function run(executable, args, label, markers = []) {
  console.log(`[RUN] ${executable} ${args.join(" ")}`);
  const result = spawnPortable(executable, args);
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${label} falhou com código ${String(result.status)}.`);
  for (const marker of markers) {
    if (!stdout.includes(marker)) fail(`${label} sem marcador esperado: ${marker}`);
  }
  console.log(`[OK] ${label}`);
}

try {
  console.log("============================================================");
  console.log("  PROJETO1 — ETAPA 75: DETERMINISTIC GAME LOOP");
  console.log("============================================================");

  ensureFiles(PREVIOUS_REQUIRED, "pré-condições Stage 71–74");
  ensureFiles(STAGE_REQUIRED, "Etapa 75");
  assertNoStage76();

  console.log("\n=== REGRESSÃO LIFECYCLE ===");
  run(
    "node",
    ["scripts/architecture/stage74-audit-lifecycle.mjs"],
    "Stage 74 Lifecycle",
    ["Violações Lifecycle / Boot / Shutdown: 0"],
  );

  console.log("\n=== STAGE 75 GAME LOOP AUDIT ===");
  run(
    "node",
    ["scripts/architecture/stage75-audit-game-loop.mjs"],
    "Deterministic Game Loop Audit",
    [
      "Game loop baseline: layer1-game-loop-v1-stage75",
      "Default tick rate: 60",
      "Tick rate range: 1..240",
      "Max frame delta: 0.25s",
      "Max fixed steps/frame: 60",
      "fire-and-forget emit calls: 0",
      "Hot-path allocations: 0",
      "RAF serialized after frame completion: YES",
      "Violações Deterministic Game Loop: 0",
    ],
  );

  console.log("\n=== ARCHITECTURE CHECK ===");
  run(
    "npm",
    ["run", "arch:check"],
    "arch:check",
    ["Violações de boundary: 0", "Violações do grafo: 0"],
  );

  console.log("\n=== TYPESCRIPT ===");
  run("npx", ["tsc", "--noEmit"], "tsc");

  console.log("\n=== TARGETED GAME LOOP TESTS ===");
  run(
    "npx",
    [
      "vitest",
      "run",
      "tests/layer1-game-loop.test.ts",
      "tests/layer1-game-loop-selftest.test.ts",
      "tests/layer1-game-loop-plugin.test.ts",
      "tests/layer1-lifecycle.test.ts",
      "tests/layer1-capability-graph.test.ts",
      "tests/layer1-public-api.test.ts",
      "tests/layer1-baseline.test.ts",
    ],
    "vitest game loop",
    ["Test Files", "Tests"],
  );

  console.log("\n=== SUÍTE COMPLETA ===");
  run("npx", ["vitest", "run"], "vitest completo", ["Test Files", "Tests"]);

  console.log("\n=== CARGO CHECK ===");
  run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"], "cargo check");

  console.log("\n=== BUILD ===");
  run("npm", ["run", "build"], "build");

  console.log("\n============================================================");
  console.log("  ETAPA 75: PASS");
  console.log("============================================================");
  console.log("[OK] Fixed timestep e accumulator determinísticos certificados.");
  console.log("[OK] Interpolation alpha permanece em 0 <= alpha < 1.");
  console.log("[OK] Frame delta clampado em 250ms.");
  console.log("[OK] Máximo de 60 fixed steps por frame governado.");
  console.log("[OK] Tick rate aceita somente valores finitos entre 1 e 240.");
  console.log("[OK] Pause/resume não acumula wall-clock catch-up.");
  console.log("[OK] Timestamps inválidos/regressivos não contaminam accumulator/alpha.");
  console.log("[OK] Tick/render dispatch é serial via emitAsync.");
  console.log("[OK] Próximo RAF só é agendado após conclusão do frame atual.");
  console.log("[OK] processFrame possui zero object/array/new allocation explícita.");
  console.log("[OK] Payloads tick/render são reutilizados no hot path.");
  console.log("[OK] game.loop inicia somente após kernel.booted e cancela RAF no dispose.");
  console.log("[OK] Public API da Etapa 72 permanece inalterada.");
  console.log("[OK] Etapa 76 não foi antecipada.");
  console.log("[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.");
  console.log("[INFO] Próxima etapa: 76 — Rendering Runtime.");
} catch (error) {
  console.error("\n============================================================");
  console.error("  ETAPA 75: REPROVADA");
  console.error("============================================================");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
