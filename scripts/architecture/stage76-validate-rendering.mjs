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
    "ETAPA75_MANIFEST.json",
    "scripts/architecture/stage75-audit-game-loop.mjs",
  ]);

const STAGE_76_REQUIRED =
  Object.freeze([
    "LAYER1_RENDERING_BASELINE_V1.json",
    "ETAPA76_RENDERING_RUNTIME.txt",
    "ETAPA76_MANIFEST.json",
    "ETAPA76_SHA256SUMS.txt",
    "src/engine/render/internal/ViewportManager.ts",
    "src/engine/render/internal/CameraManager.ts",
    "src/engine/render/internal/SceneGraphManager.ts",
    "src/engine/render/internal/ThreeRenderEngine.ts",
    "src/plugins/render/plugin.ts",
    "scripts/architecture/lib/layer1-rendering-v1.mjs",
    "scripts/architecture/stage76-audit-rendering.mjs",
    "scripts/architecture/stage76-validate-rendering.mjs",
    "tests/layer1-render-viewport-camera.test.ts",
    "tests/layer1-render-scene.test.ts",
    "tests/layer1-render-engine.test.ts",
    "tests/layer1-render-plugin.test.ts",
    "tests/layer1-rendering-selftest.test.ts",
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

function assertNoStage77() {
  const forbidden =
    Object.freeze([
      "ETAPA77_MANIFEST.json",
      "ETAPA77_SHA256SUMS.txt",
      "LAYER1_PHYSICS_BASELINE_V1.json",
      "scripts/architecture/stage77-audit-physics.mjs",
      "scripts/architecture/stage77-validate-physics.mjs",
      "tests/layer1-physics-runtime.test.ts",
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
        "Etapa 77 encontrada antes da hora:",
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
    "[OK] Etapa 77 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 76: RENDERING RUNTIME",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71–75",
    );

    ensureFiles(
      STAGE_76_REQUIRED,
      "Etapa 76",
    );

    console.log(
      `[OK] Etapa 76: ${String(STAGE_76_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage77();

    console.log("");
    console.log(
      "=== STAGE 75 REGRESSION ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage75-audit-game-loop.mjs",
      ],
      "Stage 75",
      [
        "Violações Deterministic Game Loop: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 76 RENDERING AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage76-audit-rendering.mjs",
      ],
      "Rendering Audit",
      [
        "Rendering baseline: layer1-rendering-v1-stage76",
        "Explicit any keywords: 0",
        "render hot-path allocations: 0",
        "follow-camera hot-path allocations: 0",
        "Public API unchanged: YES",
        "Violações Rendering Runtime: 0",
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
      "=== TARGETED RENDER TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-render-viewport-camera.test.ts",
        "tests/layer1-render-scene.test.ts",
        "tests/layer1-render-engine.test.ts",
        "tests/layer1-render-plugin.test.ts",
        "tests/layer1-rendering-selftest.test.ts",
        "tests/layer1-game-loop.test.ts",
        "tests/layer1-game-loop-plugin.test.ts",
        "tests/layer1-lifecycle.test.ts",
        "tests/layer1-public-api.test.ts",
      ],
      "vitest Rendering Runtime",
      [
        "Test Files",
        "Tests",
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
      "  ETAPA 76: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Public API game.render v1 permanece inalterada.",
    );
    console.log(
      "[OK] Viewport normaliza dimensões e limita pixel ratio a 2.",
    );
    console.log(
      "[OK] WebGL context loss suspende render e restore reaplica state/viewport.",
    );
    console.log(
      "[OK] Context listeners são removidos no dispose.",
    );
    console.log(
      "[OK] Canvas externo é preservado; canvas owned é removido.",
    );
    console.log(
      "[OK] Renderer/scene/viewport disposal é idempotente.",
    );
    console.log(
      "[OK] Shared geometry/material/texture não sofre early dispose.",
    );
    console.log(
      "[OK] Camera follow usa scratch vectors sem allocation literal/new no hot path.",
    );
    console.log(
      "[OK] ThreeRenderEngine.render possui zero allocation literal/new explícita.",
    );
    console.log(
      "[OK] game.render.frame é publicado serialmente após o render.",
    );
    console.log(
      "[OK] game.render.resize é publicado em resize do viewport.",
    );
    console.log(
      "[OK] Zero explicit any no runtime de render certificado.",
    );
    console.log(
      "[OK] Etapa 77 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 77 — Physics Runtime.",
    );
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 76: REPROVADA",
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
