#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TAG = "stage-36-audit-conceptual-directories";
const ROOT = process.cwd();

const CONCEPTUAL_DIRECTORIES = Object.freeze([
  "src/domain/ports",
  "src/domain/entities",
  "src/domain/economy",
  "src/domain/mechanics",
  "src/domain/narrative",
  "src/domain/evaluation",
  "src/services/ui",
  "src/services/usecases",
  "src/services/diagnostics",
  "src/app/flows",
]);

const IMPLEMENTATION_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function full(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function walk(relativeDir, output = []) {
  const absoluteDir = full(relativeDir);

  if (!fs.existsSync(absoluteDir)) return output;

  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = `${relativeDir}/${entry.name}`;
    const absolutePath = full(relativePath);

    if (entry.isDirectory()) {
      walk(relativePath, output);
      continue;
    }

    if (entry.isFile()) {
      output.push({
        path: toPosix(relativePath),
        size: fs.statSync(absolutePath).size,
      });
    }
  }

  return output;
}

function add(violations, kind, target, detail) {
  violations.push({ kind, target, detail });
}

function assertProjectRoot() {
  for (const required of [
    "package.json",
    "src/domain",
    "src/services",
    "src/app",
  ]) {
    if (!fs.existsSync(full(required))) {
      fail(`execute na raiz do projeto; ausente: ${required}`);
    }
  }
}

function auditDirectory(relativeDir, violations, successes) {
  const absoluteDir = full(relativeDir);

  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    add(
      violations,
      "missing-directory",
      relativeDir,
      "diretório conceitual obrigatório ausente",
    );
    return;
  }

  successes.push(`diretório existe: ${relativeDir}`);

  const directEntries = fs.readdirSync(absoluteDir, { withFileTypes: true });

  const readme = directEntries.find(
    (entry) => entry.isFile() && entry.name === "README.txt",
  );

  if (!readme) {
    add(
      violations,
      "missing-readme",
      `${relativeDir}/README.txt`,
      "README.txt conceitual obrigatório ausente",
    );
  } else {
    const readmePath = `${relativeDir}/README.txt`;
    const readmeSize = fs.statSync(full(readmePath)).size;

    if (readmeSize === 0) {
      add(
        violations,
        "empty-readme",
        readmePath,
        "README.txt existe, mas está vazio",
      );
    } else {
      successes.push(`README.txt presente e não vazio: ${readmePath}`);
    }
  }

  for (const entry of directEntries) {
    if (entry.isDirectory()) {
      add(
        violations,
        "unexpected-subdirectory",
        `${relativeDir}/${entry.name}`,
        "subdiretório inesperado dentro de área conceitual ainda não implementada",
      );
      continue;
    }

    if (!entry.isFile()) continue;

    if (entry.name !== "README.txt") {
      add(
        violations,
        "unexpected-file",
        `${relativeDir}/${entry.name}`,
        "área conceitual deve conter somente README.txt nesta fase",
      );
    }
  }

  const nestedFiles = walk(relativeDir);

  for (const file of nestedFiles) {
    const extension = path.posix.extname(file.path).toLowerCase();

    if (IMPLEMENTATION_EXTENSIONS.has(extension)) {
      add(
        violations,
        file.size === 0 ? "empty-code-placeholder" : "premature-implementation",
        file.path,
        file.size === 0
          ? "placeholder de código vazio detectado"
          : `implementação de código detectada (${file.size} bytes); estas camadas ainda são somente conceituais`,
      );
    }
  }
}

function auditConceptualRoots(violations) {
  const allowedDomainChildren = new Set([
    "ports",
    "entities",
    "economy",
    "mechanics",
    "narrative",
    "evaluation",
  ]);

  const allowedServicesChildren = new Set([
    "ui",
    "usecases",
    "diagnostics",
  ]);

  for (const [root, allowed] of [
    ["src/domain", allowedDomainChildren],
    ["src/services", allowedServicesChildren],
  ]) {
    const absoluteRoot = full(root);
    if (!fs.existsSync(absoluteRoot)) continue;

    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        add(
          violations,
          "unexpected-root-file",
          `${root}/${entry.name}`,
          "arquivo inesperado na raiz conceitual",
        );
        continue;
      }

      if (!allowed.has(entry.name)) {
        add(
          violations,
          "unexpected-conceptual-directory",
          `${root}/${entry.name}`,
          "diretório conceitual fora do mapa previsto para esta fase",
        );
      }
    }
  }
}

function dedupe(violations) {
  const map = new Map();

  for (const violation of violations) {
    const key = `${violation.kind}|${violation.target}|${violation.detail}`;
    if (!map.has(key)) map.set(key, violation);
  }

  return [...map.values()].sort((a, b) =>
    a.target.localeCompare(b.target, "en") ||
    a.kind.localeCompare(b.kind, "en")
  );
}

function main() {
  assertProjectRoot();

  const violations = [];
  const successes = [];

  for (const relativeDir of CONCEPTUAL_DIRECTORIES) {
    auditDirectory(relativeDir, violations, successes);
  }

  auditConceptualRoots(violations);

  const finalViolations = dedupe(violations);

  console.log("============================================================");
  console.log("  PROJETO1 — ETAPA 36: DIRETÓRIOS CONCEITUAIS");
  console.log("============================================================");
  console.log(`Diretórios conceituais esperados: ${CONCEPTUAL_DIRECTORIES.length}`);
  console.log(`Validações positivas: ${successes.length}`);
  console.log(`Violações: ${finalViolations.length}`);
  console.log("");

  for (const success of successes) {
    console.log(`[OK] ${success}`);
  }

  if (finalViolations.length > 0) {
    console.log("");
    console.log("--- Violações ---");

    for (const violation of finalViolations) {
      console.log(`[ERRO] ${violation.target}`);
      console.log(`       ${violation.kind}: ${violation.detail}`);
    }

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 36: REPROVADA");
    console.log("============================================================");
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("[OK] Todas as 10 áreas conceituais existem.");
  console.log("[OK] Cada área contém somente README.txt.");
  console.log("[OK] Todos os README.txt são não vazios.");
  console.log("[OK] Nenhum placeholder .ts/.tsx/.js vazio foi encontrado.");
  console.log("[OK] Nenhuma implementação prematura foi encontrada.");
  console.log("");
  console.log("============================================================");
  console.log("  ETAPA 36: PASS");
  console.log("============================================================");
}

main();
