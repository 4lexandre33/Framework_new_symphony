#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  NETWORKING_RUNTIME_FILES,
} from "./lib/layer1-networking-v1.mjs";

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
    "ETAPA82_MANIFEST.json",
  ]);

const STAGE_83_REQUIRED =
  Object.freeze([
    "LAYER1_NETWORKING_BASELINE_V1.json",
    "ETAPA83_NETWORKING_RUNTIME.txt",
    "ETAPA83_MANIFEST.json",
    "ETAPA83_SHA256SUMS.txt",

    ...NETWORKING_RUNTIME_FILES,

    "scripts/architecture/lib/layer1-networking-v1.mjs",
    "scripts/architecture/stage83-audit-networking.mjs",
    "scripts/architecture/stage83-validate-networking.mjs",

    "tests/layer1-networking-runtime.test.ts",
    "tests/layer1-networking-replication.test.ts",
    "tests/layer1-networking-service.test.ts",
    "tests/layer1-networking-smoke.mjs",
  ]);

const FOCUSED_TESTS =
  Object.freeze([
    "tests/layer1-networking-runtime.test.ts",
    "tests/layer1-networking-replication.test.ts",
    "tests/layer1-networking-service.test.ts",
  ]);

function fail(
  message,
) {
  throw new Error(message);
}

