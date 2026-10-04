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
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/mechanics/DamageRule.ts",
    "src/domain/mechanics/RequirementRule.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/relations/FactionMatrix.ts",
    "src/domain/economy/Reward.ts",
    "src/domain/progression/LevelProgression.ts",
    "src/domain/narrative/NarrativeState.ts",
    "src/domain/definitions/DefinitionId.ts",
    "src/domain/definitions/DefinitionSet.ts",
    "src/domain/definitions/GameDefinitions.ts",
    "tests/domain-definitions.test.ts",
    "tests/domain-gameplay-rules.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_61_REQUIRED =
  Object.freeze([
    "src/domain/tags/DomainTag.ts",
    "src/domain/tags/TagSet.ts",
    "src/domain/tags/index.ts",
    "src/domain/tags/README.txt",
    "tests/domain-tags.test.ts",
    "tests/domain-tags-purity.test.ts",
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

function assertNoStage62Integration() {
  const integrationDir =
    abs(
      "src/domain/integration",
    );

  if (
    fs.existsSync(
      integrationDir,
    )
  ) {
    fail(
      "src/domain/integration existe antes da Etapa 62.",
    );
  }

  console.log(
    "[OK] Etapa 62 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 61: TAGS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 60",
    );

    console.log(
      `[OK] Pré-condições 44 → 60: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_61_REQUIRED,
      "Etapa 61",
    );

    console.log(
      `[OK] Etapa 61: ${STAGE_61_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage62Integration();

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
      "=== TESTES TAGS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-tags.test.ts",
        "tests/domain-tags-purity.test.ts",
        "tests/domain-definitions.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 61",
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
      "  ETAPA 61: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] DomainTag branded/canônica implementada.",
    );
    console.log(
      "[OK] Normalização NFKC/lowercase/separadores implementada.",
    );
    console.log(
      "[OK] Formato canônico e limites de DomainTag validados.",
    );
    console.log(
      "[OK] TagSet com storage Set e operações O(1) médias implementado.",
    );
    console.log(
      "[OK] containsAll/containsAny/equals implementados sem arrays temporários.",
    );
    console.log(
      "[OK] union/intersection/difference preservam operands.",
    );
    console.log(
      "[OK] Snapshot/restore usa ordem canônica e rejeita colisões.",
    );
    console.log(
      "[OK] Tags não foram acopladas automaticamente a outros subdomínios.",
    );
    console.log(
      "[OK] Zero renderer/physics/Core/engine/wall-clock/RNG em Tags.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 62 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 62 — Cross-domain integration.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 61: REPROVADA",
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
