#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TAG = "stage-37-postmigration-idempotency-v3";
const ROOT = process.cwd();

const EXPECTED = Object.freeze({
  total: 355,
  stage10: 93,
  stage12: 21,
  stage13: 108,
  stage14: 23,
  stage15: 2,
  stage16: 104,
  stage17: 4,
});

const TRANSFORMATIONS = Object.freeze({
  stage10: Object.freeze([
    "move-engine-implementation-to-module-internal",
  ]),
  stage12: Object.freeze([
    "extract-plugin-implementation",
  ]),
  stage13: Object.freeze([
    "rewrite-relative-module-specifiers",
  ]),
  stage14: Object.freeze([
    "create-public-facade",
  ]),
  stage15: Object.freeze([
    "configure-core-alias",
  ]),
  stage16: Object.freeze([
    "migrate-external-core-import-to-public-facade",
    "promote-core-symbol-to-public-facade",
  ]),
  stage17: Object.freeze([
    "fix-api-implementation-leak",
  ]),
});

const JOURNALS = Object.freeze([
  {
    stage: 10,
    path: ".migration/stage10/move-journal.json",
    expectedStatus: ["completed"],
    expectedOperations: EXPECTED.stage10,
  },
  {
    stage: 12,
    path: ".migration/stage12/extraction-journal.json",
    expectedStatus: ["completed"],
    expectedOperations: EXPECTED.stage12,
  },
  {
    stage: 13,
    path: ".migration/stage13/rewrite-journal.json",
    expectedStatus: ["completed"],
    expectedOperations: EXPECTED.stage13,
  },
  {
    stage: 14,
    path: ".migration/stage14/facade-journal.json",
    expectedStatus: ["completed"],
    expectedOperations: EXPECTED.stage14,
  },
  {
    stage: 15,
    path: ".migration/stage15/core-alias-journal.json",
    expectedStatus: ["completed"],
    expectedOperations: EXPECTED.stage15,
  },
  {
    stage: 16,
    path: ".migration/stage16/core-api-journal.json",
    expectedStatus: ["completed", "applied"],
    expectedOperations: EXPECTED.stage16,
  },
  {
    stage: 17,
    path: ".migration/stage17/api-leak-journal.json",
    expectedStatus: ["completed", "applied"],
    expectedOperations: EXPECTED.stage17,
  },
]);

const SNAPSHOT_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "tests",
  "scripts/architecture",
]);

const SNAPSHOT_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "AGENTS.md",
  "agents.mjs",
  ".migration/v20-journal.json",
  ...JOURNALS.map((journal) => journal.path),
]);

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "coverage",
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

function shouldInclude(relativePath) {
  return !EXCLUDED_EXTENSIONS.has(
    path.posix.extname(relativePath).toLowerCase(),
  );
}

function collectTree(relativeRoot, records) {
  const root = abs(relativeRoot);
  if (!fs.existsSync(root)) return;

  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      const relativePath = toPosix(path.relative(ROOT, full));

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isSymbolicLink()) {
        records.push(`L ${relativePath} -> ${fs.readlinkSync(full)}`);
        continue;
      }

      if (!entry.isFile() || !shouldInclude(relativePath)) continue;

      const buffer = fs.readFileSync(full);
      records.push(
        `F ${relativePath} ${buffer.length} ${sha256(buffer)}`,
      );
    }
  }
}

function operationalSnapshot() {
  const records = [];

  for (const root of SNAPSHOT_ROOTS) {
    collectTree(root, records);
  }

  for (const relativePath of SNAPSHOT_FILES) {
    const full = abs(relativePath);

    if (
      !fs.existsSync(full) ||
      !fs.statSync(full).isFile() ||
      !shouldInclude(relativePath)
    ) {
      continue;
    }

    const buffer = fs.readFileSync(full);
    records.push(
      `F ${relativePath} ${buffer.length} ${sha256(buffer)}`,
    );
  }

  const unique = [...new Set(records)].sort((a, b) =>
    a.localeCompare(b, "en"),
  );

  return {
    count: unique.length,
    digest: sha256(Buffer.from(unique.join("\n"), "utf8")),
  };
}

