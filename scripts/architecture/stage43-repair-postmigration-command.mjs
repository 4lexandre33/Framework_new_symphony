#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PACKAGE_PATH = "package.json";
const STAGE43_PATH =
  "scripts/architecture/stage43-integrate-development-guardrails.mjs";
const STATUS_PATH =
  "scripts/architecture/stage43-migration-status.mjs";

const EXPECTED_ARCH_MIGRATE =
  "node scripts/architecture/stage43-migration-status.mjs";

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function parseArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    return "check";
  }

  if (argv.length === 1 && argv[0] === "--apply") {
    return "apply";
  }

  fail("uso: node scripts/architecture/stage43-repair-postmigration-command.mjs --check|--apply");
}

function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(abs(PACKAGE_PATH), "utf8"));
  } catch (error) {
    fail(
      `package.json inválido: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function atomicWrite(relativePath, text) {
  const full = abs(relativePath);
  const temp = `${full}.stage43-v2-${process.pid}.tmp`;

  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, full);
}

function runNode(args, label, markers = []) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) throw result.error;

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`${label} sem marcador esperado: ${marker}`);
    }
  }
}

function runNpm(scriptName, labelOrMarkers = [], maybeMarkers = []) {
  const label =
    typeof labelOrMarkers === "string"
      ? labelOrMarkers
      : `npm run ${scriptName}`;

  const markers =
    Array.isArray(labelOrMarkers)
      ? labelOrMarkers
      : maybeMarkers;

  let result;

  if (process.platform === "win32") {
    const commandProcessor =
      process.env.ComSpec ??
      process.env.COMSPEC ??
      "C:\\Windows\\System32\\cmd.exe";

    result = spawnSync(
      commandProcessor,
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } else {
    result = spawnSync(
      "npm",
      ["run", scriptName],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  for (const marker of markers) {
    if (!stdout.includes(marker)) {
      fail(`${label} sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] ${label}`);
  return { stdout, stderr };
}

function patchStage43Validator(source) {
  let next = source;

  next = next.replace(
    '"arch:migrate":\n    "node scripts/architecture/migrate-v20.mjs --dry-run",',
    '"arch:migrate":\n    "node scripts/architecture/stage43-migration-status.mjs",',
  );

  next = next.replace(
    '    ensureFile("scripts/architecture/migrate-v20.mjs");',
    '    ensureFile("scripts/architecture/stage43-migration-status.mjs");',
  );

  const oldValidation = `    console.log("");
    console.log("=== ARCH:MIGRATE DRY-RUN ===");

    const migrate = runNpm(
      "arch:migrate",
      "npm run arch:migrate",
    );

    if (
      !migrate.stdout.includes("DRY-RUN") &&
      !migrate.stdout.includes("dry-run") &&
      !migrate.stdout.includes("Dry-run")
    ) {
      fail(
        "arch:migrate não evidenciou execução em dry-run.",
      );
    }

    console.log(
      "[OK] arch:migrate permanece não destrutivo (--dry-run).",
    );`;

  const newValidation = `    console.log("");
    console.log("=== ARCH:MIGRATE STATUS PÓS-MIGRAÇÃO ===");

    runNpm(
      "arch:migrate",
      "npm run arch:migrate",
      ["MIGRATION STATUS: PASS"],
    );

    console.log(
      "[OK] arch:migrate valida o estado pós-migração sem writes.",
    );`;

  next = next.replace(oldValidation, newValidation);

  next = next.replace(
    '        archMigrate: "dry-run-pass",',
    '        archMigrate: "postmigration-status-pass",',
  );

  next = next.replace(
    '"arch:migrate is intentionally dry-run only.",',
    '"arch:migrate is a read-only post-migration status check.",',
  );

  next = next.replace(
    '"- `npm run arch:migrate`: PASS in dry-run mode",',
    '"- `npm run arch:migrate`: PASS as read-only post-migration status",',
  );

  next = next.replace(
    'console.log("[OK] arch:migrate instalado em dry-run.");',
    'console.log("[OK] arch:migrate instalado como status pós-migração read-only.");',
  );

  return next;
}

function main() {
  const mode = parseArgs(process.argv.slice(2));

  try {
    if (!fs.existsSync(abs(PACKAGE_PATH))) {
      fail("package.json ausente.");
    }

    if (!fs.existsSync(abs(STAGE43_PATH))) {
      fail(`${STAGE43_PATH} ausente.`);
    }

    if (!fs.existsSync(abs(STATUS_PATH))) {
      fail(`${STATUS_PATH} ausente; extraia o ZIP v2 antes de executar.`);
    }

    const packageJson = readPackage();
    const stage43Source = fs.readFileSync(abs(STAGE43_PATH), "utf8");

    const packagePending =
      packageJson.scripts?.["arch:migrate"] !== EXPECTED_ARCH_MIGRATE;

    const nextStage43 = patchStage43Validator(stage43Source);
    const stage43Pending = nextStage43 !== stage43Source;

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 43 v2: REPARO ARCH:MIGRATE");
    console.log("============================================================");
    console.log(`Modo: ${mode.toUpperCase()}`);
    console.log("");
    console.log(
      `[${packagePending ? "PENDENTE" : "OK"}] package.json scripts.arch:migrate`,
    );
    console.log(
      `[${stage43Pending ? "PENDENTE" : "OK"}] validador Stage 43`,
    );

    if (mode === "check") {
      console.log("");
      console.log("ETAPA 43 v2: CHECK PASS");
      console.log("[OK] Nenhum arquivo foi alterado.");
      return;
    }

    packageJson.scripts["arch:migrate"] = EXPECTED_ARCH_MIGRATE;

    atomicWrite(
      PACKAGE_PATH,
      JSON.stringify(packageJson, null, 2) + "\n",
    );

    atomicWrite(
      STAGE43_PATH,
      nextStage43,
    );

    console.log("");
    console.log("=== VALIDAÇÃO ===");

    runNode(
      [STATUS_PATH],
      "migration status",
      ["MIGRATION STATUS: PASS"],
    );

    runNpm(
      "arch:migrate",
      ["MIGRATION STATUS: PASS"],
    );

    runNpm(
      "arch:check",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    runNpm(
      "arch:audit",
      [
        "PRONTO PARA DESENVOLVIMENTO",
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    runNpm(
      "build",
      [
        "Violações de boundary: 0",
        "Violações do grafo: 0",
      ],
    );

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 43: PASS");
    console.log("============================================================");
    console.log("[OK] arch:migrate agora representa o estado pós-migração v20.");
    console.log("[OK] Nenhum exit code histórico da Etapa 6 é mascarado.");
    console.log("[OK] arch:check passou.");
    console.log("[OK] arch:audit passou.");
    console.log("[OK] build passou com guardrails.");
    console.log("[OK] subprocessos npm não usam shell:true implícito.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 43 v2: REPROVADA");
    console.error("============================================================");
    console.error(
      error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    );
    process.exitCode = 1;
  }
}

main();
