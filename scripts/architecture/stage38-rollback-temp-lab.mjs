#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TAG = "stage-38-rollback-lab";

const EXPECTED = Object.freeze({
  totalOperations: 355,
  stage10: 93,
  stage12: 21,
  stage13: 108,
  stage14: 23,
  stage15: 2,
  stage16: 104,
  stage17: 4,
  primitiveMutations: 376,
});

const JOURNALS = Object.freeze([
  { stage: 10, path: ".migration/stage10/move-journal.json" },
  { stage: 12, path: ".migration/stage12/extraction-journal.json" },
  { stage: 13, path: ".migration/stage13/rewrite-journal.json" },
  { stage: 14, path: ".migration/stage14/facade-journal.json" },
  { stage: 15, path: ".migration/stage15/core-alias-journal.json" },
  { stage: 16, path: ".migration/stage16/core-api-journal.json" },
  { stage: 17, path: ".migration/stage17/api-leak-journal.json" },
]);

const TRANSFORMATIONS = new Set([
  "move-engine-implementation-to-module-internal",
  "extract-plugin-implementation",
  "rewrite-relative-module-specifiers",
  "create-public-facade",
  "configure-core-alias",
  "migrate-external-core-import-to-public-facade",
  "promote-core-symbol-to-public-facade",
  "fix-api-implementation-leak",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".txt", ".md", ".toml",
]);

const HASH_SOURCE_ROOTS = Object.freeze([
  ".migration/stage12/backups",
  ".migration/stage13/backups",
  ".migration/stage14/backups",
  ".migration/stage15/backups",
  ".migration/stage16/backups",
  ".migration/stage17/backups",
  ".migration/fixes",
  "src",
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
  ...JOURNALS.map((entry) => entry.path),
]);

const EXCLUDED_DIR_NAMES = new Set([
  ".git", "node_modules", "dist", "target", "coverage",
]);

