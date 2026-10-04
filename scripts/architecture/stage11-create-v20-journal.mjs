#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-11-v20-journal-and-rollback";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const STAGE5_NAME =
  "stage-5-path-migration-plan";

const STAGE10_NAME =
  "stage-10-engine-layout-move";

const EXPECTED_MOVE_COUNT =
  93;

const EXPECTED_WORKER_COUNT =
  2;

const EXPECTED_TOTAL_BYTES =
  396456;

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const EXPECTED_STAGE7_DIRECTORY_COUNT =
  69;

const STAGE10_JOURNAL_PATH =
  ".migration/stage10/move-journal.json";

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const ROLLBACK_SCRIPT_PATH =
  "scripts/architecture/rollback-migration.mjs";

const SCAN_EXCLUDED_TOP_LEVEL =
  new Set([
    ".git",
    ".migration",
    "node_modules",
    "dist",
    "coverage",
    "target",
  ]);

const SCAN_EXCLUDED_RELATIVE_PREFIXES =
  Object.freeze([
    ".cache/",
    ".turbo/",
    ".vite/",
    "src-tauri/target/",
  ]);

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function normalizeAbsolute(
  inputPath,
) {
  const normalized =
    path.normalize(
      path.resolve(
        inputPath,
      ),
    );

  return process.platform ===
    "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function toPosixRelative(
  rootDir,
  absolutePath,
) {
  return path
    .relative(
      rootDir,
      absolutePath,
    )
    .split(
      path.sep,
    )
    .join(
      "/",
    );
}

function assertSafeRelativePath(
  relativePath,
  label,
) {
  if (
    typeof relativePath !==
      "string" ||
    relativePath.length ===
      0 ||
    path.isAbsolute(
      relativePath,
    ) ||
    relativePath.includes(
      "\\",
    )
  ) {
    fail(
      `${label} inválido: ${String(relativePath)}`,
    );
  }

  const segments =
    relativePath.split(
      "/",
    );

  if (
    segments.some(
      (segment) =>
        segment.length ===
          0 ||
        segment ===
          "." ||
        segment ===
          "..",
    )
  ) {
    fail(
      `${label} contém segmento inseguro: ${relativePath}`,
    );
  }
}

function fromPosixRelative(
  rootDir,
  relativePath,
) {
  assertSafeRelativePath(
    relativePath,
    "Path relativo",
  );

  const absolutePath =
    path.join(
      rootDir,
      ...relativePath.split(
        "/",
      ),
    );

  const relativeBack =
    path.relative(
      rootDir,
      absolutePath,
    );

  if (
    relativeBack.startsWith(
      "..",
    ) ||
    path.isAbsolute(
      relativeBack,
    )
  ) {
    fail(
      `Path escapou da raiz do projeto: ${relativePath}`,
    );
  }

  return absolutePath;
}

function parseArguments(
  argv,
) {
  if (
    argv.length ===
    0
  ) {
    return {
      help: false,
    };
  }

  if (
    argv.length ===
      1 &&
    (
      argv[0] ===
        "--help" ||
      argv[0] ===
        "-h"
    )
  ) {
    return {
      help: true,
    };
  }

  fail(
    [
      "Argumentos inválidos.",
      "Uso:",
      "  node scripts/architecture/stage11-create-v20-journal.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 11: journal global v20 + infraestrutura de rollback

Uso:
  node scripts/architecture/stage11-create-v20-journal.mjs

Pré-condições:
  - arquitetura v20;
  - Etapa 5 aprovada;
  - Etapa 10 concluída com 93/93 moves;
  - 2/2 workers em /internal;
  - SHA-256 dos 93 arquivos preservado;
  - scripts/architecture/rollback-migration.mjs presente.

Esta etapa cria somente:
  .migration/v20-journal.json

O rollback real NÃO é executado por este comando.

Para validar o rollback sem alterar arquivos:
  node scripts/architecture/rollback-migration.mjs --dry-run

Para executar rollback explicitamente:
  node scripts/architecture/rollback-migration.mjs --apply
`);
}

function assertProjectRoot(
  rootDir,
) {
  const requiredFiles =
    [
      "package.json",
      "scripts/architecture/module-map.mjs",
      ROLLBACK_SCRIPT_PATH,
      ".migration/stage5/LATEST",
      STAGE10_JOURNAL_PATH,
    ];

  const requiredDirectories =
    [
      "src",
      "src/engine",
      ".migration",
    ];

  for (
    const relativePath of
      requiredFiles
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    if (
      !fs.existsSync(
        absolutePath,
      )
    ) {
      fail(
        `Este comando deve ser executado na raiz do Projeto1. Arquivo obrigatório ausente: ${relativePath}`,
      );
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isSymbolicLink() ||
      !stat.isFile()
    ) {
      fail(
        `Arquivo obrigatório inválido: ${relativePath}`,
      );
    }
  }

  for (
    const relativePath of
      requiredDirectories
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    if (
      !fs.existsSync(
        absolutePath,
      )
    ) {
      fail(
        `Diretório obrigatório ausente: ${relativePath}/`,
      );
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory()
    ) {
      fail(
        `Diretório obrigatório inválido: ${relativePath}/`,
      );
    }
  }
}

function assertArchitectureVersion() {
  if (
    ARCHITECTURE_MIGRATION_VERSION !==
    EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Versão arquitetural inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}. Esperado: ${EXPECTED_ARCHITECTURE_VERSION}.`,
    );
  }

  if (
    CANONICAL_MODULES.length !==
    EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      `Module map deveria conter ${String(EXPECTED_CANONICAL_MODULE_COUNT)} módulos canônicos; atual: ${String(CANONICAL_MODULES.length)}.`,
    );
  }
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
  } catch (
    error
  ) {
    fail(
      `JSON inválido em ${displayPath}: ${
        error instanceof
        Error
          ? error.message
          : String(
              error,
            )
      }`,
    );
  }
}

