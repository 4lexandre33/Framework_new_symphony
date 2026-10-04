#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/ObjectProp.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/state/StateKey.ts",
    "src/domain/state/StateValue.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/time/SimulationTick.ts",
    "src/domain/time/DomainDuration.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/events/DomainEventBatch.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "tests/domain-events.test.ts",
    "tests/domain-time.test.ts",
    "tests/domain-state.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_50_REQUIRED =
  Object.freeze([
    "src/domain/evaluation/ConditionId.ts",
    "src/domain/evaluation/ComparisonOperator.ts",
    "src/domain/evaluation/ConditionExpression.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/evaluation/index.ts",
    "src/domain/evaluation/README.txt",
    "tests/domain-conditions.test.ts",
    "tests/domain-conditions-purity.test.ts",
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
  files,
  label,
) {
  for (
    const relativePath of files
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

function assertNoStage51Files() {
  const forbidden = [
    "src/domain/mechanics/StatusEffect.ts",
    "src/domain/mechanics/StatusEffectId.ts",
    "src/domain/mechanics/StatusEffectInstance.ts",
    "src/domain/mechanics/StatusEffectSet.ts",
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
        "Arquivos da Etapa 51 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 51 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 50: CONDITIONS / PREDICATES",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 49",
    );

    console.log(
      `[OK] Pré-condições 44 → 49: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_50_REQUIRED,
      "Etapa 50",
    );

    console.log(
      `[OK] Etapa 50: ${STAGE_50_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage51Files();

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
      "=== TESTES CONDITIONS / PREDICATES ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-conditions.test.ts",
        "tests/domain-conditions-purity.test.ts",
        "tests/domain-state.test.ts",
        "tests/domain-events.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 50",
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
      "  ETAPA 50: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] ConditionId implementado.",
    );
    console.log(
      "[OK] ComparisonOperator implementado com igualdade, ordering e contains.",
    );
    console.log(
      "[OK] ConditionExpression implementada como árvore de dados imutável.",
    );
    console.log(
      "[OK] all/any/not/state-exists/state-compare/literal implementados.",
    );
    console.log(
      "[OK] ConditionEvaluator puro com short-circuit implementado.",
    );
    console.log(
      "[OK] Comparações incompatíveis retornam erro explícito via DomainResult.",
    );
    console.log(
      "[OK] Zero closures/scripts/Core/engine/infraestrutura em Conditions.",
    );
    console.log(
      "[OK] Tags não foram antecipadas; integração direta permanece na Etapa 61.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 51 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 51 — Status Conditions / Effects.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 50: REPROVADA",
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
