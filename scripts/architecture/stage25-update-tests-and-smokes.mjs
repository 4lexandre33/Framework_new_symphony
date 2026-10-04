#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import {
  CANONICAL_MODULES,
} from "./module-map.mjs";

const STAGE = "stage-25-update-tests-and-smokes";
const ROOT = process.cwd();
const TESTS_ROOT = path.join(ROOT, "tests");

function fail(message) {
  console.error(`[${STAGE}] ERRO: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Set(argv);
  const known = new Set(["--check", "--apply", "--help", "-h"]);

  for (const arg of args) {
    if (!known.has(arg)) {
      fail(`argumento desconhecido: ${arg}`);
    }
  }

  if (args.has("--check") && args.has("--apply")) {
    fail("use apenas um modo: --check ou --apply.");
  }

  if (args.has("--help") || args.has("-h")) {
    console.log(`
Projeto1 — Etapa 25: atualização dos testes e smoke tests

Uso:
  node scripts/architecture/stage25-update-tests-and-smokes.mjs --check
  node scripts/architecture/stage25-update-tests-and-smokes.mjs --apply

Escopo:
  - tests/**/*.ts
  - tests/**/*.mjs

Regras:
  - corrige referências antigas src/engine/<modulo>/<arquivo>
    somente quando o arquivo correspondente existe em /internal;
  - preserva imports white-box já apontando para /internal;
  - preserva /public;
  - não altera snippets, expectativas ou semântica dos testes;
  - não cria architecture-smoke-test.mjs (Etapa 30);
  - não executa a bateria funcional (Etapas 28-31).
`);
    process.exit(0);
  }

  return args.has("--apply") ? "apply" : "check";
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function fromPosix(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function collectTestFiles() {
  if (!fs.existsSync(TESTS_ROOT) || !fs.statSync(TESTS_ROOT).isDirectory()) {
    fail("diretório tests/ ausente.");
  }

  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        fail(`symlink não permitido no escopo da Etapa 25: ${toPosix(path.relative(ROOT, full))}`);
      }

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) {
        files.push(full);
      }
    }
  }

  walk(TESTS_ROOT);
  return files;
}

function canonicalEngineRecords() {
  const records = [];

  for (const moduleRecord of CANONICAL_MODULES) {
    const engine = moduleRecord?.engine;

    if (
      engine === null ||
      typeof engine !== "object" ||
      typeof engine.root !== "string" ||
      typeof engine.internalRoot !== "string" ||
      typeof engine.publicRoot !== "string"
    ) {
      fail(`module-map inválido para ${String(moduleRecord?.key)}`);
    }

    records.push({
      key: moduleRecord.key,
      root: engine.root.replace(/\/+$/, ""),
      internalRoot: engine.internalRoot.replace(/\/+$/, ""),
      publicRoot: engine.publicRoot.replace(/\/+$/, ""),
    });
  }

  records.sort((a, b) => b.root.length - a.root.length);
  return records;
}

const ENGINE_RECORDS = canonicalEngineRecords();

function fileExistsForSpecifier(projectRelativePath) {
  const candidates = [
    projectRelativePath,
    `${projectRelativePath}.ts`,
    `${projectRelativePath}.tsx`,
    `${projectRelativePath}.mjs`,
    `${projectRelativePath}/index.ts`,
  ];

  return candidates.some((candidate) => {
    const full = fromPosix(candidate);
    return fs.existsSync(full) && fs.statSync(full).isFile();
  });
}

function migrateProjectPath(projectPath) {
  const normalized = projectPath.replaceAll("\\", "/");

  for (const record of ENGINE_RECORDS) {
    const prefix = `${record.root}/`;

    if (!normalized.startsWith(prefix)) {
      continue;
    }

    if (
      normalized.startsWith(`${record.internalRoot}/`) ||
      normalized === record.internalRoot ||
      normalized.startsWith(`${record.publicRoot}/`) ||
      normalized === record.publicRoot
    ) {
      return null;
    }

    const remainder = normalized.slice(prefix.length);
    if (remainder.length === 0) {
      return null;
    }

    const candidate = `${record.internalRoot}/${remainder}`;

    if (!fileExistsForSpecifier(candidate)) {
      return null;
    }

    return candidate;
  }

  return null;
}

function migrateReference(rawReference) {
  const normalized = rawReference.replaceAll("\\", "/");
  const marker = "src/engine/";
  const index = normalized.indexOf(marker);

  if (index < 0) {
    return null;
  }

  const prefix = normalized.slice(0, index);
  const projectPath = normalized.slice(index);
  const migrated = migrateProjectPath(projectPath);

  if (migrated === null) {
    return null;
  }

  return `${prefix}${migrated}`;
}

const QUOTED_PATH_PATTERN =
  /(["'`])((?:\.\.\/|\.\/)*src\/engine\/[^"'`\r\n]+?)\1/g;

function transformContent(content) {
  let replacements = 0;

  const transformed = content.replace(
    QUOTED_PATH_PATTERN,
    (full, quote, reference) => {
      const migrated = migrateReference(reference);

      if (migrated === null || migrated === reference) {
        return full;
      }

      replacements += 1;
      return `${quote}${migrated}${quote}`;
    },
  );

  return {
    transformed,
    replacements,
  };
}

function inspect() {
  const pending = [];
  let totalReplacements = 0;

  for (const full of collectTestFiles()) {
    const rel = toPosix(path.relative(ROOT, full));
    const before = fs.readFileSync(full, "utf8");
    const result = transformContent(before);

    if (result.transformed !== before) {
      pending.push({
        rel,
        before,
        after: result.transformed,
        replacements: result.replacements,
      });
      totalReplacements += result.replacements;
    }
  }

  return {
    pending,
    totalReplacements,
  };
}

function assertNoResolvableLegacyReferences() {
  const unresolved = [];

  for (const full of collectTestFiles()) {
    const rel = toPosix(path.relative(ROOT, full));
    const content = fs.readFileSync(full, "utf8");

    for (const match of content.matchAll(QUOTED_PATH_PATTERN)) {
      const reference = match[2];
      const migrated = migrateReference(reference);

      if (migrated !== null && migrated !== reference) {
        unresolved.push({
          rel,
          reference,
          migrated,
        });
      }
    }
  }

  if (unresolved.length > 0) {
    fail(
      [
        `restaram ${String(unresolved.length)} referência(s) antigas resolvíveis:`,
        ...unresolved.slice(0, 20).map(
          (item) => `  ${item.rel}: ${item.reference} -> ${item.migrated}`,
        ),
      ].join("\n"),
    );
  }
}

function applyTransaction(pending) {
  const written = [];

  try {
    for (const item of pending) {
      const full = fromPosix(item.rel);
      const temp = `${full}.stage25.tmp`;

      fs.writeFileSync(temp, item.after, "utf8");
      fs.renameSync(temp, full);
      written.push(item);
    }
  } catch (error) {
    for (const item of written.reverse()) {
      try {
        fs.writeFileSync(fromPosix(item.rel), item.before, "utf8");
      } catch {
        // Não mascara a falha original.
      }
    }

    throw error;
  }
}

const mode = parseArgs(process.argv.slice(2));
const audit = inspect();

console.log(`[${STAGE}] modo ${mode}${mode === "check" ? " (read-only)" : ""}`);
console.log(`Arquivos de teste varridos: ${String(collectTestFiles().length)}`);
console.log(`Arquivos pendentes: ${String(audit.pending.length)}`);
console.log(`Referências pendentes: ${String(audit.totalReplacements)}`);

for (const item of audit.pending) {
  console.log(`  PENDENTE ${item.rel} (${String(item.replacements)} referência(s))`);
}

if (mode === "check") {
  if (audit.pending.length === 0) {
    assertNoResolvableLegacyReferences();
    console.log("Etapa 25 já está instalada e idempotente.");
  } else {
    console.log("Etapa 25 ainda precisa ser aplicada.");
  }

  process.exit(0);
}

if (audit.pending.length > 0) {
  try {
    applyTransaction(audit.pending);
  } catch (error) {
    fail(error instanceof Error ? error.stack ?? error.message : String(error));
  }
}

assertNoResolvableLegacyReferences();

const finalAudit = inspect();

if (finalAudit.pending.length !== 0) {
  fail("aplicação não convergiu para estado idempotente.");
}

console.log(`[${STAGE}] aplicado com sucesso.`);
console.log(`Arquivos alterados: ${String(audit.pending.length)}`);
console.log(`Referências migradas: ${String(audit.totalReplacements)}`);

for (const item of audit.pending) {
  console.log(`  OK ${item.rel}`);
}

console.log("Imports white-box já em /internal foram preservados.");
console.log("Asserções/snippets dos smoke tests foram preservados; somente paths físicos foram atualizados.");