function sha256Buffer(
  buffer,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      buffer,
    )
    .digest(
      "hex",
    );
}

function sha256File(
  filePath,
) {
  return sha256Buffer(
    fs.readFileSync(
      filePath,
    ),
  );
}

function sha256Text(
  text,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      text,
      "utf8",
    )
    .digest(
      "hex",
    );
}

function stableStringify(
  value,
) {
  if (
    value ===
      null ||
    typeof value !==
      "object"
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return `[${value
      .map(
        (entry) =>
          stableStringify(
            entry,
          ),
      )
      .join(
        ",",
      )}]`;
  }

  const keys =
    Object.keys(
      value,
    ).sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  return `{${keys
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(
      ",",
    )}}`;
}

function semanticSha256(
  value,
) {
  return sha256Text(
    stableStringify(
      value,
    ),
  );
}

function writeJsonAtomic(
  filePath,
  value,
) {
  fs.mkdirSync(
    path.dirname(
      filePath,
    ),
    {
      recursive: true,
    },
  );

  const tempPath =
    `${filePath}.tmp-${String(process.pid)}`;

  const content =
    `${JSON.stringify(value, null, 2)}\n`;

  fs.writeFileSync(
    tempPath,
    content,
    {
      encoding: "utf8",
      flag: "w",
    },
  );

  try {
    fs.renameSync(
      tempPath,
      filePath,
    );
  } catch (
    error
  ) {
    if (
      fs.existsSync(
        filePath,
      )
    ) {
      fs.rmSync(
        filePath,
        {
          force: true,
        },
      );

      fs.renameSync(
        tempPath,
        filePath,
      );
    } else {
      throw error;
    }
  } finally {
    if (
      fs.existsSync(
        tempPath,
      )
    ) {
      fs.rmSync(
        tempPath,
        {
          force: true,
        },
      );
    }
  }
}

function buildPlanDigest(
  operations,
) {
  return sha256Text(
    stableStringify(
      operations.map(
        (operation) => ({
          oldPath:
            operation.oldPath,
          newPath:
            operation.newPath,
          sha256:
            operation.sha256,
        }),
      ),
    ),
  );
}

function buildMappingFromOperations(
  operations,
) {
  const mapping =
    {};

  for (
    const operation of
      operations
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        mapping,
        operation.oldPath,
      )
    ) {
      fail(
        `oldPath duplicado no plano: ${operation.oldPath}`,
      );
    }

    mapping[
      operation.oldPath
    ] =
      operation.newPath;
  }

  return mapping;
}

