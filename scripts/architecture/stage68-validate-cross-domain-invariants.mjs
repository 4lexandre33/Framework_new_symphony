#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CROSS_DOMAIN_INVARIANTS,
} from "./lib/domain-cross-invariants-v1.mjs";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-portability-v2.mjs",
    "scripts/architecture/lib/domain-performance-policy-v1.mjs",
    "scripts/architecture/lib/domain-performance-v1.mjs",
    "scripts/architecture/stage67-audit-domain-performance.mjs",
    "tests/domain-performance-audit.test.ts",
    "ETAPA67_MANIFEST.json",
    "src/domain/integration/RewardGrantIntegration.ts",
    "src/domain/integration/QuestIntegration.ts",
    "src/domain/integration/ProgressionUnlockIntegration.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/random/RandomStream.ts",
  ]);

const STAGE_68_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-cross-invariants-v1.mjs",
    "scripts/architecture/stage68-audit-cross-domain-invariants.mjs",
    "scripts/architecture/stage68-validate-cross-domain-invariants.mjs",
    "tests/domain-cross-domain-invariants.test.ts",
    "tests/domain-cross-domain-invariants-replay.test.ts",
    "tests/domain-cross-domain-invariant-catalog.test.ts",
    "ETAPA68_CROSS_DOMAIN_INVARIANTS.txt",
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
    ...relativePath.split("/"),
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
      abs(relativePath);

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

function assertNoStage69() {
  const forbidden =
    Object.freeze([
      "docs/layer2/README.md",
      "docs/layer2/architecture.md",
      "docs/layer2/domain-reference.md",
      "scripts/architecture/stage69-validate-documentation.mjs",
      "ETAPA69_MANIFEST.json",
    ]);

  const present =
    forbidden.filter(
      (relativePath) =>
        fs.existsSync(
          abs(relativePath),
        ),
    );

  if (
    present.length > 0
  ) {
    fail(
      [
        "Etapa 69 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 69 não foi antecipada.",
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
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
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
      result.stdout ?? "",
    );

  const stderr =
    String(
      result.stderr ?? "",
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
    result.status !== 0
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
      "  PROJETO1 — ETAPA 68: CROSS-DOMAIN INVARIANTS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 67",
    );

    console.log(
      `[OK] Pré-condições 44 → 67: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_68_REQUIRED,
      "Etapa 68",
    );

    console.log(
      `[OK] Etapa 68: ${String(STAGE_68_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    if (
      CROSS_DOMAIN_INVARIANTS.length !==
      10
    ) {
      fail(
        `Catálogo esperado com 10 invariantes; atual: ${String(CROSS_DOMAIN_INVARIANTS.length)}.`,
      );
    }

    console.log(
      "[OK] Catálogo v1 contém 10 invariantes.",
    );

    assertNoStage69();

    console.log("");
    console.log(
      "=== INVARIANT COVERAGE ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage68-audit-cross-domain-invariants.mjs",
      ],
      "Cross-domain invariant coverage",
      [
        "Invariantes catalogados: 10",
        "Invariantes cobertos: 10",
        "Cobertura de invariantes: completa.",
      ],
    );

    console.log("");
    console.log(
      "=== PERFORMANCE AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage67-audit-domain-performance.mjs",
      ],
      "Performance Audit",
      [
        "Violações de performance estrutural: 0",
      ],
    );

    console.log("");
    console.log(
      "=== PORTABILITY GATE v2 ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage66-audit-domain-portability-v2.mjs",
      ],
      "Portability Gate v2",
      [
        "Violações de portabilidade v2: 0",
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
      "=== TESTES CROSS-DOMAIN INVARIANTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-cross-domain-invariants.test.ts",
        "tests/domain-cross-domain-invariants-replay.test.ts",
        "tests/domain-cross-domain-invariant-catalog.test.ts",
        "tests/domain-cross-integration.test.ts",
        "tests/domain-cross-integration-headless.test.ts",
        "tests/domain-snapshots-headless.test.ts",
        "tests/domain-deterministic-rng-loot.test.ts",
        "tests/domain-performance-audit.test.ts",
        "tests/domain-portability-gate-v2.test.ts",
      ],
      "vitest Etapa 68",
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
      "  ETAPA 68: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] XINV001 Reward rejection atomicity validado.",
    );
    console.log(
      "[OK] XINV002 Reward exact-delta conservation validado.",
    );
    console.log(
      "[OK] XINV003 Interaction authorization side-effect freedom validado.",
    );
    console.log(
      "[OK] XINV004 Quest State/Event semantic coherence validado.",
    );
    console.log(
      "[OK] XINV005 Progression unlock monotonicity/idempotency validado.",
    );
    console.log(
      "[OK] XINV006 StatusEffect time monotonicity/prune lifecycle validado.",
    );
    console.log(
      "[OK] XINV007 Location event identity coherence validado.",
    );
    console.log(
      "[OK] XINV008 Snapshot state preservation/instance isolation validado.",
    );
    console.log(
      "[OK] XINV009 RNG stream isolation/restore continuation validado.",
    );
    console.log(
      "[OK] XINV010 Cross-domain deterministic headless replay validado.",
    );
    console.log(
      "[OK] Cobertura versionada dos 10 invariantes está completa.",
    );
    console.log(
      "[OK] Performance Audit permanece verde.",
    );
    console.log(
      "[OK] Portability Gate v2 permanece verde.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 69 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 69 — Documentation.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 68: REPROVADA",
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
