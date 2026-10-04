#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/entities/DomainId.ts",
    "src/domain/state/StateStore.ts",
    "src/domain/time/DomainDuration.ts",
    "src/domain/time/SimulationTimer.ts",
    "src/domain/events/DomainEvent.ts",
    "src/domain/evaluation/ConditionEvaluator.ts",
    "src/domain/mechanics/AbilityAction.ts",
    "src/domain/mechanics/StatusEffect.ts",
    "src/domain/mechanics/Modifier.ts",
    "src/domain/mechanics/ModifierSet.ts",
    "tests/domain-modifiers.test.ts",
    "tests/domain-status-effects.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_53_REQUIRED =
  Object.freeze([
    "src/domain/mechanics/ResourceId.ts",
    "src/domain/mechanics/ResourcePool.ts",
    "src/domain/mechanics/CooldownId.ts",
    "src/domain/mechanics/Cooldown.ts",
    "src/domain/mechanics/CooldownSet.ts",
    "src/domain/mechanics/index.ts",
    "src/domain/mechanics/README.txt",
    "tests/domain-resources-cooldowns.test.ts",
    "tests/domain-resources-cooldowns-purity.test.ts",
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

function assertNoStage54Files() {
  const forbidden = [
    "src/domain/interaction/InteractionId.ts",
    "src/domain/interaction/InteractionIntent.ts",
    "src/domain/interaction/Affordance.ts",
    "src/domain/interaction/InteractionRequirement.ts",
    "src/domain/interaction/InteractionOutcome.ts",
    "src/domain/interaction/index.ts",
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
        "Arquivos da Etapa 54 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 54 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 53: RESOURCES + COOLDOWNS",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 52",
    );

    console.log(
      `[OK] Pré-condições 44 → 52: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_53_REQUIRED,
      "Etapa 53",
    );

    console.log(
      `[OK] Etapa 53: ${STAGE_53_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage54Files();

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
      "=== TESTES RESOURCES + COOLDOWNS ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-resources-cooldowns.test.ts",
        "tests/domain-resources-cooldowns-purity.test.ts",
        "tests/domain-modifiers.test.ts",
        "tests/domain-time.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 53",
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
      "  ETAPA 53: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] ResourceId e ResourcePool implementados.",
    );
    console.log(
      "[OK] trySpend atômico, gain saturado e capacidade mutável validados.",
    );
    console.log(
      "[OK] CooldownId e Cooldown determinístico implementados.",
    );
    console.log(
      "[OK] start/restart/clear/advance/snapshot/restore validados.",
    );
    console.log(
      "[OK] CooldownSet implementado com Map e avanço sem arrays temporários.",
    );
    console.log(
      "[OK] Agent.health não foi migrado nem duplicado automaticamente.",
    );
    console.log(
      "[OK] Integrações Ability/Status/Modifier não foram antecipadas.",
    );
    console.log(
      "[OK] Zero wall clock/renderer/physics/Core/engine em Resources/Cooldowns.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 54 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 54 — Interaction / Affordances.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 53: REPROVADA",
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
