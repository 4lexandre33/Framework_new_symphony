#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/Agent.ts",
    "src/domain/economy/Item.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/mechanics/SkillTreeGraph.ts",
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "src/domain/location/LocationId.ts",
    "src/domain/location/LocationRef.ts",
    "src/domain/location/LocationZone.ts",
    "src/domain/location/LocationRelation.ts",
    "src/domain/location/LocationGraph.ts",
    "src/domain/ports/ClockPort.ts",
    "src/domain/ports/SaveGamePort.ts",
    "src/domain/ports/ModdingPort.ts",
    "tests/domain-location.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_46_REQUIRED =
  Object.freeze([
    "src/domain/entities/WorldObjectId.ts",
    "src/domain/entities/WorldObjectRef.ts",
    "src/domain/entities/ObjectStateRef.ts",
    "src/domain/entities/ObjectProp.ts",
    "src/domain/entities/index.ts",
    "src/domain/entities/README.txt",
    "tests/domain-world-object.test.ts",
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

function assertNoStage47Files() {
  const forbidden = [
    "src/domain/state/StateKey.ts",
    "src/domain/state/StateValue.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/state/StateSnapshot.ts",
    "src/domain/state/index.ts",
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
        "Arquivos da Etapa 47 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 47 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 46: WORLD OBJECTS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 45",
    );

    console.log(
      `[OK] Pré-condições 44 → 45: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_46_REQUIRED,
      "Etapa 46",
    );

    console.log(
      `[OK] Etapa 46: ${STAGE_46_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage47Files();

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
      "=== TESTES WORLD OBJECT + LOCATION + PORTABILITY ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-world-object.test.ts",
        "tests/domain-location.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 46",
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
      "  ETAPA 46: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] WorldObjectId e WorldObjectRef implementados.",
    );
    console.log(
      "[OK] ObjectStateRef implementada como referência opaca.",
    );
    console.log(
      "[OK] ObjectProp implementado sem representação física/visual.",
    );
    console.log(
      "[OK] Associação semântica com LocationRef implementada.",
    );
    console.log(
      "[OK] Relocation é in-place e não exige engine/world transform.",
    );
    console.log(
      "[OK] Snapshot/restauração de ObjectProp validados.",
    );
    console.log(
      "[OK] StateStore e Tags não foram antecipados.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 47 — State foundation.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 46: REPROVADA",
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