function canonicalStage7Directories() {
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

function loadApprovedStage5(
  rootDir,
) {
  const latestPath =
    fromPosixRelative(
      rootDir,
      ".migration/stage5/LATEST",
    );

  const runId =
    fs.readFileSync(
      latestPath,
      "utf8",
    ).trim();

  if (
    runId.length ===
    0
  ) {
    fail(
      ".migration/stage5/LATEST está vazio.",
    );
  }

  const reportRelativePath =
    `.migration/stage5/${runId}/migration-plan.json`;

  const reportPath =
    fromPosixRelative(
      rootDir,
      reportRelativePath,
    );

  if (
    !fs.existsSync(
      reportPath,
    )
  ) {
    fail(
      `Plano aprovado da Etapa 5 ausente: ${reportRelativePath}`,
    );
  }

  const report =
    readJson(
      reportPath,
      reportRelativePath,
    );

  if (
    report.stage !==
      STAGE5_NAME ||
    report.status !==
      "passed"
  ) {
    fail(
      "O artefato LATEST da Etapa 5 não é um plano aprovado.",
    );
  }

  if (
    report.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    report.plan
      ?.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      "Plano da Etapa 5 pertence a versão arquitetural diferente de v20.",
    );
  }

  const plan =
    report.plan;

  if (
    plan ===
      null ||
    typeof plan !==
      "object" ||
    !Array.isArray(
      plan.operations,
    )
  ) {
    fail(
      "migration-plan.json não contém operations válidas.",
    );
  }

  if (
    plan.operations.length !==
    EXPECTED_MOVE_COUNT ||
    plan.counts
      ?.moveOperations !==
      EXPECTED_MOVE_COUNT ||
    plan.counts
      ?.workers !==
      EXPECTED_WORKER_COUNT ||
    plan.counts
      ?.canonicalModules !==
      EXPECTED_CANONICAL_MODULE_COUNT ||
    plan.counts
      ?.plannedDirectories !==
      EXPECTED_STAGE7_DIRECTORY_COUNT ||
    plan.counts
      ?.destinationCollisions !==
      0 ||
    plan.counts
      ?.totalBytes !==
      EXPECTED_TOTAL_BYTES
  ) {
    fail(
      "Counts da Etapa 5 não correspondem ao escopo congelado da migração v20.",
    );
  }

  const workers =
    plan.operations.filter(
      (operation) =>
        operation.isWorker ===
        true,
    );

  const workerNames =
    workers
      .map(
        (operation) =>
          operation.fileName,
      )
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            "en",
          ),
      );

  if (
    !compareStringSets(
      workerNames,
      [
        "streaming.worker.ts",
        "terrain.worker.ts",
      ],
    )
  ) {
    fail(
      `Workers inesperados na Etapa 5: ${workerNames.join(", ")}`,
    );
  }

  const computedPlanDigest =
    buildPlanDigest(
      plan.operations,
    );

  if (
    computedPlanDigest !==
    plan.migrationPlanSha256
  ) {
    fail(
      `Digest interno da Etapa 5 divergiu. Aprovado=${String(plan.migrationPlanSha256)}; calculado=${computedPlanDigest}.`,
    );
  }

  const derivedMapping =
    buildMappingFromOperations(
      plan.operations,
    );

  if (
    semanticSha256(
      derivedMapping,
    ) !==
    semanticSha256(
      plan.mapping ??
        {},
    )
  ) {
    fail(
      "Mapping oldPath → newPath da Etapa 5 diverge das operations.",
    );
  }

  if (
    !Array.isArray(
      plan.plannedDirectories,
    ) ||
    !compareStringSets(
      plan.plannedDirectories,
      canonicalStage7Directories(),
    )
  ) {
    fail(
      "plannedDirectories da Etapa 5 divergem do module-map atual.",
    );
  }

  const modules =
    new Map(
      CANONICAL_MODULES.map(
        (moduleRecord) => [
          moduleRecord.key,
          moduleRecord,
        ],
      ),
    );

  const oldPaths =
    new Set();

  const newPaths =
    new Set();

  let totalBytes =
    0;

  for (
    const operation of
      plan.operations
  ) {
    if (
      operation.operation !==
        "move" ||
      typeof operation.oldPath !==
        "string" ||
      typeof operation.newPath !==
        "string" ||
      typeof operation.sha256 !==
        "string" ||
      typeof operation.bytes !==
        "number" ||
      typeof operation.moduleKey !==
        "string" ||
      typeof operation.relativeWithinModule !==
        "string"
    ) {
      fail(
        "Operação incompleta ou não suportada no plano da Etapa 5.",
      );
    }

    assertSafeRelativePath(
      operation.oldPath,
      "oldPath da Etapa 5",
    );

    assertSafeRelativePath(
      operation.newPath,
      "newPath da Etapa 5",
    );

    if (
      oldPaths.has(
        operation.oldPath,
      ) ||
      newPaths.has(
        operation.newPath,
      )
    ) {
      fail(
        `Path duplicado na Etapa 5: ${operation.oldPath} -> ${operation.newPath}`,
      );
    }

    oldPaths.add(
      operation.oldPath,
    );

    newPaths.add(
      operation.newPath,
    );

    const moduleRecord =
      modules.get(
        operation.moduleKey,
      );

    if (
      moduleRecord ===
      undefined
    ) {
      fail(
        `moduleKey não canônico na Etapa 5: ${operation.moduleKey}`,
      );
    }

    const expectedOldPrefix =
      `${moduleRecord.engine.root}/`;

    const expectedNewPrefix =
      `${moduleRecord.engine.internalRoot}/`;

    if (
      !operation.oldPath.startsWith(
        expectedOldPrefix,
      ) ||
      operation.oldPath.startsWith(
        `${moduleRecord.engine.publicRoot}/`,
      ) ||
      operation.oldPath.startsWith(
        `${moduleRecord.engine.internalRoot}/`,
      )
    ) {
      fail(
        `oldPath fora da raiz legada do módulo: ${operation.oldPath}`,
      );
    }

    if (
      !operation.newPath.startsWith(
        expectedNewPrefix,
      ) ||
      operation.newPath !==
        `${moduleRecord.engine.internalRoot}/${operation.relativeWithinModule}`
    ) {
      fail(
        `newPath fora de internal ou sem preservar relativeWithinModule: ${operation.newPath}`,
      );
    }

    if (
      !/^[a-f0-9]{64}$/u.test(
        operation.sha256,
      )
    ) {
      fail(
        `SHA-256 inválido para ${operation.oldPath}.`,
      );
    }

    if (
      !Number.isSafeInteger(
        operation.bytes,
      ) ||
      operation.bytes <
        0
    ) {
      fail(
        `bytes inválido para ${operation.oldPath}.`,
      );
    }

    totalBytes +=
      operation.bytes;
  }

  if (
    totalBytes !==
    EXPECTED_TOTAL_BYTES
  ) {
    fail(
      `Total de bytes das operations (${String(totalBytes)}) diverge do escopo esperado (${String(EXPECTED_TOTAL_BYTES)}).`,
    );
  }

  return {
    runId,
    reportRelativePath,
    plan,
  };
}