function fail(message) {
  throw new Error(message);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function abs(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(relativePath) {
  const full = abs(ROOT, relativePath);
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

function assertSafeRelative(relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    fail(`${label} inválido: ${String(relativePath)}`);
  }

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    fail(`${label} contém segmento inseguro: ${relativePath}`);
  }
}

function ensureParent(fullPath) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

function writeAtomic(fullPath, buffer) {
  ensureParent(fullPath);
  const tempPath = `${fullPath}.stage38-${process.pid}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, fullPath);
}

function removeFileIfExists(fullPath) {
  if (!fs.existsSync(fullPath)) return;
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile()) {
    fail(`esperava arquivo regular para remoção: ${fullPath}`);
  }
  fs.unlinkSync(fullPath);
}

function readFileHash(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile()) {
    fail(`esperava arquivo regular: ${fullPath}`);
  }
  return sha256(fs.readFileSync(fullPath));
}

function copyBufferFromProject(relativePath, expectedSha, label) {
  assertSafeRelative(relativePath, label);
  const full = abs(ROOT, relativePath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`${label} ausente: ${relativePath}`);
  }

  const buffer = fs.readFileSync(full);
  const actualSha = sha256(buffer);

  if (actualSha !== expectedSha) {
    fail(
      `${label} SHA divergente: ${relativePath}\n` +
      `esperado=${expectedSha}\n` +
      `atual=${actualSha}`,
    );
  }

  return buffer;
}

function walkFiles(rootPath, output = []) {
  if (!fs.existsSync(rootPath)) return output;

  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;

      output.push(full);
    }
  }

  return output;
}

function buildShaSourceIndex() {
  const needed = new Set();
  const stage10 = readJson(".migration/stage10/move-journal.json");

  for (const operation of stage10.operations ?? []) {
    if (typeof operation.shaBefore === "string") needed.add(operation.shaBefore);
    if (typeof operation.shaAfter === "string") needed.add(operation.shaAfter);
  }

  const index = new Map();

  for (const relativeRoot of HASH_SOURCE_ROOTS) {
    const rootPath = abs(ROOT, relativeRoot);

    for (const full of walkFiles(rootPath)) {
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > 2 * 1024 * 1024) continue;

      const buffer = fs.readFileSync(full);
      const digest = sha256(buffer);

      if (needed.has(digest) && !index.has(digest)) {
        index.set(digest, buffer);
      }

      if (index.size === needed.size) break;
    }

    if (index.size === needed.size) break;
  }

  const missing = [...needed].filter((digest) => !index.has(digest));
  if (missing.length > 0) {
    fail(
      `não foi possível localizar conteúdo histórico para ${missing.length} SHA(s) da Etapa 10.`,
    );
  }

  return index;
}

function expectedStageCount(stage) {
  return EXPECTED[`stage${stage}`];
}

function validateJournals() {
  const global = readJson(".migration/v20-journal.json");

  if (
    global.schemaVersion !== 7 ||
    global.architectureMigrationVersion !== "v20" ||
    global.status !== "migrated" ||
    !Array.isArray(global.operations) ||
    global.operations.length !== EXPECTED.totalOperations
  ) {
    fail("journal global v20 não está no estado schema=7/migrated/355 esperado.");
  }

  if (
    global.counts?.totalOperations !== EXPECTED.totalOperations ||
    global.counts?.applied !== EXPECTED.totalOperations ||
    global.counts?.rolledBack !== 0 ||
    global.counts?.conflicts !== 0
  ) {
    fail("counts do journal global v20 são incompatíveis com a Etapa 38.");
  }

  const local = new Map();
  let total = 0;

  for (const spec of JOURNALS) {
    const journal = readJson(spec.path);

    if (
      journal.architectureMigrationVersion !== "v20" ||
      journal.status !== "completed" ||
      !Array.isArray(journal.operations)
    ) {
      fail(`journal local incompatível: ${spec.path}`);
    }

    const expected = expectedStageCount(spec.stage);
    if (journal.operations.length !== expected) {
      fail(
        `Etapa ${spec.stage}: ${journal.operations.length}/${expected} operações.`,
      );
    }

    for (const operation of journal.operations) {
      if (!TRANSFORMATIONS.has(operation.transformation)) {
        fail(
          `transformação desconhecida na Etapa ${spec.stage}: ${String(operation.transformation)}`,
        );
      }
    }

    local.set(spec.stage, journal);
    total += journal.operations.length;
  }

  if (total !== EXPECTED.totalOperations) {
    fail(`soma dos journals locais=${total}, esperado=${EXPECTED.totalOperations}.`);
  }

  return { global, local };
}

function bufferFromBackup(operation, pathField, shaField, label) {
  const relativePath = operation[pathField];
  const expectedSha = operation[shaField];

  if (
    typeof relativePath !== "string" ||
    typeof expectedSha !== "string"
  ) {
    fail(
      `${label}: operação seq=${String(operation.sequence)} não possui ${pathField}/${shaField}.`,
    );
  }

  return copyBufferFromProject(relativePath, expectedSha, label);
}

function primitiveWrite({
  sequence,
  stage,
  target,
  beforeBuffer,
  afterBuffer,
  label,
}) {
  assertSafeRelative(target, `${label}.target`);

  return {
    kind: "write",
    sequence,
    stage,
    target,
    beforeBuffer,
    afterBuffer,
    beforeSha: sha256(beforeBuffer),
    afterSha: sha256(afterBuffer),
    label,
  };
}

function primitiveCreate({
  sequence,
  stage,
  target,
  afterBuffer,
  label,
}) {
  assertSafeRelative(target, `${label}.target`);

  return {
    kind: "create",
    sequence,
    stage,
    target,
    afterBuffer,
    afterSha: sha256(afterBuffer),
    label,
  };
}

function primitiveMove({
  sequence,
  stage,
  oldPath,
  newPath,
  buffer,
  expectedSha,
  label,
}) {
  assertSafeRelative(oldPath, `${label}.oldPath`);
  assertSafeRelative(newPath, `${label}.newPath`);

  if (sha256(buffer) !== expectedSha) {
    fail(`${label}: conteúdo fonte não corresponde ao SHA esperado.`);
  }

  return {
    kind: "move",
    sequence,
    stage,
    oldPath,
    newPath,
    buffer,
    beforeSha: expectedSha,
    afterSha: expectedSha,
    label,
  };
}

function targetFromOperation(operation, stage) {
  const target =
    operation.filePath ??
    operation.newPath ??
    null;

  if (typeof target !== "string") {
    fail(
      `Etapa ${stage}, seq=${String(operation.sequence)}: target não encontrado.`,
    );
  }

  return target;
}

function buildPrimitives(local, stage10ShaIndex) {
  const primitives = [];

  for (const operation of local.get(10).operations) {
    const expectedSha = operation.shaAfter ?? operation.shaBefore;
    if (typeof expectedSha !== "string") {
      fail(`Etapa 10 seq=${String(operation.sequence)} sem SHA.`);
    }

    const buffer = stage10ShaIndex.get(expectedSha);
    if (!buffer) {
      fail(`Etapa 10 seq=${String(operation.sequence)} sem conteúdo histórico recuperável.`);
    }

    primitives.push(
      primitiveMove({
        sequence: Number(operation.sequence),
        stage: 10,
        oldPath: operation.oldPath,
        newPath: operation.newPath,
        buffer,
        expectedSha,
        label: `stage10#${String(operation.sequence)}`,
      }),
    );
  }

  for (const operation of local.get(12).operations) {
    const pluginBefore = bufferFromBackup(
      operation,
      "backupBeforePath",
      "backupBeforeSha256",
      "Etapa 12 plugin before",
    );
    const pluginAfter = bufferFromBackup(
      operation,
      "backupAfterPath",
      "backupAfterSha256",
      "Etapa 12 plugin after",
    );
    const implementationAfter = bufferFromBackup(
      operation,
      "implementationBackupPath",
      "implementationBackupSha256",
      "Etapa 12 implementation after",
    );

    primitives.push(
      primitiveWrite({
        sequence: Number(operation.sequence),
        stage: 12,
        target: operation.pluginPath,
        beforeBuffer: pluginBefore,
        afterBuffer: pluginAfter,
        label: `stage12-plugin#${String(operation.sequence)}`,
      }),
    );

    primitives.push(
      primitiveCreate({
        sequence: Number(operation.sequence) + 0.1,
        stage: 12,
        target: operation.implementationPath,
        afterBuffer: implementationAfter,
        label: `stage12-impl#${String(operation.sequence)}`,
      }),
    );
  }

  for (const stage of [13, 15, 16, 17]) {
    for (const operation of local.get(stage).operations) {
      const before = bufferFromBackup(
        operation,
        "backupBeforePath",
        "backupBeforeSha256",
        `Etapa ${stage} before`,
      );
      const after = bufferFromBackup(
        operation,
        "backupAfterPath",
        "backupAfterSha256",
        `Etapa ${stage} after`,
      );

      primitives.push(
        primitiveWrite({
          sequence: Number(operation.sequence),
          stage,
          target: targetFromOperation(operation, stage),
          beforeBuffer: before,
          afterBuffer: after,
          label: `stage${stage}#${String(operation.sequence)}`,
        }),
      );
    }
  }

  for (const operation of local.get(14).operations) {
    const after = bufferFromBackup(
      operation,
      "backupAfterPath",
      "backupAfterSha256",
      "Etapa 14 after",
    );

    primitives.push(
      primitiveCreate({
        sequence: Number(operation.sequence),
        stage: 14,
        target: targetFromOperation(operation, 14),
        afterBuffer: after,
        label: `stage14#${String(operation.sequence)}`,
      }),
    );
  }

  primitives.sort((a, b) => a.sequence - b.sequence);

  if (primitives.length !== EXPECTED.primitiveMutations) {
    fail(
      `mutações primitivas=${primitives.length}, esperado=${EXPECTED.primitiveMutations}.`,
    );
  }

  return primitives;
}

