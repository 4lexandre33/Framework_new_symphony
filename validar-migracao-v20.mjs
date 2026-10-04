#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const V20 = ".migration/v20-journal.json";
const J14 = ".migration/stage14/facade-journal.json";
const J15 = ".migration/stage15/core-alias-journal.json";
const ROLLBACK = "scripts/architecture/rollback-migration.mjs";

const EXPECTED = Object.freeze({
  stage10: 93,
  stage12: 21,
  stage13: 108,
  stage14: 23,
  stage14Exports: 48,
  stage15: 2,
});

const T = Object.freeze({
  stage10: "move-engine-implementation-to-module-internal",
  stage12: "extract-plugin-implementation",
  stage13: "rewrite-relative-module-specifiers",
  stage14: "create-public-facade",
  stage15: "configure-core-alias",
});

const FORBIDDEN = Object.freeze([
  "PhysicsWorld",
  "InputManager",
  "SceneManager",
  "GPUParticleSystem",
]);

const EXCLUDED_TOP = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const EXCLUDED_PREFIX = Object.freeze([
  ".cache/",
  ".turbo/",
  ".vite/",
  "src-tauri/target/",
]);

function fail(message) {
  throw new Error(message);
}

function norm(value) {
  const out = path.normalize(path.resolve(value));
  return process.platform === "win32" ? out.toLowerCase() : out;
}

function rel(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function safe(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    fail(`Path inválido: ${String(relativePath)}`);
  }

  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(`Path inseguro: ${relativePath}`);
  }

  const absolute = path.join(root, ...parts);
  const back = path.relative(root, absolute);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    fail(`Path escapou da raiz: ${relativePath}`);
  }
  return absolute;
}

function shaBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shaFile(filePath) {
  return shaBuffer(fs.readFileSync(filePath));
}

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function semanticSha(value) {
  return crypto.createHash("sha256").update(stable(value), "utf8").digest("hex");
}

