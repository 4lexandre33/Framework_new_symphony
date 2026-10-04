#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "src/domain/progression/ProgressionCurve.ts",
    "src/domain/progression/LevelProgression.ts",
    "src/domain/progression/UnlockSet.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "tests/domain-progression.test.ts",
    "tests/domain-dialogue-graph.test.ts",
    "tests/domain-quest-goal.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_58_REQUIRED =
  Object.freeze([
    "src/domain/narrative/QuestId.ts",
    "src/domain/narrative/QuestDefinition.ts",
    "src/domain/narrative/QuestState.ts",
    "src/domain/narrative/NarrativeState.ts",
    "src/domain/narrative/StoryFlagSet.ts",
    "src/domain/narrative/index.ts",
    "src/domain/narrative/README.txt",
    "tests/domain-narrative-state.test.ts",
    "tests/domain-narrative-state-purity.test.ts",
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

function assertNoStage59Files() {
  const forbidden = [
    "src/domain/mechanics/DamageRule.ts",
    "src/domain/mechanics/HealingRule.ts",
    "src/domain/mechanics/TraversalRule.ts",
    "src/domain/mechanics/MovementRule.ts",
    "src/domain/mechanics/RequirementRule.ts",
    "src/domain/mechanics/GameplayRuleOutcome.ts",
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
        "Arquivos da Etapa 59 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 59 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 58: NARRATIVE",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 57",
    );

    console.log(
      `[OK] Pré-condições 44 → 57: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_58_REQUIRED,
      "Etapa 58",
    );

    console.log(
      `[OK] Etapa 58: ${STAGE_58_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage59Files();

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
      "=== TESTES NARRATIVE ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-narrative-state.test.ts",
        "tests/domain-narrative-state-purity.test.ts",
        "tests/domain-dialogue-graph.test.ts",
        "tests/domain-quest-goal.test.ts",
        "tests/domain-progression.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 58",
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
      "  ETAPA 58: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] QuestId e QuestDefinition multi-goal implementados.",
    );
    console.log(
      "[OK] QuestState com lifecycle e goals obrigatórios implementado.",
    );
    console.log(
      "[OK] Todos os goals completed completam a quest automaticamente.",
    );
    console.log(
      "[OK] Falha de goal terminaliza a quest sem deixar goals active.",
    );
    console.log(
      "[OK] StoryFlagSet booleano/semântico com snapshot ordenado implementado.",
    );
    console.log(
      "[OK] NarrativeState agrega quests + story flags sem side effects externos.",
    );
    console.log(
      "[OK] Snapshot/restore valida QuestDefinition externa e invariantes.",
    );
    console.log(
      "[OK] DialogueGraph e QuestGoal existentes foram preservados.",
    );
    console.log(
      "[OK] Zero renderer/physics/Core/engine/wall-clock/RNG em Narrative Stage 58.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 59 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 59 — Gameplay Rules.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 58: REPROVADA",
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
