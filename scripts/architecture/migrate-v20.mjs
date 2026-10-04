#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
} from "./module-map.mjs";

import {
  buildMigrationPlan,
  STAGE_NAME as STAGE5_PLAN_STAGE,
} from "./plan-migration.mjs";

export const STAGE_NAME = "stage-6-mandatory-dry-run";
export const DRY_RUN_MODE = "--dry-run";

const CONCEPTUAL_AREAS = Object.freeze([
  {
    directory: "src/domain/ports",
    readme: "src/domain/ports/README.txt",
  },
  {
    directory: "src/domain/entities",
    readme: "src/domain/entities/README.txt",
  },
  {
    directory: "src/domain/economy",
    readme: "src/domain/economy/README.txt",
  },
  {
    directory: "src/domain/mechanics",
    readme: "src/domain/mechanics/README.txt",
  },
  {
    directory: "src/domain/narrative",
    readme: "src/domain/narrative/README.txt",
  },
  {
    directory: "src/domain/evaluation",
    readme: "src/domain/evaluation/README.txt",
  },
  {
    directory: "src/services/ui",
    readme: "src/services/ui/README.txt",
  },
  {
    directory: "src/services/usecases",
    readme: "src/services/usecases/README.txt",
  },
  {
    directory: "src/services/diagnostics",
    readme: "src/services/diagnostics/README.txt",
  },
  {
    directory: "src/app/flows",
    readme: "src/app/flows/README.txt",
  },
]);

const GUARDRAILS = Object.freeze([
  {
    path: "AGENTS.md",
    futureAction:
      "Documentar /public vs /internal, boundaries e module-map como fonte canônica.",
  },
  {
    path: "agents.mjs",
    futureAction:
      "Orquestrar freeze, boundary checker, dependency checker e invariantes arquiteturais.",
  },
  {
    path: "tests/freeze-lock.mjs",
    futureAction:
      "Remover lista hard-coded de paths antigos e derivar paths protegidos do module-map.",
  },
  {
    path: "tests/freeze-invariants.mjs",
    futureAction:
      "Ampliar invariantes para fiscalizar arquitetura v20 e novos paths.",
  },
]);

const ROOT_MIGRATION_RELEVANT_FILES = new Set([
  "AGENTS.md",
  "agents.mjs",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
]);

const RELEVANT_PREFIXES = Object.freeze([
  "src/",
  "tests/",
  "src-tauri/src/",
  "src-tauri/capabilities/",
]);

const RELEVANT_EXACT_PATHS = new Set([
  "src-tauri/build.rs",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/steam_appid.txt",
]);

const STATE_EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const STATE_EXCLUDED_PREFIXES = Object.freeze([
  ".cache/",
  ".turbo/",
  ".vite/",
  "src-tauri/target/",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(inputPath) {
  const normalized = path.normalize(path.resolve(inputPath));

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function fromPosixRelative(rootDir, relativePath) {
  return path.join(rootDir, ...relativePath.split("/"));
}

function runCommand(executable, args, cwd, allowFailure = false) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    if (allowFailure) {
      return null;
    }

    throw result.error;
  }

  if (result.status !== 0) {
    if (allowFailure) {
      return null;
    }

    const stderr = String(result.stderr ?? "").trim();

    fail(
      stderr.length > 0
        ? `${executable} ${args.join(" ")} falhou: ${stderr}`
        : `${executable} ${args.join(" ")} falhou com código ${String(result.status)}.`,
    );
  }

  return String(result.stdout ?? "").trimEnd();
}

function runGit(args, cwd, allowFailure = false) {
  return runCommand("git", args, cwd, allowFailure);
}

function assertRepositoryRoot(cwd) {
  const inside = runGit(
    ["rev-parse", "--is-inside-work-tree"],
    cwd,
  );

  if (inside !== "true") {
    fail("O diretório atual não pertence a um repositório Git.");
  }

  const gitRootRaw = runGit(
    ["rev-parse", "--show-toplevel"],
    cwd,
  );

  if (
    normalizeAbsolute(cwd) !==
    normalizeAbsolute(gitRootRaw)
  ) {
    fail(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
}

function parseArguments(argv) {
  if (
    argv.length === 1 &&
    (argv[0] === "--help" || argv[0] === "-h")
  ) {
    return {
      help: true,
      dryRun: false,
    };
  }

  if (
    argv.length === 1 &&
    argv[0] === DRY_RUN_MODE
  ) {
    return {
      help: false,
      dryRun: true,
    };
  }

  if (argv.includes("--apply")) {
    fail(
      [
        "A Etapa 6 não permite --apply.",
        "Nesta fase o orquestrador é estritamente read-only.",
        "Execute somente:",
        "  node scripts/architecture/migrate-v20.mjs --dry-run",
      ].join("\n"),
    );
  }

  fail(
    [
      "Modo obrigatório ausente ou inválido.",
      "A Etapa 6 deve ser executada explicitamente com --dry-run:",
      "  node scripts/architecture/migrate-v20.mjs --dry-run",
    ].join("\n"),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 6: Dry-run obrigatório da migração v20

Uso:
  node scripts/architecture/migrate-v20.mjs --dry-run

A Etapa 6:
  - não move arquivos;
  - não cria diretórios;
  - não reescreve imports;
  - não altera aliases;
  - não cria README conceitual;
  - não altera guardrails;
  - não cria/move freeze-lock;
  - não grava relatório em .migration.

Ela apenas valida o plano aprovado na Etapa 5 e imprime a simulação completa.

--apply é deliberadamente bloqueado nesta etapa.
`);
}

function readJson(filePath, displayPath) {
  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    );
  } catch (error) {
    fail(
      `JSON inválido em ${displayPath}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function stableStringify(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => stableStringify(entry))
      .join(",")}]`;
  }

  const keys = Object.keys(value).sort(
    (a, b) => a.localeCompare(b, "en"),
  );

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(",")}}`;
}

function semanticSha256(value) {
  return sha256Buffer(
    Buffer.from(stableStringify(value), "utf8"),
  );
}

function isStateExcluded(relativePath, isDirectory) {
  if (relativePath.length === 0) {
    return false;
  }

  const topLevel = relativePath.split("/")[0];

  if (
    isDirectory &&
    STATE_EXCLUDED_TOP_LEVEL.has(topLevel)
  ) {
    return true;
  }

  const normalized = isDirectory
    ? `${relativePath}/`
    : relativePath;

  return STATE_EXCLUDED_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(prefix),
  );
}

function snapshotProjectState(rootDir) {
  const records = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();

    if (!currentDir) {
      continue;
    }

    const entries = fs.readdirSync(
      currentDir,
      {
        withFileTypes: true,
      },
    );

    entries.sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en"),
    );

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolutePath = path.join(
        currentDir,
        entry.name,
      );
      const relativePath = toPosixRelative(
        rootDir,
        absolutePath,
      );

      if (
        isStateExcluded(
          relativePath,
          entry.isDirectory(),
        )
      ) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        records.push({
          kind: "symlink",
          path: relativePath,
          target: fs.readlinkSync(absolutePath),
        });
        continue;
      }

      if (entry.isDirectory()) {
        records.push({
          kind: "directory",
          path: relativePath,
        });
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        const stat = fs.statSync(absolutePath);

        records.push({
          kind: "file",
          path: relativePath,
          bytes: stat.size,
          sha256: sha256File(absolutePath),
        });
      }
    }
  }

  records.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path, "en");

    if (byPath !== 0) {
      return byPath;
    }

    return a.kind.localeCompare(b.kind, "en");
  });

  return {
    recordCount: records.length,
    digest: semanticSha256(records),
    records,
  };
}

