#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TAG = "stage-37-postmigration-idempotency-v2";
const ROOT = process.cwd();

const REQUIRED_FILES = [
  "package.json",
  ".migration/v20-journal.json",
  "validar-migracao-v20.mjs",
  "scripts/architecture/migrate-v20.mjs",
  "scripts/architecture/rollback-migration.mjs",
  "scripts/architecture/check-boundaries.mjs",
  "scripts/architecture/check-dependencies.mjs",
  "scripts/architecture/stage35-audit-old-paths-v2.mjs",
  "scripts/architecture/stage36-audit-conceptual-directories.mjs",
];

const SNAPSHOT_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "tests",
  "scripts/architecture",
]);

const SNAPSHOT_SINGLE_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "AGENTS.md",
  "agents.mjs",
  "validar-migracao-v20.mjs",
  ".migration/v20-journal.json",
  ".migration/stage10/move-journal.json",
  ".migration/stage12/extraction-journal.json",
  ".migration/stage13/rewrite-journal.json",
  ".migration/stage14/facade-journal.json",
  ".migration/stage15/core-alias-journal.json",
  ".migration/stage16/core-api-journal.json",
  ".migration/stage17/api-leak-journal.json",
]);

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "target",
  ".git",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".zip",
  ".exe",
  ".png",
  ".ico",
  ".icns",
  ".dll",
  ".pdb",
]);

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shouldIncludeFile(relativePath) {
  const ext = path.posix.extname(relativePath).toLowerCase();
  return !EXCLUDED_EXTENSIONS.has(ext);
}

function collectRoot(relativeRoot, records) {
  const rootAbs = abs(relativeRoot);
  if (!fs.existsSync(rootAbs)) return;

  const stack = [rootAbs];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      const relative = toPosix(path.relative(ROOT, full));

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isSymbolicLink()) {
        records.push(`L ${relative} -> ${fs.readlinkSync(full)}`);
        continue;
      }

      if (!entry.isFile() || !shouldIncludeFile(relative)) continue;

      const stat = fs.statSync(full);
      const digest = sha256(fs.readFileSync(full));
      records.push(`F ${relative} ${stat.size} ${digest}`);
    }
  }
}

function operationalSnapshot() {
  const records = [];

  for (const root of SNAPSHOT_ROOTS) {
    collectRoot(root, records);
  }

  for (const relativePath of SNAPSHOT_SINGLE_FILES) {
    const full = abs(relativePath);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    if (!shouldIncludeFile(relativePath)) continue;

    const stat = fs.statSync(full);
    const digest = sha256(fs.readFileSync(full));
    records.push(`F ${relativePath} ${stat.size} ${digest}`);
  }

  records.sort((a, b) => a.localeCompare(b, "en"));

  return {
    count: records.length,
    digest: sha256(Buffer.from(records.join("\n"), "utf8")),
  };
}

