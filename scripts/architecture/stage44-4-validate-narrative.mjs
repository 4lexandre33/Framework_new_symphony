#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const STAGE_44_0_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/VersionedSnapshot.ts",
    "src/domain/evaluation/DomainResult.ts",
    "src/domain/ports/ClockPort.ts",
    "src/domain/ports/SaveGamePort.ts",
    "src/domain/ports/ModdingPort.ts",
    "tests/domain-foundation.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_44_1_REQUIRED =
  Object.freeze([
    "src/domain/entities/Agent.ts",
    "src/domain/economy/Item.ts",
    "tests/domain-agent.test.ts",
    "tests/domain-item.test.ts",
  ]);

const STAGE_44_2_REQUIRED =
  Object.freeze([
    "src/domain/economy/Inventory.ts",
    "tests/domain-inventory.test.ts",
  ]);

const STAGE_44_3_REQUIRED =
  Object.freeze([
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/mechanics/SkillTreeGraph.ts",
    "tests/domain-ability-action.test.ts",
    "tests/domain-skill-tree.test.ts",
  ]);

const STAGE_44_4_REQUIRED =
  Object.freeze([
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "src/domain/narrative/index.ts",
    "tests/domain-dialogue-graph.test.ts",
    "tests/domain-quest-goal.test.ts",
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

function quoteCmdPart(
  value,
) {
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
      64 * 1024 * 1024,
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

function assertNoPrematureFiles() {
  const forbidden =
    [
      "src/services/usecases/SaveLoadUseCase.ts",
      "src/services/usecases/ModdingAppService.ts",
      "src/app/flows/GameFlowFSM.ts",
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
        "arquivos de subetapas futuras encontrados:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Nenhum arquivo das Etapas 44.5+ foi antecipado.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 44.4: DIALOGUE GRAPH + QUEST GOAL",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      STAGE_44_0_REQUIRED,
      "pré-condição 44.0",
    );

    console.log(
      `[OK] Pré-condição 44.0: ${STAGE_44_0_REQUIRED.length} arquivos presentes.`,
    );

    ensureFiles(
      STAGE_44_1_REQUIRED,
      "pré-condição 44.1",
    );

    console.log(
      `[OK] Pré-condição 44.1: ${STAGE_44_1_REQUIRED.length} arquivos presentes.`,
    );

    ensureFiles(
      STAGE_44_2_REQUIRED,
      "pré-condição 44.2",
    );

    console.log(
      `[OK] Pré-condição 44.2: ${STAGE_44_2_REQUIRED.length} arquivos presentes.`,
    );

    ensureFiles(
      STAGE_44_3_REQUIRED,
      "pré-condição 44.3",
    );

    console.log(
      `[OK] Pré-condição 44.3: ${STAGE_44_3_REQUIRED.length} arquivos presentes.`,
    );

    ensureFiles(
      STAGE_44_4_REQUIRED,
      "Etapa 44.4",
    );

    console.log(
      `[OK] Etapa 44.4: ${STAGE_44_4_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoPrematureFiles();

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
      "=== TESTES DOMÍNIO 44.0 → 44.4 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-foundation.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
        "tests/domain-agent.test.ts",
        "tests/domain-item.test.ts",
        "tests/domain-inventory.test.ts",
        "tests/domain-ability-action.test.ts",
        "tests/domain-skill-tree.test.ts",
        "tests/domain-dialogue-graph.test.ts",
        "tests/domain-quest-goal.test.ts",
      ],
      "vitest domínio",
      [
        "Test Files",
        "Tests",
      ],
    );

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 44.4: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] DialogueGraph imutável e validado.",
    );
    console.log(
      "[OK] Loops de diálogo permitidos; referências quebradas/órfãs rejeitadas.",
    );
    console.log(
      "[OK] Branches usam condition IDs opacos, sem scripting concreto.",
    );
    console.log(
      "[OK] QuestGoal possui lifecycle e progresso event-driven.",
    );
    console.log(
      "[OK] QuestGoal snapshot/restauração validados.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D preservada.",
    );
    console.log(
      "[OK] Etapas 44.5+ não foram antecipadas.",
    );
    console.log(
      "[INFO] Próxima subetapa: 44.5 — SaveLoadUseCase.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 44.4: REPROVADA",
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