function compareProjectStates(before, after) {
  if (
    before.digest === after.digest &&
    before.recordCount === after.recordCount
  ) {
    return {
      unchanged: true,
      added: [],
      removed: [],
      changed: [],
    };
  }

  const beforeByKey = new Map(
    before.records.map((record) => [
      `${record.kind}\0${record.path}`,
      record,
    ]),
  );

  const afterByKey = new Map(
    after.records.map((record) => [
      `${record.kind}\0${record.path}`,
      record,
    ]),
  );

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, afterRecord] of afterByKey) {
    if (!beforeByKey.has(key)) {
      added.push(afterRecord);
      continue;
    }

    const beforeRecord = beforeByKey.get(key);

    if (
      stableStringify(beforeRecord) !==
      stableStringify(afterRecord)
    ) {
      changed.push({
        before: beforeRecord,
        after: afterRecord,
      });
    }
  }

  for (const [key, beforeRecord] of beforeByKey) {
    if (!afterByKey.has(key)) {
      removed.push(beforeRecord);
    }
  }

  return {
    unchanged: false,
    added,
    removed,
    changed,
  };
}

function loadApprovedStage5(rootDir) {
  const stage5Root = path.join(
    rootDir,
    ".migration",
    "stage5",
  );

  const latestPath = path.join(
    stage5Root,
    "LATEST",
  );

  if (!fs.existsSync(latestPath)) {
    fail(
      "Pré-condição ausente: .migration/stage5/LATEST",
    );
  }

  const runId = fs
    .readFileSync(latestPath, "utf8")
    .trim();

  if (runId.length === 0) {
    fail(".migration/stage5/LATEST está vazio.");
  }

  const reportPath = path.join(
    stage5Root,
    runId,
    "migration-plan.json",
  );

  if (!fs.existsSync(reportPath)) {
    fail(
      `Relatório da Etapa 5 ausente: ${toPosixRelative(rootDir, reportPath)}`,
    );
  }

  const report = readJson(
    reportPath,
    toPosixRelative(rootDir, reportPath),
  );

  if (report.stage !== STAGE5_PLAN_STAGE) {
    fail(
      `Stage inesperado no relatório da Etapa 5: ${String(report.stage)}`,
    );
  }

  if (report.status !== "passed") {
    fail(
      `A Etapa 5 mais recente não está aprovada. Status: ${String(report.status)}`,
    );
  }

  if (
    report.architectureMigrationVersion !==
    ARCHITECTURE_MIGRATION_VERSION
  ) {
    fail(
      `Versão arquitetural divergente na Etapa 5: ${String(report.architectureMigrationVersion)}`,
    );
  }

  if (
    !report.plan ||
    typeof report.plan.migrationPlanSha256 !== "string"
  ) {
    fail(
      "migration-plan.json da Etapa 5 não contém plano válido.",
    );
  }

  return {
    runId,
    reportPath: toPosixRelative(rootDir, reportPath),
    report,
    plan: report.plan,
  };
}

function loadStage3Artifacts(rootDir, approvedPlan) {
  const reportPath = approvedPlan.stage3?.reportPath;
  const filesPath = approvedPlan.stage3?.filesPath;

  if (
    typeof reportPath !== "string" ||
    typeof filesPath !== "string"
  ) {
    fail(
      "O plano aprovado da Etapa 5 não referencia corretamente os artefatos da Etapa 3.",
    );
  }

  const reportAbsolute = fromPosixRelative(
    rootDir,
    reportPath,
  );

  const stage3Dir = path.dirname(reportAbsolute);

  const artifactPaths = {
    files: fromPosixRelative(
      rootDir,
      filesPath,
    ),
    imports: path.join(
      stage3Dir,
      "imports.json",
    ),
    signals: path.join(
      stage3Dir,
      "architecture-signals.json",
    ),
  };

  for (const [name, artifactPath] of Object.entries(artifactPaths)) {
    if (!fs.existsSync(artifactPath)) {
      fail(
        `Artefato da Etapa 3 ausente (${name}): ${toPosixRelative(rootDir, artifactPath)}`,
      );
    }
  }

  const files = readJson(
    artifactPaths.files,
    toPosixRelative(rootDir, artifactPaths.files),
  );

  const imports = readJson(
    artifactPaths.imports,
    toPosixRelative(rootDir, artifactPaths.imports),
  );

  const signals = readJson(
    artifactPaths.signals,
    toPosixRelative(rootDir, artifactPaths.signals),
  );

  if (!Array.isArray(files)) {
    fail("files.json da Etapa 3 deveria conter um array.");
  }

  if (!Array.isArray(imports)) {
    fail("imports.json da Etapa 3 deveria conter um array.");
  }

  if (
    signals === null ||
    typeof signals !== "object" ||
    Array.isArray(signals)
  ) {
    fail(
      "architecture-signals.json da Etapa 3 deveria conter um objeto.",
    );
  }

  return {
    stage3Dir,
    files,
    imports,
    signals,
  };
}

