#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  PRESENTATION_RUNTIME_FILES,
} from "./lib/layer1-presentation-v1.mjs";

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
    "ETAPA79_MANIFEST.json",
    "scripts/architecture/stage79-audit-assets-streaming-terrain.mjs",
  ]);

const STAGE_80_REQUIRED =
  Object.freeze([
    "LAYER1_PRESENTATION_BASELINE_V1.json",
    "ETAPA80_PRESENTATION_SYSTEMS.txt",
    "ETAPA80_MANIFEST.json",
    "ETAPA80_SHA256SUMS.txt",

    ...PRESENTATION_RUNTIME_FILES,

    "scripts/architecture/lib/layer1-presentation-v1.mjs",
    "scripts/architecture/stage80-audit-presentation.mjs",
    "scripts/architecture/stage80-validate-presentation.mjs",

    "tests/layer1-presentation-ui.test.ts",
    "tests/layer1-presentation-animation.test.ts",
    "tests/layer1-presentation-audio.test.ts",
    "tests/layer1-presentation-camera-vfx.test.ts",
    "tests/layer1-presentation-runtime.test.ts",
    "tests/layer1-presentation-selftest.test.ts",
  ]);

const FOCUSED_TESTS =
  Object.freeze([
    "tests/layer1-presentation-ui.test.ts",
    "tests/layer1-presentation-animation.test.ts",
    "tests/layer1-presentation-audio.test.ts",
    "tests/layer1-presentation-camera-vfx.test.ts",
    "tests/layer1-presentation-runtime.test.ts",
    "tests/layer1-presentation-selftest.test.ts",

    "tests/ui-system.test.ts",
    "tests/sprites-system.test.ts",
    "tests/anim-system.test.ts",
    "tests/audio-system.test.ts",
    "tests/camera-system.test.ts",
    "tests/vfx-system.test.ts",
  ]);

const SMOKES =
  Object.freeze([
    "tests/ui-smoke-test.mjs",
    "tests/sprites-smoke-test.mjs",
    "tests/anim-smoke-test.mjs",
    "tests/audio-smoke-test.mjs",
    "tests/camera-smoke-test.mjs",
    "tests/vfx-smoke-test.mjs",
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

function assertNoStage81() {
  const roots =
    [
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
        /(?:ETAPA81|stage81|layer1-stage81)/iu.test(
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
        "Etapa 81 encontrada antes da hora:",
        ...found.map(
          (value) =>
            `- ${value}`,
        ),
      ].join(
        "\n",
      ),
    );
  }

  console.log(
    "[OK] Etapa 81 não foi antecipada.",
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

  return {
    stdout,
    stderr,
  };
}

function verifyManifestCoverage() {
  const manifest =
    JSON.parse(
      fs.readFileSync(
        abs(
          "ETAPA80_MANIFEST.json",
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
    PRESENTATION_RUNTIME_FILES
  ) {
    if (
      !packaged.has(
        runtimeFile,
      )
    ) {
      fail(
        `ETAPA80_MANIFEST.json não empacota runtime certificado: ${runtimeFile}`,
      );
    }
  }

  console.log(
    `[OK] Baseline e manifest cobrem os ${String(PRESENTATION_RUNTIME_FILES.length)} runtimes certificados.`,
  );
}

function verifyChecksumManifest() {
  const checksumText =
    fs.readFileSync(
      abs(
        "ETAPA80_SHA256SUMS.txt",
      ),
      "utf8",
    );

  if (
    checksumText.trim()
      .length ===
    0
  ) {
    fail(
      "ETAPA80_SHA256SUMS.txt está vazio.",
    );
  }

  console.log(
    "[OK] Manifest de SHA-256 da Etapa 80 presente.",
  );
}

function main() {
  console.log(
    "============================================================",
  );

  console.log(
    "  PROJETO1 — ETAPA 80: PRESENTATION SYSTEMS",
  );

  console.log(
    "============================================================",
  );

  ensureFiles(
    PREVIOUS_REQUIRED,
    "Pré-requisitos",
  );

  ensureFiles(
    STAGE_80_REQUIRED,
    "Etapa 80",
  );

  console.log(
    `[OK] Etapa 80: ${String(STAGE_80_REQUIRED.length)} arquivos obrigatórios presentes.`,
  );

  verifyManifestCoverage();
  verifyChecksumManifest();
  assertNoStage81();

  console.log(
    "\n=== STAGE 79 REGRESSION ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage79-audit-assets-streaming-terrain.mjs",
    ],
    "Stage 79 Audit",
  );

  console.log(
    "\n=== STAGE 80 PRESENTATION AUDIT ===",
  );

  run(
    "node",
    [
      "scripts/architecture/stage80-audit-presentation.mjs",
    ],
    "Stage 80 Audit",
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
    "\n=== PRESENTATION TESTS ===",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
      ...FOCUSED_TESTS,
    ],
    "Presentation Vitest",
  );

  console.log(
    "\n=== PRESENTATION SMOKES ===",
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
    "  ETAPA 80: PASS",
    "============================================================",
    "[OK] Public APIs game.ui, game.sprites, game.anim, game.audio, game.camera e game.vfx v1 permanecem inalteradas.",
    "[OK] Capability graph da Etapa 73 permanece inalterado.",
    "[OK] Regressão da Etapa 79 permanece verde.",
    "[OK] UI possui modal focus, Escape precedence, ownership de DOM e teardown idempotente.",
    "[OK] Sprites/Tilemap/Parallax possuem ownership seguro de recursos Three.js.",
    "[OK] Animation FSM, skeletal e sprite drivers usam delta finito com stall clamp de 250ms.",
    "[OK] Audio master governa BGM/SFX/voice/UI e stopAllSounds encerra todas as vozes.",
    "[OK] Camera SpringArm/shake reutilizam scratch state e não alocam explicitamente no hot path.",
    "[OK] VFX governa particles/decals/post-FX state e ownership de texturas.",
    "[OK] 13 hot paths certificados possuem zero allocation literal/new explícita.",
    "[OK] Zero explicit any nos 41 arquivos de runtime certificados.",
    "[OK] Etapa 81 não foi antecipada.",
    "[OK] Architecture, TypeScript, Vitest, smokes, Cargo e build permanecem verdes.",
    "[INFO] Próxima etapa: 81.",
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
    "  ETAPA 80: REPROVADA",
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