function touchedPaths(primitives) {
  const paths = new Set();

  for (const primitive of primitives) {
    if (primitive.kind === "move") {
      paths.add(primitive.oldPath);
      paths.add(primitive.newPath);
    } else {
      paths.add(primitive.target);
    }
  }

  return [...paths].sort((a, b) => a.localeCompare(b, "en"));
}

function seedPreMigrationState(labRoot, primitives) {
  const firstTouch = new Set();

  for (const primitive of primitives) {
    if (primitive.kind === "move") {
      if (!firstTouch.has(primitive.oldPath)) {
        const oldFull = abs(labRoot, primitive.oldPath);
        writeAtomic(oldFull, primitive.buffer);
        firstTouch.add(primitive.oldPath);
      }

      if (!firstTouch.has(primitive.newPath)) {
        firstTouch.add(primitive.newPath);
      }

      continue;
    }

    const target = primitive.target;

    if (firstTouch.has(target)) {
      continue;
    }

    firstTouch.add(target);

    if (primitive.kind === "write") {
      writeAtomic(abs(labRoot, target), primitive.beforeBuffer);
    }
  }
}

function assertHash(fullPath, expectedSha, label) {
  const actual = readFileHash(fullPath);
  if (actual !== expectedSha) {
    fail(
      `${label}: SHA divergente.\n` +
      `esperado=${expectedSha}\n` +
      `atual=${String(actual)}\n` +
      `path=${fullPath}`,
    );
  }
}

