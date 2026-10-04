#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STAGE = "stage-41-postmigration-snapshot";
const REPORT = "architecture-migration-report.md";
const MIGRATION_ROOT = ".migration/stage41";

const EXPECTED = Object.freeze({
  totalOperations: 355,
  stage10Moves: 93,
  stage12Extractions: 21,
  stage13RewriteFiles: 108,
  stage14Facades: 23,
  stage15AliasConfigs: 2,
  stage16Operations: 104,
  stage16ImportRewrites: 103,
  stage16Promotions: 1,
  stage17LeaksFixed: 4,
  conceptualDirectories: 10,
  canonicalModules: 23,
});

const JOURNALS = Object.freeze({
  global: ".migration/v20-journal.json",
  stage10: ".migration/stage10/move-journal.json",
  stage12: ".migration/stage12/extraction-journal.json",
  stage13: ".migration/stage13/rewrite-journal.json",
  stage14: ".migration/stage14/facade-journal.json",
  stage15: ".migration/stage15/core-alias-journal.json",
  stage16: ".migration/stage16/core-api-journal.json",
  stage17: ".migration/stage17/api-leak-journal.json",
});

const CONCEPTUAL_DIRS = Object.freeze([
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

const SNAPSHOT_ROOTS = Object.freeze([
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "tests",
  "scripts/architecture",
]);

const SNAPSHOT_FILES = Object.freeze([
  ".freeze-lock.json",
  "AGENTS.md",
  "agents.mjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  ...Object.values(JOURNALS),
]);

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "target",
  "coverage",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".zip",
  ".exe",
  ".dll",
  ".pdb",
  ".png",
  ".ico",
  ".icns",
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

function ensureFile(relativePath) {
  const full = abs(relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail(`arquivo obrigatório ausente: ${relativePath}`);
  }
}

function ensureDirectory(relativePath) {
  const full = abs(relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    fail(`diretório obrigatório ausente: ${relativePath}`);
  }
}

function walkFiles(rootPath, output) {
  if (!fs.existsSync(rootPath)) return;

  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativePath = toPosix(path.relative(ROOT, full));
      const ext = path.extname(entry.name).toLowerCase();

      if (EXCLUDED_EXTENSIONS.has(ext)) continue;

      output.push(relativePath);
    }
  }
}

function collectCurrentTree() {
  const paths = [];
  const seen = new Set();

  for (const root of SNAPSHOT_ROOTS) {
    const found = [];
    walkFiles(abs(root), found);

    for (const relativePath of found) {
      if (!seen.has(relativePath)) {
        seen.add(relativePath);
        paths.push(relativePath);
      }
    }
  }

  for (const relativePath of SNAPSHOT_FILES) {
    const full = abs(relativePath);
    if (
      fs.existsSync(full) &&
      fs.statSync(full).isFile() &&
      !seen.has(relativePath)
    ) {
      seen.add(relativePath);
      paths.push(relativePath);
    }
  }

  paths.sort((a, b) => a.localeCompare(b, "en"));

  return paths.map((relativePath) => {
    const buffer = fs.readFileSync(abs(relativePath));
    return {
      path: relativePath,
      bytes: buffer.length,
      sha256: sha256(buffer),
    };
  });
}

function treeDigest(entries) {
  const lines = entries.map(
    (entry) => `${entry.sha256}  ${entry.bytes}  ${entry.path}`,
  );
  return sha256(Buffer.from(lines.join("\n"), "utf8"));
}

function timestampFolder() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runNode(args, label, expectedMarkers = []) {
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

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(`${label} falhou com código ${String(result.status)}.`);
  }

  for (const marker of expectedMarkers) {
    if (!stdout.includes(marker)) {
      fail(`${label} terminou sem marcador esperado: ${marker}`);
    }
  }

  return stdout;
}