function isMigrationRelevantPath(relativePath) {
  if (ROOT_MIGRATION_RELEVANT_FILES.has(relativePath)) {
    return true;
  }

  if (RELEVANT_EXACT_PATHS.has(relativePath)) {
    return true;
  }

  return RELEVANT_PREFIXES.some(
    (prefix) => relativePath.startsWith(prefix),
  );
}

function collectCurrentRelevantFiles(rootDir) {
  const records = [];
  const roots = [
    "src",
    "tests",
    "src-tauri/src",
    "src-tauri/capabilities",
  ];

  const seen = new Set();

  const addFile = (relativePath) => {
    if (seen.has(relativePath)) {
      return;
    }

    const absolutePath = fromPosixRelative(
      rootDir,
      relativePath,
    );

    if (
      !fs.existsSync(absolutePath) ||
      !fs.lstatSync(absolutePath).isFile()
    ) {
      return;
    }

    seen.add(relativePath);

    const stat = fs.statSync(absolutePath);

    records.push({
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolutePath),
    });
  };

  const walk = (relativeDir) => {
    const absoluteDir = fromPosixRelative(
      rootDir,
      relativeDir,
    );

    if (!fs.existsSync(absoluteDir)) {
      return;
    }

    const entries = fs.readdirSync(
      absoluteDir,
      {
        withFileTypes: true,
      },
    );

    entries.sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en"),
    );

    for (const entry of entries) {
      const relativePath = `${relativeDir}/${entry.name}`;
      const absolutePath = fromPosixRelative(
        rootDir,
        relativePath,
      );

      if (entry.isSymbolicLink()) {
        fail(
          `Symlink não é permitido em escopo de migração durante o dry-run: ${relativePath}`,
        );
      }

      if (entry.isDirectory()) {
        walk(relativePath);
      } else if (entry.isFile()) {
        addFile(relativePath);
      }
    }
  };

  for (const root of roots) {
    walk(root);
  }

  for (const relativePath of ROOT_MIGRATION_RELEVANT_FILES) {
    addFile(relativePath);
  }

  for (const relativePath of RELEVANT_EXACT_PATHS) {
    addFile(relativePath);
  }

  records.sort(
    (a, b) =>
      a.path.localeCompare(b.path, "en"),
  );

  return records;
}

function validateMigrationRelevantBaseline(rootDir, stage3Files) {
  const expected = stage3Files
    .filter(
      (record) =>
        record &&
        typeof record.path === "string" &&
        isMigrationRelevantPath(record.path),
    )
    .map((record) => ({
      path: record.path,
      bytes: Number(record.bytes),
      sha256: record.sha256,
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path, "en"),
    );

  const current = collectCurrentRelevantFiles(rootDir);

  const expectedByPath = new Map(
    expected.map((record) => [record.path, record]),
  );

  const currentByPath = new Map(
    current.map((record) => [record.path, record]),
  );

  const missing = [];
  const added = [];
  const changed = [];

  for (const expectedRecord of expected) {
    const currentRecord = currentByPath.get(
      expectedRecord.path,
    );

    if (!currentRecord) {
      missing.push(expectedRecord);
      continue;
    }

    if (
      currentRecord.sha256 !== expectedRecord.sha256 ||
      currentRecord.bytes !== expectedRecord.bytes
    ) {
      changed.push({
        path: expectedRecord.path,
        expected: expectedRecord,
        current: currentRecord,
      });
    }
  }

  for (const currentRecord of current) {
    if (!expectedByPath.has(currentRecord.path)) {
      added.push(currentRecord);
    }
  }

  const addedByHash = new Map();

  for (const addedRecord of added) {
    const list = addedByHash.get(addedRecord.sha256) ?? [];
    list.push(addedRecord);
    addedByHash.set(addedRecord.sha256, list);
  }

  const possibleRelocations = [];

  for (const missingRecord of missing) {
    const hashMatches = addedByHash.get(
      missingRecord.sha256,
    ) ?? [];

    for (const match of hashMatches) {
      if (match.bytes === missingRecord.bytes) {
        possibleRelocations.push({
          expectedPath: missingRecord.path,
          foundAt: match.path,
          sha256: missingRecord.sha256,
          bytes: missingRecord.bytes,
        });
      }
    }
  }

  return {
    clean:
      missing.length === 0 &&
      added.length === 0 &&
      changed.length === 0,
    expectedFileCount: expected.length,
    currentFileCount: current.length,
    missing,
    added,
    changed,
    possibleRelocations,
  };
}

function validateLiveStage5Plan(rootDir, approvedStage5) {
  try {
    const livePlan = buildMigrationPlan(rootDir);

    const approvedDigest =
      approvedStage5.plan.migrationPlanSha256;

    const liveDigest =
      livePlan.migrationPlanSha256;

    const mappingMatches =
      semanticSha256(livePlan.mapping) ===
      semanticSha256(approvedStage5.plan.mapping);

    return {
      verified: true,
      error: null,
      approvedDigest,
      liveDigest,
      digestMatches:
        approvedDigest === liveDigest,
      mappingMatches,
      livePlan,
    };
  } catch (error) {
    return {
      verified: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      approvedDigest:
        approvedStage5.plan.migrationPlanSha256,
      liveDigest: null,
      digestMatches: false,
      mappingMatches: false,
      livePlan: null,
    };
  }
}

function ensureDotRelative(relativePath) {
  if (
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("./") ||
    relativePath.startsWith("../")
  ) {
    return relativePath;
  }

  return `./${relativePath}`;
}

function splitSpecifierSuffix(specifier) {
  const queryIndex = specifier.indexOf("?");
  const hashIndex = specifier.indexOf("#");

  let cut = specifier.length;

  if (queryIndex >= 0) {
    cut = Math.min(cut, queryIndex);
  }

  if (hashIndex >= 0) {
    cut = Math.min(cut, hashIndex);
  }

  return {
    pathPart: specifier.slice(0, cut),
    suffix: specifier.slice(cut),
  };
}

function findMappedTargetForLogicalPath(
  logicalPath,
  mapping,
) {
  if (Object.hasOwn(mapping, logicalPath)) {
    return {
      oldResolvedTarget: logicalPath,
      newResolvedTarget: mapping[logicalPath],
    };
  }

  const extensionCandidates = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".css",
  ];

  for (const extension of extensionCandidates) {
    const candidate = `${logicalPath}${extension}`;

    if (Object.hasOwn(mapping, candidate)) {
      return {
        oldResolvedTarget: candidate,
        newResolvedTarget: mapping[candidate],
      };
    }
  }

  for (const extension of extensionCandidates) {
    const candidate =
      `${logicalPath}/index${extension}`;

    if (Object.hasOwn(mapping, candidate)) {
      return {
        oldResolvedTarget: candidate,
        newResolvedTarget: mapping[candidate],
      };
    }
  }

  return null;
}