function readJson(root, relativePath) {
  const absolute = safe(root, relativePath);
  if (!fs.existsSync(absolute)) fail(`Arquivo obrigatório ausente: ${relativePath}`);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`Arquivo inválido: ${relativePath}`);
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`JSON inválido em ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(String(result.stderr ?? "").trim() || `git ${args.join(" ")} falhou.`);
  }
  return String(result.stdout ?? "").trim();
}

function assertRoot() {
  const cwd = path.resolve(process.cwd());
  if (runGit(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    fail("O diretório atual não pertence a um repositório Git.");
  }

  const root = path.resolve(runGit(cwd, ["rev-parse", "--show-toplevel"]));
  if (norm(cwd) !== norm(root)) {
    fail(`Execute exatamente na raiz do Projeto1.\nAtual: ${cwd}\nRaiz Git: ${root}`);
  }

  for (const required of ["package.json", V20, J14, ROLLBACK]) {
    if (!fs.existsSync(safe(root, required))) fail(`Pré-condição ausente: ${required}`);
  }

  return root;
}

function groupOperations(v20) {
  if (!Array.isArray(v20.operations)) fail("v20-journal.json não contém operations.");
  const groups = { stage10: [], stage12: [], stage13: [], stage14: [], stage15: [], unknown: [] };

  for (const operation of v20.operations) {
    if (operation.transformation === T.stage10) groups.stage10.push(operation);
    else if (operation.transformation === T.stage12) groups.stage12.push(operation);
    else if (operation.transformation === T.stage13) groups.stage13.push(operation);
    else if (operation.transformation === T.stage14) groups.stage14.push(operation);
    else if (operation.transformation === T.stage15) groups.stage15.push(operation);
    else groups.unknown.push(operation);
  }

  return groups;
}

function validateGlobal(v20, groups) {
  if (
    v20.journal !== "v20-architecture-migration-journal" ||
    v20.architectureMigrationVersion !== "v20" ||
    v20.status !== "migrated"
  ) {
    fail("Journal global v20 não está no estado migrated esperado.");
  }

  const requiredCounts = [
    ["Etapa 10", groups.stage10.length, EXPECTED.stage10],
    ["Etapa 12", groups.stage12.length, EXPECTED.stage12],
    ["Etapa 13", groups.stage13.length, EXPECTED.stage13],
    ["Etapa 14", groups.stage14.length, EXPECTED.stage14],
  ];

  for (const [label, actual, expected] of requiredCounts) {
    if (actual !== expected) fail(`${label}: ${String(actual)}/${String(expected)}.`);
  }

  if (groups.unknown.length !== 0) {
    fail(`Journal global contém ${String(groups.unknown.length)} transformação(ões) desconhecida(s).`);
  }

  const hasStage15 = groups.stage15.length > 0;
  if (hasStage15 && groups.stage15.length !== EXPECTED.stage15) {
    fail(`Etapa 15 parcial: ${String(groups.stage15.length)}/${String(EXPECTED.stage15)}.`);
  }

  const total = hasStage15 ? 247 : 245;
  if (
    v20.operations.length !== total ||
    v20.counts?.totalOperations !== total ||
    v20.counts?.applied !== total ||
    v20.counts?.rolledBack !== 0 ||
    v20.counts?.conflicts !== 0
  ) {
    fail(`Journal global deveria estar em ${String(total)}/${String(total)} operações aplicadas e 0 conflitos.`);
  }

  return { hasStage15, total };
}

function validateStage14(root, v20) {
  const journal = readJson(root, J14);

  if (
    journal.schemaVersion !== 1 ||
    journal.stage !== "stage-14-generate-public-facades" ||
    journal.architectureMigrationVersion !== "v20" ||
    journal.status !== "completed" ||
    !Array.isArray(journal.operations) ||
    journal.operations.length !== EXPECTED.stage14
  ) {
    fail("Journal da Etapa 14 é incompatível.");
  }

  if (
    journal.counts?.totalFacades !== EXPECTED.stage14 ||
    journal.counts?.applied !== EXPECTED.stage14 ||
    journal.counts?.rolledBack !== 0 ||
    journal.counts?.conflicts !== 0 ||
    journal.counts?.exportStatements !== EXPECTED.stage14Exports ||
    journal.counts?.internalReexports !== 0 ||
    journal.counts?.forbiddenConcreteExports !== 0
  ) {
    fail("Counts da Etapa 14 divergem.");
  }

  let exportsTotal = 0;
  const modules = new Set();

  for (const operation of journal.operations) {
    if (
      operation.transformation !== T.stage14 ||
      operation.state !== "applied" ||
      typeof operation.moduleKey !== "string" ||
      typeof operation.filePath !== "string" ||
      typeof operation.fileShaAfter !== "string" ||
      !Array.isArray(operation.exportSpecifiers)
    ) {
      fail("Operação inválida no journal da Etapa 14.");
    }

    if (modules.has(operation.moduleKey)) fail(`Módulo duplicado: ${operation.moduleKey}`);
    modules.add(operation.moduleKey);

    const expectedPath = `src/engine/${operation.moduleKey}/public/index.ts`;
    if (operation.filePath !== expectedPath) fail(`Facade fora do path canônico: ${operation.filePath}`);

    const absolute = safe(root, operation.filePath);
    if (!fs.existsSync(absolute)) fail(`Facade ausente: ${operation.filePath}`);
    if (shaFile(absolute) !== operation.fileShaAfter) fail(`SHA divergente: ${operation.filePath}`);

    const backup = safe(root, operation.backupAfterPath);
    if (!fs.existsSync(backup) || shaFile(backup) !== operation.backupAfterSha256) {
      fail(`Backup after divergente: ${operation.backupAfterPath}`);
    }

    const source = fs.readFileSync(absolute, "utf8");
    if (source.includes("/internal/") || source.includes("../internal")) {
      fail(`Facade reexporta internal: ${operation.filePath}`);
    }

    for (const name of FORBIDDEN) {
      if (source.includes(name)) fail(`Facade contém implementação concreta proibida (${name}): ${operation.filePath}`);
    }

    for (const specifier of operation.exportSpecifiers) {
      if (
        typeof specifier !== "string" ||
        !(specifier.includes("/contracts/") || specifier.includes("/tokens/")) ||
        specifier.includes("/internal/")
      ) {
        fail(`Reexport inválido em ${operation.filePath}: ${String(specifier)}`);
      }
    }

    exportsTotal += operation.exportSpecifiers.length;
  }

  if (modules.size !== EXPECTED.stage14 || exportsTotal !== EXPECTED.stage14Exports) {
    fail(`Fachadas físicas divergiram: módulos=${String(modules.size)}, exports=${String(exportsTotal)}.`);
  }

  const global14 = v20.operations.filter((operation) => operation.transformation === T.stage14);
  const shape = (operation) => ({
    sequence: operation.sequence,
    moduleKey: operation.moduleKey,
    filePath: operation.filePath,
    fileShaAfter: operation.fileShaAfter,
    transformation: operation.transformation,
  });

  if (semanticSha(journal.operations.map(shape)) !== semanticSha(global14.map(shape))) {
    fail("Etapa 14 no journal global diverge do facade-journal.");
  }

  return { facades: modules.size, exportsTotal };
}

function validateStage15(root, groups) {
  const absolute = safe(root, J15);
  const exists = fs.existsSync(absolute);

  if (groups.stage15.length === 0) {
    if (exists) fail("Journal da Etapa 15 existe sem consolidação no journal global.");
    return false;
  }

  if (!exists) fail("Etapa 15 está no journal global, mas core-alias-journal.json está ausente.");
  const journal = readJson(root, J15);

  if (
    journal.schemaVersion !== 1 ||
    journal.stage !== "stage-15-install-core-alias" ||
    journal.architectureMigrationVersion !== "v20" ||
    journal.status !== "completed" ||
    !Array.isArray(journal.operations) ||
    journal.operations.length !== 2 ||
    journal.counts?.totalConfigs !== 2 ||
    journal.counts?.applied !== 2 ||
    journal.counts?.rolledBack !== 0 ||
    journal.counts?.conflicts !== 0 ||
    journal.counts?.tsconfigPathsAliases !== 1 ||
    journal.counts?.viteResolveAliases !== 1 ||
    journal.counts?.sourceImportsRewritten !== 0 ||
    journal.counts?.wildcardAliases !== 0
  ) {
    fail("Journal da Etapa 15 é incompatível.");
  }

  const remaining = new Set(["tsconfig.json", "vite.config.ts"]);
  for (const operation of journal.operations) {
    if (
      operation.transformation !== T.stage15 ||
      operation.state !== "applied" ||
      operation.aliasSpecifier !== "@core" ||
      !remaining.has(operation.filePath)
    ) {
      fail(`Operação inválida da Etapa 15: ${String(operation.filePath)}`);
    }

    if (shaFile(safe(root, operation.filePath)) !== operation.fileShaAfter) {
      fail(`Config da Etapa 15 divergiu: ${operation.filePath}`);
    }
    remaining.delete(operation.filePath);
  }

  if (remaining.size !== 0) fail(`Config da Etapa 15 ausente: ${[...remaining].join(", ")}`);
  return true;
}

function excluded(relativePath, isDirectory) {
  if (!relativePath) return false;
  const top = relativePath.split("/")[0];
  if (isDirectory && EXCLUDED_TOP.has(top)) return true;
  const normalized = isDirectory ? `${relativePath}/` : relativePath;
  return EXCLUDED_PREFIX.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

function snapshot(root) {
  const records = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolute = path.join(current, entry.name);
      const relativePath = rel(root, absolute);

      if (excluded(relativePath, entry.isDirectory())) continue;

      if (entry.isSymbolicLink()) {
        records.push({ path: relativePath, kind: "symlink", target: fs.readlinkSync(absolute) });
      } else if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        const stat = fs.statSync(absolute);
        records.push({ path: relativePath, kind: "file", bytes: stat.size, sha256: shaFile(absolute) });
      }
    }
  }

  records.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { count: records.length, digest: semanticSha(records) };
}

function rollbackDryRun(root) {
  const before = snapshot(root);

  const result = spawnSync(process.execPath, [ROLLBACK, "--dry-run"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.error) throw result.error;
  if (result.status !== 0) fail(`rollback-migration.mjs --dry-run falhou com código ${String(result.status)}.`);
  if (!stdout.includes("DRY-RUN DE ROLLBACK CONCLUÍDO COM SUCESSO")) {
    fail("Rollback dry-run terminou sem confirmação de sucesso.");
  }

  const after = snapshot(root);
  if (before.count !== after.count || before.digest !== after.digest) {
    fail(
      `Dry-run alterou o projeto.\nArquivos: ${String(before.count)} -> ${String(after.count)}\nDigest: ${before.digest} -> ${after.digest}`,
    );
  }

  return { before, after };
}

function main() {
  try {
    const root = assertRoot();

    console.log("============================================================");
    console.log("  PROJETO1 — VALIDAÇÃO CONSOLIDADA DA MIGRAÇÃO v20        ");
    console.log("============================================================\n");

    const v20 = readJson(root, V20);
    const groups = groupOperations(v20);
    const global = validateGlobal(v20, groups);

    console.log(`[OK] Journal global: ${String(global.total)}/${String(global.total)} operações aplicadas.`);
    console.log(`[OK] Etapa 10: ${String(groups.stage10.length)}/${String(EXPECTED.stage10)}`);
    console.log(`[OK] Etapa 12: ${String(groups.stage12.length)}/${String(EXPECTED.stage12)}`);
    console.log(`[OK] Etapa 13: ${String(groups.stage13.length)}/${String(EXPECTED.stage13)}`);
    console.log(`[OK] Etapa 14: ${String(groups.stage14.length)}/${String(EXPECTED.stage14)}`);

    const stage14 = validateStage14(root, v20);
    console.log(`[OK] Fachadas públicas: ${String(stage14.facades)}/${String(EXPECTED.stage14)}`);
    console.log(`[OK] Reexports contracts/tokens: ${String(stage14.exportsTotal)}/${String(EXPECTED.stage14Exports)}`);
    console.log("[OK] Reexports de /internal: 0");
    console.log("[OK] PhysicsWorld/InputManager/SceneManager/GPUParticleSystem públicos: 0");

    const stage15 = validateStage15(root, groups);
    console.log(
      stage15
        ? `[OK] Etapa 15 detectada: ${String(groups.stage15.length)}/${String(EXPECTED.stage15)} configs @core íntegras.`
        : "[INFO] Etapa 15 ainda não está aplicada; validação limitada ao estado pós-Etapa 14.",
    );

    console.log("\n=== ROLLBACK READ-ONLY ===");
    const dry = rollbackDryRun(root);

    console.log("\n=== PROVA GLOBAL READ-ONLY ===");
    console.log(`[OK] Arquivos monitorados antes/depois: ${String(dry.before.count)}/${String(dry.after.count)}`);
    console.log(`[OK] Digest antes: ${dry.before.digest}`);
    console.log(`[OK] Digest depois: ${dry.after.digest}`);
    console.log("[OK] Nenhum arquivo do projeto foi alterado pela validação.");

    console.log("\n============================================================");
    console.log("  VALIDAÇÃO CONCLUÍDA COM SUCESSO                           ");
    console.log("============================================================");
    console.log(stage15 ? "Estado consolidado: Etapas 0–15." : "Estado consolidado: Etapas 0–14.");
  } catch (error) {
    console.error("\n[ERRO] Validação não concluída.");
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}

main();