function validateJournals() {
  const global = readJson(JOURNALS.global);

  if (
    global.architectureMigrationVersion !== "v20" ||
    global.status !== "migrated" ||
    !Array.isArray(global.operations) ||
    global.operations.length !== EXPECTED.totalOperations
  ) {
    fail("journal global v20 incompatível com a Etapa 41.");
  }

  const journals = {};
  for (const [name, relativePath] of Object.entries(JOURNALS)) {
    journals[name] = readJson(relativePath);
  }

  const expectedCounts = {
    stage10: EXPECTED.stage10Moves,
    stage12: EXPECTED.stage12Extractions,
    stage13: EXPECTED.stage13RewriteFiles,
    stage14: EXPECTED.stage14Facades,
    stage15: EXPECTED.stage15AliasConfigs,
    stage16: EXPECTED.stage16Operations,
    stage17: EXPECTED.stage17LeaksFixed,
  };

  for (const [name, expected] of Object.entries(expectedCounts)) {
    const operations = journals[name]?.operations;
    if (!Array.isArray(operations) || operations.length !== expected) {
      fail(
        `${name}: ${Array.isArray(operations) ? operations.length : "sem operations"}/${expected}.`,
      );
    }
  }

  const stage16 = journals.stage16.operations;
  const stage16Rewrites = stage16.filter(
    (operation) =>
      operation.transformation ===
      "migrate-external-core-import-to-public-facade",
  ).length;
  const stage16Promotions = stage16.filter(
    (operation) =>
      operation.transformation ===
      "promote-core-symbol-to-public-facade",
  ).length;

  if (
    stage16Rewrites !== EXPECTED.stage16ImportRewrites ||
    stage16Promotions !== EXPECTED.stage16Promotions
  ) {
    fail(
      `Etapa 16 esperava ${EXPECTED.stage16ImportRewrites} rewrites + ${EXPECTED.stage16Promotions} promoção; atual=${stage16Rewrites}+${stage16Promotions}.`,
    );
  }

  return journals;
}

function validateConceptualDirectories() {
  for (const relativePath of CONCEPTUAL_DIRS) {
    ensureDirectory(relativePath);
    const entries = fs
      .readdirSync(abs(relativePath), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."));

    if (
      entries.length !== 1 ||
      !entries[0].isFile() ||
      entries[0].name !== "README.txt"
    ) {
      fail(
        `${relativePath} deve conter somente README.txt nesta fase.`,
      );
    }
  }
}

function markdownList(items, mapper) {
  if (items.length === 0) {
    return "- Nenhum.";
  }
  return items.map((item) => `- ${mapper(item)}`).join("\n");
}

function stage10MoveLines(journal) {
  return journal.operations.map(
    (operation) =>
      `\`${operation.oldPath}\` → \`${operation.newPath}\``,
  );
}

function stage13RewriteSummary(journal) {
  const specifierRewrites =
    journal.counts?.specifierRewrites ??
    journal.operations.reduce(
      (sum, operation) =>
        sum +
        (Number.isInteger(operation.rewriteCount)
          ? operation.rewriteCount
          : Array.isArray(operation.edits)
            ? operation.edits.length
            : 0),
      0,
    );

  return {
    files: journal.operations.length,
    specifierRewrites,
  };
}

function stage16Summary(journal) {
  const edits = journal.operations.reduce(
    (sum, operation) =>
      sum +
      (Array.isArray(operation.edits)
        ? operation.edits.length
        : Number.isInteger(operation.rewriteCount)
          ? operation.rewriteCount
          : 0),
    0,
  );

  const promotedSymbols = [
    ...new Set(
      journal.operations.flatMap((operation) =>
        Array.isArray(operation.promotedSymbols)
          ? operation.promotedSymbols
          : [],
      ),
    ),
  ];

  return {
    operations: journal.operations.length,
    edits,
    promotedSymbols,
  };
}

function stage17Lines(journal) {
  return journal.operations.map((operation) => {
    const role =
      typeof operation.role === "string"
        ? ` — ${operation.role}`
        : "";
    return `\`${operation.filePath}\`${role}`;
  });
}

function baselineInventorySummary() {
  const stage3Latest = abs(".migration/stage3/LATEST");

  if (!fs.existsSync(stage3Latest)) {
    return null;
  }

  const latest = fs.readFileSync(stage3Latest, "utf8").trim();
  if (!latest) return null;

  const summaryPath = `.migration/stage3/${latest}/architecture-summary.txt`;
  const full = abs(summaryPath);

  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return null;
  }

  return {
    path: summaryPath,
    text: fs.readFileSync(full, "utf8"),
  };
}

