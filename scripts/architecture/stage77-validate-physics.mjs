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
    "ETAPA76_MANIFEST.json",
    "scripts/architecture/stage76-audit-rendering.mjs",
  ]);

const STAGE_77_REQUIRED =
  Object.freeze([
    "LAYER1_PHYSICS_BASELINE_V1.json",
    "ETAPA77_PHYSICS_RUNTIME.txt",
    "ETAPA77_MANIFEST.json",
    "ETAPA77_SHA256SUMS.txt",
    "src/engine/physics/internal/PhysicsWorld.ts",
    "src/engine/physics/internal/PhysicsService.ts",
    "src/engine/physics/internal/RigidBodyFactory.ts",
    "src/engine/physics/internal/RaycasterQueries.ts",
    "src/engine/physics/internal/CollisionEventManager.ts",
    "src/plugins/physics/plugin.ts",
    "scripts/architecture/lib/layer1-physics-v1.mjs",
    "scripts/architecture/stage77-audit-physics.mjs",
    "scripts/architecture/stage77-validate-physics.mjs",
    "tests/layer1-physics-runtime.test.ts",
    "tests/layer1-physics-events.test.ts",
    "tests/layer1-physics-plugin.test.ts",
    "tests/layer1-physics-factory.test.ts",
    "tests/layer1-physics-selftest.test.ts",
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

function assertNoStage78() {
  const forbidden =
    Object.freeze([
      "ETAPA78_MANIFEST.json",
      "ETAPA78_SHA256SUMS.txt",
      "LAYER1_INPUT_BASELINE_V1.json",
      "scripts/architecture/stage78-audit-input.mjs",
      "scripts/architecture/stage78-validate-input.mjs",
      "tests/layer1-input-runtime.test.ts",
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
        "Etapa 78 encontrada antes da hora:",
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
    "[OK] Etapa 78 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 77: PHYSICS RUNTIME",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71–76",
    );

    ensureFiles(
      STAGE_77_REQUIRED,
      "Etapa 77",
    );

    console.log(
      `[OK] Etapa 77: ${String(STAGE_77_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage78();

    console.log("");
    console.log(
      "=== STAGE 76 REGRESSION ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage76-audit-rendering.mjs",
      ],
      "Stage 76",
      [
        "Violações Rendering Runtime: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 77 PHYSICS AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage77-audit-physics.mjs",
      ],
      "Physics Audit",
      [
        "Physics baseline: layer1-physics-v1-stage77",
        "Explicit any keywords: 0",
        "PhysicsWorld.step allocations: 0",
        "PhysicsService.stepForGameLoop allocations: 0",
        "syncMeshTransform allocations: 0",
        "Public API unchanged: YES",
        "GameTickPayload.deltaSeconds: YES",
        "Violações Physics Runtime: 0",
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
      "=== TARGETED PHYSICS TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-physics-runtime.test.ts",
        "tests/layer1-physics-events.test.ts",
        "tests/layer1-physics-plugin.test.ts",
        "tests/layer1-physics-factory.test.ts",
        "tests/layer1-physics-selftest.test.ts",
        "tests/physics-system.test.ts",
        "tests/layer1-game-loop.test.ts",
        "tests/layer1-lifecycle.test.ts",
        "tests/layer1-public-api.test.ts",
      ],
      "vitest Physics Runtime",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "=== PHYSICS SMOKE ===",
    );

    run(
      "node",
      [
        "tests/physics-smoke-test.mjs",
      ],
      "physics smoke",
      [
        "Todos os 8 arquivos",
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
      "  ETAPA 77: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Public API game.physics v1 permanece inalterada.",
    );
    console.log(
      "[OK] Physics plugin consome GameTickPayload.deltaSeconds sem fallback legado.",
    );
    console.log(
      "[OK] Rapier recebe exatamente o fixed timestep certificado pelo game.loop.",
    );
    console.log(
      "[OK] Timestep inválido é rejeitado em vez de sofrer clamp silencioso.",
    );
    console.log(
      "[OK] Collision/trigger events são classificados por sensor ownership.",
    );
    console.log(
      "[OK] Collision/trigger events do loop oficial são entregues serialmente antes do próximo fixed tick.",
    );
    console.log(
      "[OK] PhysicsWorld.step, stepForGameLoop e syncMeshTransform possuem zero allocation literal/new explícita.",
    );
    console.log(
      "[OK] Transform cache é separado por entityId.",
    );
    console.log(
      "[OK] Rigid body/collider descriptors são validados antes do WASM.",
    );
    console.log(
      "[OK] World/EventQueue WASM possuem teardown idempotente.",
    );
    console.log(
      "[OK] Zero explicit any no runtime de física certificado.",
    );
    console.log(
      "[OK] Etapa 78 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 78 — Input Runtime.",
    );
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 77: REPROVADA",
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
