#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/WorldObjectId.ts",
    "src/domain/entities/ObjectProp.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/state/StateKey.ts",
    "src/domain/state/StateValue.ts",
    "src/domain/state/StateSnapshot.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/narrative/QuestGoal.ts",
    "tests/domain-state.test.ts",
    "tests/domain-world-object.test.ts",
    "tests/domain-location.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_48_REQUIRED =
  Object.freeze([
    "src/domain/time/SimulationTick.ts",
    "src/domain/time/DomainDuration.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/time/TimerSnapshot.ts",
    "src/domain/time/index.ts",
    "src/domain/time/README.txt",
    "tests/domain-time.test.ts",
    "tests/domain-time-purity.test.ts",
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
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
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

  console.log(`[OK] ${label}`);
}

function assertNoStage49Files() {
  const forbidden = [
    "src/domain/events/DomainEventId.ts",
    "src/domain/events/DomainEventTypeId.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/events/DomainEventMetadata.ts",
    "src/domain/events/DomainEventBatch.ts",
    "src/domain/events/index.ts",
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
        "Arquivos da Etapa 49 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 49 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 48: DOMAIN TIME",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 47",
    );

    console.log(
      `[OK] Pré-condições 44 → 47: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_48_REQUIRED,
      "Etapa 48",
    );

    console.log(
      `[OK] Etapa 48: ${STAGE_48_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage49Files();

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
      "=== TESTES DOMAIN TIME ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-time.test.ts",
        "tests/domain-time-purity.test.ts",
        "tests/domain-state.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 48",
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
      "  ETAPA 48: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] SimulationTick implementado como inteiro seguro determinístico.",
    );
    console.log(
      "[OK] DomainDuration implementada sem wall clock.",
    );
    console.log(
      "[OK] SimulationTimer implementado com lifecycle explícito.",
    );
    console.log(
      "[OK] advance() recebe elapsed externamente e satura na duração.",
    );
    console.log(
      "[OK] pause/resume/reset/snapshot/restore validados.",
    );
    console.log(
      "[OK] Zero Date.now/performance.now/requestAnimationFrame/GameLoop em domain/time.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 49 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 49 — Domain Events.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 48: REPROVADA",
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