function preserveSpecifierStyle(
  oldSpecifier,
  sourceAfter,
  oldResolvedTarget,
  newResolvedTarget,
) {
  const { pathPart, suffix } =
    splitSpecifierSuffix(oldSpecifier);

  let styledTarget =
    newResolvedTarget;

  if (
    oldResolvedTarget !== null
  ) {
    const oldTargetBase =
      path.posix.basename(
        oldResolvedTarget,
      );

    const originalBase =
      path.posix.basename(
        pathPart,
      );

    const targetExtension =
      path.posix.extname(
        oldResolvedTarget,
      );

    const originalExtension =
      path.posix.extname(
        pathPart,
      );

    const oldTargetIsIndex =
      /^index\.[^.]+$/u.test(
        oldTargetBase,
      );

    const originalExplicitlyNamesIndex =
      /^index(?:\.[^.]+)?$/u.test(
        originalBase,
      );

    if (
      oldTargetIsIndex &&
      !originalExplicitlyNamesIndex
    ) {
      styledTarget =
        path.posix.dirname(
          newResolvedTarget,
        );
    } else if (
      originalExtension.length === 0 &&
      CODE_EXTENSIONS.has(
        targetExtension,
      )
    ) {
      styledTarget =
        newResolvedTarget.slice(
          0,
          -targetExtension.length,
        );
    } else if (
      originalExtension.length > 0 &&
      targetExtension.length > 0 &&
      CODE_EXTENSIONS.has(
        targetExtension,
      ) &&
      originalExtension !==
        targetExtension
    ) {
      styledTarget =
        `${newResolvedTarget.slice(
          0,
          -targetExtension.length,
        )}${originalExtension}`;
    }
  }

  let relative =
    path.posix.relative(
      path.posix.dirname(
        sourceAfter,
      ),
      styledTarget,
    );

  if (relative.length === 0) {
    relative = ".";
  }

  return `${ensureDotRelative(relative)}${suffix}`;
}

function planLayoutImportRewrites(
  imports,
  mapping,
) {
  const rewrites = [];

  for (const edge of imports) {
    if (
      !edge ||
      edge.specifierKind !== "relative" ||
      typeof edge.sourcePath !== "string" ||
      typeof edge.specifier !== "string"
    ) {
      continue;
    }

    const sourceAfter =
      mapping[edge.sourcePath] ??
      edge.sourcePath;

    const sourceMoved =
      sourceAfter !==
      edge.sourcePath;

    let oldResolvedTarget =
      typeof edge.targetPath === "string"
        ? edge.targetPath
        : null;

    let newResolvedTarget =
      oldResolvedTarget !== null
        ? (
            mapping[oldResolvedTarget] ??
            oldResolvedTarget
          )
        : null;

    if (
      oldResolvedTarget === null
    ) {
      const { pathPart } =
        splitSpecifierSuffix(
          edge.specifier,
        );

      const logicalOldTarget =
        path.posix.normalize(
          path.posix.join(
            path.posix.dirname(
              edge.sourcePath,
            ),
            pathPart,
          ),
        );

      const mapped =
        findMappedTargetForLogicalPath(
          logicalOldTarget,
          mapping,
        );

      if (mapped) {
        oldResolvedTarget =
          mapped.oldResolvedTarget;
        newResolvedTarget =
          mapped.newResolvedTarget;
      } else {
        oldResolvedTarget =
          null;
        newResolvedTarget =
          logicalOldTarget;
      }
    }

    const targetMoved =
      oldResolvedTarget !== null &&
      Object.hasOwn(
        mapping,
        oldResolvedTarget,
      );

    if (
      !sourceMoved &&
      !targetMoved
    ) {
      continue;
    }

    const newSpecifier =
      preserveSpecifierStyle(
        edge.specifier,
        sourceAfter,
        oldResolvedTarget,
        newResolvedTarget,
      );

    if (
      newSpecifier ===
      edge.specifier
    ) {
      continue;
    }

    rewrites.push({
      stage: 13,
      kind: edge.kind,
      sourcePathBefore:
        edge.sourcePath,
      sourcePathAfter:
        sourceAfter,
      line:
        edge.line ?? null,
      targetPathBefore:
        oldResolvedTarget,
      targetPathAfter:
        newResolvedTarget,
      oldSpecifier:
        edge.specifier,
      newSpecifier,
      sourceMoved,
      targetMoved,
    });
  }

  rewrites.sort((a, b) => {
    const bySource =
      a.sourcePathBefore.localeCompare(
        b.sourcePathBefore,
        "en",
      );

    if (bySource !== 0) {
      return bySource;
    }

    const lineA =
      Number.isFinite(a.line)
        ? a.line
        : 0;

    const lineB =
      Number.isFinite(b.line)
        ? b.line
        : 0;

    if (lineA !== lineB) {
      return lineA - lineB;
    }

    return a.oldSpecifier.localeCompare(
      b.oldSpecifier,
      "en",
    );
  });

  return rewrites;
}