function abs(
  relativePath,
) {
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
    const target =
      abs(relativePath);

    if (
      !fs.existsSync(target) ||
      !fs.statSync(target).isFile()
    ) {
      fail(
        `${label}: arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function assertNoStage84() {
  const roots = [
    ROOT,
    abs(
      "scripts/architecture",
    ),
    abs("tests"),
  ];

  const found = [];

  for (const directory of roots) {
    if (
      !fs.existsSync(directory)
    ) {
      continue;
    }

    for (
      const entry of
      fs.readdirSync(
        directory,
        {
          withFileTypes:
            true,
        },
      )
    ) {
      if (
        /(?:ETAPA84|stage84|layer1-stage84)/iu.test(
          entry.name,
        )
      ) {
        found.push(
          path.relative(
            ROOT,
            path.join(
              directory,
              entry.name,
            ),
          ),
        );
      }
    }
  }

  if (found.length > 0) {
    fail(
      [
        "Etapa 84 encontrada antes da certificação da Etapa 83:",
        ...found.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 84 não foi antecipada.",
  );
}

function findStage82Audit() {
  const directory =
    abs(
      "scripts/architecture",
    );

  const candidates =
    fs.readdirSync(
      directory,
    )
      .filter(
        (name) =>
          /^stage82-audit-.*\.mjs$/u.test(
            name,
          ),
      )
      .sort();

  if (
    candidates.length ===
    0
  ) {
    fail(
      "Pré-requisito da Etapa 82 ausente: nenhum stage82-audit-*.mjs encontrado.",
    );
  }

  if (
    candidates.length >
    1
  ) {
    fail(
      `Etapa 82 ambígua: múltiplos auditors encontrados: ${candidates.join(", ")}`,
    );
  }

  return `scripts/architecture/${candidates[0]}`;
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
      result.stdout ??
      "",
    );

  const stderr =
    String(
      result.stderr ??
      "",
    );

  if (stdout.length > 0) {
    process.stdout.write(
      stdout,
    );
  }

  if (stderr.length > 0) {
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

  return {
    stdout,
    stderr,
  };
}

function sha256File(
  filePath,
) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(
        filePath,
      ),
    )
    .digest("hex");
}

function verifyManifestCoverage() {
  const manifest =
    JSON.parse(
      fs.readFileSync(
        abs(
          "ETAPA83_MANIFEST.json",
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
    const required of
    STAGE_83_REQUIRED.filter(
      (value) =>
        value !==
        "ETAPA83_SHA256SUMS.txt",
    )
  ) {
    if (!packaged.has(required)) {
      fail(
        `ETAPA83_MANIFEST.json não empacota arquivo obrigatório: ${required}`,
      );
    }
  }

  if (
    manifest.fileCount !==
    manifest.files.length
  ) {
    fail(
      "ETAPA83_MANIFEST.json possui fileCount inconsistente.",
    );
  }

  console.log(
    `[OK] Manifest cobre ${String(manifest.files.length)} arquivos da Etapa 83.`,
  );
}

function verifyChecksums() {
  const lines =
    fs.readFileSync(
      abs(
        "ETAPA83_SHA256SUMS.txt",
      ),
      "utf8",
    )
      .split(/\r?\n/gu)
      .map(
        (value) =>
          value.trim(),
      )
      .filter(Boolean);

  if (lines.length === 0) {
    fail(
      "ETAPA83_SHA256SUMS.txt está vazio.",
    );
  }

  for (const line of lines) {
    const match =
      /^([0-9a-f]{64})\s{2}(.+)$/u.exec(
        line,
      );

    if (!match) {
      fail(
        `Linha SHA-256 inválida: ${line}`,
      );
    }

    const expected =
      match[1];

    const relativePath =
      match[2];

    if (
      !expected ||
      !relativePath
    ) {
      fail(
        `Linha SHA-256 incompleta: ${line}`,
      );
    }

    const target =
      abs(relativePath);

    if (!fs.existsSync(target)) {
      fail(
        `Checksum referencia arquivo ausente: ${relativePath}`,
      );
    }

    const actual =
      sha256File(target);

    if (actual !== expected) {
      fail(
        `Checksum divergente: ${relativePath}`,
      );
    }
  }

  console.log(
    `[OK] ${String(lines.length)} checksums SHA-256 conferidos.`,
  );
}

function main() {
  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 83: NETWORKING RUNTIME",
  );
  console.log(
    "============================================================",
  );

  ensureFiles(
    PREVIOUS_REQUIRED,
    "Pré-requisitos",
  );

  ensureFiles(
    STAGE_83_REQUIRED,
    "Etapa 83",
  );

  console.log(
    `[OK] Etapa 83: ${String(STAGE_83_REQUIRED.length)} arquivos obrigatórios presentes.`,
  );

  verifyManifestCoverage();
  verifyChecksums();
  assertNoStage84();

  const stage82Audit =
    findStage82Audit();

  console.log(
    "\n=== STAGE 82 REGRESSION ===",
  );

  run(
    "node",
    [
      stage82Audit,
    ],
    "Stage 82 Audit",
  );

  console.log(
    "\n=== STAGE 83 NETWORKING AUDIT + STAGES 72/73/74 REGRESSION ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage83-audit-networking.mjs",
    ],
    "Stage 83 Audit",
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
    "\n=== NETWORKING TESTS ===",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
      ...FOCUSED_TESTS,
    ],
    "Networking Vitest",
  );

  console.log(
    "\n=== NETWORKING SMOKE ===",
  );

  run(
    "node",
    [
      "tests/layer1-networking-smoke.mjs",
    ],
    "Networking Smoke",
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
    [
      '============================================================',
      '  ETAPA 83: PASS',
      '============================================================',
      '[OK] Public API game.net v1 permanece inalterada.',
      '[OK] Plugin game.net preserva assinatura lifecycle da Etapa 74.',
      '[OK] WebSocket e Steam P2P permanecem transportes intercambiáveis.',
      '[OK] Payload, channel e peer IDs são validados antes de atravessar o runtime.',
      '[OK] WebSocket bufferedAmount e Steam pending bytes aplicam backpressure.',
      '[OK] Steam polling possui budget máximo por canal/tick.',
      '[OK] Disconnect limpa replicação e reconnect não reaproveita estado obsoleto.',
      '[OK] StateReplicator rejeita sequência stale e gera snapshot de mundo ordenado.',
      '[OK] NetworkService impede polls assíncronos concorrentes.',
      '[OK] Networking não importa Domain nem executa regras de gameplay.',
      '[OK] Architecture, TypeScript, Vitest, Cargo e build permanecem verdes.',
      '[INFO] Próxima etapa: 84 — Steamworks Integration.',
    ].join("\n"),
  );
}

try {
  main();
} catch (error) {
  console.error(
    "",
    "============================================================",
    "  ETAPA 83: REPROVADA",
    "============================================================",
  );

  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(error),
  );

  process.exitCode =
    1;
}