function runNode(args, label, expectedText = null) {
  console.log(`[RUN] node ${args.join(" ")}`);

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${label} falhou com código ${String(result.status)}.`,
    );
  }

  if (expectedText !== null && !stdout.includes(expectedText)) {
    throw new Error(
      `${label} terminou sem confirmação esperada: ${expectedText}`,
    );
  }

  console.log(`[OK] ${label}`);
  return { stdout, stderr };
}

function assertProjectRoot() {
  for (const relativePath of REQUIRED_FILES) {
    const full = abs(relativePath);

    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      fail(`arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function assertJournalMigrated() {
  let journal;

  try {
    journal = JSON.parse(
      fs.readFileSync(abs(".migration/v20-journal.json"), "utf8"),
    );
  } catch (error) {
    throw new Error(
      `.migration/v20-journal.json inválido: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (journal.architectureMigrationVersion !== "v20") {
    throw new Error(
      "journal global não declara architectureMigrationVersion=v20.",
    );
  }

  if (journal.status !== "migrated") {
    throw new Error(
      `journal global deveria estar migrated; atual=${String(journal.status)}.`,
    );
  }

  if (!Array.isArray(journal.operations) || journal.operations.length === 0) {
    throw new Error(
      "journal global não contém operações consolidadas.",
    );
  }

  console.log(
    `[OK] Journal global v20: status=migrated, operações=${journal.operations.length}.`,
  );
}

function assertStage6IsDryRunOnly() {
  const source = fs.readFileSync(
    abs("scripts/architecture/migrate-v20.mjs"),
    "utf8",
  );

  if (!source.includes("--apply é deliberadamente bloqueado nesta etapa.")) {
    throw new Error(
      "migrate-v20.mjs não contém o contrato conhecido de --apply bloqueado.",
    );
  }

  console.log(
    "[OK] migrate-v20.mjs confirmado como orquestrador dry-run-only da Etapa 6.",
  );
  console.log(
    "[INFO] --apply não será executado no repositório real.",
  );
}

function main() {
  try {
    assertProjectRoot();

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 37: IDEMPOTÊNCIA PÓS-MIGRAÇÃO v2");
    console.log("============================================================");

    assertJournalMigrated();
    assertStage6IsDryRunOnly();

    console.log("");
    console.log("=== SNAPSHOT OPERACIONAL ANTES ===");
    const before = operationalSnapshot();
    console.log(`Arquivos protegidos: ${before.count}`);
    console.log(`Digest: ${before.digest}`);

    console.log("");
    console.log("=== VALIDAÇÃO CONSOLIDADA v20 ===");
    runNode(
      ["validar-migracao-v20.mjs"],
      "validação consolidada v20",
      "VALIDAÇÃO CONSOLIDADA DA MIGRAÇÃO v20",
    );

    console.log("");
    console.log("=== BOUNDARIES ===");
    runNode(
      ["scripts/architecture/check-boundaries.mjs"],
      "check-boundaries",
    );

    console.log("");
    console.log("=== DEPENDENCY GRAPH ===");
    runNode(
      ["scripts/architecture/check-dependencies.mjs"],
      "check-dependencies",
    );

    console.log("");
    console.log("=== ETAPA 35 ===");
    runNode(
      ["scripts/architecture/stage35-audit-old-paths-v2.mjs"],
      "auditoria Etapa 35",
      "ETAPA 35: PASS",
    );

    console.log("");
    console.log("=== ETAPA 36 ===");
    runNode(
      ["scripts/architecture/stage36-audit-conceptual-directories.mjs"],
      "auditoria Etapa 36",
      "ETAPA 36: PASS",
    );

    console.log("");
    console.log("=== ROLLBACK DRY-RUN ===");
    runNode(
      ["scripts/architecture/rollback-migration.mjs", "--dry-run"],
      "rollback dry-run",
      "DRY-RUN DE ROLLBACK CONCLUÍDO COM SUCESSO",
    );

    console.log("");
    console.log("=== SNAPSHOT OPERACIONAL DEPOIS ===");
    const after = operationalSnapshot();
    console.log(`Arquivos protegidos: ${after.count}`);
    console.log(`Digest: ${after.digest}`);

    console.log("");
    console.log("=== PROVA DE NÃO-MUTAÇÃO ===");

    if (
      before.count !== after.count ||
      before.digest !== after.digest
    ) {
      throw new Error(
        [
          "estado operacional mudou durante a Etapa 37.",
          `Arquivos: ${before.count} -> ${after.count}`,
          `Digest: ${before.digest} -> ${after.digest}`,
        ].join("\n"),
      );
    }

    console.log("[OK] Quantidade de arquivos protegidos permaneceu idêntica.");
    console.log("[OK] Digest operacional antes/depois é idêntico.");

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 37: PASS");
    console.log("============================================================");
    console.log("[OK] Migração v20 permanece consolidada.");
    console.log("[OK] Boundaries e dependency graph permanecem válidos.");
    console.log("[OK] Etapas 35 e 36 permanecem válidas.");
    console.log("[OK] Rollback dry-run permanece íntegro.");
    console.log("[OK] Nenhum estado operacional foi alterado.");
    console.log("[INFO] --apply não foi usado porque migrate-v20.mjs é dry-run-only por design.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 37: REPROVADA");
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