function planCoreAliasCandidates(
  signals,
  mapping,
) {
  const source =
    Array.isArray(
      signals.externalCoreSubpathImports,
    )
      ? signals.externalCoreSubpathImports
      : [];

  return source
    .map((edge) => ({
      stage: 16,
      sourcePathBefore:
        edge.sourcePath,
      sourcePathAfter:
        mapping[edge.sourcePath] ??
        edge.sourcePath,
      line:
        edge.line ?? null,
      kind:
        edge.kind,
      oldSpecifier:
        edge.specifier,
      targetPath:
        edge.targetPath,
      candidateSpecifier:
        "@core",
      status:
        "candidate-needs-public-export-validation",
    }))
    .sort((a, b) => {
      const bySource =
        a.sourcePathBefore.localeCompare(
          b.sourcePathBefore,
          "en",
        );

      if (bySource !== 0) {
        return bySource;
      }

      return (
        Number(a.line ?? 0) -
        Number(b.line ?? 0)
      );
    });
}

function collectMissingDirectoryClosure(
  rootDir,
  requestedDirectories,
) {
  const missing = new Set();

  for (const requested of requestedDirectories) {
    let current = requested;

    while (
      current !== "." &&
      current.length > 0
    ) {
      const absolutePath =
        fromPosixRelative(
          rootDir,
          current,
        );

      if (
        fs.existsSync(
          absolutePath,
        )
      ) {
        break;
      }

      missing.add(
        current,
      );

      const parent =
        path.posix.dirname(
          current,
        );

      if (
        parent ===
        current
      ) {
        break;
      }

      current =
        parent;
    }
  }

  return [...missing].sort(
    (a, b) => {
      const depthA =
        a.split("/").length;
      const depthB =
        b.split("/").length;

      if (depthA !== depthB) {
        return depthA - depthB;
      }

      return a.localeCompare(
        b,
        "en",
      );
    },
  );
}

function planDirectoryCreation(
  rootDir,
  plan,
) {
  const engineRequested =
    Array.isArray(
      plan.plannedDirectories,
    )
      ? plan.plannedDirectories
      : [];

  const conceptualRequested =
    CONCEPTUAL_AREAS.map(
      (area) =>
        area.directory,
    );

  const engineMissing =
    collectMissingDirectoryClosure(
      rootDir,
      engineRequested,
    ).filter(
      (relativePath) =>
        relativePath.startsWith(
          "src/engine/",
        ),
    );

  const conceptualMissing =
    collectMissingDirectoryClosure(
      rootDir,
      conceptualRequested,
    ).filter(
      (relativePath) =>
        relativePath ===
          "src/domain" ||
        relativePath.startsWith(
          "src/domain/",
        ) ||
        relativePath ===
          "src/services" ||
        relativePath.startsWith(
          "src/services/",
        ) ||
        relativePath ===
          "src/app/flows" ||
        relativePath.startsWith(
          "src/app/flows/",
        ),
    );

  const allMissing =
    [...new Set([
      ...engineMissing,
      ...conceptualMissing,
    ])];

  allMissing.sort(
    (a, b) => {
      const depthA =
        a.split("/").length;
      const depthB =
        b.split("/").length;

      if (depthA !== depthB) {
        return depthA - depthB;
      }

      return a.localeCompare(
        b,
        "en",
      );
    },
  );

  return {
    engineMissing,
    conceptualMissing,
    allMissing,
  };
}

function planConceptualFiles(
  rootDir,
) {
  return CONCEPTUAL_AREAS.map(
    (area) => ({
      directory:
        area.directory,
      path:
        area.readme,
      exists:
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            area.readme,
          ),
        ),
      operation:
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            area.readme,
          ),
        )
          ? "preserve"
          : "create-readme-later",
      placeholderTsFiles:
        0,
    }),
  );
}

function detectCoreAliasPlan(
  rootDir,
) {
  const tsconfigPath =
    "tsconfig.json";
  const vitePath =
    "vite.config.ts";

  const tsconfigSource =
    fs.existsSync(
      fromPosixRelative(
        rootDir,
        tsconfigPath,
      ),
    )
      ? fs.readFileSync(
          fromPosixRelative(
            rootDir,
            tsconfigPath,
          ),
          "utf8",
        )
      : "";

  const viteSource =
    fs.existsSync(
      fromPosixRelative(
        rootDir,
        vitePath,
      ),
    )
      ? fs.readFileSync(
          fromPosixRelative(
            rootDir,
            vitePath,
          ),
          "utf8",
        )
      : "";

  const tsconfigHasCoreAlias =
    /["']@core["']\s*:/u.test(
      tsconfigSource,
    );

  const tsconfigHasBaseUrl =
    /["']baseUrl["']\s*:/u.test(
      tsconfigSource,
    );

  const viteHasCoreAlias =
    /["']@core["']/u.test(
      viteSource,
    );

  return {
    tsconfig: {
      path:
        tsconfigPath,
      currentlyHasBaseUrl:
        tsconfigHasBaseUrl,
      currentlyHasCoreAlias:
        tsconfigHasCoreAlias,
      planned: {
        baseUrl: ".",
        paths: {
          "@core": [
            "src/core/index.ts",
          ],
        },
      },
      pending:
        !tsconfigHasCoreAlias ||
        !tsconfigHasBaseUrl,
    },
    vite: {
      path:
        vitePath,
      currentlyHasCoreAlias:
        viteHasCoreAlias,
      plannedAliasExpression:
        'fileURLToPath(new URL("./src/core/index.ts", import.meta.url))',
      plannedNodeUrlImport:
        'import { fileURLToPath } from "node:url";',
      pending:
        !viteHasCoreAlias,
    },
  };
}

function countLiteralOldPaths(
  source,
  mapping,
) {
  const matches = [];

  for (
    const [oldPath, newPath] of
      Object.entries(mapping)
  ) {
    if (
      source.includes(oldPath)
    ) {
      matches.push({
        oldPath,
        newPath,
      });
    }
  }

  matches.sort(
    (a, b) =>
      a.oldPath.localeCompare(
        b.oldPath,
        "en",
      ),
  );

  return matches;
}

