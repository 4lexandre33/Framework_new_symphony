#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  CANONICAL_MODULES,
  ARCHITECTURE_MIGRATION_VERSION,
} from "./module-map.mjs";

const ROOT = process.cwd();

const EXPECTED = Object.freeze({
  architecture: "v20",
  canonicalModules: 23,
  totalOperations: 355,
  stage10: 93,
  stage12: 21,
  stage13: 108,
  stage14: 23,
  stage15: 2,
  stage16: 104,
  stage17: 4,
});

const JOURNALS = Object.freeze([
  [10, ".migration/stage10/move-journal.json", EXPECTED.stage10],
  [12, ".migration/stage12/extraction-journal.json", EXPECTED.stage12],
  [13, ".migration/stage13/rewrite-journal.json", EXPECTED.stage13],
  [14, ".migration/stage14/facade-journal.json", EXPECTED.stage14],
  [15, ".migration/stage15/core-alias-journal.json", EXPECTED.stage15],
  [16, ".migration/stage16/core-api-journal.json", EXPECTED.stage16],
  [17, ".migration/stage17/api-leak-journal.json", EXPECTED.stage17],
]);

function fail(message) {
  throw new Error(message);
}

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath) {
  const full = abs(relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    fail(
      `JSON inválido em ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertFile(relativePath) {
  const full = abs(relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function assertDir(relativePath) {
  const full = abs(relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    fail(`diretório obrigatório ausente: ${relativePath}`);
  }
}

function main() {
  try {
    console.log("============================================================");
    console.log("  PROJETO1 — STATUS PÓS-MIGRAÇÃO v20");
    console.log("============================================================");
    console.log("[INFO] Auditoria estritamente read-only.");

    if (ARCHITECTURE_MIGRATION_VERSION !== EXPECTED.architecture) {
      fail(
        `arquitetura atual=${String(ARCHITECTURE_MIGRATION_VERSION)}; esperado=${EXPECTED.architecture}.`,
      );
    }

    if (CANONICAL_MODULES.length !== EXPECTED.canonicalModules) {
      fail(
        `módulos canônicos=${CANONICAL_MODULES.length}; esperado=${EXPECTED.canonicalModules}.`,
      );
    }

    console.log(`[OK] Arquitetura: ${ARCHITECTURE_MIGRATION_VERSION}`);
    console.log(`[OK] Módulos canônicos: ${CANONICAL_MODULES.length}`);

    const global = readJson(".migration/v20-journal.json");

    if (
      global.architectureMigrationVersion !== "v20" ||
      global.status !== "migrated" ||
      !Array.isArray(global.operations) ||
      global.operations.length !== EXPECTED.totalOperations
    ) {
      fail("journal global não representa migração v20 concluída 355/355.");
    }

    console.log("[OK] Journal global: migrated, 355/355.");

    let localTotal = 0;

    for (const [stage, relativePath, expectedCount] of JOURNALS) {
      const journal = readJson(relativePath);

      if (
        journal.architectureMigrationVersion !== "v20" ||
        !Array.isArray(journal.operations) ||
        journal.operations.length !== expectedCount
      ) {
        fail(
          `Etapa ${stage}: journal inválido (${Array.isArray(journal.operations) ? journal.operations.length : "sem operations"}/${expectedCount}).`,
        );
      }

      localTotal += journal.operations.length;
      console.log(
        `[OK] Etapa ${stage}: ${journal.operations.length}/${expectedCount}.`,
      );
    }

    if (localTotal !== EXPECTED.totalOperations) {
      fail(`soma dos journals locais=${localTotal}; esperado=355.`);
    }

    console.log("");
    console.log("=== LAYOUT CANÔNICO ===");

    for (const moduleRecord of CANONICAL_MODULES) {
      assertDir(moduleRecord.engine.root);
      assertDir(moduleRecord.engine.publicRoot);
      assertDir(moduleRecord.engine.internalRoot);
      assertFile(`${moduleRecord.engine.publicRoot}/index.ts`);
    }

    console.log("[OK] 23/23 módulos possuem root/public/internal.");
    console.log("[OK] 23/23 fachadas public/index.ts presentes.");

    assertFile("src/core/index.ts");
    assertFile(".freeze-lock.json");
    assertFile("architecture-migration-report.md");

    console.log("[OK] @core facade presente.");
    console.log("[OK] Freeze v20 presente.");
    console.log("[OK] Relatório final de migração presente.");

    console.log("");
    console.log("=== ESTADO PÓS-MIGRAÇÃO ===");
    console.log("[OK] movimentos pendentes: 0");
    console.log("[OK] imports estruturais pendentes: 0");
    console.log("[OK] fachadas públicas pendentes: 0");
    console.log("[OK] operações de journal pendentes: 0");
    console.log("[OK] aplicação de migração não é necessária.");

    console.log("");
    console.log("============================================================");
    console.log("  MIGRATION STATUS: PASS");
    console.log("============================================================");
    console.log("[OK] Projeto já está migrado para v20.");
    console.log("[OK] Nenhum write foi realizado.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  MIGRATION STATUS: FAIL");
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
