#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";

const ROOT =
  process.cwd();

const REQUIRED =
  Object.freeze([
    "LAYER1_NATIVE_TAURI_BASELINE_V1.json",
    "ETAPA85_NATIVE_TAURI_INFRASTRUCTURE.txt",
    "scripts/architecture/lib/layer1-native-tauri-v1.mjs",
    "scripts/architecture/stage85-audit-native-tauri.mjs",
    "scripts/architecture/stage85-validate-native-tauri.mjs",
    "scripts/architecture/stage85-finalize-native-tauri.mjs",
    "tests/layer1-native-tauri-contract.test.ts",
    "tests/layer1-native-tauri-selftest.test.ts",
    "tests/layer1-native-tauri-security.test.ts",
  ]);

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function ensureFiles() {
  for (
    const relativePath of
    REQUIRED
  ) {
    const target =
      path.join(
        ROOT,
        ...relativePath.split(
          "/",
        ),
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
        `Arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function quote(
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

function run(
  executable,
  args,
  label,
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

  const result =
    process.platform ===
      "win32"
      ? spawnSync(
          process.env
            .ComSpec ??
            process.env
              .COMSPEC ??
            "C:\\Windows\\System32\\cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            [
              executable,
              ...args,
            ]
              .map(
                quote,
              )
              .join(
                " ",
              ),
          ],
          options,
        )
      : spawnSync(
          executable,
          args,
          options,
        );

  if (
    result.stdout
  ) {
    process.stdout.write(
      result.stdout,
    );
  }

  if (
    result.stderr
  ) {
    process.stderr.write(
      result.stderr,
    );
  }

  if (
    result.status !==
      0
  ) {
    fail(
      `${label} falhou com exit code ${String(result.status)}`,
    );
  }

  console.log(
    `[OK] ${label}`,
  );
}

function currentRuntimeFingerprint() {
  const baseline =
    JSON.parse(
      fs.readFileSync(
        path.join(
          ROOT,
          "LAYER1_NATIVE_TAURI_BASELINE_V1.json",
        ),
        "utf8",
      ),
    );

  const hash =
    crypto.createHash(
      "sha256",
    );

  for (
    const relativePath of
    Object.keys(
      baseline.ownedFileSha256 ??
      {},
    ).sort()
  ) {
    hash.update(
      relativePath,
    );

    hash.update(
      fs.readFileSync(
        path.join(
          ROOT,
          ...relativePath.split(
            "/",
          ),
        ),
      ),
    );
  }

  return hash.digest(
    "hex",
  );
}

try {
  ensureFiles();

  console.log(
    "============================================================",
  );
  console.log(
    " STAGE 85 — NATIVE / TAURI INFRASTRUCTURE VALIDATOR",
  );
  console.log(
    "============================================================",
  );

  run(
    "node",
    [
      "scripts/architecture/stage85-audit-native-tauri.mjs",
    ],
    "Stage85 semantic audit",
  );

  run(
    "npm",
    [
      "run",
      "arch:check",
    ],
    "Architecture boundaries/dependencies",
  );

  run(
    "npx",
    [
      "tsc",
      "--noEmit",
    ],
    "TypeScript",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
      "tests/layer1-native-tauri-contract.test.ts",
      "tests/layer1-native-tauri-selftest.test.ts",
      "tests/layer1-native-tauri-security.test.ts",
    ],
    "Focused Stage85 Vitest",
  );

  run(
    "npx",
    [
      "vitest",
      "run",
    ],
    "Vitest full",
  );

  run(
    "cargo",
    [
      "check",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ],
    "Cargo check",
  );

  run(
    "npm",
    [
      "run",
      "build",
    ],
    "Production web build",
  );

  run(
    "git",
    [
      "diff",
      "--check",
    ],
    "git diff --check",
  );

  const marker = {
    schemaVersion:
      1,

    stage:
      85,

    automatedGates:
      "PASS",

    generatedAt:
      new Date()
        .toISOString(),

    runtimeFingerprint:
      currentRuntimeFingerprint(),

    nativeSmokeRequired:
      true,
  };

  fs.writeFileSync(
    path.join(
      ROOT,
      "ETAPA85_AUTOMATED_PASS.json",
    ),
    `${JSON.stringify(
      marker,
      null,
      2,
    )}\n`,
  );

  console.log(
    "============================================================",
  );
  console.log(
    " STAGE 85 AUTOMATED GATES: PASS",
  );
  console.log(
    " Native Tauri smoke ainda é obrigatório para o PASS final.",
  );
  console.log(
    " Execute: npm run stage85:smoke",
  );
  console.log(
    " Feche a janela normalmente e depois execute: npm run stage85:finalize",
  );
  console.log(
    "============================================================",
  );
} catch (
  error
) {
  console.error(
    error instanceof Error
      ? error.stack ??
          error.message
      : String(
          error,
        ),
  );

  console.error(
    "STAGE 85 AUTOMATED GATES: FAIL",
  );

  process.exitCode =
    1;
}
