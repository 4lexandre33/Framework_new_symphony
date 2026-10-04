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
    "src/domain/ports/ModdingPort.ts",
    "src/domain/ports/SaveGamePort.ts",
    "src/services/usecases/SaveLoadUseCase.ts",
    "tests/domain-dimension-agnostic.test.ts",
    "tests/save-load-usecase.test.ts",
  ]);

const STAGE_44_6_REQUIRED =
  Object.freeze([
    "src/services/usecases/ModdingAppService.ts",
    "src/services/usecases/index.ts",
    "tests/modding-app-service.test.ts",
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
        "arquivos da Etapa 44.7 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] GameFlowFSM (44.7) não foi antecipado.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 44.6: MODDING APP SERVICE",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44.0 → 44.5",
    );

    console.log(
      `[OK] Pré-condições 44.0 → 44.5: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_44_6_REQUIRED,
      "Etapa 44.6",
    );

    console.log(
      `[OK] Etapa 44.6: ${STAGE_44_6_REQUIRED.length} arquivos obrigatórios presentes.`,
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
      "=== TESTES 44.0 → 44.6 ===",
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
        "tests/save-load-usecase.test.ts",
        "tests/modding-app-service.test.ts",
      ],
      "vitest 44.0 → 44.6",
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
      "  ETAPA 44.6: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] ModdingAppService depende somente de ModdingPort.",
    );
    console.log(
      "[OK] list/refresh detectam ModId duplicado.",
    );
    console.log(
      "[OK] enable/disable validam identidade e estado retornados.",
    );
    console.log(
      "[OK] Falhas do adapter permanecem tipadas como port-error.",
    );
    console.log(
      "[OK] Sem plugins, engine internals, ScriptSandbox, Steam Workshop ou Tauri.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D preservada.",
    );
    console.log(
      "[OK] Etapa 44.7 não foi antecipada.",
    );
    console.log(
      "[INFO] Próxima subetapa: 44.7 — GameFlowFSM.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 44.6: REPROVADA",
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
