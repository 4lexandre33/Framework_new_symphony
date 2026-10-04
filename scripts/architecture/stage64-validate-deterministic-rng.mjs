#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/economy/LootTable.ts",
    "src/domain/economy/RewardPolicy.ts",
    "src/domain/snapshots/SnapshotCodec.ts",
    "src/domain/snapshots/DomainSnapshotRegistry.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/snapshots/StandardSnapshotCodecs.ts",
    "src/domain/integration/RewardGrantIntegration.ts",
    "tests/domain-snapshots-headless.test.ts",
    "tests/domain-cross-integration-headless.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_64_REQUIRED =
  Object.freeze([
    "src/domain/random/RandomSeed.ts",
    "src/domain/random/DeterministicRng.ts",
    "src/domain/random/RandomStream.ts",
    "src/domain/random/RandomSnapshotCodecs.ts",
    "src/domain/random/index.ts",
    "src/domain/random/README.txt",
    "tests/domain-deterministic-rng.test.ts",
    "tests/domain-deterministic-rng-loot.test.ts",
    "tests/domain-deterministic-rng-purity.test.ts",
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

function assertNoStage65PortsWork() {
  const forbidden = [
    "src/domain/ports/RandomPort.ts",
    "src/domain/ports/RngPort.ts",
    "src/domain/ports/DomainRandomPort.ts",
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
        "Ports da Etapa 65 encontrados antes da hora:",
        ...unexpected.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 65 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 64: DETERMINISTIC RNG",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 63",
    );

    console.log(
      `[OK] Pré-condições 44 → 63: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_64_REQUIRED,
      "Etapa 64",
    );

    console.log(
      `[OK] Etapa 64: ${STAGE_64_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    assertNoStage65PortsWork();

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
      "=== TESTES DETERMINISTIC RNG ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-deterministic-rng.test.ts",
        "tests/domain-deterministic-rng-loot.test.ts",
        "tests/domain-deterministic-rng-purity.test.ts",
        "tests/domain-economy-complete.test.ts",
        "tests/domain-snapshots.test.ts",
        "tests/domain-snapshots-headless.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 64",
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
      "  ETAPA 64: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] RandomSeed 128-bit explícita/derivável implementada.",
    );
    console.log(
      "[OK] xoshiro128** v1 determinístico implementado.",
    );
    console.log(
      "[OK] Golden sequence fixa protege contra drift de algoritmo.",
    );
    console.log(
      "[OK] nextFloat/nextInt/nextFloatRange/nextBoolean implementados.",
    );
    console.log(
      "[OK] nextInt usa rejection sampling sem modulo bias.",
    );
    console.log(
      "[OK] Snapshot/restore continua exatamente a sequência RNG.",
    );
    console.log(
      "[OK] RandomStream/Factory isolam subsistemas por stream nomeado.",
    );
    console.log(
      "[OK] Fork de stream não depende do drawCount do parent.",
    );
    console.log(
      "[OK] LootTable usa RNG oficial sem alterações na Economy.",
    );
    console.log(
      "[OK] RNG/RandomStream podem compor SnapshotCoordinator da Etapa 63.",
    );
    console.log(
      "[OK] Zero Math.random/clock/crypto/Core/engine/plataforma em Random.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 65 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 65 — Ports Review.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 64: REPROVADA",
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