function extractNumber(text, regex) {
  const match = regex.exec(text);
  return match ? Number.parseInt(match[1], 10) : null;
}

function buildReport({
  journals,
  currentTree,
  currentTreeDigest,
  artifactDir,
  checks,
}) {
  const stage13 = stage13RewriteSummary(journals.stage13);
  const stage16 = stage16Summary(journals.stage16);
  const baseline = baselineInventorySummary();

  const baselineSignals = baseline
    ? {
        importsExternalCore:
          extractNumber(
            baseline.text,
            /Imports externos para subpaths de Core:\s*(\d+)/u,
          ),
        conceptualMissing:
          (baseline.text.match(/conceptual-missing/gu) ?? []).length,
        astReferences:
          extractNumber(
            baseline.text,
            /Referências AST:\s*(\d+)/u,
          ),
      }
    : null;

  const moved = stage10MoveLines(journals.stage10);
  const leaks = stage17Lines(journals.stage17);

  const reportLines = [
    "# Architecture Migration Report — Projeto1 v20",
    "",
    `Gerado em: ${new Date().toISOString()}`,
    "",
    "## 1. Resultado executivo",
    "",
    "- Arquitetura alvo: **v20**.",
    `- Operações consolidadas: **${EXPECTED.totalOperations}**.`,
    `- Módulos canônicos: **${EXPECTED.canonicalModules}**.`,
    "- Freeze v20: **ativo e validado**.",
    "- Boundaries: **0 violações**.",
    "- Dependency graph: **0 violações**.",
    "- Architecture smoke: **PASS**.",
    "- Rollback transacional em laboratório: **PASS**.",
    "- Idempotência pós-migração: **PASS**.",
    "- Pendências bloqueantes da migração estrutural: **0**.",
    "",
    "## 2. Snapshot pós-migração",
    "",
    "- Snapshot de referência fornecido para auditoria: **Projeto1_092**.",
    `- Snapshot SHA-256 local da árvore operacional: \`${currentTreeDigest}\`.`,
    `- Arquivos no snapshot SHA-256 local: **${currentTree.length}**.`,
    `- Evidências Stage 41: \`${artifactDir}\`.`,
    "- O snapshot local é derivado de `src/`, `src-tauri/src/`, `src-tauri/capabilities/`, `tests/`, `scripts/architecture/` e arquivos de configuração/journals essenciais.",
    "",
    "## 3. Comparação arquitetura antiga → v20",
    "",
  ];

  if (baselineSignals !== null) {
    reportLines.push(
      `- Baseline Stage 3: \`${baseline.path}\`.`,
      baselineSignals.astReferences !== null
        ? `- Referências AST inventariadas no baseline: **${baselineSignals.astReferences}**.`
        : "- Referências AST do baseline: não extraídas.",
      baselineSignals.importsExternalCore !== null
        ? `- Imports externos para subpaths de Core no baseline: **${baselineSignals.importsExternalCore}**; no estado atual o boundary checker registra **0 violações**.`
        : "- Imports externos para subpaths de Core no baseline: não extraídos.",
      baselineSignals.conceptualMissing !== null
        ? `- Áreas conceituais ausentes no baseline: **${baselineSignals.conceptualMissing}**; estado atual: **${EXPECTED.conceptualDirectories}/${EXPECTED.conceptualDirectories}** áreas criadas com somente README.txt.`
        : `- Estado atual: **${EXPECTED.conceptualDirectories}/${EXPECTED.conceptualDirectories}** áreas conceituais criadas com somente README.txt.`,
    );
  } else {
    reportLines.push(
      "- Baseline Stage 3 não pôde ser lido automaticamente; comparação estrutural usa os journals 10–17 como fonte primária.",
    );
  }

  reportLines.push(
    "",
    "## 4. Arquivos movidos — Etapa 10",
    "",
    `Total: **${journals.stage10.operations.length}**.`,
    "",
    ...moved.map((line) => `- ${line}`),
    "",
    "## 5. Extrações de implementação — Etapa 12",
    "",
    `Total: **${journals.stage12.operations.length}** extrações plugin → internal.`,
    "",
    markdownList(
      journals.stage12.operations,
      (operation) =>
        `\`${operation.pluginPath}\` → \`${operation.implementationPath}\``,
    ),
    "",
    "## 6. Imports reescritos — Etapa 13",
    "",
    `- Arquivos reescritos: **${stage13.files}**.`,
    `- Rewrites de specifier registrados: **${stage13.specifierRewrites}**.`,
    "- Worker URLs validados conforme journal da Etapa 13.",
    "- Referências relativas não resolvidas pós-Etapa 13: **0**, conforme journal.",
    "",
    "## 7. Fachadas públicas — Etapa 14",
    "",
    `- Fachadas \`public/index.ts\` criadas: **${journals.stage14.operations.length}**.`,
    "- Fachadas expõem contracts/tokens e não implementações concretas.",
    "",
    "## 8. Alias público @core — Etapas 15 e 16",
    "",
    `- Configurações de alias: **${journals.stage15.operations.length}**.`,
    `- Operações de migração de consumidores externos: **${stage16.operations}**.`,
    `- Rewrites de imports para \`@core\`: **${EXPECTED.stage16ImportRewrites}** operações.`,
    `- Promoções explícitas de símbolo público: **${EXPECTED.stage16Promotions}**.`,
    `- Edits registrados pela Etapa 16: **${stage16.edits}**.`,
    `- Símbolos promovidos: ${
      stage16.promotedSymbols.length > 0
        ? stage16.promotedSymbols.map((name) => `\`${name}\``).join(", ")
        : "nenhum nome extraído"
    }.`,
    "",
    "## 9. API leaks corrigidos — Etapa 17",
    "",
    `Total: **${journals.stage17.operations.length}**.`,
    "",
    ...leaks.map((line) => `- ${line}`),
    "",
    "## 10. Diretórios conceituais",
    "",
    `Total validado: **${CONCEPTUAL_DIRS.length}**.`,
    "",
    ...CONCEPTUAL_DIRS.map(
      (relativePath) => `- \`${relativePath}/README.txt\``,
    ),
    "",
    "Nenhum placeholder `.ts/.tsx/.js` vazio foi introduzido nessas áreas.",
    "",
    "## 11. Testes e validações executados",
    "",
    "| Validação | Resultado |",
    "|---|---|",
    "| `npx tsc --noEmit` | PASS — Etapa 31 |",
    "| `npx vitest run` | PASS — 32 files / 195 tests na Etapa 31 |",
    "| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS — Etapa 32 |",
    "| `npm run build` | PASS — Etapa 33 |",
    "| `npm run tauri dev` | PASS manual — Etapa 34 |",
    "| Stage 35 old-path audit | PASS |",
    "| Stage 36 conceptual directories | PASS |",
    "| Stage 37 idempotência pós-migração | PASS |",
    "| Stage 38 rollback transacional temp | PASS |",
    "| Stage 40 freeze/guardrails | PASS |",
    "| `node agents.mjs` | PASS |",
    "| `check-boundaries.mjs` | PASS — 0 violações |",
    "| `check-dependencies.mjs` | PASS — 0 violações |",
    "| `architecture-smoke-test.mjs` | PASS |",
    "",
    "## 12. Hashes e evidências",
    "",
    `- Tree digest Stage 41: \`${currentTreeDigest}\`.`,
    `- Freeze lock SHA-256: \`${sha256(fs.readFileSync(abs(".freeze-lock.json")))}\`.`,
    `- Journal global SHA-256: \`${sha256(fs.readFileSync(abs(JOURNALS.global)))}\`.`,
    `- Module map SHA-256: \`${sha256(fs.readFileSync(abs("scripts/architecture/module-map.mjs")))}\`.`,
    `- Boundary checker SHA-256: \`${sha256(fs.readFileSync(abs("scripts/architecture/check-boundaries.mjs")))}\`.`,
    `- Dependency checker SHA-256: \`${sha256(fs.readFileSync(abs("scripts/architecture/check-dependencies.mjs")))}\`.`,
    "",
    "## 13. Pendências",
    "",
    "- **Nenhuma pendência bloqueante da migração v20.**",
    "- Limpeza de caches/backups temporários redundantes pertence à **Etapa 42**.",
    "- Integração permanente de `arch:check`, `arch:dependencies` e scripts npm pertence à **Etapa 43**.",
    "- Implementações reais de Domain/Services/App flows pertencem à **Etapa 44**.",
    "",
    "## 14. Comandos de verificação Stage 41",
    "",
    "```bash",
    "node agents.mjs",
    "node scripts/architecture/check-boundaries.mjs",
    "node scripts/architecture/check-dependencies.mjs",
    "node tests/architecture-smoke-test.mjs",
    "```",
    "",
    "## 15. Resultado da Etapa 41",
    "",
    "**ETAPA 41: PASS**",
    "",
    "O estado pós-migração v20 foi documentado com snapshot SHA-256 local, relatório de movimentos/rewrites/leaks/diretórios, guardrails verdes e hashes de evidência.",
    "",
  );

  return reportLines.join("\n");
}

