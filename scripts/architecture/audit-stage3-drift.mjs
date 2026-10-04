#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CANONICAL_MODULES,
} from "./module-map.mjs";

import {
  buildMigrationPlan,
} from "./plan-migration.mjs";

export const AUDIT_NAME =
  "audit-stage3-drift-v2";

const STAGE3_NAME =
  "stage-3-architecture-inventory";

const STAGE5_NAME =
  "stage-5-path-migration-plan";

const ROOT_MIGRATION_RELEVANT_FILES =
  new Set([
    "AGENTS.md",
    "agents.mjs",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
  ]);

const RELEVANT_PREFIXES =
  Object.freeze([
    "src/",
    "tests/",
    "src-tauri/src/",
    "src-tauri/capabilities/",
  ]);

const RELEVANT_EXACT_PATHS =
  new Set([
    "src-tauri/build.rs",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/steam_appid.txt",
  ]);

const WALK_EXCLUDED_TOP_LEVEL =
  new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    "target",
  ]);

const WALK_EXCLUDED_PREFIXES =
  Object.freeze([
    ".cache/",
    ".turbo/",
    ".vite/",
    "src-tauri/target/",
  ]);

const CONCEPTUAL_DIRECTORIES =
  Object.freeze([
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

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(inputPath) {
  const normalized =
    path.normalize(
      path.resolve(inputPath),
    );

  return process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(rootDir, absolutePath) {
  return path
    .relative(rootDir, absolutePath)
    .split(path.sep)
    .join("/");
}

function fromPosixRelative(rootDir, relativePath) {
  return path.join(
    rootDir,
    ...relativePath.split("/"),
  );
}

function runCommand(
  executable,
  args,
  cwd,
  allowFailure = false,
) {
  const result =
    spawnSync(
      executable,
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

  if (result.error) {
    if (allowFailure) {
      return {
        status: result.status ?? 1,
        stdout: String(result.stdout ?? ""),
        stderr: String(result.stderr ?? ""),
      };
    }

    throw result.error;
  }

  const status =
    result.status ?? 1;

  const stdout =
    String(result.stdout ?? "");

  const stderr =
    String(result.stderr ?? "");

  if (
    status !== 0 &&
    !allowFailure
  ) {
    fail(
      stderr.trim().length > 0
        ? stderr.trim()
        : `${executable} ${args.join(" ")} falhou com código ${String(status)}.`,
    );
  }

  return {
    status,
    stdout,
    stderr,
  };
}

function runGit(
  args,
  cwd,
  allowFailure = false,
) {
  return runCommand(
    "git",
    args,
    cwd,
    allowFailure,
  );
}

function assertRepositoryRoot(cwd) {
  const inside =
    runGit(
      ["rev-parse", "--is-inside-work-tree"],
      cwd,
    ).stdout.trim();

  if (inside !== "true") {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRootRaw =
    runGit(
      ["rev-parse", "--show-toplevel"],
      cwd,
    ).stdout.trim();

  if (gitRootRaw.length === 0) {
    fail(
      "Não foi possível determinar a raiz do repositório Git.",
    );
  }

  if (
    normalizeAbsolute(cwd) !==
    normalizeAbsolute(gitRootRaw)
  ) {
    fail(
      [
        "Execute este auditor exatamente na raiz do projeto.",
        `Atual: ${cwd}`,
        `Raiz Git: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(gitRootRaw);
}

function parseArguments(argv) {
  const options = {
    json: false,
    recoveryRoot: null,
  };

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--recovery-root") {
      const value = argv[index + 1];

      if (
        value === undefined ||
        value.startsWith("--")
      ) {
        fail(
          "--recovery-root exige um caminho.",
        );
      }

      options.recoveryRoot =
        path.resolve(value);

      index += 1;
      continue;
    }

    if (
      arg === "--help" ||
      arg === "-h"
    ) {
      return {
        help: true,
        json: false,
        recoveryRoot: null,
      };
    }

    fail(
      `Argumento inválido: ${arg}`,
    );
  }

  return {
    help: false,
    ...options,
  };
}

function printHelp() {
  console.log(`
Projeto1 — Auditoria completa contra o baseline da Etapa 3

Uso:
  node scripts/architecture/audit-stage3-drift.mjs
  node scripts/architecture/audit-stage3-drift.mjs --json
  node scripts/architecture/audit-stage3-drift.mjs --recovery-root "C:/caminho/dos/snapshots"

O auditor é somente leitura.

Ele verifica:
  - arquivos faltantes desde a Etapa 3;
  - arquivos novos dentro do escopo usado pela Etapa 6;
  - arquivos alterados por SHA-256;
  - relocações por hash idêntico;
  - o bloqueador equivalente ao dry-run da Etapa 6;
  - recomputação do plano vivo da Etapa 5;
  - estado físico da Etapa 7;
  - estado físico da Etapa 8;
  - candidatos de recuperação em uma pasta externa opcional.

Nenhum arquivo é restaurado, copiado, movido, criado ou removido.
`);
}

function readJson(
  filePath,
  displayPath,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8",
      ),
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

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath),
    )
    .digest("hex");
}

function sha256Text(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
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
      .map((entry) =>
        stableStringify(entry))
      .join(",")}]`;
  }

  const keys =
    Object.keys(value).sort(
      (a, b) =>
        a.localeCompare(b, "en"),
    );

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(",")}}`;
}

function semanticSha256(value) {
  return sha256Text(
    stableStringify(value),
  );
}

function isMigrationRelevantPath(
  relativePath,
) {
  if (
    ROOT_MIGRATION_RELEVANT_FILES.has(
      relativePath,
    )
  ) {
    return true;
  }

  if (
    RELEVANT_EXACT_PATHS.has(
      relativePath,
    )
  ) {
    return true;
  }

  return RELEVANT_PREFIXES.some(
    (prefix) =>
      relativePath.startsWith(prefix),
  );
}

function shouldExcludeWalkPath(
  relativePath,
  isDirectory,
) {
  if (relativePath.length === 0) {
    return false;
  }

  const topLevel =
    relativePath.split("/")[0];

  if (
    isDirectory &&
    WALK_EXCLUDED_TOP_LEVEL.has(
      topLevel,
    )
  ) {
    return true;
  }

  const normalized =
    isDirectory
      ? `${relativePath}/`
      : relativePath;

  return WALK_EXCLUDED_PREFIXES.some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(prefix),
  );
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();

    if (currentDir === undefined) {
      continue;
    }

    let entries;

    try {
      entries =
        fs.readdirSync(
          currentDir,
          {
            withFileTypes: true,
          },
        );
    } catch {
      continue;
    }

    entries.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          "en",
        ),
    );

    for (
      let index =
        entries.length - 1;
      index >= 0;
      index -= 1
    ) {
      const entry =
        entries[index];

      const absolutePath =
        path.join(
          currentDir,
          entry.name,
        );

      const relativePath =
        toPosixRelative(
          rootDir,
          absolutePath,
        );

      if (
        shouldExcludeWalkPath(
          relativePath,
          entry.isDirectory(),
        )
      ) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath,
        });
      }
    }
  }

  files.sort(
    (a, b) =>
      a.relativePath.localeCompare(
        b.relativePath,
        "en",
      ),
  );

  return files;
}

function collectCurrentRelevantFiles(
  rootDir,
) {
  return walkFiles(rootDir)
    .filter(
      (record) =>
        isMigrationRelevantPath(
          record.relativePath,
        ),
    )
    .map(
      (record) => {
        const stat =
          fs.statSync(
            record.absolutePath,
          );

        return {
          path: record.relativePath,
          bytes: stat.size,
          sha256:
            sha256File(
              record.absolutePath,
            ),
        };
      },
    );
}

function loadStage3(rootDir) {
  const stage3Root =
    path.join(
      rootDir,
      ".migration",
      "stage3",
    );

  const latestPath =
    path.join(
      stage3Root,
      "LATEST",
    );

  if (!fs.existsSync(latestPath)) {
    fail(
      "Pré-condição ausente: .migration/stage3/LATEST",
    );
  }

  const runId =
    fs.readFileSync(
      latestPath,
      "utf8",
    ).trim();

  const runDir =
    path.join(
      stage3Root,
      runId,
    );

  const inventoryPath =
    path.join(
      runDir,
      "architecture-inventory.json",
    );

  const filesPath =
    path.join(
      runDir,
      "files.json",
    );

  if (
    !fs.existsSync(inventoryPath) ||
    !fs.existsSync(filesPath)
  ) {
    fail(
      `Artefatos incompletos da Etapa 3 em ${toPosixRelative(rootDir, runDir)}`,
    );
  }

  const inventory =
    readJson(
      inventoryPath,
      toPosixRelative(
        rootDir,
        inventoryPath,
      ),
    );

  const files =
    readJson(
      filesPath,
      toPosixRelative(
        rootDir,
        filesPath,
      ),
    );

  if (
    inventory.stage !==
    STAGE3_NAME
  ) {
    fail(
      `Stage inesperado no baseline: ${String(inventory.stage)}`,
    );
  }

  if (!Array.isArray(files)) {
    fail(
      "files.json da Etapa 3 deveria conter um array.",
    );
  }

  return {
    runId,
    inventoryPath:
      toPosixRelative(
        rootDir,
        inventoryPath,
      ),
    filesPath:
      toPosixRelative(
        rootDir,
        filesPath,
      ),
    inventory,
    files,
  };
}

function loadStage5(rootDir) {
  const stage5Root =
    path.join(
      rootDir,
      ".migration",
      "stage5",
    );

  const latestPath =
    path.join(
      stage5Root,
      "LATEST",
    );

  if (!fs.existsSync(latestPath)) {
    return null;
  }

  const runId =
    fs.readFileSync(
      latestPath,
      "utf8",
    ).trim();

  if (runId.length === 0) {
    return null;
  }

  const reportPath =
    path.join(
      stage5Root,
      runId,
      "migration-plan.json",
    );

  if (!fs.existsSync(reportPath)) {
    return null;
  }

  const report =
    readJson(
      reportPath,
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    );

  if (
    report.stage !== STAGE5_NAME ||
    report.status !== "passed"
  ) {
    return null;
  }

  return {
    runId,
    reportPath:
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    report,
    plan: report.plan,
  };
}

function compareAgainstStage3(
  stage3Files,
  currentFiles,
) {
  const expected =
    stage3Files
      .filter(
        (record) =>
          record &&
          typeof record.path === "string" &&
          isMigrationRelevantPath(
            record.path,
          ),
      )
      .map(
        (record) => ({
          path: record.path,
          bytes: Number(record.bytes),
          sha256: record.sha256,
          extension:
            record.extension ?? "",
          area:
            record.area ?? null,
          module:
            record.module ?? null,
          isText:
            record.isText === true,
        }),
      )
      .sort(
        (a, b) =>
          a.path.localeCompare(
            b.path,
            "en",
          ),
      );

  const expectedByPath =
    new Map(
      expected.map(
        (record) => [
          record.path,
          record,
        ],
      ),
    );

  const currentByPath =
    new Map(
      currentFiles.map(
        (record) => [
          record.path,
          record,
        ],
      ),
    );

  const missing = [];
  const added = [];
  const changed = [];
  const unchanged = [];

  for (const expectedRecord of expected) {
    const currentRecord =
      currentByPath.get(
        expectedRecord.path,
      );

    if (currentRecord === undefined) {
      missing.push(expectedRecord);
      continue;
    }

    if (
      currentRecord.bytes !==
        expectedRecord.bytes ||
      currentRecord.sha256 !==
        expectedRecord.sha256
    ) {
      changed.push({
        path:
          expectedRecord.path,
        expected:
          expectedRecord,
        current:
          currentRecord,
      });
      continue;
    }

    unchanged.push(expectedRecord);
  }

  for (const currentRecord of currentFiles) {
    if (
      !expectedByPath.has(
        currentRecord.path,
      )
    ) {
      added.push(currentRecord);
    }
  }

  const addedBySignature =
    new Map();

  for (const record of added) {
    const key =
      `${String(record.bytes)}:${record.sha256}`;

    const list =
      addedBySignature.get(key) ?? [];

    list.push(record);

    addedBySignature.set(
      key,
      list,
    );
  }

  const relocations = [];

  for (const missingRecord of missing) {
    const key =
      `${String(missingRecord.bytes)}:${missingRecord.sha256}`;

    const matches =
      addedBySignature.get(key) ?? [];

    for (const match of matches) {
      relocations.push({
        from:
          missingRecord.path,
        to:
          match.path,
        bytes:
          missingRecord.bytes,
        sha256:
          missingRecord.sha256,
        exactContentMatch:
          true,
      });
    }
  }

  return {
    expectedCount:
      expected.length,
    currentCount:
      currentFiles.length,
    unchangedCount:
      unchanged.length,
    missing,
    added,
    changed,
    relocations,
    clean:
      missing.length === 0 &&
      added.length === 0 &&
      changed.length === 0,
  };
}

function collectProjectHashIndex(rootDir) {
  const index = new Map();

  for (const record of walkFiles(rootDir)) {
    const stat =
      fs.statSync(
        record.absolutePath,
      );

    const sha256 =
      sha256File(
        record.absolutePath,
      );

    const key =
      `${String(stat.size)}:${sha256}`;

    const list =
      index.get(key) ?? [];

    list.push(
      record.relativePath,
    );

    index.set(
      key,
      list,
    );
  }

  return index;
}

function scanRecoveryRoot(
  recoveryRoot,
  missingRecords,
) {
  if (recoveryRoot === null) {
    return [];
  }

  if (!fs.existsSync(recoveryRoot)) {
    fail(
      `--recovery-root não existe: ${recoveryRoot}`,
    );
  }

  const wanted =
    new Map(
      missingRecords.map(
        (record) => [
          `${String(record.bytes)}:${record.sha256}`,
          record,
        ],
      ),
    );

  if (wanted.size === 0) {
    return [];
  }

  const wantedSizes =
    new Set(
      [...wanted.values()]
        .map(
          (record) =>
            record.bytes,
        ),
    );

  const matches = [];
  const stack = [recoveryRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop();

    if (currentDir === undefined) {
      continue;
    }

    let entries;

    try {
      entries =
        fs.readdirSync(
          currentDir,
          {
            withFileTypes: true,
          },
        );
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath =
        path.join(
          currentDir,
          entry.name,
        );

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === "target"
        ) {
          continue;
        }

        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      let stat;

      try {
        stat =
          fs.statSync(
            absolutePath,
          );
      } catch {
        continue;
      }

      if (!wantedSizes.has(stat.size)) {
        continue;
      }

      let sha256;

      try {
        sha256 =
          sha256File(
            absolutePath,
          );
      } catch {
        continue;
      }

      const key =
        `${String(stat.size)}:${sha256}`;

      const expectedRecord =
        wanted.get(key);

      if (expectedRecord === undefined) {
        continue;
      }

      matches.push({
        expectedPath:
          expectedRecord.path,
        expectedBytes:
          expectedRecord.bytes,
        expectedSha256:
          expectedRecord.sha256,
        candidateAbsolutePath:
          absolutePath,
      });
    }
  }

  matches.sort(
    (a, b) =>
      a.candidateAbsolutePath.localeCompare(
        b.candidateAbsolutePath,
        "en",
      ),
  );

  return matches;
}

function buildApprovedPlanDigest(
  operations,
) {
  if (!Array.isArray(operations)) {
    return null;
  }

  const digestPayload =
    operations.map(
      (operation) => ({
        oldPath:
          operation.oldPath,
        newPath:
          operation.newPath,
        sha256:
          operation.sha256,
      }),
    );

  return sha256Text(
    stableStringify(
      digestPayload,
    ),
  );
}

function buildMappingFromOperations(
  operations,
) {
  if (!Array.isArray(operations)) {
    return null;
  }

  const mapping = {};

  for (
    const operation of
      operations
  ) {
    if (
      operation === null ||
      typeof operation !== "object" ||
      typeof operation.oldPath !== "string" ||
      typeof operation.newPath !== "string"
    ) {
      return null;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        mapping,
        operation.oldPath,
      )
    ) {
      return null;
    }

    mapping[
      operation.oldPath
    ] =
      operation.newPath;
  }

  return mapping;
}

function buildCanonicalTargetDirectories() {
  const directories =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    directories.push(
      moduleRecord.engine.root,
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  return directories.sort(
    (a, b) =>
      a.localeCompare(
        b,
        "en",
      ),
  );
}

function compareStringSets(
  actual,
  expected,
) {
  const actualSorted =
    [...actual].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  const expectedSorted =
    [...expected].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  return (
    actualSorted.length ===
      expectedSorted.length &&
    actualSorted.every(
      (value, index) =>
        value ===
        expectedSorted[index],
    )
  );
}

export function validateApprovedStage5Artifact(
  approvedStage5,
) {
  if (approvedStage5 === null) {
    return {
      available: false,
      verified: false,
      blocker:
        "Etapa 5 aprovada não encontrada.",
      approvedDigest: null,
      computedDigest: null,
      digestMatches: false,
      mappingMatches: false,
      canonicalDirectoriesMatch: false,
    };
  }

  const plan =
    approvedStage5.plan;

  const approvedDigest =
    plan
      ?.migrationPlanSha256 ??
    null;

  const operations =
    plan
      ?.operations;

  const computedDigest =
    buildApprovedPlanDigest(
      operations,
    );

  const derivedMapping =
    buildMappingFromOperations(
      operations,
    );

  const approvedMapping =
    plan
      ?.mapping;

  const plannedDirectories =
    Array.isArray(
      plan
        ?.plannedDirectories,
    )
      ? plan.plannedDirectories
      : [];

  const canonicalDirectories =
    buildCanonicalTargetDirectories();

  const digestMatches =
    typeof approvedDigest ===
      "string" &&
    computedDigest !==
      null &&
    approvedDigest ===
      computedDigest;

  const mappingMatches =
    derivedMapping !==
      null &&
    approvedMapping !==
      null &&
    typeof approvedMapping ===
      "object" &&
    semanticSha256(
      approvedMapping,
    ) ===
      semanticSha256(
        derivedMapping,
      );

  const canonicalDirectoriesMatch =
    plannedDirectories.length >
      0 &&
    compareStringSets(
      plannedDirectories,
      canonicalDirectories,
    );

  const verified =
    digestMatches &&
    mappingMatches &&
    canonicalDirectoriesMatch;

  const blocker =
    verified
      ? null
      : [
          "Artefato aprovado da Etapa 5 não passou na validação interna.",
          `Digest interno: ${digestMatches ? "OK" : "DIVERGENTE"}`,
          `Mapping interno: ${mappingMatches ? "OK" : "DIVERGENTE"}`,
          `Diretórios canônicos: ${canonicalDirectoriesMatch ? "OK" : "DIVERGENTE"}`,
        ].join(
          " ",
        );

  return {
    available: true,
    verified,
    blocker,
    approvedDigest,
    computedDigest,
    digestMatches,
    mappingMatches,
    canonicalDirectoriesMatch,
  };
}

function auditLiveStage5Plan(
  rootDir,
  approvedStage5,
  stage7,
) {
  if (approvedStage5 === null) {
    return {
      mode:
        "unavailable",
      recomputed:
        false,
      available:
        false,
      verified:
        false,
      blocker:
        "Etapa 5 aprovada não encontrada.",
      approvedDigest:
        null,
      liveDigest:
        null,
      digestMatches:
        false,
      mappingMatches:
        false,
      canonicalDirectoriesMatch:
        false,
    };
  }

  /*
   * O planner da Etapa 5 é deliberadamente pré-Etapa 7:
   * ele trata /public e /internal já existentes como colisões.
   *
   * Portanto, depois que a Etapa 7 materializa qualquer diretório
   * reservado, NÃO é válido chamar buildMigrationPlan(rootDir)
   * novamente para concluir que o plano aprovado divergiu.
   *
   * Pós-Etapa 7 validamos:
   *   1) integridade interna do plano aprovado;
   *   2) mapping derivado das próprias operations;
   *   3) conjunto de diretórios canônicos contra module-map atual.
   *
   * A integridade dos arquivos fonte continua sendo validada
   * separadamente contra o baseline da Etapa 3.
   */
  if (
    stage7.reservedPresentCount >
    0
  ) {
    const approvedArtifact =
      validateApprovedStage5Artifact(
        approvedStage5,
      );

    return {
      mode:
        "approved-artifact-post-stage7",
      recomputed:
        false,
      available:
        approvedArtifact.available,
      verified:
        approvedArtifact.verified,
      blocker:
        approvedArtifact.blocker,
      approvedDigest:
        approvedArtifact.approvedDigest,
      liveDigest:
        approvedArtifact.computedDigest,
      digestMatches:
        approvedArtifact.digestMatches,
      mappingMatches:
        approvedArtifact.mappingMatches,
      canonicalDirectoriesMatch:
        approvedArtifact.canonicalDirectoriesMatch,
    };
  }

  try {
    const livePlan =
      buildMigrationPlan(
        rootDir,
      );

    const approvedDigest =
      approvedStage5
        .plan
        ?.migrationPlanSha256 ??
      null;

    const liveDigest =
      livePlan
        ?.migrationPlanSha256 ??
      null;

    const approvedMapping =
      approvedStage5
        .plan
        ?.mapping ??
      {};

    const liveMapping =
      livePlan
        ?.mapping ??
      {};

    const digestMatches =
      approvedDigest !==
        null &&
      approvedDigest ===
        liveDigest;

    const mappingMatches =
      semanticSha256(
        approvedMapping,
      ) ===
      semanticSha256(
        liveMapping,
      );

    return {
      mode:
        "live-pre-stage7",
      recomputed:
        true,
      available:
        true,
      verified:
        true,
      blocker:
        null,
      approvedDigest,
      liveDigest,
      digestMatches,
      mappingMatches,
      canonicalDirectoriesMatch:
        true,
    };
  } catch (error) {
    return {
      mode:
        "live-pre-stage7",
      recomputed:
        true,
      available:
        true,
      verified:
        false,
      blocker:
        error instanceof
        Error
          ? error.message
          : String(
              error,
            ),
      approvedDigest:
        approvedStage5
          .plan
          ?.migrationPlanSha256 ??
        null,
      liveDigest:
        null,
      digestMatches:
        false,
      mappingMatches:
        false,
      canonicalDirectoriesMatch:
        false,
    };
  }
}

function inspectStage7(rootDir) {
  const expected = [];

  for (const moduleRecord of CANONICAL_MODULES) {
    expected.push(
      moduleRecord.engine.root,
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  const present = [];
  const missing = [];
  const conflicts = [];

  for (const relativePath of expected) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    if (!fs.existsSync(absolutePath)) {
      missing.push(relativePath);
      continue;
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isDirectory() &&
      !stat.isSymbolicLink()
    ) {
      present.push(relativePath);
    } else {
      conflicts.push(relativePath);
    }
  }

  let status;

  if (conflicts.length > 0) {
    status = "conflict";
  } else if (missing.length === 0) {
    status = "complete";
  } else if (present.length === 0) {
    status = "not-applied";
  } else {
    status = "partial";
  }

  const reservedExpected =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    reservedExpected.push(
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  const reservedPresent =
    reservedExpected.filter(
      (relativePath) =>
        present.includes(
          relativePath,
        ),
    );

  const reservedMissing =
    reservedExpected.filter(
      (relativePath) =>
        !present.includes(
          relativePath,
        ),
    );

  return {
    status,
    expectedCount: expected.length,
    presentCount: present.length,
    missingCount: missing.length,
    conflictCount: conflicts.length,
    reservedExpectedCount:
      reservedExpected.length,
    reservedPresentCount:
      reservedPresent.length,
    reservedMissingCount:
      reservedMissing.length,
    reservedPresent,
    reservedMissing,
    present,
    missing,
    conflicts,
  };
}

function inspectStage8(rootDir) {
  const present = [];
  const missing = [];
  const conflicts = [];

  for (
    const relativePath of
      CONCEPTUAL_DIRECTORIES
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    if (!fs.existsSync(absolutePath)) {
      missing.push(relativePath);
      continue;
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isDirectory() &&
      !stat.isSymbolicLink()
    ) {
      present.push(relativePath);
    } else {
      conflicts.push(relativePath);
    }
  }

  let status;

  if (conflicts.length > 0) {
    status = "conflict";
  } else if (missing.length === 0) {
    status = "complete";
  } else if (present.length === 0) {
    status = "not-applied";
  } else {
    status = "partial";
  }

  return {
    status,
    expectedCount:
      CONCEPTUAL_DIRECTORIES.length,
    presentCount: present.length,
    missingCount: missing.length,
    conflictCount: conflicts.length,
    present,
    missing,
    conflicts,
  };
}

function buildStage6EquivalentBlockers(
  drift,
  livePlanAudit,
) {
  const blockers = [];

  if (!drift.clean) {
    blockers.push({
      kind:
        "stage3-baseline-drift",
      message:
        `Escopo da Etapa 3 divergiu: missing=${String(drift.missing.length)}, added=${String(drift.added.length)}, changed=${String(drift.changed.length)}.`,
    });
  }

  if (!livePlanAudit.available) {
    blockers.push({
      kind:
        "stage5-plan-unavailable",
      message:
        livePlanAudit.blocker,
    });

    return blockers;
  }

  if (!livePlanAudit.verified) {
    blockers.push({
      kind:
        "stage5-live-plan-failed",
      message:
        livePlanAudit.blocker,
    });

    return blockers;
  }

  if (!livePlanAudit.digestMatches) {
    blockers.push({
      kind:
        "stage5-plan-digest-drift",
      message:
        `Migration plan diverge: aprovado=${String(livePlanAudit.approvedDigest)}, verificado=${String(livePlanAudit.liveDigest)}.`,
    });
  }

  if (!livePlanAudit.mappingMatches) {
    blockers.push({
      kind:
        "stage5-mapping-drift",
      message:
        "oldPath → newPath diverge do plano aprovado na Etapa 5.",
    });
  }

  return blockers;
}

function snapshotRelevantDigest(
  currentFiles,
) {
  return semanticSha256(
    currentFiles,
  );
}

function printRecord(
  prefix,
  record,
) {
  console.log(
    `${prefix} ${record.path}`,
  );
  console.log(
    `    bytes: ${String(record.bytes)}`,
  );
  console.log(
    `    sha256: ${record.sha256}`,
  );
}

function printAudit(audit) {
  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — AUDITORIA COMPLETA CONTRA ETAPA 3            ",
  );
  console.log(
    "============================================================",
  );
  console.log("");
  console.log(
    `[OK] Baseline Etapa 3: ${audit.stage3.runId}`,
  );
  console.log(
    `[OK] Arquivos esperados no mesmo escopo usado pela Etapa 6: ${String(audit.drift.expectedCount)}`,
  );
  console.log(
    `[OK] Arquivos atuais nesse escopo: ${String(audit.drift.currentCount)}`,
  );

  console.log("");
  console.log(
    "=== DRIFT DE ARQUIVOS ===",
  );
  console.log(
    `Inalterados: ${String(audit.drift.unchangedCount)}`,
  );
  console.log(
    `Faltantes: ${String(audit.drift.missing.length)}`,
  );
  console.log(
    `Novos: ${String(audit.drift.added.length)}`,
  );
  console.log(
    `Alterados: ${String(audit.drift.changed.length)}`,
  );
  console.log(
    `Relocações exatas detectadas: ${String(audit.drift.relocations.length)}`,
  );

  if (audit.drift.missing.length > 0) {
    console.log("");
    console.log("--- FALTANTES ---");

    for (const record of audit.drift.missing) {
      printRecord(
        "[MISSING]",
        record,
      );
    }
  }

  if (audit.drift.added.length > 0) {
    console.log("");
    console.log("--- NOVOS ---");

    for (const record of audit.drift.added) {
      printRecord(
        "[ADDED]",
        record,
      );
    }
  }

  if (audit.drift.changed.length > 0) {
    console.log("");
    console.log("--- ALTERADOS ---");

    for (const record of audit.drift.changed) {
      console.log(
        `[CHANGED] ${record.path}`,
      );
      console.log(
        `    esperado bytes: ${String(record.expected.bytes)}`,
      );
      console.log(
        `    atual bytes:    ${String(record.current.bytes)}`,
      );
      console.log(
        `    esperado sha:   ${record.expected.sha256}`,
      );
      console.log(
        `    atual sha:      ${record.current.sha256}`,
      );
    }
  }

  if (audit.drift.relocations.length > 0) {
    console.log("");
    console.log(
      "--- RELOCAÇÕES EXATAS ---",
    );

    for (
      const relocation of
        audit.drift.relocations
    ) {
      console.log(
        `[RELOCATED] ${relocation.from} -> ${relocation.to}`,
      );
      console.log(
        `    bytes: ${String(relocation.bytes)}`,
      );
      console.log(
        `    sha256: ${relocation.sha256}`,
      );
    }
  }

  console.log("");
  console.log(
    "=== CANDIDATOS NO PRÓPRIO PROJETO POR HASH ===",
  );

  if (
    audit.localRecoveryCandidates.length ===
    0
  ) {
    console.log(
      "Nenhum candidato adicional encontrado.",
    );
  } else {
    for (
      const candidate of
        audit.localRecoveryCandidates
    ) {
      console.log(
        `[HASH MATCH] esperado=${candidate.expectedPath}`,
      );

      for (
        const foundPath of
          candidate.foundPaths
      ) {
        console.log(
          `    encontrado=${foundPath}`,
        );
      }
    }
  }

  if (
    audit.externalRecoveryRoot !==
    null
  ) {
    console.log("");
    console.log(
      "=== CANDIDATOS EM --recovery-root ===",
    );

    if (
      audit.externalRecoveryMatches.length ===
      0
    ) {
      console.log(
        "Nenhum arquivo externo com bytes+SHA-256 exatos.",
      );
    } else {
      for (
        const match of
          audit.externalRecoveryMatches
      ) {
        console.log(
          `[RECOVERY MATCH] ${match.expectedPath}`,
        );
        console.log(
          `    candidato: ${match.candidateAbsolutePath}`,
        );
        console.log(
          `    bytes: ${String(match.expectedBytes)}`,
        );
        console.log(
          `    sha256: ${match.expectedSha256}`,
        );
      }
    }
  }

  console.log("");
  console.log(
    "=== ETAPA 5 — VALIDAÇÃO DO PLANO ===",
  );
  console.log(
    `Disponível: ${audit.livePlanAudit.available ? "sim" : "não"}`,
  );
  console.log(
    `Modo: ${audit.livePlanAudit.mode}`,
  );
  console.log(
    `Recomputado: ${audit.livePlanAudit.recomputed ? "sim" : "não (esperado após materialização da Etapa 7)"}`,
  );
  console.log(
    `Verificado: ${audit.livePlanAudit.verified ? "sim" : "não"}`,
  );
  console.log(
    `Digest válido: ${audit.livePlanAudit.digestMatches ? "sim" : "não"}`,
  );
  console.log(
    `Mapping válido: ${audit.livePlanAudit.mappingMatches ? "sim" : "não"}`,
  );
  console.log(
    `Diretórios canônicos válidos: ${audit.livePlanAudit.canonicalDirectoriesMatch ? "sim" : "não"}`,
  );

  if (
    audit.livePlanAudit.blocker !==
    null
  ) {
    console.log(
      `Erro: ${audit.livePlanAudit.blocker}`,
    );
  }

  console.log("");
  console.log(
    "=== ETAPA 7 — ESTADO FÍSICO ===",
  );
  console.log(
    `Status: ${audit.stage7.status}`,
  );
  console.log(
    `Presentes: ${String(audit.stage7.presentCount)}/${String(audit.stage7.expectedCount)}`,
  );
  console.log(
    `Ausentes: ${String(audit.stage7.missingCount)}`,
  );
  console.log(
    `Conflitos: ${String(audit.stage7.conflictCount)}`,
  );

  if (audit.stage7.missing.length > 0) {
    for (
      const relativePath of
        audit.stage7.missing.slice(
          0,
          25,
        )
    ) {
      console.log(
        `  [MISSING DIR] ${relativePath}/`,
      );
    }

    if (
      audit.stage7.missing.length >
      25
    ) {
      console.log(
        `  ... mais ${String(audit.stage7.missing.length - 25)} diretório(s).`,
      );
    }
  }

  console.log("");
  console.log(
    "=== ETAPA 8 — ESTADO FÍSICO ===",
  );
  console.log(
    `Status: ${audit.stage8.status}`,
  );
  console.log(
    `Presentes: ${String(audit.stage8.presentCount)}/${String(audit.stage8.expectedCount)}`,
  );
  console.log(
    `Ausentes: ${String(audit.stage8.missingCount)}`,
  );
  console.log(
    `Conflitos: ${String(audit.stage8.conflictCount)}`,
  );

  console.log("");
  console.log(
    "=== BLOQUEADORES EQUIVALENTES À ETAPA 6 ===",
  );

  if (
    audit.stage6EquivalentBlockers.length ===
    0
  ) {
    console.log(
      "[OK] Nenhum bloqueador equivalente detectado.",
    );
  } else {
    for (
      let index = 0;
      index <
      audit.stage6EquivalentBlockers.length;
      index += 1
    ) {
      const blocker =
        audit.stage6EquivalentBlockers[index];

      console.log(
        `[BLOQUEADOR ${String(index + 1)}] ${blocker.kind}`,
      );
      console.log(
        `    ${blocker.message}`,
      );
    }
  }

  console.log("");
  console.log(
    "=== PROVA READ-ONLY DO AUDITOR ===",
  );
  console.log(
    `Digest relevante antes: ${audit.readOnly.beforeDigest}`,
  );
  console.log(
    `Digest relevante depois: ${audit.readOnly.afterDigest}`,
  );
  console.log(
    audit.readOnly.unchanged
      ? "[OK] Auditor não alterou nenhum arquivo do escopo relevante."
      : "[FALHA] Estado relevante mudou durante a auditoria.",
  );

  console.log("");
  console.log("=== CONCLUSÃO ===");

  if (
    audit.drift.clean &&
    audit.stage6EquivalentBlockers.length === 0
  ) {
    console.log(
      "Baseline da Etapa 3 está íntegro no escopo da Etapa 6.",
    );
    console.log(
      "Não há arquivo a recuperar por causa deste baseline.",
    );
  } else {
    console.log(
      "Há divergência real contra o baseline da Etapa 3.",
    );
    console.log(
      "Não restaure nada sem conferir bytes e SHA-256 mostrados acima.",
    );
  }
}

export function runAudit() {
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

  const stage3 =
    loadStage3(rootDir);

  const stage5 =
    loadStage5(rootDir);

  const currentBefore =
    collectCurrentRelevantFiles(
      rootDir,
    );

  const beforeDigest =
    snapshotRelevantDigest(
      currentBefore,
    );

  const drift =
    compareAgainstStage3(
      stage3.files,
      currentBefore,
    );

  const projectHashIndex =
    collectProjectHashIndex(
      rootDir,
    );

  const localRecoveryCandidates =
    drift.missing
      .map(
        (record) => {
          const key =
            `${String(record.bytes)}:${record.sha256}`;

          const foundPaths =
            (
              projectHashIndex.get(key) ?? []
            ).filter(
              (foundPath) =>
                foundPath !== record.path,
            );

          return {
            expectedPath: record.path,
            bytes: record.bytes,
            sha256: record.sha256,
            foundPaths,
          };
        },
      )
      .filter(
        (record) =>
          record.foundPaths.length > 0,
      );

  const externalRecoveryMatches =
    scanRecoveryRoot(
      options.recoveryRoot,
      drift.missing,
    );

  const stage7 =
    inspectStage7(rootDir);

  const livePlanAudit =
    auditLiveStage5Plan(
      rootDir,
      stage5,
      stage7,
    );

  const stage8 =
    inspectStage8(rootDir);

  const stage6EquivalentBlockers =
    buildStage6EquivalentBlockers(
      drift,
      livePlanAudit,
    );

  const currentAfter =
    collectCurrentRelevantFiles(
      rootDir,
    );

  const afterDigest =
    snapshotRelevantDigest(
      currentAfter,
    );

  const audit = {
    audit: AUDIT_NAME,
    projectRoot: rootDir,
    stage3: {
      runId: stage3.runId,
      inventoryPath:
        stage3.inventoryPath,
      filesPath:
        stage3.filesPath,
      treeSha256:
        stage3.inventory
          ?.summary
          ?.treeSha256 ??
        null,
    },
    stage5:
      stage5 === null
        ? null
        : {
            runId:
              stage5.runId,
            reportPath:
              stage5.reportPath,
            migrationPlanSha256:
              stage5.plan
                ?.migrationPlanSha256 ??
              null,
          },
    drift,
    localRecoveryCandidates,
    externalRecoveryRoot:
      options.recoveryRoot,
    externalRecoveryMatches,
    livePlanAudit,
    stage7,
    stage8,
    stage6EquivalentBlockers,
    readOnly: {
      beforeDigest,
      afterDigest,
      unchanged:
        beforeDigest === afterDigest,
    },
  };

  if (options.json) {
    console.log(
      JSON.stringify(
        audit,
        null,
        2,
      ),
    );
  } else {
    printAudit(audit);
  }

  if (!audit.readOnly.unchanged) {
    process.exitCode = 3;
    return;
  }

  process.exitCode =
    audit.stage6EquivalentBlockers.length === 0
      ? 0
      : 2;
}

const executedAsMain =
  process.argv[1] !== undefined &&
  normalizeAbsolute(
    fileURLToPath(
      import.meta.url,
    ),
  ) ===
    normalizeAbsolute(
      process.argv[1],
    );

if (executedAsMain) {
  try {
    runAudit();
  } catch (error) {
    console.error("");
    console.error(
      "[ERRO] Auditoria não concluída.",
    );
    console.error(
      error instanceof Error
        ? (
            error.stack ??
            error.message
          )
        : String(error),
    );

    process.exitCode = 1;
  }
}