function operationIdentityFromStage5(
  operation,
  sequence,
) {
  return {
    sequence,
    moduleKey:
      operation.moduleKey,
    capabilityId:
      operation.capabilityId,
    isWorker:
      operation.isWorker ===
      true,
    oldPath:
      operation.oldPath,
    newPath:
      operation.newPath,
    bytes:
      operation.bytes,
    shaBefore:
      operation.sha256,
    shaAfter:
      operation.sha256,
    transformation:
      "move-engine-implementation-to-module-internal",
  };
}

function immutableJournalIdentity(
  operation,
) {
  return {
    sequence:
      operation.sequence,
    moduleKey:
      operation.moduleKey,
    capabilityId:
      operation.capabilityId,
    isWorker:
      operation.isWorker ===
      true,
    oldPath:
      operation.oldPath,
    newPath:
      operation.newPath,
    bytes:
      operation.bytes,
    shaBefore:
      operation.shaBefore,
    shaAfter:
      operation.shaAfter,
    timestampUtc:
      operation.timestampUtc,
    transformation:
      operation.transformation,
  };
}

function loadStage10Journal(
  rootDir,
) {
  const journalPath =
    fromPosixRelative(
      rootDir,
      STAGE10_JOURNAL_PATH,
    );

  const journal =
    readJson(
      journalPath,
      STAGE10_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      STAGE10_NAME ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_MOVE_COUNT
  ) {
    fail(
      `Journal da Etapa 10 incompatível: ${STAGE10_JOURNAL_PATH}`,
    );
  }

  return journal;
}

function validateStage10JournalAgainstPlan(
  stage10,
  stage5,
  requireCompleted,
) {
  if (
    stage10.sourcePlan
      ?.runId !==
      stage5.runId ||
    stage10.sourcePlan
      ?.migrationPlanSha256 !==
      stage5.plan.migrationPlanSha256
  ) {
    fail(
      "Journal da Etapa 10 pertence a outro plano da Etapa 5.",
    );
  }

  if (
    requireCompleted &&
    stage10.status !==
      "completed"
  ) {
    fail(
      `Etapa 10 ainda não está completed. Status atual: ${String(stage10.status)}`,
    );
  }

  if (
    stage10.status ===
      "rollback-failed"
  ) {
    fail(
      "Journal da Etapa 10 está em rollback-failed.",
    );
  }

  if (
    stage10.counts
      ?.totalOperations !==
      EXPECTED_MOVE_COUNT ||
    stage10.counts
      ?.workers !==
      EXPECTED_WORKER_COUNT ||
    stage10.counts
      ?.totalBytes !==
      EXPECTED_TOTAL_BYTES
  ) {
    fail(
      "Counts do journal da Etapa 10 são incompatíveis.",
    );
  }

  const expected =
    stage5.plan.operations.map(
      (operation, index) =>
        operationIdentityFromStage5(
          operation,
          index +
            1,
        ),
    );

  const actual =
    stage10.operations.map(
      (entry) => ({
        sequence:
          entry.sequence,
        moduleKey:
          entry.moduleKey,
        capabilityId:
          entry.capabilityId,
        isWorker:
          entry.isWorker ===
          true,
        oldPath:
          entry.oldPath,
        newPath:
          entry.newPath,
        bytes:
          entry.bytes,
        shaBefore:
          entry.shaBefore,
        shaAfter:
          entry.shaAfter,
        transformation:
          entry.transformation,
      }),
    );

  if (
    semanticSha256(
      expected,
    ) !==
    semanticSha256(
      actual,
    )
  ) {
    fail(
      "As 93 operações do journal da Etapa 10 divergem do plano aprovado.",
    );
  }

  for (
    const entry of
      stage10.operations
  ) {
    if (
      typeof entry.timestampUtc !==
        "string" ||
      entry.timestampUtc.length ===
        0
    ) {
      if (
        entry.state ===
        "moved"
      ) {
        fail(
          `Operação moved sem timestamp no journal da Etapa 10: ${entry.oldPath}`,
        );
      }
    }
  }
}