function applyPrimitive(labRoot, primitive) {
  if (primitive.kind === "move") {
    const oldFull = abs(labRoot, primitive.oldPath);
    const newFull = abs(labRoot, primitive.newPath);

    assertHash(oldFull, primitive.beforeSha, `${primitive.label} precondition old`);

    if (fs.existsSync(newFull)) {
      fail(`${primitive.label}: destino já existe antes do move: ${primitive.newPath}`);
    }

    ensureParent(newFull);
    fs.renameSync(oldFull, newFull);
    assertHash(newFull, primitive.afterSha, `${primitive.label} postcondition new`);
    return;
  }

  const targetFull = abs(labRoot, primitive.target);

  if (primitive.kind === "write") {
    assertHash(
      targetFull,
      primitive.beforeSha,
      `${primitive.label} precondition write`,
    );
    writeAtomic(targetFull, primitive.afterBuffer);
    assertHash(
      targetFull,
      primitive.afterSha,
      `${primitive.label} postcondition write`,
    );
    return;
  }

  if (primitive.kind === "create") {
    if (fs.existsSync(targetFull)) {
      fail(`${primitive.label}: target deveria estar ausente antes do create: ${primitive.target}`);
    }
    writeAtomic(targetFull, primitive.afterBuffer);
    assertHash(
      targetFull,
      primitive.afterSha,
      `${primitive.label} postcondition create`,
    );
    return;
  }

  fail(`kind desconhecido: ${String(primitive.kind)}`);
}

function rollbackPrimitive(labRoot, primitive) {
  if (primitive.kind === "move") {
    const oldFull = abs(labRoot, primitive.oldPath);
    const newFull = abs(labRoot, primitive.newPath);

    assertHash(newFull, primitive.afterSha, `${primitive.label} rollback precondition new`);

    if (fs.existsSync(oldFull)) {
      fail(`${primitive.label}: origem antiga já existe antes do rollback move: ${primitive.oldPath}`);
    }

    ensureParent(oldFull);
    fs.renameSync(newFull, oldFull);
    assertHash(oldFull, primitive.beforeSha, `${primitive.label} rollback postcondition old`);
    return;
  }

  const targetFull = abs(labRoot, primitive.target);

  if (primitive.kind === "write") {
    assertHash(
      targetFull,
      primitive.afterSha,
      `${primitive.label} rollback precondition write`,
    );
    writeAtomic(targetFull, primitive.beforeBuffer);
    assertHash(
      targetFull,
      primitive.beforeSha,
      `${primitive.label} rollback postcondition write`,
    );
    return;
  }

  if (primitive.kind === "create") {
    assertHash(
      targetFull,
      primitive.afterSha,
      `${primitive.label} rollback precondition create`,
    );
    fs.unlinkSync(targetFull);
    if (fs.existsSync(targetFull)) {
      fail(`${primitive.label}: create não foi removido no rollback.`);
    }
    return;
  }

  fail(`kind desconhecido: ${String(primitive.kind)}`);
}

function stateDigest(root, relativePaths) {
  const records = [];

  for (const relativePath of relativePaths) {
    const full = abs(root, relativePath);

    if (!fs.existsSync(full)) {
      records.push(`MISSING ${relativePath}`);
      continue;
    }

    const stat = fs.lstatSync(full);

    if (!stat.isFile()) {
      records.push(`OTHER ${relativePath}`);
      continue;
    }

    const buffer = fs.readFileSync(full);
    records.push(`FILE ${relativePath} ${buffer.length} ${sha256(buffer)}`);
  }

  return sha256(Buffer.from(records.join("\n"), "utf8"));
}

function operationalSnapshot() {
  const records = [];
  const seen = new Set();

  function addFile(full) {
    const relativePath = toPosix(path.relative(ROOT, full));
    if (seen.has(relativePath)) return;
    seen.add(relativePath);

    const buffer = fs.readFileSync(full);
    records.push(`F ${relativePath} ${buffer.length} ${sha256(buffer)}`);
  }

  for (const relativeRoot of SNAPSHOT_ROOTS) {
    const fullRoot = abs(ROOT, relativeRoot);
    if (!fs.existsSync(fullRoot)) continue;

    for (const full of walkFiles(fullRoot)) {
      addFile(full);
    }
  }

  for (const relativePath of SNAPSHOT_FILES) {
    const full = abs(ROOT, relativePath);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      addFile(full);
    }
  }

  records.sort((a, b) => a.localeCompare(b, "en"));

  return {
    count: records.length,
    digest: sha256(Buffer.from(records.join("\n"), "utf8")),
  };
}

