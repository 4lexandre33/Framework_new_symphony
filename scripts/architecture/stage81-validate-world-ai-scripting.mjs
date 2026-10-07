#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  STAGE82_DEFERRED_WORLD_FILES,
  WORLD_AI_SCRIPTING_RUNTIME_FILES,
} from "./lib/layer1-world-ai-scripting-v1.mjs";

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
    "scripts/architecture/stage80-audit-presentation.mjs",
  ]);

const STAGE_81_META_FILES =
  Object.freeze([
    "LAYER1_WORLD_AI_SCRIPTING_BASELINE_V1.json",
    "ETAPA81_WORLD_AI_SCRIPTING.txt",
    "ETAPA81_MANIFEST.json",
    "ETAPA81_SHA256SUMS.txt",
    "scripts/architecture/lib/layer1-world-ai-scripting-v1.mjs",
    "scripts/architecture/stage81-audit-world-ai-scripting.mjs",
    "scripts/architecture/stage81-validate-world-ai-scripting.mjs",
    "tests/layer1-world-ai-scripting-world.test.ts",
    "tests/layer1-world-ai-scripting-ai.test.ts",
    "tests/layer1-world-ai-scripting-scripting.test.ts",
    "tests/layer1-world-ai-scripting-runtime.test.ts",
    "tests/layer1-world-ai-scripting-selftest.test.ts",
  ]);

const STAGE_81_REQUIRED =
  Object.freeze([
    ...STAGE_81_META_FILES,
    ...WORLD_AI_SCRIPTING_RUNTIME_FILES,
  ]);

const FOCUSED_TESTS =
  Object.freeze([
    "tests/layer1-world-ai-scripting-world.test.ts",
    "tests/layer1-world-ai-scripting-ai.test.ts",
    "tests/layer1-world-ai-scripting-scripting.test.ts",
    "tests/layer1-world-ai-scripting-runtime.test.ts",
    "tests/layer1-world-ai-scripting-selftest.test.ts",
    "tests/world-system.test.ts",
    "tests/ai-system.test.ts",
    "tests/scripting-system.test.ts",
  ]);

const SMOKES =
  Object.freeze([
    "tests/world-smoke-test.mjs",
    "tests/ai-smoke-test.mjs",
    "tests/scripting-smoke-test.mjs",
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
      abs(
        relativePath,
      );

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

function assertNoStage82() {
  const roots = [
    ROOT,
    abs(
      "scripts/architecture",
    ),
    abs(
      "tests",
    ),
  ];

  const found =
    [];

  for (
    const directory of
    roots
  ) {
    if (
      !fs.existsSync(
        directory,
      )
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
      const name =
        entry.name;

      if (
        /(?:ETAPA82|stage82|layer1-stage82)/iu.test(
          name,
        )
      ) {
        found.push(
          path.relative(
            ROOT,
            path.join(
              directory,
              name,
            ),
          ),
        );
      }
    }
  }

  if (
    found.length >
    0
  ) {
    fail(
      [
        "Etapa 82 encontrada antes da hora:",
        ...found.map(
          (value) =>
            `- ${value}`,
        ),
      ].join("\n"),
    );
  }

  console.log(
    "[OK] Etapa 82 não foi antecipada.",
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
          "ETAPA81_MANIFEST.json",
        ),
        "utf8",
      ),
    );

  const packaged =
    new Set(
      manifest.files ??
      [],
    );

  if (
    manifest.stage !==
    81
  ) {
    fail(
      "ETAPA81_MANIFEST.json possui número de etapa inválido.",
    );
  }

  if (
    manifest.fileCount !==
    STAGE_81_REQUIRED.length
  ) {
    fail(
      `ETAPA81_MANIFEST.json fileCount=${String(manifest.fileCount)}; esperado ${String(STAGE_81_REQUIRED.length)}.`,
    );
  }

  for (
    const required of
    STAGE_81_REQUIRED
  ) {
    if (
      !packaged.has(
        required,
      )
    ) {
      fail(
        `ETAPA81_MANIFEST.json não empacota arquivo obrigatório: ${required}`,
      );
    }
  }

  for (
    const deferred of
    STAGE82_DEFERRED_WORLD_FILES
  ) {
    if (
      packaged.has(
        deferred,
      )
    ) {
      fail(
        `ETAPA81_MANIFEST.json antecipou arquivo reservado à Etapa 82: ${deferred}`,
      );
    }
  }

  console.log(
    `[OK] Baseline e manifest cobrem os ${String(WORLD_AI_SCRIPTING_RUNTIME_FILES.length)} runtimes certificados.`,
  );
}

function sha256File(
  relativePath,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      fs.readFileSync(
        abs(
          relativePath,
        ),
      ),
    )
    .digest(
      "hex",
    );
}