function inspectRegularFile(
  absolutePath,
) {
  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    return {
      exists: false,
      kind: "missing",
      bytes: null,
      sha256: null,
    };
  }

  const stat =
    fs.lstatSync(
      absolutePath,
    );

  if (
    stat.isSymbolicLink()
  ) {
    return {
      exists: true,
      kind: "symlink",
      bytes: null,
      sha256: null,
    };
  }

  if (
    !stat.isFile()
  ) {
    return {
      exists: true,
      kind: "non-file",
      bytes: null,
      sha256: null,
    };
  }

  return {
    exists: true,
    kind: "file",
    bytes:
      stat.size,
    sha256:
      sha256File(
        absolutePath,
      ),
  };
}

function matchesExpectedFile(
  info,
  operation,
) {
  return (
    info.exists ===
      true &&
    info.kind ===
      "file" &&
    info.bytes ===
      operation.bytes &&
    info.sha256 ===
      operation.sha256
  );
}

function inspectLayout(
  rootDir,
  operations,
) {
  const migrated =
    [];

  const rolledBack =
    [];

  const conflicts =
    [];

  for (
    const operation of
      operations
  ) {
    const oldInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.oldPath,
        ),
      );

    const newInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.newPath,
        ),
      );

    const oldMatches =
      matchesExpectedFile(
        oldInfo,
        operation,
      );

    const newMatches =
      matchesExpectedFile(
        newInfo,
        operation,
      );

    if (
      !oldInfo.exists &&
      newMatches
    ) {
      migrated.push(
        operation,
      );
      continue;
    }

    if (
      oldMatches &&
      !newInfo.exists
    ) {
      rolledBack.push(
        operation,
      );
      continue;
    }

    conflicts.push(
      {
        operation,
        oldInfo,
        newInfo,
      },
    );
  }

  return {
    migrated,
    rolledBack,
    conflicts,
  };
}

function failForLayoutConflicts(
  layout,
) {
  if (
    layout.conflicts.length ===
    0
  ) {
    return;
  }

  const lines =
    layout.conflicts
      .slice(
        0,
        20,
      )
      .map(
        (record, index) =>
          `${String(index + 1)}. ${record.operation.oldPath} -> ${record.operation.newPath}; old=${record.oldInfo.kind}/${String(record.oldInfo.bytes)}/${String(record.oldInfo.sha256)}; new=${record.newInfo.kind}/${String(record.newInfo.bytes)}/${String(record.newInfo.sha256)}`,
      );

  fail(
    [
      `Layout contém ${String(layout.conflicts.length)} conflito(s) nos 93 paths da Etapa 10.`,
      ...lines,
      layout.conflicts.length >
        20
        ? `... e mais ${String(layout.conflicts.length - 20)} conflito(s).`
        : "",
    ]
      .filter(
        (line) =>
          line.length >
          0,
      )
      .join(
        "\n",
      ),
  );
}

