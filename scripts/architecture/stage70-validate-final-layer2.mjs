#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  auditLayer2FinalGate,
  formatLayer2FinalGate,
} from "./lib/layer2-final-gate-v1.mjs";

const ROOT =
  process.cwd();

const STAGE_70_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/layer2-final-gate-v1.mjs",
    "scripts/architecture/stage70-audit-layer2-final.mjs",
    "scripts/architecture/stage70-validate-final-layer2.mjs",
    "tests/domain-layer2-final-gate.test.ts",
    "tests/domain-layer2-final-gate-selftest.test.ts",
    "ETAPA70_LAYER2_FINAL_GATE.txt",
    "ETAPA70_MANIFEST.json",
    "ETAPA70_SHA256SUMS.txt",
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
      "  PROJETO1 — ETAPA 70: FINAL LAYER 2 GATE",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      STAGE_70_REQUIRED,
      "Etapa 70",
    );

    console.log(
      `[OK] Etapa 70: ${String(STAGE_70_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    console.log("");
    console.log(
      "=== FINAL LAYER 2 AUDIT ===",
    );

    const finalAudit =
      auditLayer2FinalGate({
        projectRoot:
          ROOT,
      });

    console.log(
      formatLayer2FinalGate(
        finalAudit,
      ),
    );

    if (!finalAudit.ok) {
      fail(
        `Final Layer 2 Audit encontrou ${String(finalAudit.violations.length)} violação(ões).`,
      );
    }

    console.log("");
    console.log(
      "=== DOCUMENTATION AUDIT ===",
    );

    run(
      "node",
      [
        "scripts/architecture/stage69-audit-documentation.mjs",
      ],
      "Layer 2 documentation audit",
      [
        "Documentos governados: 8",
        "Domain roots documentados: 18/18",
        "Violações de documentação: 0",
      ],
    );

    console.log("");
    console.log(
      "=== CROSS-DOMAIN INVARIANTS ===",
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
      "=== TARGETED FINAL LAYER 2 TESTS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-layer2-final-gate.test.ts",
        "tests/domain-layer2-final-gate-selftest.test.ts",
        "tests/domain-documentation.test.ts",
        "tests/domain-cross-domain-invariant-catalog.test.ts",
        "tests/domain-cross-domain-invariants.test.ts",
        "tests/domain-cross-domain-invariants-replay.test.ts",
        "tests/domain-performance-audit.test.ts",
        "tests/domain-performance-lifecycle.test.ts",
        "tests/domain-portability-gate-v2.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
        "tests/domain-snapshots-headless.test.ts",
        "tests/domain-deterministic-rng.test.ts",
      ],
      "vitest Final Layer 2",
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
      "  ETAPA 70: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Checkpoints das Etapas 44 → 69 completos.",
    );
    console.log(
      "[OK] Todos os 18 roots finais de src/domain presentes e documentados.",
    );
    console.log(
      "[OK] Portability Gate v2: 0 violações.",
    );
    console.log(
      "[OK] Performance Audit: 0 violações.",
    );
    console.log(
      "[OK] Cross-domain invariant coverage: XINV001–XINV010 completa.",
    );
    console.log(
      "[OK] Documentation Audit: 0 violações.",
    );
    console.log(
      "[OK] Hard invariant L2-DIMENSION-AGNOSTIC preservado.",
    );
    console.log(
      "[OK] Snapshot/restore, deterministic RNG e save boundary preservados.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless certificada.",
    );
    console.log(
      "[OK] Architecture boundaries/dependency graph permanecem verdes.",
    );
    console.log(
      "[OK] TypeScript, suíte completa e build permanecem verdes.",
    );
    console.log(
      "[OK] CAMADA 2 CONCLUÍDA.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 70: REPROVADA",
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
