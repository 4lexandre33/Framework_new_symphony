#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "LAYER1_BASELINE_V1.json",
    "LAYER1_PUBLIC_API_BASELINE_V1.json",
    "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
    "LAYER1_LIFECYCLE_BASELINE_V1.json",
    "LAYER1_GAME_LOOP_BASELINE_V1.json",
    "LAYER1_RENDERING_BASELINE_V1.json",
    "LAYER1_PHYSICS_BASELINE_V1.json",
    "ETAPA77_MANIFEST.json",
    "scripts/architecture/stage77-audit-physics.mjs",
  ]);

const STAGE_78_REQUIRED =
  Object.freeze([
    "LAYER1_INPUT_BASELINE_V1.json",
    "ETAPA78_INPUT_RUNTIME.txt",
    "ETAPA78_MANIFEST.json",
    "ETAPA78_SHA256SUMS.txt",
    "src/engine/input/internal/KeyboardMouseDriver.ts",
    "src/engine/input/internal/GamepadDriver.ts",
    "src/engine/input/internal/InputManager.ts",
    "src/engine/input/internal/InputFramePump.ts",
    "src/plugins/input/plugin.ts",
    "src/debug/hud/InputDiagnostics.ts",
    "scripts/architecture/lib/layer1-input-v1.mjs",
    "scripts/architecture/stage78-audit-input.mjs",
    "scripts/architecture/stage78-validate-input.mjs",
    "tests/layer1-input-keyboard-mouse.test.ts",
    "tests/layer1-input-gamepad.test.ts",
    "tests/layer1-input-manager.test.ts",
    "tests/layer1-input-frame-pump.test.ts",
    "tests/layer1-input-plugin.test.ts",
    "tests/layer1-input-diagnostics.test.ts",
    "tests/layer1-input-selftest.test.ts",
  ]);

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function abs(
  relativePath,
) {
  return path.join(
    ROOT,
    ...relativePath.split(
      "/",
    ),
  );
}