function buildV20Journal(
  rootDir,
  stage5,
  stage10,
) {
  const now =
    new Date().toISOString();

  const operations =
    stage10.operations.map(
      (entry) => ({
        sequence:
          entry.sequence,
        sourceStage:
          10,
        moduleKey:
          entry.moduleKey,
        capabilityId:
          entry.capabilityId,
        isWorker:
          entry.isWorker ===
          true,
        oldPath:
          entry.oldPath,
        newPath:
          entry.newPath,
        bytes:
          entry.bytes,
        shaBefore:
          entry.shaBefore,
        shaAfter:
          entry.shaAfter,
        timestampUtc:
          entry.timestampUtc,
        transformation:
          entry.transformation,
        state:
          "applied",
        rollbackTimestampUtc:
          null,
      }),
    );

  return {
    schemaVersion: 1,
    journal:
      "v20-architecture-migration-journal",
    stage:
      STAGE_NAME,
    architectureMigrationVersion:
      EXPECTED_ARCHITECTURE_VERSION,
    status:
      "migrated",
    createdAtUtc:
      now,
    updatedAtUtc:
      now,
    projectRootAtCreation:
      rootDir,
    sourcePlan: {
      stage:
        STAGE5_NAME,
      runId:
        stage5.runId,
      reportPath:
        stage5.reportRelativePath,
      migrationPlanSha256:
        stage5.plan.migrationPlanSha256,
    },
    sourceJournals: [
      {
        stage:
          STAGE10_NAME,
        path:
          STAGE10_JOURNAL_PATH,
        statusAtConsolidation:
          stage10.status,
      },
    ],
    counts: {
      totalOperations:
        EXPECTED_MOVE_COUNT,
      applied:
        EXPECTED_MOVE_COUNT,
      rolledBack:
        0,
      conflicts:
        0,
      workers:
        EXPECTED_WORKER_COUNT,
      totalBytes:
        EXPECTED_TOTAL_BYTES,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            immutableJournalIdentity(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "Journal global da migração arquitetural v20.",
      "As 93 entradas desta versão correspondem à movimentação da Etapa 10.",
      "Cada entrada preserva oldPath, newPath, SHA antes/depois, timestamp e transformação.",
      "O rollback-migration.mjs usa este journal e não depende do histórico do Git.",
      "A Etapa 11 não executa rollback automaticamente.",
    ],
  };
}

function validateExistingV20Journal(
  journal,
  stage5,
) {
  if (
    journal.schemaVersion !==
      1 ||
    journal.journal !==
      "v20-architecture-migration-journal" ||
    journal.stage !==
      STAGE_NAME ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_MOVE_COUNT
  ) {
    fail(
      `Journal global existente é incompatível: ${V20_JOURNAL_PATH}`,
    );
  }

  if (
    journal.sourcePlan
      ?.runId !==
      stage5.runId ||
    journal.sourcePlan
      ?.migrationPlanSha256 !==
      stage5.plan.migrationPlanSha256
  ) {
    fail(
      "Journal global existente referencia outro plano da Etapa 5.",
    );
  }

  if (
    journal.counts
      ?.totalOperations !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.workers !==
      EXPECTED_WORKER_COUNT ||
    journal.counts
      ?.totalBytes !==
      EXPECTED_TOTAL_BYTES
  ) {
    fail(
      "Counts do journal global existente são incompatíveis.",
    );
  }

  const expected =
    stage5.plan.operations.map(
      (operation, index) => ({
        sequence:
          index +
          1,
        moduleKey:
          operation.moduleKey,
        capabilityId:
          operation.capabilityId,
        isWorker:
          operation.isWorker ===
          true,
        oldPath:
          operation.oldPath,
        newPath:
          operation.newPath,
        bytes:
          operation.bytes,
        shaBefore:
          operation.sha256,
        shaAfter:
          operation.sha256,
        transformation:
          "move-engine-implementation-to-module-internal",
      }),
    );

  const actual =
    journal.operations.map(
      (entry) => ({
        sequence:
          entry.sequence,
        moduleKey:
          entry.moduleKey,
        capabilityId:
          entry.capabilityId,
        isWorker:
          entry.isWorker ===
          true,
        oldPath:
          entry.oldPath,
        newPath:
          entry.newPath,
        bytes:
          entry.bytes,
        shaBefore:
          entry.shaBefore,
        shaAfter:
          entry.shaAfter,
        transformation:
          entry.transformation,
      }),
    );

  if (
    semanticSha256(
      expected,
    ) !==
    semanticSha256(
      actual,
    )
  ) {
    fail(
      "Identidade das operations do journal global diverge do plano aprovado.",
    );
  }

  const computedIdentity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          immutableJournalIdentity(
            operation,
          ),
      ),
    );

  if (
    computedIdentity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal global divergiu.",
    );
  }
}

function shouldExcludeScanPath(
  relativePath,
  isDirectory,
) {
  if (
    relativePath.length ===
    0
  ) {
    return false;
  }

  const topLevel =
    relativePath.split(
      "/",
    )[0];

  if (
    isDirectory &&
    SCAN_EXCLUDED_TOP_LEVEL.has(
      topLevel,
    )
  ) {
    return true;
  }

  const normalized =
    isDirectory
      ? `${relativePath}/`
      : relativePath;

  return SCAN_EXCLUDED_RELATIVE_PREFIXES.some(
    (prefix) =>
      normalized ===
        prefix ||
      normalized.startsWith(
        prefix,
      ),
  );
}

function protectedProjectSnapshot(
  rootDir,
) {
  const records =
    [];

  const stack =
    [
      rootDir,
    ];

  while (
    stack.length >
    0
  ) {
    const currentDir =
      stack.pop();

    if (
      currentDir ===
      undefined
    ) {
      continue;
    }

    const entries =
      fs.readdirSync(
        currentDir,
        {
          withFileTypes:
            true,
        },
      );

    entries.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          "en",
        ),
    );

    for (
      let index =
        entries.length -
        1;
      index >=
        0;
      index -=
        1
    ) {
      const entry =
        entries[
          index
        ];

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
        shouldExcludeScanPath(
          relativePath,
          entry.isDirectory(),
        )
      ) {
        continue;
      }

      if (
        entry.isSymbolicLink()
      ) {
        records.push(
          {
            path:
              relativePath,
            kind:
              "symlink",
            target:
              fs.readlinkSync(
                absolutePath,
              ),
          },
        );
        continue;
      }

      if (
        entry.isDirectory()
      ) {
        stack.push(
          absolutePath,
        );
        continue;
      }

      if (
        entry.isFile()
      ) {
        const stat =
          fs.statSync(
            absolutePath,
          );

        records.push(
          {
            path:
              relativePath,
            kind:
              "file",
            bytes:
              stat.size,
            sha256:
              sha256File(
                absolutePath,
              ),
          },
        );
      }
    }
  }

  records.sort(
    (a, b) =>
      a.path.localeCompare(
        b.path,
        "en",
      ),
  );

  return {
    count:
      records.length,
    digest:
      semanticSha256(
        records,
      ),
  };
}