function verifyChecksumManifest() {
  const checksumPath =
    abs(
      "ETAPA81_SHA256SUMS.txt",
    );

  const lines =
    fs.readFileSync(
      checksumPath,
      "utf8",
    )
      .split(/\r?\n/gu)
      .map(
        (line) =>
          line.trim(),
      )
      .filter(
        (line) =>
          line.length >
          0,
      );

  const expectedCount =
    STAGE_81_REQUIRED.length -
    1;

  if (
    lines.length !==
    expectedCount
  ) {
    fail(
      `ETAPA81_SHA256SUMS.txt contém ${String(lines.length)} entradas; esperado ${String(expectedCount)}.`,
    );
  }

  const seen =
    new Set();

  for (
    const line of
    lines
  ) {
    const match =
      /^([a-f0-9]{64})\s{2}(.+)$/u.exec(
        line,
      );

    if (!match) {
      fail(
        `linha SHA-256 inválida: ${line}`,
      );
    }

    const expectedHash =
      match[1];

    const relativePath =
      match[2];

    if (
      relativePath ===
      "ETAPA81_SHA256SUMS.txt"
    ) {
      fail(
        "ETAPA81_SHA256SUMS.txt não deve hashear a si próprio.",
      );
    }

    if (
      seen.has(
        relativePath,
      )
    ) {
      fail(
        `entrada SHA-256 duplicada: ${relativePath}`,
      );
    }

    seen.add(
      relativePath,
    );

    if (
      !STAGE_81_REQUIRED.includes(
        relativePath,
      )
    ) {
      fail(
        `SHA-256 referencia arquivo fora do pacote Stage 81: ${relativePath}`,
      );
    }

    const actualHash =
      sha256File(
        relativePath,
      );

    if (
      actualHash !==
      expectedHash
    ) {
      fail(
        `SHA-256 divergente para ${relativePath}: esperado ${expectedHash}, atual ${actualHash}`,
      );
    }
  }

  for (
    const required of
    STAGE_81_REQUIRED
  ) {
    if (
      required ===
      "ETAPA81_SHA256SUMS.txt"
    ) {
      continue;
    }

    if (
      !seen.has(
        required,
      )
    ) {
      fail(
        `SHA-256 ausente para ${required}`,
      );
    }
  }

  console.log(
    `[OK] SHA-256: ${String(lines.length)} arquivos verificados.`,
  );
}

function main() {
  console.log(
    "============================================================",
  );

  console.log(
    "  PROJETO1 — ETAPA 81: WORLD / AI / SCRIPTING",
  );

  console.log(
    "============================================================",
  );

  ensureFiles(
    PREVIOUS_REQUIRED,
    "Pré-requisitos",
  );

  ensureFiles(
    STAGE_81_REQUIRED,
    "Etapa 81",
  );

  console.log(
    `[OK] Etapa 81: ${String(STAGE_81_REQUIRED.length)} arquivos obrigatórios presentes.`,
  );

  verifyManifestCoverage();
  verifyChecksumManifest();
  assertNoStage82();

  console.log(
    "\n=== STAGE 80 REGRESSION ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage80-audit-presentation.mjs",
    ],
    "Stage 80 Audit",
  );

  console.log(
    "\n=== STAGE 81 WORLD / AI / SCRIPTING AUDIT ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage81-audit-world-ai-scripting.mjs",
    ],
    "Stage 81 Audit",
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
    "\n=== WORLD / AI / SCRIPTING TESTS ===",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
      ...FOCUSED_TESTS,
    ],
    "World/AI/Scripting Vitest",
  );

  console.log(
    "\n=== WORLD / AI / SCRIPTING SMOKES ===",
  );

  for (
    const smoke of
    SMOKES
  ) {
    run(
      "node",
      [
        smoke,
      ],
      smoke,
    );
  }

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
    "  ETAPA 81: PASS",
    "============================================================",
    "[OK] Public APIs game.world, game.ai e game.scripting v1 permanecem inalteradas.",
    "[OK] Capability graph da Etapa 73 permanece inalterado.",
    "[OK] Assinaturas lifecycle de World/AI/Scripting permanecem compatíveis com a Etapa 74.",
    "[OK] Regressão semântica da Etapa 80 permanece verde.",
    "[OK] World mantém lifetime de entidades e SpatialGrid/Octree coerentes após movement/despawn/reload.",
    "[OK] AI limpa agentes/NavMesh e libera referências de Physics/World no teardown.",
    "[OK] Scripting limpa cutscene/dialogue/quest/trigger state e não cria callbacks por tick/check.",
    "[OK] Engine World/AI/Scripting não importa regras autoritativas do Domain.",
    "[OK] 12 hot paths certificados possuem zero allocation literal/new/function explícita.",
    "[OK] Zero explicit any nos 20 arquivos de runtime certificados.",
    "[OK] SaveSystem permanece reservado à Etapa 82.",
    "[OK] Etapa 82 não foi antecipada.",
    "[OK] Architecture, TypeScript, Vitest, smokes, Cargo e build permanecem verdes.",
    "[INFO] Próxima etapa: 82.",
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
    "  ETAPA 81: REPROVADA",
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