function planGuardrailChanges(
  rootDir,
  mapping,
) {
  return GUARDRAILS.map(
    (guardrail) => {
      const absolutePath =
        fromPosixRelative(
          rootDir,
          guardrail.path,
        );

      const exists =
        fs.existsSync(
          absolutePath,
        );

      const source =
        exists
          ? fs.readFileSync(
              absolutePath,
              "utf8",
            )
          : "";

      const oldPathReferences =
        countLiteralOldPaths(
          source,
          mapping,
        );

      return {
        path:
          guardrail.path,
        exists,
        futureAction:
          guardrail.futureAction,
        oldEnginePathReferenceCount:
          oldPathReferences.length,
        oldEnginePathReferences:
          oldPathReferences,
      };
    },
  );
}

function planFreezeChanges(
  rootDir,
  mapping,
  guardrailPlan,
) {
  const freezeGuardrail =
    guardrailPlan.find(
      (record) =>
        record.path ===
        "tests/freeze-lock.mjs",
    );

  return {
    lockFilePathMigration: {
      from:
        "tests/.freeze-lock.json",
      to:
        ".freeze-lock.json",
      sourceExistsNow:
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            "tests/.freeze-lock.json",
          ),
        ),
      targetExistsNow:
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            ".freeze-lock.json",
          ),
        ),
      stage:
        24,
      operation:
        "future-path-migration",
    },
    protectedEnginePathRewrites:
      freezeGuardrail
        ?.oldEnginePathReferences ??
      [],
    sourceOfTruthAfterGovernanceMigration:
      "scripts/architecture/module-map.mjs",
  };
}

function formatOptionalLineNumber(line) {
  return Number.isFinite(line)
    ? `:${String(line)}`
    : "";
}

function printBlockers(blockers) {
  console.log("");
  console.log(
    "=== PRE-FLIGHT / BLOQUEADORES ===",
  );

  if (
    blockers.length ===
    0
  ) {
    console.log(
      "[OK] Nenhum bloqueador detectado.",
    );
    return;
  }

  for (
    let index = 0;
    index < blockers.length;
    index += 1
  ) {
    const blocker =
      blockers[index];

    console.log(
      `[BLOQUEIO ${String(index + 1)}] ${blocker.title}`,
    );

    for (
      const line of
        blocker.details
    ) {
      console.log(
        `  ${line}`,
      );
    }
  }
}

function printDirectoryPlan(
  directoryPlan,
) {
  console.log("");
  console.log(
    "=== DIRETÓRIOS QUE SERÃO CRIADOS ===",
  );
  console.log(
    `Engine/public/internal pendentes: ${String(directoryPlan.engineMissing.length)}`,
  );

  for (
    const relativePath of
      directoryPlan.engineMissing
  ) {
    console.log(
      `  [MKDIR] ${relativePath}/`,
    );
  }

  console.log(
    `Diretórios conceituais/parents pendentes: ${String(directoryPlan.conceptualMissing.length)}`,
  );

  for (
    const relativePath of
      directoryPlan.conceptualMissing
  ) {
    console.log(
      `  [MKDIR] ${relativePath}/`,
    );
  }
}

function printMovePlan(
  plan,
) {
  console.log("");
  console.log(
    "=== ARQUIVOS QUE SERÃO MOVIDOS ===",
  );
  console.log(
    `Total: ${String(plan.operations.length)} | Workers: ${String(plan.workerMoves.length)}`,
  );

  for (
    const operation of
      plan.operations
  ) {
    const workerTag =
      operation.isWorker
        ? " [WORKER]"
        : "";

    console.log(
      `  [MOVE${workerTag}] ${operation.oldPath} -> ${operation.newPath}`,
    );
  }
}

function printImportPlan(
  layoutRewrites,
  coreAliasCandidates,
) {
  console.log("");
  console.log(
    "=== IMPORTS QUE SERÃO ALTERADOS ===",
  );
  console.log(
    `Rewrites de paths por movimentação (Etapa 13): ${String(layoutRewrites.length)}`,
  );

  for (
    const rewrite of
      layoutRewrites
  ) {
    console.log(
      `  [${rewrite.kind}] ${rewrite.sourcePathBefore}${formatOptionalLineNumber(rewrite.line)}`,
    );
    console.log(
      `      ${rewrite.oldSpecifier} -> ${rewrite.newSpecifier}`,
    );

    if (
      rewrite.sourcePathBefore !==
      rewrite.sourcePathAfter
    ) {
      console.log(
        `      source: ${rewrite.sourcePathBefore} -> ${rewrite.sourcePathAfter}`,
      );
    }
  }

  console.log(
    `Candidatos a @core (Etapa 16): ${String(coreAliasCandidates.length)}`,
  );

  for (
    const candidate of
      coreAliasCandidates
  ) {
    console.log(
      `  [@core candidate] ${candidate.sourcePathBefore}${formatOptionalLineNumber(candidate.line)}`,
    );
    console.log(
      `      ${candidate.oldSpecifier} -> @core`,
    );
    console.log(
      "      validação final de export público fica para a Etapa 16",
    );
  }
}

function printAliasPlan(
  aliasPlan,
) {
  console.log("");
  console.log(
    "=== ALIASES ===",
  );

  console.log(
    `  ${aliasPlan.tsconfig.path}`,
  );
  console.log(
    `    atual baseUrl: ${aliasPlan.tsconfig.currentlyHasBaseUrl ? "presente" : "ausente"}`,
  );
  console.log(
    `    atual @core: ${aliasPlan.tsconfig.currentlyHasCoreAlias ? "presente" : "ausente"}`,
  );
  console.log(
    '    planejado: baseUrl="."',
  );
  console.log(
    '    planejado: paths["@core"]=["src/core/index.ts"]',
  );

  console.log(
    `  ${aliasPlan.vite.path}`,
  );
  console.log(
    `    atual @core: ${aliasPlan.vite.currentlyHasCoreAlias ? "presente" : "ausente"}`,
  );
  console.log(
    `    planejado: @core -> ${aliasPlan.vite.plannedAliasExpression}`,
  );
}

