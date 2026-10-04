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
    "src/domain/economy/index.ts",
    "tests/domain-inventory.test.ts",
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
      "src/domain/mechanics/AbilityAction.ts",
      "src/domain/mechanics/SkillTreeGraph.ts",
      "src/domain/narrative/DialogueGraph.ts",
      "src/domain/narrative/QuestGoal.ts",
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
    "[OK] Nenhum arquivo das Etapas 44.3+ foi antecipado.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 44.2: INVENTORY",
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
      "Etapa 44.2",
    );

    console.log(
      `[OK] Etapa 44.2: ${STAGE_44_2_REQUIRED.length} arquivos obrigatórios presentes.`,
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
      "=== TESTES DOMÍNIO 44.0 + 44.1 + 44.2 ===",
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
      "  ETAPA 44.2: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] Inventory implementado com Map<ItemId, entry>.",
    );
    console.log(
      "[OK] add/remove/get/has em O(1) médio.",
    );
    console.log(
      "[OK] maxStack respeitado sem arrays de stacks no caminho comum.",
    );
    console.log(
      "[OK] capacidade por slots é opcional e atualizada incrementalmente.",
    );
    console.log(
      "[OK] snapshot determinístico somente sob demanda.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D preservada.",
    );
    console.log(
      "[OK] Etapas 44.3+ não foram antecipadas.",
    );
    console.log(
      "[INFO] Próxima subetapa: 44.3 — AbilityAction + SkillTreeGraph.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 44.2: REPROVADA",
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