function assertGlobalJournal() {
  const journal = readJson(".migration/v20-journal.json");

  if (
    journal.architectureMigrationVersion !== "v20" ||
    journal.status !== "migrated" ||
    journal.schemaVersion !== 7 ||
    !Array.isArray(journal.operations)
  ) {
    fail("journal global v20 não está no schema 7 migrated esperado.");
  }

  if (
    journal.operations.length !== EXPECTED.total ||
    journal.counts?.totalOperations !== EXPECTED.total ||
    journal.counts?.applied !== EXPECTED.total ||
    journal.counts?.rolledBack !== 0 ||
    journal.counts?.conflicts !== 0
  ) {
    fail(
      `journal global deveria registrar ${EXPECTED.total}/${EXPECTED.total} operações aplicadas, 0 rollback e 0 conflitos.`,
    );
  }

  const groups = new Map();

  for (const [key, transformations] of Object.entries(TRANSFORMATIONS)) {
    const accepted = new Set(transformations);
    groups.set(
      key,
      journal.operations.filter(
        (operation) => accepted.has(operation.transformation),
      ),
    );
  }

  const knownTransformations = new Set(
    Object.values(TRANSFORMATIONS).flat(),
  );

  const unknown = journal.operations.filter(
    (operation) => !knownTransformations.has(operation.transformation),
  );

  if (unknown.length !== 0) {
    fail(
      `journal global contém ${unknown.length} transformação(ões) realmente desconhecida(s): ${[
        ...new Set(unknown.map((operation) => String(operation.transformation))),
      ].join(", ")}`,
    );
  }

  for (const stage of [10, 12, 13, 14, 15, 16, 17]) {
    const key = `stage${stage}`;
    const actual = groups.get(key)?.length ?? 0;
    const expected = EXPECTED[key];

    if (actual !== expected) {
      fail(`Etapa ${stage}: ${actual}/${expected} operações.`);
    }
  }

  console.log(`[OK] Journal global: ${EXPECTED.total}/${EXPECTED.total} operações.`);
  console.log(`[OK] Schema global: 7 | status: migrated.`);
  console.log("[OK] Transformações desconhecidas: 0.");

  return { journal, groups };
}

function assertStageJournals(globalGroups) {
  for (const spec of JOURNALS) {
    const journal = readJson(spec.path);

    if (
      journal.architectureMigrationVersion !== "v20" ||
      !spec.expectedStatus.includes(journal.status) ||
      !Array.isArray(journal.operations) ||
      journal.operations.length !== spec.expectedOperations
    ) {
      fail(
        `journal Etapa ${spec.stage} incompatível: ${spec.path}`,
      );
    }

    const acceptedTransformations = new Set(
      TRANSFORMATIONS[`stage${spec.stage}`],
    );

    for (const operation of journal.operations) {
      if (!acceptedTransformations.has(operation.transformation)) {
        fail(
          `Etapa ${spec.stage} contém transformação inesperada: ${String(operation.transformation)}`,
        );
      }

      const expectedOperationState =
        spec.stage === 10
          ? "moved"
          : "applied";

      if (operation.state !== expectedOperationState) {
        fail(
          `Etapa ${spec.stage} contém operação fora de state=${expectedOperationState}.`,
        );
      }
    }

    const globalOps = globalGroups.get(`stage${spec.stage}`) ?? [];

    if (globalOps.length !== journal.operations.length) {
      fail(
        `Etapa ${spec.stage}: journal local/global divergem em quantidade.`,
      );
    }

    if (spec.stage === 16) {
      const rewrites = journal.operations.filter(
        (operation) =>
          operation.transformation ===
          "migrate-external-core-import-to-public-facade",
      ).length;
      const promotions = journal.operations.filter(
        (operation) =>
          operation.transformation ===
          "promote-core-symbol-to-public-facade",
      ).length;

      if (rewrites !== 103 || promotions !== 1) {
        fail(
          `Etapa 16 esperava 103 rewrites + 1 promoção; encontrou ${rewrites} + ${promotions}.`,
        );
      }

      console.log(
        `[OK] Etapa 16: ${journal.operations.length}/${spec.expectedOperations} operações aplicadas (103 rewrites + 1 promoção).`,
      );
    } else {
      console.log(
        spec.stage === 10
          ? `[OK] Etapa 10: ${journal.operations.length}/${spec.expectedOperations} operações moved (estado local concluído).`
          : `[OK] Etapa ${spec.stage}: ${journal.operations.length}/${spec.expectedOperations} operações applied.`,
      );
    }
  }
}

