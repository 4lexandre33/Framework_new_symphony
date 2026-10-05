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
    "LAYER1_INPUT_BASELINE_V1.json",
    "ETAPA78_MANIFEST.json",
    "scripts/architecture/stage78-audit-input.mjs",
  ]);

const STAGE_79_REQUIRED =
  Object.freeze([
    "LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_V1.json",
    "ETAPA79_ASSETS_STREAMING_TERRAIN_WORKERS.txt",
    "ETAPA79_MANIFEST.json",
    "ETAPA79_SHA256SUMS.txt",

    "src/engine/assets/internal/AssetCache.ts",
    "src/engine/assets/internal/AssetsManagerService.ts",
    "src/engine/assets/internal/AudioLoaderService.ts",
    "src/engine/assets/internal/GLTFLoaderService.ts",
    "src/engine/assets/internal/TextureLoaderService.ts",
    "src/plugins/assets/plugin.ts",

    "src/engine/streaming/internal/StreamingService.ts",
    "src/engine/streaming/internal/StreamingWorkerPool.ts",
    "src/engine/streaming/internal/DistanceLODManager.ts",
    "src/engine/streaming/internal/HLODBuilder.ts",
    "src/engine/streaming/internal/WorldStreamingSectorManager.ts",
    "src/engine/streaming/internal/streaming.worker.ts",
    "src/plugins/streaming/plugin.ts",

    "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    "src/engine/terrain/internal/TerrainService.ts",
    "src/engine/terrain/internal/VoxelChunkManager.ts",
    "src/engine/terrain/internal/BiomeEvaluator.ts",
    "src/engine/terrain/internal/GreedyMesher.ts",
    "src/engine/terrain/internal/PerlinNoiseService.ts",
    "src/engine/terrain/internal/terrain.worker.ts",
    "src/plugins/terrain/plugin.ts",

    "scripts/architecture/lib/layer1-assets-streaming-terrain-v1.mjs",
    "scripts/architecture/stage79-audit-assets-streaming-terrain.mjs",
    "scripts/architecture/stage79-validate-assets-streaming-terrain.mjs",

    "tests/layer1-assets-runtime.test.ts",
    "tests/layer1-streaming-workers.test.ts",
    "tests/layer1-streaming-runtime.test.ts",
    "tests/layer1-terrain-workers.test.ts",
    "tests/layer1-terrain-runtime.test.ts",
    "tests/layer1-assets-streaming-terrain-selftest.test.ts",
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

function assertNoStage80() {
  const forbidden =
    Object.freeze([
      "ETAPA80_MANIFEST.json",
      "ETAPA80_SHA256SUMS.txt",
      "LAYER1_PRESENTATION_BASELINE_V1.json",
      "scripts/architecture/stage80-audit-presentation.mjs",
      "scripts/architecture/stage80-validate-presentation.mjs",
      "tests/layer1-presentation-runtime.test.ts",
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
        "Etapa 80 encontrada antes da hora:",
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
    "[OK] Etapa 80 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 79: ASSETS / STREAMING / TERRAIN / WORKERS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71–78",
    );

    ensureFiles(
      STAGE_79_REQUIRED,
      "Etapa 79",
    );

    console.log(
      `[OK] Etapa 79: ${String(STAGE_79_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage80();

    console.log("");
    console.log(
      "=== STAGE 78 REGRESSION ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage78-audit-input.mjs",
      ],
      "Stage 78",
      [
        "Violações Input Runtime: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 79 ASSETS / STREAMING / TERRAIN AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage79-audit-assets-streaming-terrain.mjs",
      ],
      "Stage 79 Audit",
      [
        "Stage 79 baseline: layer1-assets-streaming-terrain-v1-stage79",
        "Semantic runtime files: 21",
        "Explicit any keywords: 0",
        "StreamingService.update allocations: 0",
        "Sector update allocations: 0",
        "TerrainService.update allocations: 0",
        "Public APIs unchanged: YES",
        "Capability graph unchanged: YES",
        "Violações Assets/Streaming/Terrain: 0",
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
      "=== TARGETED STAGE 79 TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-assets-runtime.test.ts",
        "tests/layer1-streaming-workers.test.ts",
        "tests/layer1-streaming-runtime.test.ts",
        "tests/layer1-terrain-workers.test.ts",
        "tests/layer1-terrain-runtime.test.ts",
        "tests/layer1-assets-streaming-terrain-selftest.test.ts",
        "tests/assets-pipeline.test.ts",
        "tests/streaming-system.test.ts",
        "tests/terrain-system.test.ts",
      ],
      "vitest Stage 79",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "=== ASSETS SMOKE ===",
    );

    run(
      "node",
      [
        "tests/assets-smoke-test.mjs",
      ],
      "assets smoke",
      [
        "Todos os requisitos da Camada de Assets Pipeline foram validados com sucesso",
      ],
    );

    console.log("");
    console.log(
      "=== STREAMING SMOKE ===",
    );

    run(
      "node",
      [
        "tests/streaming-smoke-test.mjs",
      ],
      "streaming smoke",
      [
        "Camada game.streaming íntegra",
      ],
    );

    console.log("");
    console.log(
      "=== TERRAIN SMOKE ===",
    );

    run(
      "node",
      [
        "tests/terrain-smoke-test.mjs",
      ],
      "terrain smoke",
      [
        "Camada game.terrain íntegra e conectada ao Microkernel",
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
      "  ETAPA 79: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Public APIs game.assets, game.streaming e game.terrain v1 permanecem inalteradas.",
    );
    console.log(
      "[OK] Capability graph da Etapa 73 permanece inalterado.",
    );
    console.log(
      "[OK] Assets deduplica loads concorrentes e preserva refCount por consumidor.",
    );
    console.log(
      "[OK] AssetProgressEvent e AssetLoadedEvent são publicados pelo runtime.",
    );
    console.log(
      "[OK] AssetCache evita double-dispose de recursos GLTF compartilhados.",
    );
    console.log(
      "[OK] AudioContext possui teardown governado.",
    );
    console.log(
      "[OK] Streaming Worker jobs sempre finalizam por resposta ou fallback.",
    );
    console.log(
      "[OK] StreamingService.clear é reutilizável e dispose encerra Workers.",
    );
    console.log(
      "[OK] Terrain requestChunk usa ProceduralWorkerPool sem alterar TerrainApi.",
    );
    console.log(
      "[OK] Terrain ignora respostas Worker obsoletas após unload/clear/setSeed.",
    );
    console.log(
      "[OK] VoxelChunkManager valida ChunkDataMatrix antes de instalar resposta Worker.",
    );
    console.log(
      "[OK] Worker pools encerram resources e jobs no teardown.",
    );
    console.log(
      "[OK] Hot paths certificados possuem zero allocation literal/new explícita.",
    );
    console.log(
      "[OK] Zero explicit any nos 21 arquivos de runtime certificados.",
    );
    console.log(
      "[OK] Etapa 80 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 80 — Presentation Systems.",
    );
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 79: REPROVADA",
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
