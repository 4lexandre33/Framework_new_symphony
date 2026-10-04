#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "src/domain/ports/ClockPort.ts",
    "src/domain/ports/SaveGamePort.ts",
    "src/domain/ports/ModdingPort.ts",
    "src/domain/snapshots/SnapshotBundle.ts",
    "src/domain/snapshots/SnapshotCoordinator.ts",
    "src/domain/random/RandomSeed.ts",
    "src/domain/random/DeterministicRng.ts",
    "src/domain/random/RandomStream.ts",
    "src/services/usecases/SaveLoadUseCase.ts",
    "src/services/usecases/ModdingAppService.ts",
    "tests/domain-snapshots-headless.test.ts",
    "tests/domain-deterministic-rng.test.ts",
    "tests/domain-dimension-agnostic.test.ts",
  ]);

const STAGE_65_REQUIRED =
  Object.freeze([
    "src/domain/ports/DomainSaveGamePort.ts",
    "src/domain/ports/index.ts",
    "src/domain/ports/README.txt",
    "tests/domain-ports-review.test.ts",
    "tests/domain-ports-review-boundaries.test.ts",
  ]);

const SPECULATIVE_PORTS =
  Object.freeze([
    "src/domain/ports/RandomPort.ts",
    "src/domain/ports/RngPort.ts",
    "src/domain/ports/EventBusPort.ts",
    "src/domain/ports/EventPublisherPort.ts",
    "src/domain/ports/InputPort.ts",
    "src/domain/ports/RendererPort.ts",
    "src/domain/ports/PhysicsPort.ts",
    "src/domain/ports/AudioPort.ts",
    "src/domain/ports/SnapshotPort.ts",
    "src/domain/ports/TagPort.ts",
    "src/domain/ports/QuestPort.ts",
    "src/domain/ports/InventoryPort.ts",
    "src/domain/ports/ProgressionPort.ts",
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

function ensureAbsent(
  paths,
  label,
) {
  const present =
    paths.filter(
      (relativePath) =>
        fs.existsSync(
          abs(relativePath),
        ),
    );

  if (
    present.length > 0
  ) {
    fail(
      [
        label,
        ...present.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
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

function assertNoStage66Gate() {
  const forbidden = [
    "tests/domain-portability-gate-v2.test.ts",
    "scripts/architecture/stage66-validate-portability-gate.mjs",
    "scripts/architecture/stage66-validate-portability-gate-v2.mjs",
  ];

  ensureAbsent(
    forbidden,
    "Etapa 66 encontrada antes da hora:",
  );

  console.log(
    "[OK] Etapa 66 não foi antecipada.",
  );
}

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 65: PORTS REVIEW",
    );
    console.log(
      "============================================================",
    );

    ensureFiles(
      PREVIOUS_REQUIRED,
      "pré-condições 44 → 64",
    );

    console.log(
      `[OK] Pré-condições 44 → 64: ${PREVIOUS_REQUIRED.length} arquivos-chave presentes.`,
    );

    ensureFiles(
      STAGE_65_REQUIRED,
      "Etapa 65",
    );

    console.log(
      `[OK] Etapa 65: ${STAGE_65_REQUIRED.length} arquivos obrigatórios presentes.`,
    );

    ensureAbsent(
      SPECULATIVE_PORTS,
      "Ports especulativos encontrados:",
    );

    console.log(
      "[OK] Nenhum port especulativo foi criado.",
    );

    assertNoStage66Gate();

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
      "=== TESTES PORTS REVIEW ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-ports-review.test.ts",
        "tests/domain-ports-review-boundaries.test.ts",
        "tests/domain-foundation.test.ts",
        "tests/save-load-usecase.test.ts",
        "tests/modding-app-service.test.ts",
        "tests/domain-snapshots-headless.test.ts",
        "tests/domain-deterministic-rng.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Etapa 65",
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
      "  ETAPA 65: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] ClockPort revisado e mantido somente para tempo civil externo.",
    );
    console.log(
      "[OK] SaveGamePort<TState> preservado genérico e retrocompatível.",
    );
    console.log(
      "[OK] DomainSaveGamePort especializa save para SnapshotBundleSnapshot.",
    );
    console.log(
      "[OK] Versionamento save/bundle/codec permanece explícito em três níveis.",
    );
    console.log(
      "[OK] ModdingPort revisado e mantido como fronteira externa abstrata.",
    );
    console.log(
      "[OK] RandomPort/RngPort não foram criados; RNG da Etapa 64 permanece domínio puro.",
    );
    console.log(
      "[OK] Event/Input/Renderer/Physics/Audio/Snapshot ports especulativos não foram criados.",
    );
    console.log(
      "[OK] SaveLoadUseCase e ModdingAppService permanecem compatíveis.",
    );
    console.log(
      "[OK] Ports não expõem Core/engine/stack gráfica/física/plataforma.",
    );
    console.log(
      "[OK] Compatibilidade 2D / 2.5D / 3D / headless preservada.",
    );
    console.log(
      "[OK] Etapa 66 não foi antecipada.",
    );
    console.log(
      "[OK] Suíte completa e build permanecem verdes.",
    );
    console.log(
      "[INFO] Próxima etapa: 66 — Portability Gate v2.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 65: REPROVADA",
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