function main() {
  let labRoot = null;

  try {
    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 38: ROLLBACK TRANSACIONAL EM TEMP COPY");
    console.log("============================================================");
    console.log("[INFO] O working tree real é somente leitura nesta etapa.");

    const realBefore = operationalSnapshot();

    console.log("");
    console.log("=== JOURNALS ===");
    const { local } = validateJournals();
    console.log("[OK] Journal global: schema 7, migrated, 355/355.");
    console.log("[OK] Journals locais 10–17: contagens esperadas.");

    console.log("");
    console.log("=== RECUPERAÇÃO HISTÓRICA DA ETAPA 10 ===");
    const stage10ShaIndex = buildShaSourceIndex();
    console.log(`[OK] SHAs históricos da Etapa 10 recuperados: ${stage10ShaIndex.size}.`);

    console.log("");
    console.log("=== PLANO TRANSACIONAL ===");
    const primitives = buildPrimitives(local, stage10ShaIndex);
    const paths = touchedPaths(primitives);
    console.log(`[OK] Operações globais: ${EXPECTED.totalOperations}.`);
    console.log(`[OK] Mutações primitivas: ${primitives.length}.`);
    console.log(`[OK] Paths lógicos envolvidos: ${paths.length}.`);

    labRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "projeto1-stage38-"),
    );
    console.log(`[OK] Laboratório temporário criado fora do projeto: ${labRoot}`);

    console.log("");
    console.log("=== ESTADO PRÉ-MIGRAÇÃO RECONSTRUÍDO ===");
    seedPreMigrationState(labRoot, primitives);
    const originalDigest = stateDigest(labRoot, paths);
    console.log(`[OK] Digest original reconstruído: ${originalDigest}`);

    console.log("");
    console.log("=== APPLY HISTÓRICO 10 → 17 ===");
    for (const primitive of primitives) {
      applyPrimitive(labRoot, primitive);
    }
    const migratedDigest = stateDigest(labRoot, paths);
    console.log(`[OK] Digest migrated: ${migratedDigest}`);

    if (migratedDigest === originalDigest) {
      fail("digest migrated não pode ser igual ao digest pré-migração.");
    }

    console.log("");
    console.log("=== ROLLBACK 17 → 10 ===");
    for (let index = primitives.length - 1; index >= 0; index -= 1) {
      rollbackPrimitive(labRoot, primitives[index]);
    }
    const rolledBackDigest = stateDigest(labRoot, paths);
    console.log(`[OK] Digest rollback: ${rolledBackDigest}`);

    if (rolledBackDigest !== originalDigest) {
      fail(
        `rollback não restaurou o digest original.\n` +
        `original=${originalDigest}\nrollback=${rolledBackDigest}`,
      );
    }

    console.log("[OK] migrated → rollback → hashes originais confirmado.");

    console.log("");
    console.log("=== REAPPLY 10 → 17 ===");
    for (const primitive of primitives) {
      applyPrimitive(labRoot, primitive);
    }
    const reappliedDigest = stateDigest(labRoot, paths);
    console.log(`[OK] Digest reapplied: ${reappliedDigest}`);

    if (reappliedDigest !== migratedDigest) {
      fail(
        `reapply não restaurou o digest migrated.\n` +
        `migrated=${migratedDigest}\nreapplied=${reappliedDigest}`,
      );
    }

    console.log("[OK] rollback → reapply reproduziu exatamente o estado migrated do laboratório.");

    console.log("");
    console.log("=== LIMPEZA DO LABORATÓRIO ===");
    fs.rmSync(labRoot, { recursive: true, force: true });
    labRoot = null;
    console.log("[OK] Cópia temporária removida.");

    const realAfter = operationalSnapshot();

    console.log("");
    console.log("=== PROVA DE ISOLAMENTO DO REPOSITÓRIO REAL ===");
    console.log(`Arquivos protegidos antes: ${realBefore.count}`);
    console.log(`Arquivos protegidos depois: ${realAfter.count}`);
    console.log(`Digest real antes: ${realBefore.digest}`);
    console.log(`Digest real depois: ${realAfter.digest}`);

    if (
      realBefore.count !== realAfter.count ||
      realBefore.digest !== realAfter.digest
    ) {
      fail("o working tree real foi alterado pela Etapa 38.");
    }

    console.log("[OK] Working tree real permaneceu byte-identical.");

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 38: PASS");
    console.log("============================================================");
    console.log("[OK] 355 operações / 376 mutações primitivas testadas.");
    console.log("[OK] migrated → rollback → hashes originais.");
    console.log("[OK] rollback → reapply → mesmo digest migrated.");
    console.log("[OK] Laboratório executado somente em os.tmpdir().");
    console.log("[OK] Repositório real não foi modificado.");
    console.log("[INFO] Nenhum journal foi apagado nesta etapa.");
  } catch (error) {
    if (labRoot !== null) {
      try {
        fs.rmSync(labRoot, { recursive: true, force: true });
      } catch {
        // Não mascara o erro original.
      }
    }

    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 38: REPROVADA");
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
