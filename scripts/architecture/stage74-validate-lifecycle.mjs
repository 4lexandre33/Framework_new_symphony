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
    "ETAPA71_MANIFEST.json",
    "ETAPA72_MANIFEST.json",
    "ETAPA73_MANIFEST.json",
    "scripts/architecture/stage73-audit-capability-graph.mjs",
  ]);

const STAGE_74_REQUIRED =
  Object.freeze([
    "LAYER1_LIFECYCLE_BASELINE_V1.json",
    "ETAPA74_LAYER1_LIFECYCLE.txt",
    "ETAPA74_MANIFEST.json",
    "ETAPA74_SHA256SUMS.txt",
    "src/core/runtime/boot.ts",
    "src/core/runtime/stop.ts",
    "scripts/architecture/lib/layer1-lifecycle-v1.mjs",
    "scripts/architecture/stage74-audit-lifecycle.mjs",
    "scripts/architecture/stage74-validate-lifecycle.mjs",
    "tests/layer1-lifecycle.test.ts",
    "tests/layer1-lifecycle-selftest.test.ts",
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

function assertNoStage75() {
  const forbidden =
    Object.freeze([
      "ETAPA75_MANIFEST.json",
      "ETAPA75_SHA256SUMS.txt",
      "scripts/architecture/stage75-audit-game-loop.mjs",
      "scripts/architecture/stage75-validate-game-loop.mjs",
      "tests/layer1-game-loop.test.ts",
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
        "Etapa 75 encontrada antes da hora:",
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
    "[OK] Etapa 75 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 74: LIFECYCLE / BOOT / SHUTDOWN",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71–73",
    );

    ensureFiles(
      STAGE_74_REQUIRED,
      "Etapa 74",
    );

    console.log(
      `[OK] Etapa 74: ${String(STAGE_74_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage75();

    console.log("");
    console.log(
      "=== REGRESSÕES 71–73 ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage71-audit-layer1-baseline.mjs",
      ],
      "Stage 71",
      [
        "Violações da baseline Layer 1: 0",
      ],
    );

    run(
      "node",
      [
        "scripts/architecture/stage72-audit-public-apis.mjs",
      ],
      "Stage 72",
      [
        "Violações Public API / Contracts / Tokens: 0",
      ],
    );

    run(
      "node",
      [
        "scripts/architecture/stage73-audit-capability-graph.mjs",
      ],
      "Stage 73",
      [
        "Violações Plugin Manifests / Capability Graph: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 74 LIFECYCLE AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage74-audit-lifecycle.mjs",
      ],
      "Lifecycle Audit",
      [
        "Lifecycle baseline: layer1-lifecycle-v1-stage74",
        "Kernel instance single-use: YES",
        "Controlled restart uses fresh Kernel: YES",
        "Violações Lifecycle / Boot / Shutdown: 0",
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
      "=== TARGETED LIFECYCLE TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-lifecycle.test.ts",
        "tests/layer1-lifecycle-selftest.test.ts",
        "src/core/runtime/inverse-shutdown.test.ts",
        "src/core/runtime/hardening-failures.test.ts",
        "src/core/internal/boot-order.test.ts",
        "tests/layer1-capability-graph.test.ts",
        "tests/layer1-public-api.test.ts",
        "tests/layer1-baseline.test.ts",
      ],
      "vitest lifecycle",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "=== SUÍTE COMPLETA ===",
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
      "  ETAPA 74: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Boot failure executa rollback automático antes de rejeitar.",
    );
    console.log(
      "[OK] Erro original do boot permanece autoridade da falha.",
    );
    console.log(
      "[OK] Rollback e shutdown seguem ordem inversa do boot.",
    );
    console.log(
      "[OK] lifecycleHooks.onStop roda somente para plugins started.",
    );
    console.log(
      "[OK] Disposers/resources são removidos após falha parcial.",
    );
    console.log(
      "[OK] Readiness timeout não deixa pending plugin parcialmente vivo.",
    );
    console.log(
      "[OK] tolerant=true quarentena plugins falhos.",
    );
    console.log(
      "[OK] stop/dispose permanecem idempotentes.",
    );
    console.log(
      "[OK] Kernel instance é single-use; restart controlado usa nova instância.",
    );
    console.log(
      "[OK] Todos os plugins ativos sinalizam lifecycle.ready() exatamente uma vez.",
    );
    console.log(
      "[OK] Baseline lifecycle permanece extensível para novas capabilities registradas.",
    );
    console.log(
      "[OK] Etapa 75 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 75 — Deterministic Game Loop.",
    );
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 74: REPROVADA",
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
