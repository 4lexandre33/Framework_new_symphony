#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  auditDomainPortability,
  formatPortabilityAudit,
  PORTABILITY_GATE_VERSION,
} from "./lib/domain-portability-v2.mjs";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/ports/DomainSaveGamePort.ts",
    "src/domain/random/DeterministicRng.ts",
    "src/domain/random/RandomStream.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/integration/RewardGrantIntegration.ts",
    "tests/domain-ports-review.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
    "ETAPA65_MANIFEST.json",
  ]);

const STAGE_66_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-portability-v2.mjs",
    "scripts/architecture/stage66-audit-domain-portability-v2.mjs",
    "scripts/architecture/stage66-validate-portability-gate-v2.mjs",
    "tests/domain-portability-gate-v2.test.ts",
    "tests/domain-portability-gate-v2-selftest.test.ts",
    "ETAPA66_PORTABILITY_GATE_V2.txt",
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

function assertNoStage67() {
  const forbidden =
    Object.freeze([
      "tests/domain-performance-audit.test.ts",
      "tests/domain-performance-budget.test.ts",
      "scripts/architecture/stage67-validate-performance-audit.mjs",
      "scripts/architecture/stage67-validate-performance.mjs",
      "ETAPA67_MANIFEST.json",
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
        "Etapa 67 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 67 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 66: PORTABILITY GATE v2",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 65",
    );

    console.log(
      `[OK] Pré-condições 44 → 65: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_66_REQUIRED,
      "Etapa 66",
    );

    console.log(
      `[OK] Etapa 66: ${String(STAGE_66_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage67();

    console.log("");
    console.log(
      "=== PORTABILITY AUDIT v2 ===",
    );

    const audit =
      auditDomainPortability({
        projectRoot:
          ROOT,
      });

    console.log(
      formatPortabilityAudit(
        audit,
      ),
    );

    if (
      audit.version !==
      PORTABILITY_GATE_VERSION
    ) {
      fail(
        "Versão inesperada do Portability Gate.",
      );
    }

    if (!audit.ok) {
      fail(
        `Portability Gate v2 encontrou ${String(audit.violations.length)} violação(ões).`,
      );
    }

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
      "=== TESTES PORTABILITY GATE v2 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-portability-gate-v2.test.ts",
        "tests/domain-portability-gate-v2-selftest.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
        "tests/domain-ports-review-boundaries.test.ts",
        "tests/domain-deterministic-rng-purity.test.ts",
        "tests/domain-snapshots-purity.test.ts",
        "tests/domain-cross-integration-purity.test.ts",
      ],
      "vitest Etapa 66",
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
      "  ETAPA 66: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Portability Gate v2 fiscaliza automaticamente todo src/domain/**/*.ts.",
    );
    console.log(
      "[OK] Imports/exports externos ou fora de src/domain são proibidos.",
    );
    console.log(
      "[OK] DOM/browser/Node/plataforma globals são proibidos no domínio.",
    );
    console.log(
      "[OK] Wall-clock/host timers são proibidos no domínio.",
    );
    console.log(
      "[OK] Math.random/crypto entropy são proibidos; RNG determinístico permanece permitido.",
    );
    console.log(
      "[OK] Símbolos concretos de renderer/physics/spatial stack são proibidos.",
    );
    console.log(
      "[OK] Declarações domain-specific *2D/*3D são proibidas.",
    );
    console.log(
      "[OK] require/triple-slash escapes são proibidos.",
    );
    console.log(
      "[OK] Self-tests provam que o auditor detecta violações reais.",
    );
    console.log(
      "[OK] Legacy dimension-agnostic gate permanece verde.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless comprovada pelo gate.",
    );
    console.log(
      "[OK] Etapa 67 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 67 — Performance Audit.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 66: REPROVADA",
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