function printConceptualFiles(
  conceptualFiles,
) {
  console.log("");
  console.log(
    "=== ARQUIVOS CONCEITUAIS ===",
  );

  for (
    const record of
      conceptualFiles
  ) {
    console.log(
      `  [${record.exists ? "PRESERVE" : "CREATE LATER"}] ${record.path}`,
    );
  }

  console.log(
    "  Placeholders .ts planejados: 0",
  );
}

function printGuardrailPlan(
  guardrails,
) {
  console.log("");
  console.log(
    "=== GUARDRAILS AFETADOS ===",
  );

  for (
    const guardrail of
      guardrails
  ) {
    console.log(
      `  ${guardrail.path}`,
    );
    console.log(
      `    existe: ${guardrail.exists ? "sim" : "não"}`,
    );
    console.log(
      `    referências diretas a old engine paths: ${String(guardrail.oldEnginePathReferenceCount)}`,
    );
    console.log(
      `    ação futura: ${guardrail.futureAction}`,
    );
  }
}

function printFreezePlan(
  freezePlan,
) {
  console.log("");
  console.log(
    "=== FREEZE PATHS AFETADOS ===",
  );

  const lock =
    freezePlan.lockFilePathMigration;

  console.log(
    `  lock path: ${lock.from} -> ${lock.to}`,
  );
  console.log(
    `  lock antigo existe agora: ${lock.sourceExistsNow ? "sim" : "não"}`,
  );
  console.log(
    `  lock alvo existe agora: ${lock.targetExistsNow ? "sim" : "não"}`,
  );
  console.log(
    `  paths protegidos de engine a atualizar: ${String(freezePlan.protectedEnginePathRewrites.length)}`,
  );

  for (
    const rewrite of
      freezePlan.protectedEnginePathRewrites
  ) {
    console.log(
      `    ${rewrite.oldPath} -> ${rewrite.newPath}`,
    );
  }

  console.log(
    `  fonte futura: ${freezePlan.sourceOfTruthAfterGovernanceMigration}`,
  );
}

function printBaselineDrift(
  baseline,
) {
  console.log("");
  console.log(
    "=== INTEGRIDADE DO ESCOPO DE MIGRAÇÃO ===",
  );
  console.log(
    `Esperados da Etapa 3: ${String(baseline.expectedFileCount)} arquivo(s)`,
  );
  console.log(
    `Atuais no escopo: ${String(baseline.currentFileCount)} arquivo(s)`,
  );
  console.log(
    `Missing: ${String(baseline.missing.length)} | Added: ${String(baseline.added.length)} | Changed: ${String(baseline.changed.length)}`,
  );

  for (
    const relocation of
      baseline.possibleRelocations
  ) {
    console.log(
      "  [POSSÍVEL RELOCAÇÃO NÃO AUTORIZADA]",
    );
    console.log(
      `    esperado: ${relocation.expectedPath}`,
    );
    console.log(
      `    encontrado: ${relocation.foundAt}`,
    );
    console.log(
      `    SHA-256: ${relocation.sha256}`,
    );
  }

  for (
    const record of
      baseline.missing
  ) {
    console.log(
      `  [MISSING] ${record.path}`,
    );
  }

  for (
    const record of
      baseline.added
  ) {
    console.log(
      `  [ADDED] ${record.path}`,
    );
  }

  for (
    const record of
      baseline.changed
  ) {
    console.log(
      `  [CHANGED] ${record.path}`,
    );
    console.log(
      `      Etapa 3: ${record.expected.sha256}`,
    );
    console.log(
      `      Atual:   ${record.current.sha256}`,
    );
  }
}

export function buildDryRunPreview(
  rootDir,
  approvedStage5,
  stage3Artifacts,
) {
  const plan =
    approvedStage5.plan;

  const directoryPlan =
    planDirectoryCreation(
      rootDir,
      plan,
    );

  const layoutImportRewrites =
    planLayoutImportRewrites(
      stage3Artifacts.imports,
      plan.mapping,
    );

  const coreAliasCandidates =
    planCoreAliasCandidates(
      stage3Artifacts.signals,
      plan.mapping,
    );

  const aliasPlan =
    detectCoreAliasPlan(
      rootDir,
    );

  const conceptualFiles =
    planConceptualFiles(
      rootDir,
    );

  const guardrails =
    planGuardrailChanges(
      rootDir,
      plan.mapping,
    );

  const freezePlan =
    planFreezeChanges(
      rootDir,
      plan.mapping,
      guardrails,
    );

  return {
    directoryPlan,
    layoutImportRewrites,
    coreAliasCandidates,
    aliasPlan,
    conceptualFiles,
    guardrails,
    freezePlan,
  };
}

function buildBlockers(
  baseline,
  livePlanValidation,
  approvedStage5,
) {
  const blockers = [];

  if (!baseline.clean) {
    const details = [
      `Escopo da Etapa 3 divergiu: missing=${String(baseline.missing.length)}, added=${String(baseline.added.length)}, changed=${String(baseline.changed.length)}.`,
    ];

    for (
      const relocation of
        baseline.possibleRelocations
    ) {
      details.push(
        `Possível relocação: ${relocation.expectedPath} -> ${relocation.foundAt} (mesmo SHA-256).`,
      );
    }

    blockers.push({
      title:
        "Drift detectado em arquivos de migração desde a Etapa 3.",
      details,
    });
  }

  if (!livePlanValidation.verified) {
    blockers.push({
      title:
        "Não foi possível recomputar o plano vivo da Etapa 5.",
      details: [
        livePlanValidation.error ??
          "Erro desconhecido.",
      ],
    });
  } else {
    if (!livePlanValidation.digestMatches) {
      blockers.push({
        title:
          "Migration plan SHA-256 vivo diverge do plano aprovado.",
        details: [
          `Aprovado: ${approvedStage5.plan.migrationPlanSha256}`,
          `Atual: ${String(livePlanValidation.liveDigest)}`,
        ],
      });
    }

    if (!livePlanValidation.mappingMatches) {
      blockers.push({
        title:
          "oldPath → newPath vivo diverge do mapeamento aprovado na Etapa 5.",
        details: [
          "Execute novamente a Etapa 5 somente depois de resolver o drift.",
        ],
      });
    }
  }

  return blockers;
}

