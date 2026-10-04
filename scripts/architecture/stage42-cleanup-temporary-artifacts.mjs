#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STAGE = "stage-42-cleanup-temporary-artifacts";
const STAGE41_ROOT = ".migration/stage41";
const STAGE42_ROOT = ".migration/stage42";
const FINAL_REPORT = "architecture-migration-report.md";

const BACKUP_DIRS = Object.freeze([
  ".migration/stage12/backups",
  ".migration/stage13/backups",
  ".migration/stage14/backups",
  ".migration/stage15/backups",
  ".migration/stage16/backups",
  ".migration/stage17/backups",
]);

const REQUIRED_PRESERVED_FILES = Object.freeze([
  ".freeze-lock.json",
  ".migration/v20-journal.json",
  ".migration/stage10/move-journal.json",
  ".migration/stage12/extraction-journal.json",
  ".migration/stage13/rewrite-journal.json",
  ".migration/stage14/facade-journal.json",
  ".migration/stage15/core-alias-journal.json",
  ".migration/stage16/core-api-journal.json",
  ".migration/stage17/api-leak-journal.json",
  FINAL_REPORT,
  "scripts/architecture/module-map.mjs",
  "scripts/architecture/check-boundaries.mjs",
  "scripts/architecture/check-dependencies.mjs",
  "tests/architecture-smoke-test.mjs",
  "agents.mjs",
]);

const OPERATIONAL_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "tests",
  "scripts/architecture",
]);

const OPERATIONAL_FILES = Object.freeze([
  ".freeze-lock.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "AGENTS.md",
  "agents.mjs",
]);

const ZIP_PATTERNS = Object.freeze([
  /^etapa37_.*\.zip$/iu,
  /^etapa38_.*\.zip$/iu,
  /^etapa40_.*\.zip$/iu,
  /^etapa41_.*\.zip$/iu,
]);

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "coverage",
]);

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const known = new Set(["--check", "--apply", "--help", "-h"]);

  for (const arg of argv) {
    if (!known.has(arg)) {
      fail(`argumento desconhecido: ${arg}`);
    }
  }

  if (argv.includes("--check") && argv.includes("--apply")) {
    fail("use somente um modo: --check ou --apply.");
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, mode: "check" };
  }

  return {
    help: false,
    mode: argv.includes("--apply") ? "apply" : "check",
  };
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 42: remoção controlada de artefatos temporários

Uso:
  node scripts/architecture/stage42-cleanup-temporary-artifacts.mjs
  node scripts/architecture/stage42-cleanup-temporary-artifacts.mjs --check
  node scripts/architecture/stage42-cleanup-temporary-artifacts.mjs --apply

Modo padrão:
  --check (somente leitura)

--apply:
  - exige Etapa 41 concluída;
  - registra manifesto SHA-256 dos artefatos removidos;
  - remove somente os paths no allowlist desta Etapa 42;
  - preserva journals, relatório final, freeze, código, testes e scripts;
  - reexecuta guardrails após a limpeza.
`);
}

function ensureFile(relativePath) {
  const full = abs(relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(abs(relativePath), "utf8"));
  } catch (error) {
    fail(
      `JSON inválido em ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function listStage41Runs() {
  const full = abs(STAGE41_ROOT);

  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    fail(`Etapa 41 ausente: ${STAGE41_ROOT}`);
  }

  return fs
    .readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, "en"));
}

function assertStage41Completed() {
  ensureFile(FINAL_REPORT);

  const runs = listStage41Runs();
  if (runs.length === 0) {
    fail("nenhum run da Etapa 41 encontrado.");
  }

  for (const run of runs) {
    const evidencePath = `${STAGE41_ROOT}/${run}/stage41-evidence.json`;
    const reportPath = `${STAGE41_ROOT}/${run}/architecture-migration-report.md`;
    const checksumPath = `${STAGE41_ROOT}/${run}/artifact-checksums.sha256`;

    if (
      fs.existsSync(abs(evidencePath)) &&
      fs.existsSync(abs(reportPath)) &&
      fs.existsSync(abs(checksumPath))
    ) {
      const evidence = readJson(evidencePath);

      if (
        evidence.stage !== "stage-41-postmigration-snapshot" ||
        evidence.status !== "completed" ||
        evidence.architectureMigrationVersion !== "v20"
      ) {
        continue;
      }

      return {
        run,
        evidencePath,
        reportPath,
        checksumPath,
        evidence,
      };
    }
  }

  fail("nenhum run válido/completed da Etapa 41 foi encontrado.");
}

function assertPreservedFilesPresent() {
  for (const relativePath of REQUIRED_PRESERVED_FILES) {
    ensureFile(relativePath);
  }
}

