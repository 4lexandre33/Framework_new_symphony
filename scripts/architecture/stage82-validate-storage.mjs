#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  STORAGE_RUNTIME_FILES,
} from "./lib/layer1-storage-v1.mjs";

const ROOT =
  process.cwd();

const PREVIOUS_REQUIRED =
  Object.freeze([
    "LAYER1_BASELINE_V1.json",
    "LAYER1_PUBLIC_API_BASELINE_V1.json",
    "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
    "LAYER1_LIFECYCLE_BASELINE_V1.json",
    "LAYER1_GAME_LOOP_BASELINE_V1.json",
    "LAYER1_RENDERING_BASELINE_V1.json",
    "LAYER1_PHYSICS_BASELINE_V1.json",
    "LAYER1_INPUT_BASELINE_V1.json",
    "LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_V1.json",
    "LAYER1_PRESENTATION_BASELINE_V1.json",
    "ETAPA80_MANIFEST.json",
    "ETAPA81_MANIFEST.json",
  ]);

const STAGE_82_REQUIRED =
  Object.freeze([
    "LAYER1_STORAGE_BASELINE_V1.json",
    "ETAPA82_STORAGE_PERSISTENCE.txt",
    "ETAPA82_MANIFEST.json",
    "ETAPA82_SHA256SUMS.txt",

    ...STORAGE_RUNTIME_FILES,

    "scripts/architecture/lib/layer1-storage-v1.mjs",
    "scripts/architecture/stage82-audit-storage.mjs",
    "scripts/architecture/stage82-validate-storage.mjs",

    "tests/layer1-storage-runtime.test.ts",
    "tests/layer1-storage-service.test.ts",
    "tests/layer1-storage-domain-port.test.ts",
    "tests/layer1-storage-selftest.test.ts",
  ]);

const FOCUSED_TESTS =
  Object.freeze([
    "tests/layer1-storage-runtime.test.ts",
    "tests/layer1-storage-service.test.ts",
    "tests/layer1-storage-domain-port.test.ts",
    "tests/layer1-storage-selftest.test.ts",

    "tests/storage-system.test.ts",
    "tests/storage-persistence.test.ts",
    "tests/storage-cloud-db.test.ts",
  ]);

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function abs(
  relativePath,
) {
  return path.join(
    ROOT,
    ...relativePath.split(
      "/",
    ),
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
    const target =
      abs(
        relativePath,
      );

    if (
      !fs.existsSync(
        target,
      ) ||
      !fs.statSync(
        target,
      ).isFile()
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
    cwd:
      ROOT,

    encoding:
      "utf8",

    windowsHide:
      true,

    stdio: [
      "ignore",
      "pipe",
      "pipe",
    ],

    maxBuffer:
      128 *
      1024 *
      1024,
  };

  if (
    process.platform !==
      "win32"
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
      .map(
        quoteCmdPart,
      )
      .join(
        " ",
      );

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
      result.stdout ??
      "",
    );

  const stderr =
    String(
      result.stderr ??
      "",
    );

  if (
    stdout.length >
    0
  ) {
    process.stdout.write(
      stdout,
    );
  }

  if (
    stderr.length >
    0
  ) {
    process.stderr.write(
      stderr,
    );
  }

  if (
    result.error !==
      undefined
  ) {
    fail(
      `${label} não pôde ser iniciado: ${result.error.message}`,
    );
  }

  if (
    result.status !==
      0
  ) {
    fail(
      `${label} falhou com código ${String(result.status)}.`,
    );
  }
}

function verifyManifestCoverage() {
  const manifest =
    JSON.parse(
      fs.readFileSync(
        abs(
          "ETAPA82_MANIFEST.json",
        ),
        "utf8",
      ),
    );

  const packaged =
    new Set(
      manifest.files ??
      [],
    );

  for (
    const runtimeFile of
    STORAGE_RUNTIME_FILES
  ) {
    if (
      !packaged.has(
        runtimeFile,
      )
    ) {
      fail(
        `ETAPA82_MANIFEST.json não empacota runtime certificado: ${runtimeFile}`,
      );
    }
  }

  console.log(
    `[OK] Manifest cobre os ${String(STORAGE_RUNTIME_FILES.length)} runtimes certificados.`,
  );
}

function main() {
  console.log(
    "============================================================",
  );

  console.log(
    "  PROJETO1 — ETAPA 82: STORAGE & PERSISTENCE INFRASTRUCTURE",
  );

  console.log(
    "============================================================",
  );

  ensureFiles(
    PREVIOUS_REQUIRED,
    "Pré-requisitos",
  );

  ensureFiles(
    STAGE_82_REQUIRED,
    "Etapa 82",
  );

  verifyManifestCoverage();

  console.log(
    "\n=== STAGE 82 STORAGE AUDIT ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage82-audit-storage.mjs",
    ],
    "Stage 82 Audit",
  );

  console.log(
    "\n=== ARCHITECTURE ===",
  );

  run(
    "npm",
    [
      "run",
      "arch:check",
    ],
    "Architecture Check",
  );

  console.log(
    "\n=== TYPESCRIPT ===",
  );

  run(
    "npx",
    [
      "tsc",
      "--noEmit",
    ],
    "TypeScript",
  );

  console.log(
    "\n=== STORAGE TESTS ===",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
      ...FOCUSED_TESTS,
    ],
    "Storage Vitest",
  );

  console.log(
    "\n=== STORAGE SMOKE ===",
  );

  run(
    "node",
    [
      "tests/storage-smoke-test.mjs",
    ],
    "Storage Smoke",
  );

  console.log(
    "\n=== FULL VITEST ===",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
    ],
    "Full Vitest",
  );

  console.log(
    "\n=== CARGO ===",
  );

  run(
    "cargo",
    [
      "check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ],
    "Cargo Check",
  );

  console.log(
    "\n=== BUILD ===",
  );

  run(
    "npm",
    [
      "run",
      "build",
    ],
    "Build",
  );

  console.log(
    "",
    "============================================================",
    "  ETAPA 82: PASS",
    "============================================================",
    "[OK] Public API game.storage v1 permanece inalterada.",
    "[OK] Capability graph da Etapa 73 permanece inalterado.",
    "[OK] Local/Steam save slots usam codec único com checksum e leitura legado.",
    "[OK] Corrupção de payload é detectada antes de desserializar estado de jogo.",
    "[OK] cloud_database não é mais fallback implícito para save local.",
    "[OK] Backend local está isolado atrás de KeyValueStorageBackend.",
    "[OK] SteamCloudDriver está pronto para backend Remote Storage da Etapa 84.",
    "[OK] CloudDatabaseDriver está pronto para backend remoto sem credenciais/fetch no frontend.",
    "[OK] DomainSaveGamePortAdapter implementa o port por dependências type-only.",
    "[OK] Domain permanece sem imports de Engine/Storage.",
    "[OK] Storage não atravessa game.world/internal; WorldStateSerializer mantém ownership de game.world.",
    "[OK] Lifecycle dispose do storage plugin é explícito e idempotente.",
    "[OK] Etapas 83/84/85 não foram antecipadas.",
    "[OK] Architecture, TypeScript, Vitest, smoke, Cargo e build permanecem verdes.",
    "[INFO] Próxima etapa: 83 — Networking Runtime.",
  );
}

try {
  main();
} catch (
  error
) {
  console.error(
    "",
    "============================================================",
    "  ETAPA 82: REPROVADA",
    "============================================================",
  );

  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(
          error,
        ),
  );

  process.exitCode =
    1;
}