function synchronizeExistingJournal(
  rootDir,
  journal,
  stage10,
  layout,
) {
  if (
    layout.conflicts.length >
    0
  ) {
    failForLayoutConflicts(
      layout,
    );
  }

  const allMigrated =
    layout.migrated.length ===
      EXPECTED_MOVE_COUNT;

  const allRolledBack =
    layout.rolledBack.length ===
      EXPECTED_MOVE_COUNT;

  if (
    !allMigrated &&
    !allRolledBack
  ) {
    fail(
      [
        "O journal global já existe, mas o filesystem está em estado parcial.",
        `Migrados: ${String(layout.migrated.length)}`,
        `Rolled-back: ${String(layout.rolledBack.length)}`,
        "Conclua ou reverta a operação pendente antes de executar novamente a Etapa 11.",
      ].join(
        "\n",
      ),
    );
  }

  const stage10ByOldPath =
    new Map(
      stage10.operations.map(
        (entry) => [
          entry.oldPath,
          entry,
        ],
      ),
    );

  let changed =
    false;

  for (
    const entry of
      journal.operations
  ) {
    const stage10Entry =
      stage10ByOldPath.get(
        entry.oldPath,
      );

    if (
      stage10Entry ===
      undefined
    ) {
      fail(
        `Journal da Etapa 10 perdeu operação: ${entry.oldPath}`,
      );
    }

    if (
      allMigrated
    ) {
      if (
        entry.state !==
          "applied" ||
        entry.rollbackTimestampUtc !==
          null ||
        entry.timestampUtc !==
          stage10Entry.timestampUtc
      ) {
        entry.state =
          "applied";
        entry.rollbackTimestampUtc =
          null;
        entry.timestampUtc =
          stage10Entry.timestampUtc;
        changed =
          true;
      }
    } else if (
      entry.state !==
        "rolled-back"
    ) {
      entry.state =
        "rolled-back";
      entry.rollbackTimestampUtc =
        stage10Entry.rollbackTimestampUtc ??
        journal.rolledBackAtUtc ??
        null;
      changed =
        true;
    }
  }

  const desiredStatus =
    allMigrated
      ? "migrated"
      : "rolled-back";

  const desiredApplied =
    allMigrated
      ? EXPECTED_MOVE_COUNT
      : 0;

  const desiredRolledBack =
    allRolledBack
      ? EXPECTED_MOVE_COUNT
      : 0;

  if (
    journal.status !==
      desiredStatus ||
    journal.counts.applied !==
      desiredApplied ||
    journal.counts.rolledBack !==
      desiredRolledBack ||
    journal.counts.conflicts !==
      0
  ) {
    journal.status =
      desiredStatus;
    journal.counts.applied =
      desiredApplied;
    journal.counts.rolledBack =
      desiredRolledBack;
    journal.counts.conflicts =
      0;
    changed =
      true;
  }

  const newIdentity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          immutableJournalIdentity(
            operation,
          ),
      ),
    );

  if (
    journal.operationsIdentitySha256 !==
      newIdentity
  ) {
    journal.operationsIdentitySha256 =
      newIdentity;
    changed =
      true;
  }

  if (
    changed
  ) {
    journal.updatedAtUtc =
      new Date().toISOString();

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      journal,
    );
  }

  return {
    changed,
    desiredStatus,
  };
}