function walkFiles(fullRoot, output) {
  if (!fs.existsSync(fullRoot)) return;

  const stack = [fullRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isFile()) {
        output.push(full);
      }
    }
  }
}

function collectBackupFiles() {
  const files = [];

  for (const relativeDir of BACKUP_DIRS) {
    const full = abs(relativeDir);

    if (!fs.existsSync(full)) {
      continue;
    }

    if (!fs.statSync(full).isDirectory()) {
      fail(`esperava diretório de backup: ${relativeDir}`);
    }

    walkFiles(full, files);
  }

  return files;
}

function collectRootZipFiles() {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    if (ZIP_PATTERNS.some((pattern) => pattern.test(entry.name))) {
      files.push(path.join(ROOT, entry.name));
    }
  }

  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function fileRecord(fullPath, kind) {
  const buffer = fs.readFileSync(fullPath);
  return {
    kind,
    path: toPosix(path.relative(ROOT, fullPath)),
    bytes: buffer.length,
    sha256: sha256(buffer),
  };
}

function collectCandidates() {
  const records = [];

  for (const full of collectBackupFiles()) {
    records.push(fileRecord(full, "migration-backup"));
  }

  for (const full of collectRootZipFiles()) {
    records.push(fileRecord(full, "delivery-zip"));
  }

  records.sort((a, b) => a.path.localeCompare(b.path, "en"));

  return records;
}

function operationalFiles() {
  const records = [];
  const seen = new Set();

  function add(full) {
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return;

    const relativePath = toPosix(path.relative(ROOT, full));
    if (seen.has(relativePath)) return;
    seen.add(relativePath);

    const buffer = fs.readFileSync(full);
    records.push(
      `${relativePath}\t${buffer.length}\t${sha256(buffer)}`,
    );
  }

  for (const relativeRoot of OPERATIONAL_ROOTS) {
    const fullRoot = abs(relativeRoot);
    if (!fs.existsSync(fullRoot)) continue;

    const stack = [fullRoot];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;

        const full = path.join(current, entry.name);

        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          add(full);
        }
      }
    }
  }

  for (const relativePath of OPERATIONAL_FILES) {
    add(abs(relativePath));
  }

  records.sort((a, b) => a.localeCompare(b, "en"));

  return {
    count: records.length,
    digest: sha256(Buffer.from(records.join("\n"), "utf8")),
  };
}

function timestampFolder() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function atomicWrite(relativePath, text) {
  const full = abs(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });

  const temp = `${full}.stage42-${process.pid}.tmp`;
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, full);
}

function runNode(args, label, markers = []) {
  console.log(`[RUN] node ${args.join(" ")}`);

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
      fail(`${label} terminou sem marcador esperado: ${marker}`);
    }
  }

  console.log(`[OK] ${label}`);
}

function removeAllowlistedCandidates(records) {
  const backupRoots = new Set(BACKUP_DIRS);

  for (const record of records) {
    if (record.kind === "delivery-zip") {
      const full = abs(record.path);

      if (!ZIP_PATTERNS.some((pattern) => pattern.test(path.basename(record.path)))) {
        fail(`ZIP escapou do allowlist: ${record.path}`);
      }

      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
      }
    }
  }

  for (const relativeDir of BACKUP_DIRS) {
    if (!backupRoots.has(relativeDir)) {
      fail(`backup root escapou do allowlist: ${relativeDir}`);
    }

    const full = abs(relativeDir);

    if (fs.existsSync(full)) {
      fs.rmSync(full, {
        recursive: true,
        force: false,
      });
    }
  }
}

