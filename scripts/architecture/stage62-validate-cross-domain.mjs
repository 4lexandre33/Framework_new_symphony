#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/location/LocationGraph.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/mechanics/StatusEffectSet.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/progression/LevelProgression.ts",
    "src/domain/progression/UnlockSet.ts",
    "src/domain/narrative/QuestState.ts",
    "src/domain/definitions/GameDefinitions.ts",
    "src/domain/tags/TagSet.ts",
    "tests/domain-tags.test.ts",
    "tests/domain-definitions.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_62_REQUIRED =
  Object.freeze([
    "src/domain/integration/ConditionStateIntegration.ts",
    "src/domain/integration/InteractionConditionIntegration.ts",
    "src/domain/integration/LocationEventIntegration.ts",
    "src/domain/integration/StatusEffectTimeIntegration.ts",
    "src/domain/integration/QuestIntegration.ts",
    "src/domain/integration/RewardGrantIntegration.ts",
    "src/domain/integration/ProgressionUnlockIntegration.ts",
    "src/domain/integration/index.ts",
    "src/domain/integration/README.txt",
    "tests/domain-cross-integration.test.ts",
    "tests/domain-cross-integration-headless.test.ts",
    "tests/domain-cross-integration-purity.test.ts",
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

function assertNoStage63Framework() {
  const forbidden = [
    "src/domain/snapshots",
    "src/domain/state/DomainSnapshotRegistry.ts",
    "src/domain/state/SnapshotBundle.ts",
    "src/domain/state/SnapshotCoordinator.ts",
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
        "Framework da Etapa 63 encontrado antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 63 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 62: CROSS-DOMAIN INTEGRATION",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 61",
    );

    console.log(
      `[OK] Pré-condições 44 → 61: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_62_REQUIRED,
      "Etapa 62",
    );

    console.log(
      `[OK] Etapa 62: ${STAGE_62_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage63Framework();

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
      "=== TESTES CROSS-DOMAIN ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-cross-integration.test.ts",
        "tests/domain-cross-integration-headless.test.ts",
        "tests/domain-cross-integration-purity.test.ts",
        "tests/domain-tags.test.ts",
        "tests/domain-definitions.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 62",
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
      "  ETAPA 62: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] LocationEntered -> DomainEvent implementado.",
    );
    console.log(
      "[OK] Conditions -> StateStore evaluation integration implementada.",
    );
    console.log(
      "[OK] Interaction requirements -> Conditions -> State implementado.",
    );
    console.log(
      "[OK] StatusEffectSet -> DomainDuration integration implementada.",
    );
    console.log(
      "[OK] QuestState -> StateStore projection implementada.",
    );
    console.log(
      "[OK] QuestState -> DomainEvent implementado.",
    );
    console.log(
      "[OK] Reward -> Inventory/Currency grant atômico implementado.",
    );
    console.log(
      "[OK] LevelProgression -> UnlockSet integration implementada.",
    );
    console.log(
      "[OK] Cenário cross-domain headless validado.",
    );
    console.log(
      "[OK] Zero Core/engine/renderer/physics/wall-clock/RNG na integração.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 63 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 63 — Snapshots / Restore.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 62: REPROVADA",
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
