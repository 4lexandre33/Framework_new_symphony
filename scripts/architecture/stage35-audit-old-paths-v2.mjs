#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CANONICAL_MODULES,
} from "./module-map.mjs";

const TAG = "stage-35-audit-old-paths-v2";
const ROOT = process.cwd();

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".rs", ".toml",
]);

const HISTORICAL_ROOTS = [
  ".migration/",
];

const HISTORICAL_ROOT_FILES = new Set([
  "HUD_RENDERER_FIX_README.txt",
  "MODDING_FIX_README.txt",
  "OVERLAY_RECT_FIX_README.txt",
  "RUNTIME_BOOT_FIX_README.txt",
  "SECURITY_FIX_README.txt",
  "STAGE0_README.txt",
  "STREAMING_OVERLAY_FIX_README.txt",
  "debug-execution.log",
  "debug-report.txt",
]);

const MIGRATION_TOOLING = new Set([
  "scripts/architecture/audit-layout.mjs",
  "scripts/architecture/audit-stage3-drift.mjs",
  "scripts/architecture/fix-api-leaks.mjs",
  "scripts/architecture/fix-steam-consumer-boundary.mjs",
  "scripts/architecture/fix-steam-rollback-reconciliation.mjs",
  "scripts/architecture/generate-public-facades.mjs",
  "scripts/architecture/migrate-core-api.mjs",
  "scripts/architecture/migrate-layout.mjs",
  "scripts/architecture/migrate-v20.mjs",
  "scripts/architecture/plan-migration.mjs",
  "scripts/architecture/rewrite-imports.mjs",
  "scripts/architecture/rollback-migration-v5.mjs",
  "scripts/architecture/rollback-migration-v6.mjs",
  "scripts/architecture/rollback-migration.mjs",
  "scripts/architecture/stage0-baseline.mjs",
  "scripts/architecture/stage1-functional-baseline.mjs",
  "scripts/architecture/stage11-create-v20-journal.mjs",
  "scripts/architecture/stage12-extract-plugin-implementations.mjs",
  "scripts/architecture/stage15-install-core-alias.mjs",
  "scripts/architecture/stage2-unlock-freeze.mjs",
  "scripts/architecture/stage7-create-engine-structure.mjs",
  "scripts/architecture/stage8-create-conceptual-directories.mjs",
  "scripts/architecture/stage9-create-conceptual-readmes.mjs",
  "scripts/architecture/stage23-restructure-governance.mjs",
  "scripts/architecture/stage24-migrate-freeze-lock.mjs",
  "scripts/architecture/stage25-update-tests-and-smokes.mjs",
  "validar-migracao-v20.mjs",
]);

const STRICT_GOVERNANCE_FILES = new Set([
  "agents.mjs",
  "tests/freeze-lock.mjs",
  "tests/freeze-invariants.mjs",
  "tests/architecture-smoke-test.mjs",
  "scripts/architecture/check-boundaries.mjs",
  "scripts/architecture/check-dependencies.mjs",
  "scripts/architecture/module-map.mjs",
]);

function fail(message) {
  console.error(`[${TAG}] ERRO: ${message}`);
  process.exit(1);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relative(fullPath) {
  return toPosix(path.relative(ROOT, fullPath));
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "target" ||
        entry.name === ".git"
      ) {
        continue;
      }

      walk(full, output);
      continue;
    }

    if (entry.isFile()) output.push(full);
  }

  return output;
}