function runStage11() {
  const options =
    parseArguments(
      process.argv.slice(
        2,
      ),
    );

  if (
    options.help
  ) {
    printHelp();
    return;
  }

  const rootDir =
    path.resolve(
      process.cwd(),
    );

  assertProjectRoot(
    rootDir,
  );

  assertArchitectureVersion();

  const stage5 =
    loadApprovedStage5(
      rootDir,
    );

  const stage10 =
    loadStage10Journal(
      rootDir,
    );

  const v20AbsolutePath =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  const v20Exists =
    fs.existsSync(
      v20AbsolutePath,
    );

  validateStage10JournalAgainstPlan(
    stage10,
    stage5,
    !v20Exists,
  );

  const layout =
    inspectLayout(
      rootDir,
      stage5.plan.operations,
    );

  failForLayoutConflicts(
    layout,
  );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
    );

  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 11: JOURNAL GLOBAL + ROLLBACK          ",
  );
  console.log(
    "============================================================",
  );
  console.log("");
  console.log(
    `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
  );
  console.log(
    `[OK] Plano Etapa 5: ${stage5.runId}`,
  );
  console.log(
    `[OK] Migration plan SHA-256: ${stage5.plan.migrationPlanSha256}`,
  );
  console.log(
    `[OK] Operações: ${String(EXPECTED_MOVE_COUNT)}`,
  );
  console.log(
    `[OK] Workers: ${String(EXPECTED_WORKER_COUNT)}`,
  );
  console.log(
    `[OK] Bytes cobertos: ${String(EXPECTED_TOTAL_BYTES)}`,
  );
  console.log(
    `[OK] Layout migrado: ${String(layout.migrated.length)}/${String(EXPECTED_MOVE_COUNT)}`,
  );
  console.log(
    `[OK] Layout rolled-back: ${String(layout.rolledBack.length)}/${String(EXPECTED_MOVE_COUNT)}`,
  );

  if (
    v20Exists
  ) {
    const existing =
      readJson(
        v20AbsolutePath,
        V20_JOURNAL_PATH,
      );

    validateExistingV20Journal(
      existing,
      stage5,
    );

    const syncResult =
      synchronizeExistingJournal(
        rootDir,
        existing,
        stage10,
        layout,
      );

    const protectedAfter =
      protectedProjectSnapshot(
        rootDir,
      );

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "A Etapa 11 alterou conteúdo fora de .migration.",
          `Digest protegido antes: ${protectedBefore.digest}`,
          `Digest protegido depois: ${protectedAfter.digest}`,
        ].join(
          "\n",
        ),
      );
    }

    console.log("");
    console.log(
      "=== JOURNAL GLOBAL EXISTENTE ===",
    );
    console.log(
      `[OK] ${V20_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Estado sincronizado: ${syncResult.desiredStatus}`,
    );
    console.log(
      syncResult.changed
        ? "[OK] Metadados do journal foram reconciliados com o filesystem e journal da Etapa 10."
        : "[OK] Journal já estava íntegro e idempotente; nenhum write foi necessário.",
    );
    console.log(
      `[OK] Digest protegido antes: ${protectedBefore.digest}`,
    );
    console.log(
      `[OK] Digest protegido depois: ${protectedAfter.digest}`,
    );
    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 11 JÁ ESTÁ CONCLUÍDA                              ",
    );
    console.log(
      "============================================================",
    );
    return;
  }

  if (
    layout.migrated.length !==
      EXPECTED_MOVE_COUNT ||
    layout.rolledBack.length !==
      0
  ) {
    fail(
      [
        "A primeira criação de .migration/v20-journal.json exige a Etapa 10 integralmente aplicada.",
        `Migrados: ${String(layout.migrated.length)}/${String(EXPECTED_MOVE_COUNT)}`,
        `Rolled-back: ${String(layout.rolledBack.length)}/${String(EXPECTED_MOVE_COUNT)}`,
      ].join(
        "\n",
      ),
    );
  }

  const journal =
    buildV20Journal(
      rootDir,
      stage5,
      stage10,
    );

  writeJsonAtomic(
    v20AbsolutePath,
    journal,
  );

  const written =
    readJson(
      v20AbsolutePath,
      V20_JOURNAL_PATH,
    );

  validateExistingV20Journal(
    written,
    stage5,
  );

  const protectedAfter =
    protectedProjectSnapshot(
      rootDir,
    );

  if (
    protectedBefore.digest !==
    protectedAfter.digest
  ) {
    fs.rmSync(
      v20AbsolutePath,
      {
        force: true,
      },
    );

    fail(
      [
        "A Etapa 11 alterou conteúdo fora de .migration; o journal recém-criado foi removido.",
        `Digest protegido antes: ${protectedBefore.digest}`,
        `Digest protegido depois: ${protectedAfter.digest}`,
      ].join(
        "\n",
      ),
    );
  }

  console.log("");
  console.log(
    "=== JOURNAL GLOBAL v20 ===",
  );
  console.log(
    `[OK] Criado: ${V20_JOURNAL_PATH}`,
  );
  console.log(
    `[OK] Entradas: ${String(written.operations.length)}/${String(EXPECTED_MOVE_COUNT)}`,
  );
  console.log(
    `[OK] Workers: ${String(written.counts.workers)}/${String(EXPECTED_WORKER_COUNT)}`,
  );
  console.log(
    `[OK] Bytes: ${String(written.counts.totalBytes)}`,
  );
  console.log(
    `[OK] Estado: ${written.status}`,
  );
  console.log(
    `[OK] operationsIdentitySha256: ${written.operationsIdentitySha256}`,
  );
  console.log(
    `[OK] Rollback disponível: ${ROLLBACK_SCRIPT_PATH}`,
  );
  console.log(
    "[OK] Dependência do Git para rollback: nenhuma.",
  );
  console.log(
    `[OK] Digest protegido antes: ${protectedBefore.digest}`,
  );
  console.log(
    `[OK] Digest protegido depois: ${protectedAfter.digest}`,
  );
  console.log("");
  console.log(
    "============================================================",
  );
  console.log(
    "  ETAPA 11 CONCLUÍDA COM SUCESSO                           ",
  );
  console.log(
    "============================================================",
  );
  console.log(
    "O journal global v20 registra as 93 operações da Etapa 10 e o rollback está disponível sem depender do Git.",
  );
}

const executedAsMain =
  process.argv[1] !==
    undefined &&
  normalizeAbsolute(
    fileURLToPath(
      import.meta.url,
    ),
  ) ===
    normalizeAbsolute(
      process.argv[1],
    );

if (
  executedAsMain
) {
  try {
    runStage11();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 11 não concluída.",
    );
    console.error(
      error instanceof
      Error
        ? (
            error.stack ??
            error.message
          )
        : String(
            error,
          ),
    );

    process.exitCode =
      1;
  }
}