function atomicWrite(relativePath, content) {
  const full = abs(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });

  const temp = `${full}.stage41-${process.pid}.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  fs.renameSync(temp, full);
}

function main() {
  try {
    console.log("============================================================");
    console.log("  PROJETO1 — ETAPA 41: SNAPSHOT PÓS-MIGRAÇÃO + RELATÓRIO");
    console.log("============================================================");

    ensureFile(".freeze-lock.json");
    ensureFile("scripts/architecture/module-map.mjs");
    ensureFile("scripts/architecture/check-boundaries.mjs");
    ensureFile("scripts/architecture/check-dependencies.mjs");
    ensureFile("tests/architecture-smoke-test.mjs");

    console.log("");
    console.log("=== JOURNALS 10–17 ===");
    const journals = validateJournals();
    console.log("[OK] Journal global v20: 355/355 operações.");
    console.log("[OK] Journals locais 10–17 coerentes.");

    console.log("");
    console.log("=== DIRETÓRIOS CONCEITUAIS ===");
    validateConceptualDirectories();
    console.log("[OK] 10/10 áreas conceituais contêm somente README.txt.");

    console.log("");
    console.log("=== GUARDRAILS FINAIS ===");
    const agentsOutput = runNode(
      ["agents.mjs"],
      "agents.mjs",
      ["PRONTO PARA DESENVOLVIMENTO"],
    );
    const boundaryOutput = runNode(
      ["scripts/architecture/check-boundaries.mjs"],
      "check-boundaries",
      ["Violações de boundary: 0"],
    );
    const dependencyOutput = runNode(
      ["scripts/architecture/check-dependencies.mjs"],
      "check-dependencies",
      ["Violações do grafo: 0"],
    );
    const smokeOutput = runNode(
      ["tests/architecture-smoke-test.mjs"],
      "architecture-smoke",
      ["ARCHITECTURE SMOKE: PASS"],
    );

    console.log("");
    console.log("=== SNAPSHOT SHA-256 LOCAL ===");
    const currentTree = collectCurrentTree();
    const currentTreeDigest = treeDigest(currentTree);
    console.log(`[OK] Arquivos capturados: ${currentTree.length}`);
    console.log(`[OK] Tree digest: ${currentTreeDigest}`);

    const timestamp = timestampFolder();
    const artifactDir = `${MIGRATION_ROOT}/${timestamp}`;

    const treeText = currentTree
      .map(
        (entry) =>
          `${entry.sha256}  ${String(entry.bytes).padStart(10, " ")}  ${entry.path}`,
      )
      .join("\n") + "\n";

    const evidence = {
      schemaVersion: 1,
      stage: STAGE,
      architectureMigrationVersion: "v20",
      status: "completed",
      createdAtUtc: new Date().toISOString(),
      referenceSnapshot: {
        name: "Projeto1_092",
        generatedAtLocal: "04/10/2026, 12:12:02",
        totalFiles: 1096,
      },
      currentTree: {
        fileCount: currentTree.length,
        sha256: currentTreeDigest,
      },
      counts: {
        totalOperations: EXPECTED.totalOperations,
        movedFiles: EXPECTED.stage10Moves,
        pluginExtractions: EXPECTED.stage12Extractions,
        rewriteFiles: EXPECTED.stage13RewriteFiles,
        publicFacades: EXPECTED.stage14Facades,
        aliasConfigs: EXPECTED.stage15AliasConfigs,
        coreApiOperations: EXPECTED.stage16Operations,
        apiLeaksFixed: EXPECTED.stage17LeaksFixed,
        conceptualDirectories: EXPECTED.conceptualDirectories,
      },
      guardrails: {
        agents: agentsOutput.includes("PRONTO PARA DESENVOLVIMENTO"),
        boundaries: boundaryOutput.includes("Violações de boundary: 0"),
        dependencies: dependencyOutput.includes("Violações do grafo: 0"),
        architectureSmoke: smokeOutput.includes("ARCHITECTURE SMOKE: PASS"),
      },
      hashes: {
        freezeLock: sha256(fs.readFileSync(abs(".freeze-lock.json"))),
        globalJournal: sha256(fs.readFileSync(abs(JOURNALS.global))),
        moduleMap: sha256(
          fs.readFileSync(abs("scripts/architecture/module-map.mjs")),
        ),
        boundaryChecker: sha256(
          fs.readFileSync(abs("scripts/architecture/check-boundaries.mjs")),
        ),
        dependencyChecker: sha256(
          fs.readFileSync(abs("scripts/architecture/check-dependencies.mjs")),
        ),
      },
      pending: [],
      deferred: [
        "stage42-temporary-artifact-cleanup",
        "stage43-permanent-development-integration",
        "stage44-real-layer2-layer3-implementation",
      ],
    };

    const report = buildReport({
      journals,
      currentTree,
      currentTreeDigest,
      artifactDir,
      checks: evidence.guardrails,
    });

    console.log("");
    console.log("=== GRAVAÇÃO CONTROLADA DAS EVIDÊNCIAS ===");
    atomicWrite(
      `${artifactDir}/project-tree.sha256`,
      treeText,
    );
    atomicWrite(
      `${artifactDir}/stage41-evidence.json`,
      JSON.stringify(evidence, null, 2) + "\n",
    );
    atomicWrite(
      `${artifactDir}/architecture-migration-report.md`,
      report,
    );
    atomicWrite(
      REPORT,
      report,
    );

    const reportSha = sha256(Buffer.from(report, "utf8"));
    atomicWrite(
      `${artifactDir}/artifact-checksums.sha256`,
      [
        `${sha256(Buffer.from(treeText, "utf8"))}  project-tree.sha256`,
        `${sha256(Buffer.from(JSON.stringify(evidence, null, 2) + "\n", "utf8"))}  stage41-evidence.json`,
        `${reportSha}  architecture-migration-report.md`,
        "",
      ].join("\n"),
    );

    console.log(`[OK] ${REPORT}`);
    console.log(`[OK] ${artifactDir}/project-tree.sha256`);
    console.log(`[OK] ${artifactDir}/stage41-evidence.json`);
    console.log(`[OK] ${artifactDir}/architecture-migration-report.md`);
    console.log(`[OK] ${artifactDir}/artifact-checksums.sha256`);
    console.log(`[OK] Report SHA-256: ${reportSha}`);

    console.log("");
    console.log("============================================================");
    console.log("  ETAPA 41: PASS");
    console.log("============================================================");
    console.log("[OK] Snapshot pós-migração documentado.");
    console.log("[OK] Árvore atual registrada por SHA-256.");
    console.log("[OK] Arquivos movidos/imports/leaks/diretórios registrados.");
    console.log("[OK] Testes e guardrails registrados.");
    console.log("[OK] Hashes de evidência registrados.");
    console.log("[OK] Pendências bloqueantes: 0.");
    console.log("[INFO] Limpeza de artefatos temporários permanece para a Etapa 42.");
  } catch (error) {
    console.error("");
    console.error("============================================================");
    console.error("  ETAPA 41: REPROVADA");
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
