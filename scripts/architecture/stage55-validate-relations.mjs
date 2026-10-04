#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
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
    "src/domain/interaction/InteractionOutcome.ts",
    "tests/domain-interaction.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_55_REQUIRED =
  Object.freeze([
    "src/domain/relations/FactionId.ts",
    "src/domain/relations/FactionRelation.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/relations/Reputation.ts",
    "src/domain/relations/Relationship.ts",
    "src/domain/relations/index.ts",
    "src/domain/relations/README.txt",
    "tests/domain-relations.test.ts",
    "tests/domain-relations-purity.test.ts",
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

function assertNoStage56Files() {
  const forbidden = [
    "src/domain/economy/CurrencyId.ts",
    "src/domain/economy/CurrencyAccount.ts",
    "src/domain/economy/Cost.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/economy/RewardPolicy.ts",
    "src/domain/economy/LootTable.ts",
    "src/domain/economy/LootEntry.ts",
    "src/domain/economy/CraftingRecipe.ts",
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
        "Arquivos da Etapa 56 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 56 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 55: RELATIONS / FACTIONS / REPUTATION",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 54",
    );

    console.log(
      `[OK] Pré-condições 44 → 54: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_55_REQUIRED,
      "Etapa 55",
    );

    console.log(
      `[OK] Etapa 55: ${STAGE_55_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage56Files();

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
      "=== TESTES RELATIONS / FACTIONS / REPUTATION ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-relations.test.ts",
        "tests/domain-relations-purity.test.ts",
        "tests/domain-interaction.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 55",
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
      "  ETAPA 55: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] FactionId e FactionRelation implementados.",
    );
    console.log(
      "[OK] FactionMatrix direcional com default explícito implementada.",
    );
    console.log(
      "[OK] Reputation bounded/saturada com subject lógico implementada.",
    );
    console.log(
      "[OK] Relationship direcional tipada com strength implementada.",
    );
    console.log(
      "[OK] Snapshots/restore determinísticos validados.",
    );
    console.log(
      "[OK] Zero posição/renderer/physics/Core/engine em Relations.",
    );
    console.log(
      "[OK] Integrações Conditions/Dialogue/AI não foram antecipadas.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 56 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 56 — Economy complete.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 55: REPROVADA",
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
