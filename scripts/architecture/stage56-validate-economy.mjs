#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/economy/Item.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/mechanics/StatusEffectSet.ts",
    "src/domain/mechanics/ModifierSet.ts",
    "src/domain/mechanics/ResourcePool.ts",
    "src/domain/mechanics/CooldownSet.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/relations/Reputation.ts",
    "tests/domain-relations.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_56_REQUIRED =
  Object.freeze([
    "src/domain/economy/CurrencyId.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/economy/Cost.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/economy/RewardPolicy.ts",
    "src/domain/economy/LootEntry.ts",
    "src/domain/economy/LootTable.ts",
    "src/domain/economy/CraftingRecipe.ts",
    "src/domain/economy/index.ts",
    "src/domain/economy/README.txt",
    "tests/domain-economy-complete.test.ts",
    "tests/domain-economy-complete-purity.test.ts",
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
    const marker of markers
  ) {
    if (
      !stdout.includes(marker)
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

function assertNoStage57Files() {
  const forbidden = [
    "src/domain/progression/ProgressionCurve.ts",
    "src/domain/progression/ExperiencePool.ts",
    "src/domain/progression/LevelProgression.ts",
    "src/domain/progression/UnlockSet.ts",
    "src/domain/progression/ProgressionSnapshot.ts",
    "src/domain/progression/index.ts",
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
        "Arquivos da Etapa 57 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 57 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 56: ECONOMY COMPLETE",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 55",
    );

    console.log(
      `[OK] Pré-condições 44 → 55: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_56_REQUIRED,
      "Etapa 56",
    );

    console.log(
      `[OK] Etapa 56: ${STAGE_56_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage57Files();

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
      "=== TESTES ECONOMY COMPLETE ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-economy-complete.test.ts",
        "tests/domain-economy-complete-purity.test.ts",
        "tests/domain-inventory.test.ts",
        "tests/domain-item.test.ts",
        "tests/domain-relations.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 56",
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
      "  ETAPA 56: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] CurrencyId e CurrencyAccount implementados.",
    );
    console.log(
      "[OK] Débito e transferência de moeda preservam atomicidade.",
    );
    console.log(
      "[OK] Cost multi-moeda com pagamento all-or-nothing implementado.",
    );
    console.log(
      "[OK] Reward declarativo de moedas/itens implementado.",
    );
    console.log(
      "[OK] RewardPolicy implementada sem grant automático.",
    );
    console.log(
      "[OK] LootEntry/LootTable ponderados com RNG injetado implementados.",
    );
    console.log(
      "[OK] Modos with/without replacement determinísticos validados.",
    );
    console.log(
      "[OK] CraftingRecipe declarativa implementada sem mutar Inventory.",
    );
    console.log(
      "[OK] Zero RNG global/plataforma/Core/engine em Economy Stage 56.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 57 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 57 — Progression.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 56: REPROVADA",
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
