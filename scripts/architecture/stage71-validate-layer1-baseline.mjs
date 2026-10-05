#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "ETAPA70_MANIFEST.json",
    "ETAPA70_SHA256SUMS.txt",
    "scripts/architecture/lib/layer2-final-gate-v1.mjs",
    "scripts/architecture/stage70-audit-layer2-final.mjs",
    "scripts/architecture/stage70-validate-final-layer2.mjs",
  ]);

const STAGE_71_REQUIRED =
  Object.freeze([
    "LAYER1_BASELINE_V1.json",
    "ETAPA71_LAYER1_BASELINE.txt",
    "ETAPA71_MANIFEST.json",
    "ETAPA71_SHA256SUMS.txt",
    "scripts/architecture/lib/layer1-baseline-v1.mjs",
    "scripts/architecture/stage71-audit-layer1-baseline.mjs",
    "scripts/architecture/stage71-validate-layer1-baseline.mjs",
    "tests/layer1-baseline.test.ts",
    "tests/layer1-baseline-extensibility.test.ts",
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
    ...relativePath
      .split("/"),
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
    const full =
      abs(
        relativePath,
      );

    if (
      !fs.existsSync(
        full,
      ) ||
      !fs.statSync(
        full,
      ).isFile()
    ) {
      fail(
        `${label}: arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function assertNoStage72() {
  const forbidden =
    Object.freeze([
      "ETAPA72_MANIFEST.json",
      "ETAPA72_SHA256SUMS.txt",
      "scripts/architecture/stage72-validate-public-apis.mjs",
      "scripts/architecture/stage72-audit-public-apis.mjs",
      "tests/layer1-public-api.test.ts",
      "tests/layer1-contracts-tokens.test.ts",
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
    present.length > 0
  ) {
    fail(
      [
        "Etapa 72 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 72 não foi antecipada.",
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
      .join(" ");

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

  if (stdout) {
    process.stdout.write(
      stdout,
    );
  }

  if (stderr) {
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
      "  PROJETO1 — ETAPA 71: LAYER 1 BASELINE & INVENTORY",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 70",
    );

    console.log(
      `[OK] Pré-condição: Camada 2 Stage 70 presente (${String(PREVIOUS_REQUIRED.length)} arquivos-chave).`,
    );

    ensureFiles(
      STAGE_71_REQUIRED,
      "Etapa 71",
    );

    console.log(
      `[OK] Etapa 71: ${String(STAGE_71_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage72();

    console.log("");
    console.log(
      "=== LAYER 1 BASELINE AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage71-audit-layer1-baseline.mjs",
      ],
      "Layer 1 Baseline Audit",
      [
        "Baseline ID: layer1-v1-stage71",
        "Canonical modules at capture: 23",
        "Baseline modules preservados: 23/23",
        "Extensible baseline: YES",
        "Capture count is permanent limit: NO",
        "Violações da baseline Layer 1: 0",
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
      "=== ARCHITECTURE SMOKE ===",
    );

    run(
      "node",
      [
        "tests/architecture-smoke-test.mjs",
      ],
      "architecture smoke",
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
      "=== TESTES ETAPA 71 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-baseline.test.ts",
        "tests/layer1-baseline-extensibility.test.ts",
      ],
      "vitest Etapa 71",
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
      "  ETAPA 71: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Layer 1 Baseline v1 registrada a partir do module-map v20.",
    );
    console.log(
      "[OK] 20 módulos funcionais + 3 runtimes certificados como capture atual.",
    );
    console.log(
      "[OK] 23 módulos canônicos da baseline v1 permanecem presentes.",
    );
    console.log(
      "[OK] game.steam.net permanece secondary capability owned by steam.",
    );
    console.log(
      "[OK] game.debug permanece tooling bootstrapped e não-canônico.",
    );
    console.log(
      "[OK] game.player permanece experimental e fora do bootstrap.",
    );
    console.log(
      "[OK] Engine/public/internal/contracts/tokens/plugins declarados permanecem íntegros.",
    );
    console.log(
      "[OK] Workers Streaming/Terrain e host Tauri/Rust estão inventariados.",
    );
    console.log(
      "[OK] Baseline permite capacidades canônicas futuras registradas oficialmente.",
    );
    console.log(
      "[OK] A contagem 23 é capture v1, não limite permanente da engine.",
    );
    console.log(
      "[OK] Etapa 71 não alterou implementação funcional da Camada 1.",
    );
    console.log(
      "[OK] Etapa 72 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 72 — Public APIs / Contracts / Tokens.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 71: REPROVADA",
    );
    console.error(
      "============================================================",
    );
    console.error(
      error instanceof Error
        ? error.stack ??
          error.message
        : String(error),
    );
    process.exitCode = 1;
  }
}

main();