export function runStage6() {
  const options =
    parseArguments(
      process.argv.slice(2),
    );

  if (options.help) {
    printHelp();
    return;
  }

  const rootDir =
    assertRepositoryRoot(
      process.cwd(),
    );

  const stateBefore =
    snapshotProjectState(
      rootDir,
    );

  let desiredExitCode =
    0;

  let executionError =
    null;

  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 6: DRY-RUN OBRIGATÓRIO DA MIGRAÇÃO v20 ",
    );
    console.log(
      "============================================================\n",
    );
    console.log(
      `[OK] Raiz Git: ${rootDir}`,
    );
    console.log(
      "[MODO] DRY-RUN / READ-ONLY",
    );
    console.log(
      "[GARANTIA] Nenhum artefato da Etapa 6 será gravado em .migration.",
    );

    const approvedStage5 =
      loadApprovedStage5(
        rootDir,
      );

    console.log(
      `[OK] Etapa 5 aprovada: ${approvedStage5.runId}`,
    );
    console.log(
      `[OK] Plan SHA-256 aprovado: ${approvedStage5.plan.migrationPlanSha256}`,
    );

    const stage3Artifacts =
      loadStage3Artifacts(
        rootDir,
        approvedStage5.plan,
      );

    const baseline =
      validateMigrationRelevantBaseline(
        rootDir,
        stage3Artifacts.files,
      );

    const livePlanValidation =
      validateLiveStage5Plan(
        rootDir,
        approvedStage5,
      );

    const blockers =
      buildBlockers(
        baseline,
        livePlanValidation,
        approvedStage5,
      );

    const preview =
      buildDryRunPreview(
        rootDir,
        approvedStage5,
        stage3Artifacts,
      );

    printBaselineDrift(
      baseline,
    );

    printBlockers(
      blockers,
    );

    printDirectoryPlan(
      preview.directoryPlan,
    );

    printMovePlan(
      approvedStage5.plan,
    );

    printImportPlan(
      preview.layoutImportRewrites,
      preview.coreAliasCandidates,
    );

    printAliasPlan(
      preview.aliasPlan,
    );

    printConceptualFiles(
      preview.conceptualFiles,
    );

    printGuardrailPlan(
      preview.guardrails,
    );

    printFreezePlan(
      preview.freezePlan,
    );

    console.log("");
    console.log(
      "=== RESUMO DO DRY-RUN ===",
    );
    console.log(
      `Diretórios pendentes: ${String(preview.directoryPlan.allMissing.length)}`,
    );
    console.log(
      `Move operations: ${String(approvedStage5.plan.operations.length)}`,
    );
    console.log(
      `Workers: ${String(approvedStage5.plan.workerMoves.length)}`,
    );
    console.log(
      `Rewrites de import por layout: ${String(preview.layoutImportRewrites.length)}`,
    );
    console.log(
      `Candidatos a @core: ${String(preview.coreAliasCandidates.length)}`,
    );
    console.log(
      `README conceituais: ${String(preview.conceptualFiles.length)}`,
    );
    console.log(
      `Guardrails: ${String(preview.guardrails.length)}`,
    );
    console.log(
      `Freeze engine path rewrites: ${String(preview.freezePlan.protectedEnginePathRewrites.length)}`,
    );
    console.log(
      `Bloqueadores: ${String(blockers.length)}`,
    );

    if (blockers.length > 0) {
      console.log("");
      console.log(
        "============================================================",
      );
      console.log(
        "  DRY-RUN CONCLUÍDO, MAS A MIGRAÇÃO ESTÁ BLOQUEADA          ",
      );
      console.log(
        "============================================================",
      );
      console.log(
        "Nenhum write foi solicitado.",
      );
      console.log(
        "Resolva os bloqueadores antes da Etapa 7.",
      );

      desiredExitCode =
        2;
    } else {
      console.log("");
      console.log(
        "============================================================",
      );
      console.log(
        "  ETAPA 6 CONCLUÍDA COM SUCESSO                             ",
      );
      console.log(
        "============================================================",
      );
      console.log(
        "Dry-run aprovado para a estrutura atual.",
      );
      console.log(
        "Nenhum arquivo ou diretório foi alterado.",
      );

      desiredExitCode =
        0;
    }
  } catch (error) {
    executionError =
      error instanceof Error
        ? error
        : new Error(
            String(error),
          );

    desiredExitCode =
      1;
  } finally {
    const stateAfter =
      snapshotProjectState(
        rootDir,
      );

    const stateComparison =
      compareProjectStates(
        stateBefore,
        stateAfter,
      );

    console.log("");
    console.log(
      "=== PROVA READ-ONLY ===",
    );
    console.log(
      `Estado antes: ${stateBefore.digest}`,
    );
    console.log(
      `Estado depois: ${stateAfter.digest}`,
    );

    if (stateComparison.unchanged) {
      console.log(
        "[OK] Nenhum arquivo, diretório ou symlink do projeto foi alterado pelo dry-run.",
      );
    } else {
      console.error(
        "[FALHA CRÍTICA] O estado do projeto mudou durante o dry-run.",
      );

      for (const record of stateComparison.added.slice(0, 20)) {
        console.error(
          `  [ADDED] ${record.path}`,
        );
      }

      for (const record of stateComparison.removed.slice(0, 20)) {
        console.error(
          `  [REMOVED] ${record.path}`,
        );
      }

      for (const record of stateComparison.changed.slice(0, 20)) {
        console.error(
          `  [CHANGED] ${record.before.path}`,
        );
      }

      desiredExitCode =
        3;
    }
  }

  if (executionError) {
    console.error("");
    console.error(
      "[ERRO] Etapa 6 não concluída.",
    );
    console.error(
      executionError.stack ??
        executionError.message,
    );
  }

  process.exitCode =
    desiredExitCode;
}

const executedAsMain =
  process.argv[1] !== undefined &&
  normalizeAbsolute(
    fileURLToPath(import.meta.url),
  ) ===
    normalizeAbsolute(
      process.argv[1],
    );

if (executedAsMain) {
  runStage6();
}
