#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/Agent.ts",
    "src/domain/entities/WorldObjectId.ts",
    "src/domain/entities/WorldObjectRef.ts",
    "src/domain/entities/ObjectStateRef.ts",
    "src/domain/entities/ObjectProp.ts",
    "src/domain/location/LocationId.ts",
    "src/domain/location/LocationRef.ts",
    "src/domain/location/LocationZone.ts",
    "src/domain/location/LocationRelation.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/economy/Item.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/mechanics/SkillTreeGraph.ts",
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "tests/domain-location.test.ts",
    "tests/domain-world-object.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_47_REQUIRED =
  Object.freeze([
    "src/domain/state/StateKey.ts",
    "src/domain/state/StateValue.ts",
    "src/domain/state/StateSnapshot.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/state/index.ts",
    "src/domain/state/README.txt",
    "tests/domain-state.test.ts",
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

function assertNoStage48Files() {
  const forbidden = [
    "src/domain/time/SimulationTick.ts",
    "src/domain/time/DomainDuration.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/time/TimerSnapshot.ts",
    "src/domain/time/index.ts",
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
        "Arquivos da Etapa 48 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 48 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 47: STATE FOUNDATION",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 46",
    );

    console.log(
      `[OK] Pré-condições 44 → 46: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_47_REQUIRED,
      "Etapa 47",
    );

    console.log(
      `[OK] Etapa 47: ${STAGE_47_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage48Files();

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
      "=== TESTES STATE + PORTABILITY ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-state.test.ts",
        "tests/domain-world-object.test.ts",
        "tests/domain-location.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 47",
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
      "  ETAPA 47: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] StateKey tipada e serializável implementada.",
    );
    console.log(
      "[OK] StateValue valida/copia/congela valores recursivos.",
    );
    console.log(
      "[OK] StateStore implementado com Map e lookup O(1) médio.",
    );
    console.log(
      "[OK] has/read/set/delete/compare/clear implementados.",
    );
    console.log(
      "[OK] Snapshot determinístico e restore validados.",
    );
    console.log(
      "[OK] Sem localStorage, database, world service ou infraestrutura.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 48 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 48 — Domain Time.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 47: REPROVADA",
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
