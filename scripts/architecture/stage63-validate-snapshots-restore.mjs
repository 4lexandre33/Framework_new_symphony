#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/Agent.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/mechanics/StatusEffectSet.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/progression/ProgressionSnapshot.ts",
    "src/domain/narrative/NarrativeState.ts",
    "src/domain/tags/TagSet.ts",
    "src/domain/integration/RewardGrantIntegration.ts",
    "src/domain/integration/QuestIntegration.ts",
    "tests/domain-cross-integration-headless.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_63_REQUIRED =
  Object.freeze([
    "src/domain/snapshots/SnapshotIds.ts",
    "src/domain/snapshots/SnapshotValue.ts",
    "src/domain/snapshots/SnapshotCodec.ts",
    "src/domain/snapshots/DomainSnapshotRegistry.ts",
    "src/domain/snapshots/SnapshotBundle.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/snapshots/StandardSnapshotCodecs.ts",
    "src/domain/snapshots/index.ts",
    "src/domain/snapshots/README.txt",
    "tests/domain-snapshots.test.ts",
    "tests/domain-snapshots-headless.test.ts",
    "tests/domain-snapshots-purity.test.ts",
  ]);

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
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
      !fs.existsSync(full) ||
      !fs.statSync(full).isFile()
    ) {
      fail(
        `${label}: arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function quoteCmdPart(value) {
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
    process.platform !== "win32"
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
      .map(quoteCmdPart)
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

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
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

function assertNoStage64Rng() {
  const forbidden = [
    "src/domain/random",
    "src/domain/rng",
    "src/domain/random/DeterministicRng.ts",
    "src/domain/random/RandomSeed.ts",
    "src/domain/random/RandomStream.ts",
    "src/domain/rng/DeterministicRng.ts",
    "src/domain/rng/RandomSeed.ts",
    "src/domain/rng/RandomStream.ts",
  ];

  const unexpected =
    forbidden.filter(
      (relativePath) =>
        fs.existsSync(
          abs(relativePath),
        ),
    );

  if (
    unexpected.length > 0
  ) {
    fail(
      [
        "Arquivos da Etapa 64 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 64 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 63: SNAPSHOTS / RESTORE",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 62",
    );

    console.log(
      `[OK] Pré-condições 44 → 62: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_63_REQUIRED,
      "Etapa 63",
    );

    console.log(
      `[OK] Etapa 63: ${STAGE_63_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage64Rng();

    console.log("");
    console.log(
      "=== ARCHITECTURE CHECK ===",
    );

    run(
      "npm",
      ["run", "arch:check"],
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
      ["tsc", "--noEmit"],
      "tsc",
    );

    console.log("");
    console.log(
      "=== TESTES SNAPSHOTS / RESTORE ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-snapshots.test.ts",
        "tests/domain-snapshots-headless.test.ts",
        "tests/domain-snapshots-purity.test.ts",
        "tests/domain-cross-integration-headless.test.ts",
        "tests/domain-state.test.ts",
        "tests/domain-inventory.test.ts",
        "tests/domain-progression.test.ts",
        "tests/domain-narrative-state.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 63",
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
      ["vitest", "run"],
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
      ["run", "build"],
      "build",
    );

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 63: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] SnapshotTypeId/SnapshotSlotId implementados.",
    );
    console.log(
      "[OK] SnapshotValue JSON-safe/canônico implementado.",
    );
    console.log(
      "[OK] SnapshotCodec versionado e type-erased runtime implementado.",
    );
    console.log(
      "[OK] DomainSnapshotRegistry imutável implementado.",
    );
    console.log(
      "[OK] SnapshotBundle schema v1 com slots ordenados implementado.",
    );
    console.log(
      "[OK] SnapshotCoordinator capture/restore implementado.",
    );
    console.log(
      "[OK] Restore cria novos aggregates sem mutar estado existente.",
    );
    console.log(
      "[OK] 19 codecs padrão de estado mutável implementados.",
    );
    console.log(
      "[OK] Inventory/Progression/Narrative usam definições externas no restore.",
    );
    console.log(
      "[OK] Round-trip JSON headless determinístico validado.",
    );
    console.log(
      "[OK] Zero Core/engine/renderer/physics/I/O/wall-clock/RNG em Snapshots.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 64 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 64 — Deterministic RNG.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 63: REPROVADA",
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
