#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const STAGE_44_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/entities/Agent.ts",
    "src/domain/economy/Item.ts",
    "src/domain/economy/Inventory.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/mechanics/SkillTreeGraph.ts",
    "src/domain/narrative/DialogueGraph.ts",
    "src/domain/narrative/QuestGoal.ts",
    "src/domain/ports/ClockPort.ts",
    "src/domain/ports/SaveGamePort.ts",
    "src/domain/ports/ModdingPort.ts",
    "src/services/usecases/SaveLoadUseCase.ts",
    "src/services/usecases/ModdingAppService.ts",
    "src/app/flows/GameFlowFSM.ts",
    "src/app/flows/index.ts",
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
    "tests/game-flow-fsm.test.ts",
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

function ensureFiles() {
  for (
    const relativePath of
    STAGE_44_REQUIRED
  ) {
    const full =
      abs(relativePath);

    if (
      !fs.existsSync(full) ||
      !fs.statSync(full).isFile()
    ) {
      fail(
        `arquivo obrigatório da Etapa 44 ausente: ${relativePath}`,
      );
    }
  }

  console.log(
    `[OK] Etapa 44: ${STAGE_44_REQUIRED.length} arquivos-chave presentes.`,
  );
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

  console.log(
    `[OK] ${label}`,
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 44.7: GAME FLOW FSM + GATE FINAL",
    );
    console.log(
      "============================================================",
    );

    ensureFiles();

    console.log("");
    console.log(
      "=== ARCHITECTURE AUDIT ===",
    );

    run(
      "npm",
      ["run", "arch:audit"],
      "arch:audit",
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
      "=== SUÍTE COMPLETA VITEST ===",
    );

    run(
      "npx",
      ["vitest", "run"],
      "vitest completo",
    );

    console.log("");
    console.log(
      "=== BUILD COMPLETO ===",
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
      "  ETAPA 44.7: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] GameFlowFSM implementada com transições explícitas.",
    );
    console.log(
      "[OK] Save retorna corretamente para playing/paused.",
    );
    console.log(
      "[OK] loading e returning-to-menu são estados transitórios explícitos.",
    );
    console.log(
      "[OK] shutdown é terminal e controlado.",
    );
    console.log(
      "[OK] FSM sem fixed tick, render loop, plugins ou engine internals.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D preservada.",
    );

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 44: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Camada 2 real implementada: Agent, Item, Inventory, AbilityAction, SkillTreeGraph, DialogueGraph, QuestGoal.",
    );
    console.log(
      "[OK] Camada 3 real implementada: SaveLoadUseCase, ModdingAppService.",
    );
    console.log(
      "[OK] Camada 4 / flows implementada: GameFlowFSM.",
    );
    console.log(
      "[OK] arch:audit, tsc, Vitest completo e build concluídos.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 44.7 / ETAPA 44: REPROVADA",
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