function isText(relativePath) {
  return TEXT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function readText(relativePath) {
  return fs.readFileSync(
    path.join(ROOT, ...relativePath.split("/")),
    "utf8",
  );
}

function isHistorical(relativePath) {
  if (HISTORICAL_ROOTS.some((prefix) => relativePath.startsWith(prefix))) {
    return true;
  }

  if (HISTORICAL_ROOT_FILES.has(relativePath)) {
    return true;
  }

  if (/README(?:\.txt|\.md)$/iu.test(path.posix.basename(relativePath))) {
    return true;
  }

  return false;
}

function isMigrationTooling(relativePath) {
  if (MIGRATION_TOOLING.has(relativePath)) return true;

  if (
    relativePath.startsWith("scripts/architecture/stage") &&
    !relativePath.startsWith("scripts/architecture/stage21-") &&
    !relativePath.startsWith("scripts/architecture/stage22-") &&
    !relativePath.startsWith("scripts/architecture/stage28-") &&
    !relativePath.startsWith("scripts/architecture/stage29-") &&
    !relativePath.startsWith("scripts/architecture/stage30-") &&
    !relativePath.startsWith("scripts/architecture/stage35-")
  ) {
    return true;
  }

  return false;
}

function add(hits, kind, relativePath, line, detail) {
  hits.push({
    kind,
    path: relativePath,
    line,
    detail,
  });
}

function dedupe(hits) {
  const seen = new Set();
  const result = [];

  for (const hit of hits) {
    const key = `${hit.kind}|${hit.path}|${hit.line}|${hit.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }

  result.sort((a, b) =>
    a.path.localeCompare(b.path, "en") ||
    a.line - b.line ||
    a.kind.localeCompare(b.kind, "en")
  );

  return result;
}

function auditPhysicalEngineLayout(violations) {
  for (const moduleRecord of CANONICAL_MODULES) {
    const moduleRootRel = `src/engine/${moduleRecord.key}`;
    const moduleRoot = path.join(ROOT, ...moduleRootRel.split("/"));

    if (!fs.existsSync(moduleRoot) || !fs.statSync(moduleRoot).isDirectory()) {
      add(
        violations,
        "engine-layout",
        moduleRootRel,
        1,
        "módulo canônico ausente",
      );
      continue;
    }

    const publicIndex = `${moduleRootRel}/public/index.ts`;
    const internalDir = `${moduleRootRel}/internal`;

    if (!fs.existsSync(path.join(ROOT, ...publicIndex.split("/")))) {
      add(
        violations,
        "engine-layout",
        publicIndex,
        1,
        "fachada pública canônica ausente",
      );
    }

    if (!fs.existsSync(path.join(ROOT, ...internalDir.split("/")))) {
      add(
        violations,
        "engine-layout",
        internalDir,
        1,
        "diretório /internal ausente",
      );
    }

    for (const entry of fs.readdirSync(moduleRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;

      if (
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".tsx") ||
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".mjs")
      ) {
        add(
          violations,
          "engine-root-file",
          `${moduleRootRel}/${entry.name}`,
          1,
          "arquivo de código ainda está diretamente na raiz do módulo; deve estar em /internal ou /public",
        );
      }
    }
  }
}

function extractModule(relativePath) {
  const match = /^src\/engine\/([^/]+)\//u.exec(relativePath);
  return match ? match[1] : null;
}

function resolveRelativeImport(sourcePath, specifier) {
  if (!specifier.startsWith(".")) return null;

  const joined = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(sourcePath),
      specifier,
    ),
  );

  return joined;
}

function auditActiveImports(files, violations) {
  const importRe =
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const relativePath of files) {
    if (!relativePath.startsWith("src/")) continue;
    if (isHistorical(relativePath)) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/u.test(relativePath)) continue;

    const source = readText(relativePath);
    const sourceModule = extractModule(relativePath);

    let match;
    importRe.lastIndex = 0;

    while ((match = importRe.exec(source)) !== null) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;

      const line = lineOf(source, match.index);

      // Core internals/runtime are private to src/core.
      if (!relativePath.startsWith("src/core/")) {
        if (
          specifier === "@core/internal" ||
          specifier.startsWith("@core/internal/") ||
          specifier.includes("/core/internal/") ||
          specifier.endsWith("/core/internal")
        ) {
          add(
            violations,
            "core-internal-import",
            relativePath,
            line,
            `consumidor externo importa Core internal: ${specifier}`,
          );
        }

        if (
          specifier === "@core/runtime" ||
          specifier.startsWith("@core/runtime/") ||
          specifier.includes("/core/runtime/") ||
          specifier.endsWith("/core/runtime")
        ) {
          add(
            violations,
            "core-runtime-import",
            relativePath,
            line,
            `consumidor externo importa Core runtime: ${specifier}`,
          );
        }
      }

      // Detect cross-module direct imports into another module's /internal.
      if (sourceModule !== null) {
        let targetPath = null;

        if (specifier.startsWith("src/engine/")) {
          targetPath = specifier;
        } else {
          targetPath = resolveRelativeImport(relativePath, specifier);
        }

        if (targetPath !== null) {
          const targetMatch =
            /^src\/engine\/([^/]+)\/internal(?:\/|$)/u.exec(targetPath);

          if (targetMatch && targetMatch[1] !== sourceModule) {
            add(
              violations,
              "cross-module-internal",
              relativePath,
              line,
              `${sourceModule} importa /internal de ${targetMatch[1]}: ${specifier}`,
            );
          }
        }
      }
    }
  }
}

function auditStrictOldPathReferences(files, violations, migrationInfo, historicalInfo) {
  // Only code-ish file references, intentionally not generic directory strings.
  const oldPathRe =
    /src\/engine\/([a-z0-9-]+)\/(?!internal\/|public\/)([A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs))/g;

  for (const relativePath of files) {
    if (!isText(relativePath)) continue;

    const source = readText(relativePath);
    let match;

    oldPathRe.lastIndex = 0;

    while ((match = oldPathRe.exec(source)) !== null) {
      const hitLine = lineOf(source, match.index);
      const detail = `referência pré-v20: ${match[0]}`;

      if (isHistorical(relativePath)) {
        add(historicalInfo, "historical-old-path", relativePath, hitLine, detail);
        continue;
      }

      if (isMigrationTooling(relativePath)) {
        add(migrationInfo, "migration-tooling-old-path", relativePath, hitLine, detail);
        continue;
      }

      const isSmoke =
        relativePath.startsWith("tests/") &&
        relativePath.endsWith(".mjs");

      const isStrictGovernance =
        STRICT_GOVERNANCE_FILES.has(relativePath);

      const isActiveSource =
        relativePath.startsWith("src/");

      if (isSmoke || isStrictGovernance || isActiveSource) {
        add(
          violations,
          "active-old-path-reference",
          relativePath,
          hitLine,
          detail,
        );
      }
    }
  }
}

function runGuardrail(scriptPath, label, violations) {
  const result = spawnSync(
    process.execPath,
    [scriptPath],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status === 0) return;

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();

  add(
    violations,
    "guardrail",
    scriptPath,
    1,
    `${label} reprovou${stdout || stderr ? `: ${stdout}${stdout && stderr ? " | " : ""}${stderr}` : ""}`,
  );
}

function printHits(title, hits, limit) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));

  if (hits.length === 0) {
    console.log("[OK] 0 ocorrências");
    return;
  }

  for (const hit of hits.slice(0, limit)) {
    console.log(`[${hit.kind}] ${hit.path}:${hit.line}`);
    console.log(`  ${hit.detail}`);
  }

  if (hits.length > limit) {
    console.log(`... ${hits.length - limit} ocorrência(s) adicionais omitidas.`);
  }
}

function assertProjectRoot() {
  for (const required of [
    "package.json",
    "src",
    "tests",
    "scripts/architecture/module-map.mjs",
    "scripts/architecture/check-boundaries.mjs",
    "scripts/architecture/check-dependencies.mjs",
  ]) {
    if (!fs.existsSync(path.join(ROOT, required))) {
      fail(`execute na raiz do projeto; ausente: ${required}`);
    }
  }
}

function main() {
  assertProjectRoot();

  const allFiles = walk(ROOT)
    .map(relative)
    .filter((relativePath) => relativePath.length > 0)
    .filter((relativePath) => isText(relativePath));

  const violations = [];
  const migrationInfo = [];
  const historicalInfo = [];

  auditPhysicalEngineLayout(violations);
  auditActiveImports(allFiles, violations);
  auditStrictOldPathReferences(
    allFiles,
    violations,
    migrationInfo,
    historicalInfo,
  );

  runGuardrail(
    "scripts/architecture/check-boundaries.mjs",
    "check-boundaries",
    violations,
  );

  runGuardrail(
    "scripts/architecture/check-dependencies.mjs",
    "check-dependencies",
    violations,
  );

  const finalViolations = dedupe(violations);
  const finalMigrationInfo = dedupe(migrationInfo);
  const finalHistoricalInfo = dedupe(historicalInfo);

  console.log("============================================================");
  console.log("  PROJETO1 — ETAPA 35: AUDITORIA DE PATHS ANTIGOS v2");
  console.log("  Base metodológica: snapshot Projeto1_089");
  console.log("============================================================");
  console.log(`Módulos canônicos auditados: ${CANONICAL_MODULES.length}`);
  console.log(`Arquivos texto inspecionados: ${allFiles.length}`);
  console.log(`Violações operacionais: ${finalViolations.length}`);
  console.log(`Referências em tooling de migração: ${finalMigrationInfo.length}`);
  console.log(`Referências históricas/documentais: ${finalHistoricalInfo.length}`);

  printHits(
    "OPERACIONAL — reprova a Etapa 35",
    finalViolations,
    200,
  );

  printHits(
    "TOOLING DE MIGRAÇÃO — informativo, paths antigos podem ser intencionais",
    finalMigrationInfo,
    50,
  );

  printHits(
    "HISTÓRICO/DOCUMENTAÇÃO — informativo, não reprova",
    finalHistoricalInfo,
    50,
  );

  console.log("");
  console.log("============================================================");

  if (finalViolations.length > 0) {
    console.log("  ETAPA 35: REPROVADA");
    console.log("============================================================");
    process.exitCode = 1;
    return;
  }

  console.log("  ETAPA 35: PASS");
  console.log("============================================================");
  console.log("0 violações operacionais.");
  console.log("Referências antigas restantes estão isoladas em histórico ou tooling de migração.");
}

main();