function assertCurrentFilesMatchJournals() {
  let checked = 0;

  for (const spec of JOURNALS) {
    const journal = readJson(spec.path);

    for (const operation of journal.operations) {
      const candidatePath =
        operation.filePath ??
        operation.newPath ??
        operation.implementationPath ??
        null;

      const candidateSha =
        operation.fileShaAfter ??
        operation.shaAfter ??
        operation.implementationShaAfter ??
        null;

      if (
        typeof candidatePath !== "string" ||
        typeof candidateSha !== "string"
      ) {
        continue;
      }

      const full = abs(candidatePath);

      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        fail(
          `arquivo aplicado ausente conforme journal da Etapa ${spec.stage}: ${candidatePath}`,
        );
      }

      const currentSha = sha256(fs.readFileSync(full));

      if (currentSha !== candidateSha) {
        fail(
          `SHA atual diverge do journal da Etapa ${spec.stage}: ${candidatePath}`,
        );
      }

      checked += 1;
    }
  }

  if (checked === 0) {
    fail("nenhum arquivo pôde ser validado contra SHA pós-migração.");
  }

  console.log(
    `[OK] Arquivos comparados com SHA pós-migração: ${checked}.`,
  );
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

  if (result.error) throw result.error;

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  if (expectedText !== null && !stdout.includes(expectedText)) {
    fail(
      `${label} terminou sem confirmação esperada: ${expectedText}`,
    );
  }

  console.log(`[OK] ${label}`);
}

function main() {
  try {
    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 37: IDEMPOTÊNCIA PÓS-MIGRAÇÃO v5");
    console.log("============================================================");

    const before = operationalSnapshot();

    console.log("");
    console.log("=== JOURNAL GLOBAL ===");
    const global = assertGlobalJournal();

    console.log("");
    console.log("=== JOURNALS 10–17 ===");
    assertStageJournals(global.groups);

    console.log("");
    console.log("=== INTEGRIDADE DOS ARQUIVOS MIGRADOS ===");
    assertCurrentFilesMatchJournals();

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
      "Etapa 35",
      "ETAPA 35: PASS",
    );

    console.log("");
    console.log("=== ETAPA 36 ===");
    runNode(
      ["scripts/architecture/stage36-audit-conceptual-directories.mjs"],
      "Etapa 36",
      "ETAPA 36: PASS",
    );

    const after = operationalSnapshot();

    console.log("");
    console.log("=== PROVA DE NÃO-MUTAÇÃO ===");
    console.log(`Arquivos protegidos antes: ${before.count}`);
    console.log(`Arquivos protegidos depois: ${after.count}`);
    console.log(`Digest antes: ${before.digest}`);
    console.log(`Digest depois: ${after.digest}`);

    if (
      before.count !== after.count ||
      before.digest !== after.digest
    ) {
      fail("estado operacional mudou durante a prova de idempotência.");
    }

    console.log("[OK] Estado operacional permaneceu byte-identical.");
    console.log("[OK] Nenhum write foi realizado pela Etapa 37.");

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 37: PASS");
    console.log("============================================================");
    console.log("[OK] 355 operações v20 reconhecidas e aplicadas.");
    console.log("[OK] Etapas 10–17 coerentes com seus journals.");
    console.log("[OK] Guardrails permanecem verdes.");
    console.log("[OK] Reexecução dos checks não produz mutação.");
    console.log("[INFO] Rollback não é executado aqui; pertence à Etapa 38.");
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
