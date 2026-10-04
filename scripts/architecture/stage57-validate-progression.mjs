#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/Agent.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/economy/Cost.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/economy/LootTable.ts",
    "src/domain/economy/CraftingRecipe.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/mechanics/SkillTreeGraph.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/relations/FactionMatrix.ts",
    "tests/domain-economy-complete.test.ts",
    "tests/domain-relations.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_57_REQUIRED =
  Object.freeze([
    "src/domain/progression/ProgressionCurve.ts",
    "src/domain/progression/ExperiencePool.ts",
    "src/domain/progression/LevelProgression.ts",
    "src/domain/progression/UnlockSet.ts",
    "src/domain/progression/ProgressionSnapshot.ts",
    "src/domain/progression/index.ts",
    "src/domain/progression/README.txt",
    "tests/domain-progression.test.ts",
    "tests/domain-progression-purity.test.ts",
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

function assertNoStage58Files() {
  const forbidden = [
    "src/domain/narrative/QuestId.ts",
    "src/domain/narrative/QuestDefinition.ts",
    "src/domain/narrative/QuestState.ts",
    "src/domain/narrative/NarrativeState.ts",
    "src/domain/narrative/StoryFlagSet.ts",
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
        "Arquivos da expansão Narrative da Etapa 58 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 58 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 57: PROGRESSION",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 56",
    );

    console.log(
      `[OK] Pré-condições 44 → 56: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_57_REQUIRED,
      "Etapa 57",
    );

    console.log(
      `[OK] Etapa 57: ${STAGE_57_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage58Files();

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
      "=== TESTES PROGRESSION ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-progression.test.ts",
        "tests/domain-progression-purity.test.ts",
        "tests/domain-economy-complete.test.ts",
        "tests/domain-skill-tree.test.ts",
        "tests/domain-agent.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 57",
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
      "  ETAPA 57: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] ProgressionCurve cumulativa e determinística implementada.",
    );
    console.log(
      "[OK] Lookup de level por XP usa busca binária sem alocação.",
    );
    console.log(
      "[OK] ExperiencePool implementado com overflow protegido.",
    );
    console.log(
      "[OK] LevelProgression deriva level de XP + curve sem estado duplicado.",
    );
    console.log(
      "[OK] Level-up múltiplo em uma única concessão de XP validado.",
    );
    console.log(
      "[OK] UnlockSet semântico implementado com snapshot ordenado.",
    );
    console.log(
      "[OK] ProgressionSnapshot persiste somente estado mutável.",
    );
    console.log(
      "[OK] Agent level/experience e SkillTreeGraph não foram acoplados automaticamente.",
    );
    console.log(
      "[OK] Zero renderer/physics/Core/engine/wall-clock/RNG em Progression.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 58 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 58 — Narrative.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 57: REPROVADA",
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
