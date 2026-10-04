#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TAG = "stage-37-postmigration-idempotency";
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

const EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
]);

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function stableProjectSnapshot() {
  const records = [];
  const stack = [ROOT];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = toPosix(path.relative(ROOT, absolute));
      const top = relative.split("/")[0];

      if (EXCLUDED_TOP_LEVEL.has(top)) continue;

      if (entry.isDirectory()) {
        records.push(`D ${relative}`);
        stack.push(absolute);
        continue;
      }

      if (entry.isSymbolicLink()) {
        records.push(`L ${relative} -> ${fs.readlinkSync(absolute)}`);
        continue;
      }

      if (entry.isFile()) {
        records.push(`F ${relative} ${fs.statSync(absolute).size} ${sha256(fs.readFileSync(absolute))}`);
      }
    }
  }

  records.sort((a, b) => a.localeCompare(b, "en"));
  return {
    count: records.length,
    digest: sha256(Buffer.from(records.join("\n"), "utf8")),
  };
}

function runNode(args, label, expectedText = null) {
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`${label} falhou com código ${String(result.status)}.`);
  }

  if (expectedText !== null && !stdout.includes(expectedText)) {
    throw new Error(`${label} terminou sem confirmação esperada: ${expectedText}`);
  }

  return { stdout, stderr };
}

function assertProjectRoot() {
  for (const relativePath of REQUIRED_FILES) {
    const absolute = path.join(ROOT, ...relativePath.split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      fail(`arquivo obrigatório ausente: ${relativePath}`);
    }
  }
}

function assertJournalMigrated() {
  const journalPath = path.join(ROOT, ".migration", "v20-journal.json");
  let journal;

  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw new Error(
      `.migration/v20-journal.json inválido: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (journal.architectureMigrationVersion !== "v20") {
    throw new Error("journal global não declara architectureMigrationVersion=v20.");
  }

  if (journal.status !== "migrated") {
    throw new Error(`journal global deveria estar migrated; atual=${String(journal.status)}.`);
  }

  if (!Array.isArray(journal.operations) || journal.operations.length === 0) {
    throw new Error("journal global não contém operações consolidadas.");
  }

  console.log(`[OK] Journal global v20: status=migrated, operações=${journal.operations.length}.`);
}

function assertStage6IsDryRunOnly() {
  const source = fs.readFileSync(
    path.join(ROOT, "scripts", "architecture", "migrate-v20.mjs"),
    "utf8",
  );

  const hasDryRunOnlyContract =
    source.includes("--apply é deliberadamente bloqueado nesta etapa.") ||
    source.includes("--apply") && source.includes("deliberadamente bloqueado");

  if (!hasDryRunOnlyContract) {
    throw new Error(
      "migrate-v20.mjs não contém mais o contrato conhecido de --apply bloqueado; revisar a Etapa 37.",
    );
  }

  console.log("[OK] migrate-v20.mjs confirmado como orquestrador dry-run-only da Etapa 6.");
  console.log("[INFO] Não será executado --apply no repositório real.");
}

function main() {
  try {
    assertProjectRoot();

    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 37: IDEMPOTÊNCIA PÓS-MIGRAÇÃO");
    console.log("============================================================");

    assertJournalMigrated();
    assertStage6IsDryRunOnly();

    const before = stableProjectSnapshot();

    console.log("");
    console.log("=== VALIDAÇÃO CONSOLIDADA v20 ===");
    runNode(
      ["validar-migracao-v20.mjs"],
      "validar-migracao-v20.mjs",
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
      "stage35-audit-old-paths-v2",
      "ETAPA 35: PASS",
    );

    console.log("");
    console.log("=== ETAPA 36 ===");
    runNode(
      ["scripts/architecture/stage36-audit-conceptual-directories.mjs"],
      "stage36-audit-conceptual-directories",
      "ETAPA 36: PASS",
    );

    console.log("");
    console.log("=== ROLLBACK DRY-RUN ===");
    runNode(
      ["scripts/architecture/rollback-migration.mjs", "--dry-run"],
      "rollback-migration --dry-run",
      "DRY-RUN DE ROLLBACK CONCLUÍDO COM SUCESSO",
    );

    const after = stableProjectSnapshot();

    console.log("");
    console.log("=== PROVA DE NÃO-MUTAÇÃO ===");
    console.log(`Registros antes: ${before.count}`);
    console.log(`Registros depois: ${after.count}`);
    console.log(`Digest antes: ${before.digest}`);
    console.log(`Digest depois: ${after.digest}`);

    if (before.count !== after.count || before.digest !== after.digest) {
      throw new Error(
        "a auditoria da Etapa 37 alterou o projeto; idempotência/read-only reprovada.",
      );
    }

    console.log("[OK] Estado do projeto permaneceu byte-identical durante toda a validação.");
    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 37: PASS");
    console.log("============================================================");
    console.log("[OK] Migração v20 consolidada e journals coerentes.");
    console.log("[OK] Layout/boundaries/dependencies continuam válidos.");
    console.log("[OK] Diretórios conceituais continuam válidos.");
    console.log("[OK] Rollback dry-run continua íntegro.");
    console.log("[OK] Nenhum write foi produzido pela prova pós-migração.");
    console.log("[INFO] migrate-v20.mjs --apply não foi usado porque é bloqueado por design na Etapa 6.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 37: REPROVADA");
    console.error("============================================================");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
