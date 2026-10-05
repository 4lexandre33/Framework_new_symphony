#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "LAYER1_BASELINE_V1.json",
    "ETAPA71_MANIFEST.json",
    "ETAPA71_SHA256SUMS.txt",
    "scripts/architecture/lib/layer1-baseline-v1.mjs",
    "scripts/architecture/stage71-audit-layer1-baseline.mjs",
  ]);

const STAGE_72_REQUIRED =
  Object.freeze([
    "LAYER1_PUBLIC_API_BASELINE_V1.json",
    "ETAPA72_PUBLIC_APIS_CONTRACTS_TOKENS.txt",
    "ETAPA72_MANIFEST.json",
    "ETAPA72_SHA256SUMS.txt",
    "scripts/architecture/lib/layer1-public-api-v1.mjs",
    "scripts/architecture/stage72-audit-public-apis.mjs",
    "scripts/architecture/stage72-validate-public-apis.mjs",
    "tests/layer1-public-api.test.ts",
    "tests/layer1-public-api-selftest.test.ts",
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

function assertNoStage73() {
  const forbidden =
    Object.freeze([
      "ETAPA73_MANIFEST.json",
      "ETAPA73_SHA256SUMS.txt",
      "scripts/architecture/stage73-audit-capability-graph.mjs",
      "scripts/architecture/stage73-validate-capability-graph.mjs",
      "tests/layer1-capability-graph.test.ts",
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
        "Etapa 73 encontrada antes da hora:",
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
    "[OK] Etapa 73 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 72: PUBLIC APIs / CONTRACTS / TOKENS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições Stage 71",
    );

    console.log(
      `[OK] Pré-condição Stage 71: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_72_REQUIRED,
      "Etapa 72",
    );

    console.log(
      `[OK] Etapa 72: ${String(STAGE_72_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage73();

    console.log("");
    console.log(
      "=== STAGE 71 BASELINE ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage71-audit-layer1-baseline.mjs",
      ],
      "Layer 1 Baseline Audit",
      [
        "Baseline modules preservados: 23/23",
        "Violações da baseline Layer 1: 0",
      ],
    );

    console.log("");
    console.log(
      "=== PUBLIC API / CONTRACTS / TOKENS ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage72-audit-public-apis.mjs",
      ],
      "Public API Audit",
      [
        "API baseline: layer1-public-api-v1-stage72",
        "Public facades: 23",
        "Contracts: 24",
        "Tokens: 24",
        "Secondary capabilities: 1",
        "Violações Public API / Contracts / Tokens: 0",
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
      "=== TESTES ETAPA 72 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/layer1-public-api.test.ts",
        "tests/layer1-public-api-selftest.test.ts",
        "tests/layer1-baseline.test.ts",
        "tests/layer1-baseline-extensibility.test.ts",
      ],
      "vitest Etapa 72",
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
      "  ETAPA 72: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] 23 public facades canônicas certificadas.",
    );
    console.log(
      "[OK] 24 contracts públicos certificados.",
    );
    console.log(
      "[OK] 24 capability tokens certificados.",
    );
    console.log(
      "[OK] game.steam.net permanece secondary capability explícita.",
    );
    console.log(
      "[OK] Public facades exportam somente contracts/tokens declarados.",
    );
    console.log(
      "[OK] Zero internal/plugin implementation exportado por facade pública.",
    );
    console.log(
      "[OK] Contracts dependem somente de @core ou da própria área de contract.",
    );
    console.log(
      "[OK] Token relative imports permanecem restritos aos contracts do próprio módulo.",
    );
    console.log(
      "[OK] Capability IDs e versions em defineCapability conferem com module-map.",
    );
    console.log(
      "[OK] Fingerprints semânticos ignoram whitespace/comments/CRLF.",
    );
    console.log(
      "[OK] Novas capabilities futuras continuam permitidas via module-map.",
    );
    console.log(
      "[OK] Mudanças em APIs baseline existentes exigem recertificação explícita.",
    );
    console.log(
      "[OK] Etapa 73 não foi antecipada.",
    );
    console.log(
      "[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 73 — Plugin Manifests & Capability Graph.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 72: REPROVADA",
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
