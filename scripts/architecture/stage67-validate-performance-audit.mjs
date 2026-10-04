#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  auditDomainPerformance,
  formatDomainPerformanceAudit,
} from "./lib/domain-performance-v1.mjs";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-portability-v2.mjs",
    "scripts/architecture/stage66-audit-domain-portability-v2.mjs",
    "tests/domain-portability-gate-v2.test.ts",
    "ETAPA66_MANIFEST.json",
    "src/domain/random/DeterministicRng.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/integration/RewardGrantIntegration.ts",
  ]);

const STAGE_67_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-performance-policy-v1.mjs",
    "scripts/architecture/lib/domain-performance-v1.mjs",
    "scripts/architecture/stage67-audit-domain-performance.mjs",
    "scripts/architecture/stage67-validate-performance-audit.mjs",
    "tests/domain-performance-audit.test.ts",
    "tests/domain-performance-audit-selftest.test.ts",
    "tests/domain-performance-lifecycle.test.ts",
    "tests/domain-performance-stress.test.ts",
    "ETAPA67_PERFORMANCE_AUDIT.txt",
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

function assertNoStage68() {
  const forbidden =
    Object.freeze([
      "tests/domain-cross-domain-invariants.test.ts",
      "tests/domain-cross-invariants.test.ts",
      "scripts/architecture/stage68-validate-cross-domain-invariants.mjs",
      "ETAPA68_MANIFEST.json",
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
        "Etapa 68 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 68 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 67: PERFORMANCE AUDIT",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 66",
    );

    console.log(
      `[OK] Pré-condições 44 → 66: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_67_REQUIRED,
      "Etapa 67",
    );

    console.log(
      `[OK] Etapa 67: ${String(STAGE_67_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage68();

    console.log("");
    console.log(
      "=== PERFORMANCE AUDIT ===",
    );

    const audit =
      auditDomainPerformance({
        projectRoot:
          ROOT,
      });

    console.log(
      formatDomainPerformanceAudit(
        audit,
      ),
    );

    if (!audit.ok) {
      fail(
        `Performance Audit encontrou ${String(audit.violations.length)} violação(ões).`,
      );
    }

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
      "=== TESTES PERFORMANCE / LIFECYCLE ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-performance-audit.test.ts",
        "tests/domain-performance-audit-selftest.test.ts",
        "tests/domain-performance-lifecycle.test.ts",
        "tests/domain-performance-stress.test.ts",
        "tests/domain-portability-gate-v2.test.ts",
        "tests/domain-deterministic-rng.test.ts",
        "tests/domain-resources-cooldowns.test.ts",
        "tests/domain-status-effects.test.ts",
        "tests/domain-modifiers.test.ts",
        "tests/domain-inventory.test.ts",
      ],
      "vitest Etapa 67",
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
      "  ETAPA 67: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Política de hot paths v1 implementada e versionada.",
    );
    console.log(
      "[OK] Hot paths auditados por AST contra allocation/materialization acidental.",
    );
    console.log(
      "[OK] Loop nesting dos hot paths permanece dentro dos budgets declarados.",
    );
    console.log(
      "[OK] Hot paths permanecem síncronos e sem await/yield.",
    );
    console.log(
      "[OK] Lifecycles mutáveis críticos preservam release explícito.",
    );
    console.log(
      "[OK] StateStore/ModifierSet reutilizam referências em reads críticas.",
    );
    console.log(
      "[OK] StatusEffectSet terminal lifecycle exige prune explícito e foi validado.",
    );
    console.log(
      "[OK] Stress budgets headless protegem contra regressões catastróficas.",
    );
    console.log(
      "[OK] Portability Gate v2 permanece verde.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 68 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 68 — Cross-domain invariants.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 67: REPROVADA",
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