function ensureFiles(
  paths,
  label,
) {
  for (
    const relativePath of
    paths
  ) {
    const target =
      abs(
        relativePath,
      );

    if (
      !fs.existsSync(
        target,
      ) ||
      !fs.statSync(
        target,
      ).isFile()
    ) {
      fail(
        `${label}: arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function assertNoStage79() {
  const forbidden =
    Object.freeze([
      "ETAPA79_MANIFEST.json",
      "ETAPA79_SHA256SUMS.txt",
      "LAYER1_ASSETS_STREAMING_BASELINE_V1.json",
      "scripts/architecture/stage79-audit-assets-streaming.mjs",
      "scripts/architecture/stage79-validate-assets-streaming.mjs",
      "tests/layer1-assets-streaming-runtime.test.ts",
    ]);

  const present =
    forbidden.filter(
      (relativePath) =>
        fs.existsSync(
          abs(
            relativePath,
          ),
        ),
    );

  if (
    present.length >
    0
  ) {
    fail(
      [
        "Etapa 79 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join(
        "\n",
      ),
    );
  }

  console.log(
    "[OK] Etapa 79 não foi antecipada.",
  );
}

function quoteCmdPart(
  value,
) {
  if (
    /^[A-Za-z0-9_./:@=-]+$/u.test(
      value,
    )
  ) {
    return value;
  }

  return `"${value.replace(
    /"/gu,
    '""',
  )}"`;
}

function spawnPortable(
  executable,
  args,
) {
  const options = {
    cwd:
      ROOT,
    encoding:
      "utf8",
    windowsHide:
      true,
    stdio: [
      "ignore",
      "pipe",
      "pipe",
    ],
    maxBuffer:
      128 * 1024 * 1024,
  };

  if (
    process.platform !==
      "win32"
  ) {
    return spawnSync(
      executable,
      args,
      options,
    );
  }

  const commandProcessor =
    process.env.ComSpec ??
    process.env.COMSPEC ??
    "C:\\Windows\\System32\\cmd.exe";

  const command =
    [
      executable,
      ...args,
    ]
      .map(
        quoteCmdPart,
      )
      .join(
        " ",
      );

  return spawnSync(
    commandProcessor,
    [
      "/d",
      "/s",
      "/c",
      command,
    ],
    options,
  );
}

function run(
  executable,
  args,
  label,
  markers = [],
) {
  console.log(
    `[RUN] ${executable} ${args.join(" ")}`,
  );

  const result =
    spawnPortable(
      executable,
      args,
    );

  const stdout =
    String(
      result.stdout ??
        "",
    );

  const stderr =
    String(
      result.stderr ??
        "",
    );

  if (
    stdout
  ) {
    process.stdout.write(
      stdout,
    );
  }

  if (
    stderr
  ) {
    process.stderr.write(
      stderr,
    );
  }

  if (
    result.error
  ) {
    throw result.error;
  }

  if (
    result.status !==
    0
  ) {
    fail(
      `${label} falhou com código ${String(result.status)}.`,
    );
  }

  for (
    const marker of
    markers
  ) {
    if (
      !stdout.includes(
        marker,
      )
    ) {
      fail(
        `${label} sem marcador esperado: ${marker}`,
      );
    }
  }

  console.log(
    `[OK] ${label}`,
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 78: INPUT RUNTIME",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71–77",
    );

    ensureFiles(
      STAGE_78_REQUIRED,
      "Etapa 78",
    );

    console.log(
      `[OK] Etapa 78: ${String(STAGE_78_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage79();

    console.log("");
    console.log(
      "=== STAGE 77 REGRESSION ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage77-audit-physics.mjs",
      ],
      "Stage 77",
      [
        "Violações Physics Runtime: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 78 INPUT AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage78-audit-input.mjs",
      ],
      "Input Audit",
      [
        "Input baseline: layer1-input-v1-stage78",
        "Explicit any keywords: 0",
        "KeyboardMouseDriver.update allocations: 0",
        "GamepadDriver.update allocations: 0",
        "InputManager.update allocations: 0",
        "InputFramePump.processFrame allocations: 0",
        "Public API unchanged: YES",
        "Standalone from game.loop: YES",
        "Violações Input Runtime: 0",
      ],
    );

    console.log("");
    console.log(
      "=== ARCHITECTURE CHECK ===",
    );

    run(
      "npm",
      [
        "run",
        "arch:check",
      ],
      "arch:check",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    console.log("");
    console.log(
      "=== TYPESCRIPT ===",
    );

    run(
      "npx",
      [
        "tsc",
        "--noEmit",
      ],
      "tsc",
    );

    console.log("");
    console.log(
      "=== TARGETED INPUT TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-input-keyboard-mouse.test.ts",
        "tests/layer1-input-gamepad.test.ts",
        "tests/layer1-input-manager.test.ts",
        "tests/layer1-input-frame-pump.test.ts",
        "tests/layer1-input-plugin.test.ts",
        "tests/layer1-input-diagnostics.test.ts",
        "tests/layer1-input-selftest.test.ts",
        "tests/input-system.test.ts",
        "tests/layer1-capability-graph.test.ts",
        "tests/layer1-lifecycle.test.ts",
        "tests/layer1-public-api.test.ts",
      ],
      "vitest Input Runtime",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "=== INPUT SMOKE ===",
    );

    run(
      "node",
      [
        "tests/input-smoke-test.mjs",
      ],
      "input smoke",
      [
        "Todos os requisitos da Camada de Input foram validados com sucesso",
      ],
    );

    console.log("");
    console.log(
      "=== FULL VITEST ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
      ],
      "vitest completo",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "=== CARGO CHECK ===",
    );

    run(
      "cargo",
      [
        "check",
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
      "cargo check",
    );

    console.log("");
    console.log(
      "=== BUILD ===",
    );

    run(
      "npm",
      [
        "run",
        "build",
      ],
      "build",
    );

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 78: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Public API game.input v1 permanece inalterada.",
    );
    console.log(
      "[OK] InputFramePump é o owner único do snapshot por RAF e inicia somente após kernel.booted.",
    );
    console.log(
      "[OK] game.input permanece independente de game.loop e funciona em aplicações desktop sem loop de jogo.",
    );
    console.log(
      "[OK] Keyboard/mouse preserva pressed/held/released e recupera focus-loss/visibility-loss.",
    );
    console.log(
      "[OK] Pointer Lock possui request/exit/teardown governados.",
    );
    console.log(
      "[OK] Gamepad possui pressed/held/released snapshots e polling único por frame.",
    );
    console.log(
      "[OK] Deadzone de gamepad permanece normalizada e finita.",
    );
    console.log(
      "[OK] InputActionEvent e InputDeviceChangedEvent são publicados pelo runtime.",
    );
    console.log(
      "[OK] InputDiagnostics é somente leitor e não avança snapshots.",
    );
    console.log(
      "[OK] KeyboardMouseDriver.update, GamepadDriver.update, InputManager.update e InputFramePump.processFrame possuem zero allocation literal/new explícita.",
    );
    console.log(
      "[OK] Zero explicit any no runtime de Input certificado.",
    );
    console.log(
      "[OK] Etapa 79 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 79 — Assets / Streaming / Terrain / Workers.",
    );
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 78: REPROVADA",
    );
    console.error(
      "============================================================",
    );
    console.error(
      error instanceof Error
        ? error.stack ??
          error.message
        : String(
            error,
          ),
    );

    process.exitCode =
      1;
  }
}

main();
