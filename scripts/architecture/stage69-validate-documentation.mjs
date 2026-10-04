#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "scripts/architecture/lib/domain-portability-v2.mjs",
    "scripts/architecture/lib/domain-performance-v1.mjs",
    "scripts/architecture/lib/domain-cross-invariants-v1.mjs",
    "scripts/architecture/stage68-audit-cross-domain-invariants.mjs",
    "tests/domain-cross-domain-invariants.test.ts",
    "ETAPA68_MANIFEST.json",
  ]);

const STAGE_69_REQUIRED =
  Object.freeze([
    "docs/layer2/README.md",
    "docs/layer2/architecture.md",
    "docs/layer2/domain-reference.md",
    "docs/layer2/integration-contracts.md",
    "docs/layer2/state-persistence-determinism.md",
    "docs/layer2/performance-portability.md",
    "docs/layer2/extension-guide.md",
    "docs/layer2/stage-history.md",
    "scripts/architecture/lib/layer2-documentation-catalog-v1.mjs",
    "scripts/architecture/stage69-audit-documentation.mjs",
    "scripts/architecture/stage69-validate-documentation.mjs",
    "tests/domain-documentation.test.ts",
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

function assertNoStage70() {
  const forbidden =
    Object.freeze([
      "scripts/architecture/stage70-final-layer2-gate.mjs",
      "scripts/architecture/stage70-validate-final-layer2.mjs",
      "tests/domain-layer2-final-gate.test.ts",
      "ETAPA70_MANIFEST.json",
      "ETAPA70_SHA256SUMS.txt",
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
        "Etapa 70 encontrada antes da hora:",
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 70 não foi antecipada.",
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
      "  PROJETO1 — ETAPA 69: DOCUMENTATION",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 68",
    );

    console.log(
      `[OK] Pré-condições 44 → 68: ${String(PREVIOUS_REQUIRED.length)} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_69_REQUIRED,
      "Etapa 69",
    );

    console.log(
      `[OK] Etapa 69: ${String(STAGE_69_REQUIRED.length)} arquivos obrigatórios presentes.`,
    );

    assertNoStage70();

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
        "Cross-domain invariants documentados: 10",
        "Standard snapshot codecs documentados: 19",
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
      "=== TESTES DOCUMENTATION ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-documentation.test.ts",
        "tests/domain-cross-domain-invariant-catalog.test.ts",
        "tests/domain-performance-audit.test.ts",
        "tests/domain-portability-gate-v2.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 69",
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
      "  ETAPA 69: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Overview da Layer 2 documentado.",
    );
    console.log(
      "[OK] Arquitetura e hard invariant dimension-agnostic documentados.",
    );
    console.log(
      "[OK] Todos os 18 roots atuais de src/domain documentados.",
    );
    console.log(
      "[OK] Integrações da Etapa 62 e XINV001–XINV010 documentados.",
    );
    console.log(
      "[OK] State/time/snapshots/save/RNG/replay documentados.",
    );
    console.log(
      "[OK] 19 codecs padrão + 2 codecs RNG documentados.",
    );
    console.log(
      "[OK] PRT001–PRT008 e PERF001–PERF007 documentados.",
    );
    console.log(
      "[OK] Guia de extensão/governança da Layer 2 documentado.",
    );
    console.log(
      "[OK] Stage history 44 → 69 documentado.",
    );
    console.log(
      "[OK] Links relativos e cobertura documental validados.",
    );
    console.log(
      "[OK] Etapa 70 não foi antecipada.",
    );
    console.log(
      "[OK] Portability, performance e cross-domain gates permanecem verdes.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 70 — FINAL LAYER 2 GATE.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 69: REPROVADA",
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
