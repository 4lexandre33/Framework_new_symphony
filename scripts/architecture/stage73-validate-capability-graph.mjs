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
    "ETAPA71_MANIFEST.json",
    "ETAPA72_MANIFEST.json",
    "scripts/architecture/lib/layer1-baseline-v1.mjs",
    "scripts/architecture/lib/layer1-public-api-v1.mjs",
  ]);

const STAGE_73_REQUIRED =
  Object.freeze([
    "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
    "ETAPA73_PLUGIN_MANIFESTS_CAPABILITY_GRAPH.txt",
    "ETAPA73_MANIFEST.json",
    "ETAPA73_SHA256SUMS.txt",
    "scripts/architecture/check-dependencies.mjs",
    "scripts/architecture/lib/layer1-capability-graph-v1.mjs",
    "scripts/architecture/stage73-audit-capability-graph.mjs",
    "scripts/architecture/stage73-validate-capability-graph.mjs",
    "tests/layer1-capability-graph.test.ts",
    "tests/layer1-capability-graph-selftest.test.ts",
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

function assertNoStage74() {
  const forbidden =
    Object.freeze([
      "ETAPA74_MANIFEST.json",
      "ETAPA74_SHA256SUMS.txt",
      "scripts/architecture/stage74-audit-lifecycle.mjs",
      "scripts/architecture/stage74-validate-lifecycle.mjs",
      "tests/layer1-lifecycle.test.ts",
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
        "Etapa 74 encontrada antes da hora:",
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
    "[OK] Etapa 74 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 73: PLUGIN MANIFESTS & CAPABILITY GRAPH",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71/72",
    );

    console.log(
      `[OK] Pré-condições 71/72: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_73_REQUIRED,
      "Etapa 73",
    );

    console.log(
      `[OK] Etapa 73: ${String(STAGE_73_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage74();

    console.log("");
    console.log(
      "=== STAGE 71 BASELINE ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage71-audit-layer1-baseline.mjs",
      ],
      "Layer 1 Baseline",
      [
        "Violações da baseline Layer 1: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 72 PUBLIC API ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage72-audit-public-apis.mjs",
      ],
      "Public API Audit",
      [
        "Violações Public API / Contracts / Tokens: 0",
      ],
    );

    console.log("");
    console.log(
      "=== STAGE 73 CAPABILITY GRAPH ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage73-audit-capability-graph.mjs",
      ],
      "Capability Graph Audit",
      [
        "Graph baseline: layer1-capability-graph-v1-stage73",
        "Cycles: 0",
        "Provider ambiguities: 0",
        "Registry-derived canonical count: YES",
        "New registered plugins allowed: YES",
        "Violações Plugin Manifests / Capability Graph: 0",
      ],
    );

    console.log("");
    console.log(
      "=== DEPENDENCY CHECKER ===",
    );

    run(
      "node",
      [
        "scripts/architecture/check-dependencies.mjs",
      ],
      "check-dependencies",
      [
        "Violações do grafo: 0",
        "Boot order calculável: sim",
        "Provider priority preservada; nenhum empate ambíguo.",
        "Nenhum arquivo foi criado, removido, movido ou reescrito.",
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
      [
        "ARCHITECTURE SMOKE: PASS",
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
      "=== TESTES ETAPA 73 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-capability-graph.test.ts",
        "tests/layer1-capability-graph-selftest.test.ts",
        "tests/layer1-public-api.test.ts",
        "tests/layer1-baseline.test.ts",
      ],
      "vitest Etapa 73",
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
      "  ETAPA 73: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Plugin manifests ativos certificados estaticamente.",
    );
    console.log(
      "[OK] 23 módulos canônicos atuais + tooling ativo permanecem coerentes.",
    );
    console.log(
      "[OK] Canonical/tooling/experimental são derivados do module-map, sem limite permanente 23.",
    );
    console.log(
      "[OK] Provides/consumes/conflicts/semver/provider priority certificados.",
    );
    console.log(
      "[OK] Requirements obrigatórios e opcionais resolvem corretamente.",
    );
    console.log(
      "[OK] dependsOn válido e boot order calculável.",
    );
    console.log(
      "[OK] Zero ciclos e zero provider ambiguity.",
    );
    console.log(
      "[OK] PluginKind rules permanecem compatíveis com o Kernel.",
    );
    console.log(
      "[OK] game.steam.net permanece secondary capability pública dormente, sem falsa implementação.",
    );
    console.log(
      "[OK] check-dependencies permanece estritamente read-only.",
    );
    console.log(
      "[OK] Novos plugins/capabilities registrados continuam permitidos com recertificação.",
    );
    console.log(
      "[OK] Etapa 74 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 74 — Lifecycle / Boot / Shutdown.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 73: REPROVADA",
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
