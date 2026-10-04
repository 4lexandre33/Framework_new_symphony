#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const REQUIRED_FILES = Object.freeze([
  "src/domain/entities/DomainId.ts",
  "src/domain/entities/VersionedSnapshot.ts",
  "src/domain/entities/index.ts",
  "src/domain/evaluation/DomainResult.ts",
  "src/domain/evaluation/index.ts",
  "src/domain/ports/ClockPort.ts",
  "src/domain/ports/SaveGamePort.ts",
  "src/domain/ports/ModdingPort.ts",
  "src/domain/ports/index.ts",
  "tests/domain-foundation.test.ts",
  "tests/domain-dimension-agnostic.test.ts",
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
    REQUIRED_FILES
  ) {
    const full =
      abs(relativePath);

    if (
      !fs.existsSync(full) ||
      !fs.statSync(full).isFile()
    ) {
      fail(
        `arquivo obrigatório ausente: ${relativePath}`,
      );
    }
  }
}

function spawnPortable(
  executable,
  args,
) {
  if (
    process.platform !== "win32"
  ) {
    return spawnSync(
      executable,
      args,
      {
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
      },
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
      .map((part) => {
        if (
          /^[A-Za-z0-9_./:@=-]+$/u.test(
            part,
          )
        ) {
          return part;
        }

        return `"${part.replace(
          /"/gu,
          '\\"',
        )}"`;
      })
      .join(" ");

  return spawnSync(
    commandProcessor,
    [
      "/d",
      "/s",
      "/c",
      command,
    ],
    {
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
    },
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

function main() {
  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 44.0: FUNDAÇÃO DO DOMÍNIO",
    );
    console.log(
      "============================================================",
    );

    ensureFiles();

    console.log(
      `[OK] ${REQUIRED_FILES.length} arquivos obrigatórios presentes.`,
    );

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
      "=== TESTES ETAPA 44.0 ===",
    );

    run(
      "npx",
      [
        "vitest",
        "run",
        "tests/domain-foundation.test.ts",
        "tests/domain-dimension-agnostic.test.ts",
      ],
      "vitest Stage 44.0",
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
      "  ETAPA 44.0: PASS",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] IDs nominais e snapshots versionados.",
    );
    console.log(
      "[OK] DomainResult puro.",
    );
    console.log(
      "[OK] ClockPort, SaveGamePort e ModdingPort.",
    );
    console.log(
      "[OK] Camada 2 sem imports externos ou infraestrutura.",
    );
    console.log(
      "[OK] Compatibilidade estrutural 2D / 2.5D / 3D preservada.",
    );
    console.log(
      "[INFO] Próxima subetapa: 44.1 — Agent + Item.",
    );
  } catch (error) {
    console.error("");
    console.error(
      "============================================================",
    );
    console.error(
      "  ETAPA 44.0: REPROVADA",
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