function assertCandidatesRemoved(records) {
  const remaining = [];

  for (const record of records) {
    if (fs.existsSync(abs(record.path))) {
      remaining.push(record.path);
    }
  }

  for (const relativeDir of BACKUP_DIRS) {
    if (fs.existsSync(abs(relativeDir))) {
      remaining.push(relativeDir);
    }
  }

  if (remaining.length > 0) {
    fail(
      `limpeza incompleta; ${remaining.length} path(s) permanecem:\n` +
      remaining.slice(0, 20).map((item) => `  - ${item}`).join("\n"),
    );
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function buildManifest(stage41, candidates, beforeOperational) {
  const byKind = {
    "migration-backup": candidates.filter(
      (record) => record.kind === "migration-backup",
    ),
    "delivery-zip": candidates.filter(
      (record) => record.kind === "delivery-zip",
    ),
  };

  const totalBytes = candidates.reduce(
    (sum, record) => sum + record.bytes,
    0,
  );

  return {
    schemaVersion: 1,
    stage: STAGE,
    architectureMigrationVersion: "v20",
    mode: "apply",
    createdAtUtc: new Date().toISOString(),
    preconditions: {
      stage41Run: stage41.run,
      stage41Evidence: stage41.evidencePath,
      stage41Status: stage41.evidence.status,
      finalReport: FINAL_REPORT,
    },
    protectedOperationalStateBefore: beforeOperational,
    cleanupPolicy: {
      deleteBackupDirectories: [...BACKUP_DIRS],
      deleteDeliveryZipPatterns: ZIP_PATTERNS.map(
        (pattern) => pattern.toString(),
      ),
      preserveArchitectureScripts: true,
      preserveHistoricalReadmes: true,
      preserveFreezeLock: true,
      preserveGlobalJournal: true,
      preserveStageJournals: true,
      preserveStage41Evidence: true,
      preserveFinalMigrationReport: true,
      preserveMigrationFixes: true,
    },
    counts: {
      files: candidates.length,
      backupFiles: byKind["migration-backup"].length,
      deliveryZipFiles: byKind["delivery-zip"].length,
      bytes: totalBytes,
    },
    files: candidates,
  };
}

function buildReport({
  stage41,
  manifest,
  beforeOperational,
  afterOperational,
  runDir,
}) {
  return [
    "# Stage 42 — Temporary Artifact Cleanup",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Result",
    "",
    "**ETAPA 42: PASS**",
    "",
    "## Preconditions",
    "",
    `- Stage 41 run: \`${stage41.run}\``,
    `- Stage 41 evidence: \`${stage41.evidencePath}\``,
    `- Final migration report preserved: \`${FINAL_REPORT}\``,
    "",
    "## Removed",
    "",
    `- Migration backup payload files: **${manifest.counts.backupFiles}**`,
    `- Delivery ZIP files: **${manifest.counts.deliveryZipFiles}**`,
    `- Total files removed: **${manifest.counts.files}**`,
    `- Total bytes removed: **${manifest.counts.bytes}**`,
    "",
    "Backup directories removed:",
    ...BACKUP_DIRS.map((item) => `- \`${item}\``),
    "",
    "## Preserved",
    "",
    "- `/.freeze-lock.json`",
    "- `.migration/v20-journal.json`",
    "- Local journals for Stages 10, 12, 13, 14, 15, 16 and 17",
    "- `.migration/fixes/**` reconciliation evidence",
    "- `.migration/stage41/**` final snapshot/report evidence",
    "- `architecture-migration-report.md`",
    "- all `scripts/architecture/**` files",
    "- historical patch README files",
    "- runtime code, tests and Tauri sources",
    "",
    "## Audit trail",
    "",
    `- Cleanup manifest: \`${runDir}/cleanup-manifest.json\``,
    `- Removed-file SHA list: \`${runDir}/removed-files.sha256\``,
    `- Stage 42 report: \`${runDir}/stage42-report.md\``,
    "",
    "## Operational integrity",
    "",
    `- Files before: **${beforeOperational.count}**`,
    `- Files after: **${afterOperational.count}**`,
    `- Digest before: \`${beforeOperational.digest}\``,
    `- Digest after: \`${afterOperational.digest}\``,
    "- Operational digest remained byte-identical.",
    "",
    "## Consequence",
    "",
    "The historical backup payloads used for rollback proof were intentionally removed after Stage 38 proved rollback and Stage 41 captured the final migration evidence. Journals remain archived, but historical rollback scripts that require the deleted backup payloads are no longer expected to be executable after this cleanup.",
    "",
    "Stage 43 may now integrate the permanent architecture guardrails into the normal development workflow.",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  try {
    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 42: LIMPEZA DE ARTEFATOS TEMPORÁRIOS");
    console.log("============================================================");
    console.log(`Modo: ${args.mode.toUpperCase()}`);

    const stage41 = assertStage41Completed();
    assertPreservedFilesPresent();

    console.log("");
    console.log("=== PRÉ-CONDIÇÃO ETAPA 41 ===");
    console.log(`[OK] Run validado: ${stage41.run}`);
    console.log(`[OK] ${FINAL_REPORT}`);
    console.log("[OK] Journals 10–17 e freeze presentes.");

    const candidates = collectCandidates();
    const totalBytes = candidates.reduce(
      (sum, record) => sum + record.bytes,
      0,
    );
    const backupCount = candidates.filter(
      (record) => record.kind === "migration-backup",
    ).length;
    const zipCount = candidates.filter(
      (record) => record.kind === "delivery-zip",
    ).length;

    console.log("");
    console.log("=== CANDIDATOS ALLOWLIST ===");
    console.log(`[INFO] Backups redundantes: ${backupCount} arquivo(s).`);
    console.log(`[INFO] ZIPs de entrega: ${zipCount} arquivo(s).`);
    console.log(`[INFO] Total: ${candidates.length} arquivo(s).`);
    console.log(`[INFO] Espaço estimado: ${formatBytes(totalBytes)}.`);

    for (const relativeDir of BACKUP_DIRS) {
      console.log(
        fs.existsSync(abs(relativeDir))
          ? `[REMOVE-DIR] ${relativeDir}`
          : `[ABSENT] ${relativeDir}`,
      );
    }

    for (const record of candidates.filter(
      (item) => item.kind === "delivery-zip",
    )) {
      console.log(`[REMOVE-ZIP] ${record.path}`);
    }

    if (args.mode === "check") {
      console.log("");
      console.log("============================================================");
      console.log("  ETAPA 42: CHECK PASS");
      console.log("============================================================");
      console.log("[OK] Nenhum arquivo foi alterado.");
      console.log("[INFO] Execute novamente com --apply para efetivar a limpeza.");
      return;
    }

    const beforeOperational = operationalFiles();
    const run = timestampFolder();
    const runDir = `${STAGE42_ROOT}/${run}`;
    const manifest = buildManifest(
      stage41,
      candidates,
      beforeOperational,
    );

    console.log("");
    console.log("=== REGISTRO FORENSE PRÉ-REMOÇÃO ===");
    atomicWrite(
      `${runDir}/cleanup-manifest.json`,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    atomicWrite(
      `${runDir}/removed-files.sha256`,
      candidates
        .map(
          (record) =>
            `${record.sha256}  ${String(record.bytes).padStart(10, " ")}  ${record.path}`,
        )
        .join("\n") + "\n",
    );
    console.log(`[OK] ${runDir}/cleanup-manifest.json`);
    console.log(`[OK] ${runDir}/removed-files.sha256`);

    console.log("");
    console.log("=== REMOÇÃO CONTROLADA ===");
    removeAllowlistedCandidates(candidates);
    assertCandidatesRemoved(candidates);
    console.log("[OK] Artefatos temporários removidos conforme allowlist.");

    assertPreservedFilesPresent();

    console.log("");
    console.log("=== GUARDRAILS PÓS-LIMPEZA ===");
    runNode(
      ["agents.mjs"],
      "agents.mjs",
      ["PRONTO PARA DESENVOLVIMENTO"],
    );
    runNode(
      ["scripts/architecture/check-boundaries.mjs"],
      "check-boundaries",
      ["Violações de boundary: 0"],
    );
    runNode(
      ["scripts/architecture/check-dependencies.mjs"],
      "check-dependencies",
      ["Violações do grafo: 0"],
    );
    runNode(
      ["tests/architecture-smoke-test.mjs"],
      "architecture-smoke",
      ["ARCHITECTURE SMOKE: PASS"],
    );

    const afterOperational = operationalFiles();

    console.log("");
    console.log("=== INTEGRIDADE OPERACIONAL ===");
    console.log(`Arquivos protegidos antes: ${beforeOperational.count}`);
    console.log(`Arquivos protegidos depois: ${afterOperational.count}`);
    console.log(`Digest antes: ${beforeOperational.digest}`);
    console.log(`Digest depois: ${afterOperational.digest}`);

    if (
      beforeOperational.count !== afterOperational.count ||
      beforeOperational.digest !== afterOperational.digest
    ) {
      fail(
        "estado operacional protegido mudou durante a limpeza.",
      );
    }

    const report = buildReport({
      stage41,
      manifest,
      beforeOperational,
      afterOperational,
      runDir,
    });

    atomicWrite(
      `${runDir}/stage42-report.md`,
      report,
    );

    const reportSha = sha256(Buffer.from(report, "utf8"));

    atomicWrite(
      `${runDir}/artifact-checksums.sha256`,
      [
        `${sha256(Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"))}  cleanup-manifest.json`,
        `${sha256(Buffer.from(
          candidates
            .map(
              (record) =>
                `${record.sha256}  ${String(record.bytes).padStart(10, " ")}  ${record.path}`,
            )
            .join("\n") + "\n",
          "utf8",
        ))}  removed-files.sha256`,
        `${reportSha}  stage42-report.md`,
        "",
      ].join("\n"),
    );

    console.log("[OK] Estado operacional permaneceu byte-identical.");
    console.log(`[OK] ${runDir}/stage42-report.md`);
    console.log(`[OK] Report SHA-256: ${reportSha}`);

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 42: PASS");
    console.log("============================================================");
    console.log("[OK] Backups temporários redundantes removidos.");
    console.log("[OK] ZIPs de entrega temporários removidos.");
    console.log("[OK] Journals finais preservados.");
    console.log("[OK] Relatório e evidências da Etapa 41 preservados.");
    console.log("[OK] Scripts de arquitetura preservados integralmente.");
    console.log("[OK] Guardrails permanecem verdes.");
    console.log("[OK] Código/runtime/testes permaneceram byte-identical.");
    console.log("[INFO] Etapa 43 pode iniciar.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 42: REPROVADA");
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
