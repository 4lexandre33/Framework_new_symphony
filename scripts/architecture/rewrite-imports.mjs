#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-13-rewrite-imports";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_STAGE5_NAME =
  "stage-5-path-migration-plan";

const EXPECTED_STAGE10_MOVE_COUNT =
  93;

const EXPECTED_STAGE12_EXTRACTION_COUNT =
  21;

const EXPECTED_PRE_STAGE13_OPERATION_COUNT =
  EXPECTED_STAGE10_MOVE_COUNT +
  EXPECTED_STAGE12_EXTRACTION_COUNT;

const EXPECTED_REWRITE_FILE_COUNT =
  108;

const EXPECTED_REWRITE_SPECIFIER_COUNT =
  163;

const EXPECTED_WORKER_URL_REFERENCE_COUNT =
  2;

const EXPECTED_WORKER_COUNT =
  2;

const EXPECTED_STAGE10_BYTES =
  396456;

const EXPECTED_STAGE12_IMPLEMENTATION_BYTES =
  106892;

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const STAGE10_JOURNAL_PATH =
  ".migration/stage10/move-journal.json";

const STAGE12_JOURNAL_PATH =
  ".migration/stage12/extraction-journal.json";

const STAGE13_JOURNAL_PATH =
  ".migration/stage13/rewrite-journal.json";

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const ROLLBACK_SCRIPT_PATH =
  "scripts/architecture/rollback-migration.mjs";

const CODE_EXTENSIONS =
  new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ]);

const RESOLUTION_EXTENSIONS =
  Object.freeze([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
  ]);

const EXCLUDED_TOP_LEVEL_DIRECTORIES =
  new Set([
    ".git",
    ".migration",
    "node_modules",
    "dist",
    "coverage",
    "target",
  ]);

const EXCLUDED_RELATIVE_PREFIXES =
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
      "  node scripts/architecture/rewrite-imports.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 13: reescrita automática dos imports

Uso:
  node scripts/architecture/rewrite-imports.mjs

Escopo:
  - TypeScript Compiler API;
  - import ... from;
  - export ... from;
  - import();
  - new URL(..., import.meta.url);
  - paths relativos recalculados a partir do layout antigo/novo da Etapa 5;
  - validação pós-escrita de todos os references relativos suportados.

Esta etapa NÃO:
  - cria public/index.ts;
  - cria o alias @core;
  - corrige vazamentos de API;
  - altera manifests;
  - usa substituição regex cega sobre código-fonte.
`);
}

function runCommand(
  executable,
  args,
  cwd,
) {
  const result =
    spawnSync(
      executable,
      args,
      {
        cwd,
        encoding:
          "utf8",
        windowsHide:
          true,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  const status =
    result.status ??
    1;

  if (
    status !==
    0
  ) {
    const stderr =
      String(
        result.stderr ??
        "",
      ).trim();

    fail(
      stderr.length >
        0
        ? stderr
        : `${executable} ${args.join(" ")} falhou com código ${String(status)}.`,
    );
  }

  return String(
    result.stdout ??
      "",
  );
}

function assertRepositoryRoot(
  cwd,
) {
  const inside =
    runCommand(
      "git",
      [
        "rev-parse",
        "--is-inside-work-tree",
      ],
      cwd,
    ).trim();

  if (
    inside !==
    "true"
  ) {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRoot =
    runCommand(
      "git",
      [
        "rev-parse",
        "--show-toplevel",
      ],
      cwd,
    ).trim();

  if (
    normalizeAbsolute(
      cwd,
    ) !==
    normalizeAbsolute(
      gitRoot,
    )
  ) {
    fail(
      [
        "Execute a Etapa 13 exatamente na raiz do Projeto1.",
        `Atual: ${cwd}`,
        `Raiz Git: ${gitRoot}`,
      ].join(
        "\n",
      ),
    );
  }

  return path.resolve(
    gitRoot,
  );
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

function sha256Text(
  text,
) {
  return sha256Buffer(
    Buffer.from(
      text,
      "utf8",
    ),
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

function writeFileAtomic(
  filePath,
  buffer,
) {
  fs.mkdirSync(
    path.dirname(
      filePath,
    ),
    {
      recursive:
        true,
    },
  );

  const tempPath =
    `${filePath}.tmp-${String(process.pid)}`;

  fs.writeFileSync(
    tempPath,
    buffer,
    {
      flag:
        "w",
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
          force:
            true,
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
          force:
            true,
        },
      );
    }
  }
}

function writeJsonAtomic(
  filePath,
  value,
) {
  writeFileAtomic(
    filePath,
    Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    ),
  );
}

function loadTypeScript(
  rootDir,
) {
  const candidateRequires =
    [];

  const packageJsonPath =
    path.join(
      rootDir,
      "package.json",
    );

  if (
    fs.existsSync(
      packageJsonPath,
    )
  ) {
    candidateRequires.push(
      createRequire(
        packageJsonPath,
      ),
    );
  }

  candidateRequires.push(
    createRequire(
      import.meta.url,
    ),
  );

  for (
    const requireFn of
      candidateRequires
  ) {
    try {
      const ts =
        requireFn(
          "typescript",
        );

      const major =
        Number.parseInt(
          String(
            ts.versionMajorMinor ??
              ts.version ??
              "0",
          ).split(
            ".",
          )[0],
          10,
        );

      if (
        !Number.isFinite(
          major,
        ) ||
        major <
          5
      ) {
        fail(
          `TypeScript 5.x ou superior é necessário. Detectado: ${String(ts.version)}`,
        );
      }

      return ts;
    } catch (
      error
    ) {
      if (
        error instanceof
          Error &&
        error.message.startsWith(
          "TypeScript 5.x",
        )
      ) {
        throw error;
      }
    }
  }

  fail(
    [
      "Não foi possível carregar o pacote TypeScript.",
      "A Etapa 13 depende do TypeScript Compiler API.",
      "Execute npm install antes desta etapa.",
    ].join(
      "\n",
    ),
  );
}

function getScriptKind(
  ts,
  relativePath,
) {
  const extension =
    path.posix.extname(
      relativePath,
    ).toLowerCase();

  switch (
    extension
  ) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function parseSource(
  ts,
  relativePath,
  sourceText,
) {
  const sourceFile =
    ts.createSourceFile(
      relativePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      getScriptKind(
        ts,
        relativePath,
      ),
    );

  if (
    sourceFile.parseDiagnostics.length >
    0
  ) {
    const diagnostics =
      sourceFile.parseDiagnostics.map(
        (diagnostic) =>
          ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          ),
      );

    fail(
      [
        `Erro de parsing em ${relativePath}:`,
        ...diagnostics,
      ].join(
        "\n",
      ),
    );
  }

  return sourceFile;
}

function validateModuleMap() {
  if (
    ARCHITECTURE_MIGRATION_VERSION !==
    EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Arquitetura inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}.`,
    );
  }

  if (
    CANONICAL_MODULES.length !==
    EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      `Esperados ${String(EXPECTED_CANONICAL_MODULE_COUNT)} módulos canônicos; atual: ${String(CANONICAL_MODULES.length)}.`,
    );
  }
}

function buildStage5PlanDigest(
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

function loadApprovedStage5(
  rootDir,
) {
  const latestPath =
    fromPosixRelative(
      rootDir,
      ".migration/stage5/LATEST",
    );

  if (
    !fs.existsSync(
      latestPath,
    )
  ) {
    fail(
      "Pré-condição ausente: .migration/stage5/LATEST",
    );
  }

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

  const report =
    readJson(
      fromPosixRelative(
        rootDir,
        reportRelativePath,
      ),
      reportRelativePath,
    );

  if (
    report.stage !==
      EXPECTED_STAGE5_NAME ||
    report.status !==
      "passed" ||
    report.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      "A Etapa 5 LATEST não é um plano v20 aprovado.",
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
    ) ||
    plan.operations.length !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    plan.counts?.moveOperations !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    plan.counts?.workers !==
      EXPECTED_WORKER_COUNT ||
    plan.counts?.totalBytes !==
      EXPECTED_STAGE10_BYTES
  ) {
    fail(
      "Plano da Etapa 5 não corresponde às 93 operações congeladas.",
    );
  }

  const computedDigest =
    buildStage5PlanDigest(
      plan.operations,
    );

  if (
    computedDigest !==
    plan.migrationPlanSha256
  ) {
    fail(
      `Digest interno da Etapa 5 divergiu: ${computedDigest}`,
    );
  }

  const mapping =
    plan.mapping ??
    {};

  const reverseMapping =
    {};

  for (
    const operation of
      plan.operations
  ) {
    if (
      mapping[
        operation.oldPath
      ] !==
      operation.newPath
    ) {
      fail(
        `Mapping da Etapa 5 diverge para ${operation.oldPath}.`,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        reverseMapping,
        operation.newPath,
      )
    ) {
      fail(
        `newPath duplicado no plano da Etapa 5: ${operation.newPath}`,
      );
    }

    reverseMapping[
      operation.newPath
    ] =
      operation.oldPath;
  }

  return {
    runId,
    reportRelativePath,
    plan,
    mapping,
    reverseMapping,
  };
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

function validateStage10Layout(
  rootDir,
  stage5,
) {
  let workerCount =
    0;

  let totalBytes =
    0;

  for (
    const operation of
      stage5.plan.operations
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

    if (
      oldInfo.exists
    ) {
      fail(
        `Etapa 10 não está integralmente aplicada; oldPath ainda existe: ${operation.oldPath}`,
      );
    }

    if (
      newInfo.kind !==
        "file" ||
      newInfo.bytes !==
        operation.bytes ||
      newInfo.sha256 !==
        operation.sha256
    ) {
      fail(
        `Destino da Etapa 10 inválido: ${operation.newPath}`,
      );
    }

    if (
      operation.isWorker ===
      true
    ) {
      workerCount +=
        1;
    }

    totalBytes +=
      operation.bytes;
  }

  if (
    workerCount !==
      EXPECTED_WORKER_COUNT ||
    totalBytes !==
      EXPECTED_STAGE10_BYTES
  ) {
    fail(
      "Escopo físico da Etapa 10 divergiu.",
    );
  }
}

function stage11IdentityV1(
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

function stage12IdentityV2(
  operation,
) {
  if (
    operation.transformation ===
    "move-engine-implementation-to-module-internal"
  ) {
    return {
      ...stage11IdentityV1(
        operation,
      ),
      sourceStage:
        operation.sourceStage ??
        10,
    };
  }

  if (
    operation.transformation ===
    "extract-plugin-implementation"
  ) {
    return {
      sequence:
        operation.sequence,
      sourceStage: 12,
      moduleKey:
        operation.moduleKey,
      capabilityId:
        operation.capabilityId,
      isWorker: false,
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
      pluginPath:
        operation.pluginPath,
      implementationPath:
        operation.implementationPath,
      className:
        operation.className,
      exportedNames:
        operation.exportedNames,
      pluginShaBefore:
        operation.pluginShaBefore,
      pluginShaAfter:
        operation.pluginShaAfter,
      implementationShaAfter:
        operation.implementationShaAfter,
      backupBeforePath:
        operation.backupBeforePath,
      backupBeforeSha256:
        operation.backupBeforeSha256,
      backupAfterPath:
        operation.backupAfterPath,
      backupAfterSha256:
        operation.backupAfterSha256,
      implementationBackupPath:
        operation.implementationBackupPath,
      implementationBackupSha256:
        operation.implementationBackupSha256,
    };
  }

  fail(
    `Transformação inesperada no schema v2: ${String(operation.transformation)}`,
  );
}

function stage13IdentityV3(
  operation,
) {
  if (
    operation.transformation !==
    "rewrite-relative-module-specifiers"
  ) {
    return stage12IdentityV2(
      operation,
    );
  }

  return {
    sequence:
      operation.sequence,
    sourceStage: 13,
    moduleKey:
      operation.moduleKey,
    capabilityId:
      operation.capabilityId,
    isWorker: false,
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
    filePath:
      operation.filePath,
    fileBytesBefore:
      operation.fileBytesBefore,
    fileBytesAfter:
      operation.fileBytesAfter,
    fileShaBefore:
      operation.fileShaBefore,
    fileShaAfter:
      operation.fileShaAfter,
    backupBeforePath:
      operation.backupBeforePath,
    backupBeforeSha256:
      operation.backupBeforeSha256,
    backupAfterPath:
      operation.backupAfterPath,
    backupAfterSha256:
      operation.backupAfterSha256,
    edits:
      operation.edits,
  };
}

function loadAndValidateStage12(
  rootDir,
) {
  const journal =
    readJson(
      fromPosixRelative(
        rootDir,
        STAGE12_JOURNAL_PATH,
      ),
      STAGE12_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      "stage-12-extract-plugin-implementations" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_STAGE12_EXTRACTION_COUNT ||
    journal.counts?.applied !==
      EXPECTED_STAGE12_EXTRACTION_COUNT
  ) {
    fail(
      "Journal da Etapa 12 não está completed com 21/21 extrações.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          stage12IdentityV2(
            operation,
          ),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 da Etapa 12 divergiu.",
    );
  }

  let implementationBytes =
    0;

  for (
    const operation of
      journal.operations
  ) {
    const pluginInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.pluginPath,
        ),
      );

    const implementationInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.implementationPath,
        ),
      );

    if (
      pluginInfo.kind !==
        "file" ||
      pluginInfo.sha256 !==
        operation.pluginShaAfter ||
      implementationInfo.kind !==
        "file" ||
      implementationInfo.sha256 !==
        operation.implementationShaAfter
    ) {
      fail(
        `Filesystem divergiu da Etapa 12: ${operation.moduleKey}`,
      );
    }

    const backupChecks =
      [
        [
          operation.backupBeforePath,
          operation.backupBeforeSha256,
        ],
        [
          operation.backupAfterPath,
          operation.backupAfterSha256,
        ],
        [
          operation.implementationBackupPath,
          operation.implementationBackupSha256,
        ],
      ];

    for (
      const [
        relativePath,
        expectedSha,
      ] of
        backupChecks
    ) {
      const info =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            relativePath,
          ),
        );

      if (
        info.kind !==
          "file" ||
        info.sha256 !==
          expectedSha
      ) {
        fail(
          `Backup da Etapa 12 inválido: ${relativePath}`,
        );
      }
    }

    implementationBytes +=
      operation.implementationBytes;
  }

  if (
    implementationBytes !==
    EXPECTED_STAGE12_IMPLEMENTATION_BYTES
  ) {
    fail(
      `Bytes de implementações da Etapa 12 divergiram: ${String(implementationBytes)}.`,
    );
  }

  return journal;
}

function loadGlobalJournalV2(
  rootDir,
  stage5,
) {
  const journal =
    readJson(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      V20_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      2 ||
    journal.journal !==
      "v20-architecture-migration-journal" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "migrated" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_PRE_STAGE13_OPERATION_COUNT ||
    journal.counts?.stage10MoveOperations !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    journal.counts?.stage12Extractions !==
      EXPECTED_STAGE12_EXTRACTION_COUNT ||
    journal.counts?.applied !==
      EXPECTED_PRE_STAGE13_OPERATION_COUNT ||
    journal.counts?.rolledBack !==
      0 ||
    journal.sourcePlan?.runId !==
      stage5.runId ||
    journal.sourcePlan?.migrationPlanSha256 !==
      stage5.plan.migrationPlanSha256
  ) {
    fail(
      "Journal global v20 não está no estado schema v2 / 114 operações migradas esperado antes da Etapa 13.",
    );
  }

  const moveCount =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        "move-engine-implementation-to-module-internal",
    ).length;

  const extractionCount =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        "extract-plugin-implementation",
    ).length;

  if (
    moveCount !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    extractionCount !==
      EXPECTED_STAGE12_EXTRACTION_COUNT
  ) {
    fail(
      "Journal global v20 divergiu nas operações de Etapa 10/12.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          stage12IdentityV2(
            operation,
          ),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global v2 divergiu.",
    );
  }

  return journal;
}

function shouldExcludeDirectory(
  relativePath,
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
    EXCLUDED_TOP_LEVEL_DIRECTORIES.has(
      topLevel,
    )
  ) {
    return true;
  }

  const normalized =
    `${relativePath}/`;

  return EXCLUDED_RELATIVE_PREFIXES.some(
    (prefix) =>
      normalized ===
        prefix ||
      normalized.startsWith(
        prefix,
      ),
  );
}

function listCodeFiles(
  rootDir,
) {
  const files =
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
        entry.isSymbolicLink()
      ) {
        if (
          CODE_EXTENSIONS.has(
            path.posix.extname(
              relativePath,
            ).toLowerCase(),
          )
        ) {
          fail(
            `Arquivo de código não pode ser symlink durante a Etapa 13: ${relativePath}`,
          );
        }

        continue;
      }

      if (
        entry.isDirectory()
      ) {
        if (
          !shouldExcludeDirectory(
            relativePath,
          )
        ) {
          stack.push(
            absolutePath,
          );
        }

        continue;
      }

      if (
        !entry.isFile()
      ) {
        continue;
      }

      const extension =
        path.posix.extname(
          relativePath,
        ).toLowerCase();

      if (
        CODE_EXTENSIONS.has(
          extension,
        )
      ) {
        files.push(
          relativePath,
        );
      }
    }
  }

  files.sort(
    (a, b) =>
      a.localeCompare(
        b,
        "en",
      ),
  );

  return files;
}

function isImportMetaUrl(
  ts,
  node,
) {
  if (
    !ts.isPropertyAccessExpression(
      node,
    ) ||
    node.name.text !==
      "url" ||
    !ts.isMetaProperty(
      node.expression,
    )
  ) {
    return false;
  }

  return (
    node.expression.keywordToken ===
      ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text ===
      "meta"
  );
}

function collectReferences(
  ts,
  sourceFile,
) {
  const references =
    [];

  const addReference =
    (
      literal,
      kind,
    ) => {
      if (
        !ts.isStringLiteralLike(
          literal,
        )
      ) {
        return;
      }

      references.push(
        {
          kind,
          literal,
          specifier:
            literal.text,
        },
      );
    };

  const visit =
    (
      node,
    ) => {
      if (
        ts.isImportDeclaration(
          node,
        ) &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addReference(
          node.moduleSpecifier,
          "import",
        );
      } else if (
        ts.isExportDeclaration(
          node,
        ) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        addReference(
          node.moduleSpecifier,
          "export-from",
        );
      } else if (
        ts.isCallExpression(
          node,
        ) &&
        node.expression.kind ===
          ts.SyntaxKind.ImportKeyword &&
        node.arguments.length >=
          1 &&
        ts.isStringLiteralLike(
          node.arguments[0],
        )
      ) {
        addReference(
          node.arguments[0],
          "import()",
        );
      } else if (
        ts.isNewExpression(
          node,
        ) &&
        ts.isIdentifier(
          node.expression,
        ) &&
        node.expression.text ===
          "URL" &&
        node.arguments &&
        node.arguments.length >=
          2 &&
        ts.isStringLiteralLike(
          node.arguments[0],
        ) &&
        isImportMetaUrl(
          ts,
          node.arguments[1],
        )
      ) {
        addReference(
          node.arguments[0],
          "new-url-import-meta",
        );
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

  visit(
    sourceFile,
  );

  return references;
}

function splitSpecifierSuffix(
  specifier,
) {
  const queryIndex =
    specifier.indexOf(
      "?",
    );

  const hashIndex =
    specifier.indexOf(
      "#",
    );

  let splitIndex =
    -1;

  if (
    queryIndex >=
      0 &&
    hashIndex >=
      0
  ) {
    splitIndex =
      Math.min(
        queryIndex,
        hashIndex,
      );
  } else if (
    queryIndex >=
    0
  ) {
    splitIndex =
      queryIndex;
  } else if (
    hashIndex >=
    0
  ) {
    splitIndex =
      hashIndex;
  }

  if (
    splitIndex <
    0
  ) {
    return {
      base:
        specifier,
      suffix:
        "",
    };
  }

  return {
    base:
      specifier.slice(
        0,
        splitIndex,
      ),
    suffix:
      specifier.slice(
        splitIndex,
      ),
  };
}

function explicitResolutionCandidates(
  basePath,
) {
  const extension =
    path.posix.extname(
      basePath,
    ).toLowerCase();

  const candidates =
    [
      {
        path:
          basePath,
        kind:
          "explicit",
        emittedExtension:
          extension,
      },
    ];

  const replacementExtensions =
    extension ===
      ".js"
      ? [
          ".ts",
          ".tsx",
        ]
      : extension ===
        ".mjs"
        ? [
            ".mts",
          ]
        : extension ===
          ".cjs"
          ? [
              ".cts",
            ]
          : [];

  if (
    replacementExtensions.length >
    0
  ) {
    const withoutExtension =
      basePath.slice(
        0,
        -extension.length,
      );

    for (
      const replacementExtension of
        replacementExtensions
    ) {
      candidates.push(
        {
          path:
            `${withoutExtension}${replacementExtension}`,
          kind:
            "explicit-runtime-extension",
          emittedExtension:
            extension,
        },
      );
    }
  }

  return candidates;
}

function extensionlessResolutionCandidates(
  basePath,
) {
  const candidates =
    [];

  for (
    const extension of
      RESOLUTION_EXTENSIONS
  ) {
    candidates.push(
      {
        path:
          `${basePath}${extension}`,
        kind:
          "file",
        emittedExtension:
          "",
      },
    );
  }

  for (
    const extension of
      RESOLUTION_EXTENSIONS
  ) {
    candidates.push(
      {
        path:
          `${basePath}/index${extension}`,
        kind:
          "index",
        emittedExtension:
          "",
      },
    );
  }

  return candidates;
}

function resolutionCandidates(
  basePath,
) {
  const extension =
    path.posix.extname(
      path.posix.basename(
        basePath,
      ),
    );

  return extension.length >
    0
    ? explicitResolutionCandidates(
        basePath,
      )
    : extensionlessResolutionCandidates(
        basePath,
      );
}

function fileExistsAsRegular(
  rootDir,
  relativePath,
) {
  let absolutePath;

  try {
    absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );
  } catch {
    return false;
  }

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    return false;
  }

  const stat =
    fs.lstatSync(
      absolutePath,
    );

  return (
    !stat.isSymbolicLink() &&
    stat.isFile()
  );
}

function resolveRelativeReference(
  rootDir,
  sourceRelativePath,
  specifier,
  options,
) {
  if (
    !specifier.startsWith(
      ".",
    )
  ) {
    return {
      relative: false,
    };
  }

  const {
    base,
    suffix,
  } =
    splitSpecifierSuffix(
      specifier,
    );

  const logicalSourcePath =
    options.legacyLayout
      ? options.reverseMapping[
          sourceRelativePath
        ] ??
        sourceRelativePath
      : sourceRelativePath;

  const logicalDirectory =
    path.posix.dirname(
      logicalSourcePath,
    );

  const unresolvedBase =
    path.posix.normalize(
      path.posix.join(
        logicalDirectory,
        base,
      ),
    );

  for (
    const candidate of
      resolutionCandidates(
        unresolvedBase,
      )
  ) {
    if (
      options.legacyLayout
    ) {
      const mappedTarget =
        options.mapping[
          candidate.path
        ];

      if (
        typeof mappedTarget ===
          "string" &&
        fileExistsAsRegular(
          rootDir,
          mappedTarget,
        )
      ) {
        return {
          relative: true,
          resolved: true,
          logicalSourcePath,
          oldTarget:
            candidate.path,
          currentTarget:
            mappedTarget,
          resolutionKind:
            candidate.kind,
          emittedExtension:
            candidate.emittedExtension,
          suffix,
        };
      }
    }

    if (
      fileExistsAsRegular(
        rootDir,
        candidate.path,
      )
    ) {
      return {
        relative: true,
        resolved: true,
        logicalSourcePath,
        oldTarget:
          candidate.path,
        currentTarget:
          candidate.path,
        resolutionKind:
          candidate.kind,
        emittedExtension:
          candidate.emittedExtension,
        suffix,
      };
    }
  }

  return {
    relative: true,
    resolved: false,
    logicalSourcePath,
    unresolvedBase,
    suffix,
  };
}

function renderTargetForSpecifier(
  resolution,
) {
  const target =
    resolution.currentTarget;

  if (
    resolution.resolutionKind ===
    "file"
  ) {
    const extension =
      path.posix.extname(
        target,
      );

    return target.slice(
      0,
      -extension.length,
    );
  }

  if (
    resolution.resolutionKind ===
    "index"
  ) {
    const extension =
      path.posix.extname(
        target,
      );

    return target.slice(
      0,
      -(
        `/index${extension}`
      ).length,
    );
  }

  if (
    resolution.resolutionKind ===
    "explicit-runtime-extension"
  ) {
    const actualExtension =
      path.posix.extname(
        target,
      );

    return `${target.slice(0, -actualExtension.length)}${resolution.emittedExtension}`;
  }

  return target;
}

function recalculateSpecifier(
  sourceRelativePath,
  resolution,
) {
  const renderedTarget =
    renderTargetForSpecifier(
      resolution,
    );

  let relative =
    path.posix.relative(
      path.posix.dirname(
        sourceRelativePath,
      ),
      renderedTarget,
    );

  if (
    !relative.startsWith(
      ".",
    )
  ) {
    relative =
      `./${relative}`;
  }

  return `${relative}${resolution.suffix}`;
}

function literalReplacementRange(
  sourceFile,
  literal,
) {
  const start =
    literal.getStart(
      sourceFile,
    );

  const end =
    literal.end;

  const raw =
    sourceFile.text.slice(
      start,
      end,
    );

  if (
    raw.length <
      2 ||
    ![
      "\"",
      "'",
      "`",
    ].includes(
      raw[0],
    ) ||
    raw[
      raw.length -
      1
    ] !==
      raw[0]
  ) {
    fail(
      `Literal de módulo inesperado em ${sourceFile.fileName}: ${raw}`,
    );
  }

  return {
    start:
      start +
      1,
    end:
      end -
      1,
  };
}

function applyTextEdits(
  sourceText,
  edits,
) {
  const sorted =
    [...edits].sort(
      (a, b) =>
        b.start -
        a.start,
    );

  let lastStart =
    sourceText.length +
    1;

  let output =
    sourceText;

  for (
    const edit of
      sorted
  ) {
    if (
      edit.end >
        lastStart ||
      edit.start <
        0 ||
      edit.end <
        edit.start ||
      edit.end >
        sourceText.length
    ) {
      fail(
        "Foram detectados edits sobrepostos ou fora dos limites.",
      );
    }

    output =
      `${output.slice(0, edit.start)}${edit.newSpecifier}${output.slice(edit.end)}`;

    lastStart =
      edit.start;
  }

  return output;
}

function planRewrites(
  ts,
  rootDir,
  stage5,
) {
  const codeFiles =
    listCodeFiles(
      rootDir,
    );

  const filePlans =
    [];

  const unresolved =
    [];

  const counts =
    {
      codeFilesScanned:
        codeFiles.length,
      referencesSeen: 0,
      relativeReferencesSeen: 0,
      importReferencesSeen: 0,
      exportFromReferencesSeen: 0,
      dynamicImportReferencesSeen: 0,
      workerUrlReferencesSeen: 0,
      importRewrites: 0,
      exportFromRewrites: 0,
      dynamicImportRewrites: 0,
      workerUrlRewrites: 0,
      specifierRewrites: 0,
      filesRewritten: 0,
    };

  for (
    const relativePath of
      codeFiles
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    const beforeBuffer =
      fs.readFileSync(
        absolutePath,
      );

    const beforeText =
      beforeBuffer.toString(
        "utf8",
      );

    const sourceFile =
      parseSource(
        ts,
        relativePath,
        beforeText,
      );

    const references =
      collectReferences(
        ts,
        sourceFile,
      );

    const edits =
      [];

    for (
      const reference of
        references
    ) {
      counts.referencesSeen +=
        1;

      if (
        reference.kind ===
        "import"
      ) {
        counts.importReferencesSeen +=
          1;
      } else if (
        reference.kind ===
        "export-from"
      ) {
        counts.exportFromReferencesSeen +=
          1;
      } else if (
        reference.kind ===
        "import()"
      ) {
        counts.dynamicImportReferencesSeen +=
          1;
      } else if (
        reference.kind ===
        "new-url-import-meta"
      ) {
        counts.workerUrlReferencesSeen +=
          1;
      }

      if (
        !reference.specifier.startsWith(
          ".",
        )
      ) {
        continue;
      }

      counts.relativeReferencesSeen +=
        1;

      const resolution =
        resolveRelativeReference(
          rootDir,
          relativePath,
          reference.specifier,
          {
            legacyLayout:
              true,
            mapping:
              stage5.mapping,
            reverseMapping:
              stage5.reverseMapping,
          },
        );

      if (
        !resolution.resolved
      ) {
        unresolved.push(
          {
            filePath:
              relativePath,
            kind:
              reference.kind,
            specifier:
              reference.specifier,
            logicalSourcePath:
              resolution.logicalSourcePath,
            unresolvedBase:
              resolution.unresolvedBase,
          },
        );

        continue;
      }

      const newSpecifier =
        recalculateSpecifier(
          relativePath,
          resolution,
        );

      if (
        newSpecifier ===
        reference.specifier
      ) {
        continue;
      }

      const range =
        literalReplacementRange(
          sourceFile,
          reference.literal,
        );

      edits.push(
        {
          kind:
            reference.kind,
          start:
            range.start,
          end:
            range.end,
          oldSpecifier:
            reference.specifier,
          newSpecifier,
          logicalSourcePath:
            resolution.logicalSourcePath,
          oldTarget:
            resolution.oldTarget,
          newTarget:
            resolution.currentTarget,
          resolutionKind:
            resolution.resolutionKind,
        },
      );

      counts.specifierRewrites +=
        1;

      if (
        reference.kind ===
        "import"
      ) {
        counts.importRewrites +=
          1;
      } else if (
        reference.kind ===
        "export-from"
      ) {
        counts.exportFromRewrites +=
          1;
      } else if (
        reference.kind ===
        "import()"
      ) {
        counts.dynamicImportRewrites +=
          1;
      } else if (
        reference.kind ===
        "new-url-import-meta"
      ) {
        counts.workerUrlRewrites +=
          1;
      }
    }

    if (
      edits.length ===
      0
    ) {
      continue;
    }

    edits.sort(
      (a, b) =>
        a.start -
        b.start,
    );

    const afterText =
      applyTextEdits(
        beforeText,
        edits,
      );

    const afterBuffer =
      Buffer.from(
        afterText,
        "utf8",
      );

    parseSource(
      ts,
      relativePath,
      afterText,
    );

    filePlans.push(
      {
        filePath:
          relativePath,
        beforeBuffer,
        afterBuffer,
        bytesBefore:
          beforeBuffer.length,
        bytesAfter:
          afterBuffer.length,
        shaBefore:
          sha256Buffer(
            beforeBuffer,
          ),
        shaAfter:
          sha256Buffer(
            afterBuffer,
          ),
        edits,
      },
    );
  }

  counts.filesRewritten =
    filePlans.length;

  return {
    codeFiles,
    filePlans,
    unresolved,
    counts,
  };
}

function validateExpectedScope(
  plan,
) {
  if (
    plan.unresolved.length >
    0
  ) {
    const details =
      plan.unresolved
        .slice(
          0,
          20,
        )
        .map(
          (
            record,
            index,
          ) =>
            `${String(index + 1)}. ${record.filePath} | ${record.kind} | ${record.specifier} | base=${record.unresolvedBase}`,
        );

    fail(
      [
        `Preflight encontrou ${String(plan.unresolved.length)} reference(s) relativo(s) sem destino.`,
        ...details,
      ].join(
        "\n",
      ),
    );
  }

  if (
    plan.counts.filesRewritten !==
      EXPECTED_REWRITE_FILE_COUNT ||
    plan.counts.specifierRewrites !==
      EXPECTED_REWRITE_SPECIFIER_COUNT
  ) {
    fail(
      [
        "Escopo vivo da Etapa 13 divergiu do snapshot aprovado pós-Etapa 12.",
        `Arquivos a reescrever: ${String(plan.counts.filesRewritten)} (esperado ${String(EXPECTED_REWRITE_FILE_COUNT)})`,
        `Specifiers a reescrever: ${String(plan.counts.specifierRewrites)} (esperado ${String(EXPECTED_REWRITE_SPECIFIER_COUNT)})`,
        "Nenhum arquivo foi alterado.",
      ].join(
        "\n",
      ),
    );
  }

  if (
    plan.counts.workerUrlReferencesSeen !==
    EXPECTED_WORKER_URL_REFERENCE_COUNT
  ) {
    fail(
      `Foram encontrados ${String(plan.counts.workerUrlReferencesSeen)} new URL(..., import.meta.url); esperado ${String(EXPECTED_WORKER_URL_REFERENCE_COUNT)}.`,
    );
  }
}

function validateCurrentRelativeReferences(
  ts,
  rootDir,
) {
  const codeFiles =
    listCodeFiles(
      rootDir,
    );

  const unresolved =
    [];

  const counts =
    {
      codeFilesScanned:
        codeFiles.length,
      referencesSeen: 0,
      relativeReferencesSeen: 0,
      workerUrlReferencesSeen: 0,
    };

  for (
    const relativePath of
      codeFiles
  ) {
    const sourceText =
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          relativePath,
        ),
        "utf8",
      );

    const sourceFile =
      parseSource(
        ts,
        relativePath,
        sourceText,
      );

    for (
      const reference of
        collectReferences(
          ts,
          sourceFile,
        )
    ) {
      counts.referencesSeen +=
        1;

      if (
        reference.kind ===
        "new-url-import-meta"
      ) {
        counts.workerUrlReferencesSeen +=
          1;
      }

      if (
        !reference.specifier.startsWith(
          ".",
        )
      ) {
        continue;
      }

      counts.relativeReferencesSeen +=
        1;

      const resolution =
        resolveRelativeReference(
          rootDir,
          relativePath,
          reference.specifier,
          {
            legacyLayout:
              false,
            mapping: {},
            reverseMapping: {},
          },
        );

      if (
        !resolution.resolved
      ) {
        unresolved.push(
          {
            filePath:
              relativePath,
            kind:
              reference.kind,
            specifier:
              reference.specifier,
            unresolvedBase:
              resolution.unresolvedBase,
          },
        );
      }
    }
  }

  return {
    codeFiles,
    unresolved,
    counts,
  };
}

function inferModuleMetadata(
  filePath,
) {
  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    const enginePrefix =
      `${moduleRecord.engine.root}/`;

    const pluginPrefix =
      `src/plugins/${moduleRecord.key}/`;

    if (
      filePath.startsWith(
        enginePrefix,
      ) ||
      filePath.startsWith(
        pluginPrefix,
      )
    ) {
      return {
        moduleKey:
          moduleRecord.key,
        capabilityId:
          moduleRecord.capabilityId,
      };
    }
  }

  return {
    moduleKey: null,
    capabilityId: null,
  };
}

function backupPathsFor(
  filePath,
) {
  return {
    before:
      `.migration/stage13/backups/before/${filePath}`,
    after:
      `.migration/stage13/backups/after/${filePath}`,
  };
}

function buildStage13Operation(
  filePlan,
  sequence,
  timestampUtc,
) {
  const metadata =
    inferModuleMetadata(
      filePlan.filePath,
    );

  const backups =
    backupPathsFor(
      filePlan.filePath,
    );

  return {
    sequence,
    sourceStage: 13,
    moduleKey:
      metadata.moduleKey,
    capabilityId:
      metadata.capabilityId,
    isWorker: false,
    oldPath:
      filePlan.filePath,
    newPath:
      filePlan.filePath,
    bytes:
      filePlan.bytesAfter,
    shaBefore:
      filePlan.shaBefore,
    shaAfter:
      filePlan.shaAfter,
    timestampUtc,
    transformation:
      "rewrite-relative-module-specifiers",
    state:
      "applied",
    rollbackTimestampUtc:
      null,
    filePath:
      filePlan.filePath,
    fileBytesBefore:
      filePlan.bytesBefore,
    fileBytesAfter:
      filePlan.bytesAfter,
    fileShaBefore:
      filePlan.shaBefore,
    fileShaAfter:
      filePlan.shaAfter,
    backupBeforePath:
      backups.before,
    backupBeforeSha256:
      filePlan.shaBefore,
    backupAfterPath:
      backups.after,
    backupAfterSha256:
      filePlan.shaAfter,
    edits:
      filePlan.edits.map(
        (edit) => ({
          kind:
            edit.kind,
          oldSpecifier:
            edit.oldSpecifier,
          newSpecifier:
            edit.newSpecifier,
          logicalSourcePath:
            edit.logicalSourcePath,
          oldTarget:
            edit.oldTarget,
          newTarget:
            edit.newTarget,
          resolutionKind:
            edit.resolutionKind,
        }),
      ),
  };
}

function buildStage13Journal(
  stage5,
  rewritePlan,
  operations,
  validationAfter,
) {
  const now =
    new Date().toISOString();

  return {
    schemaVersion: 1,
    stage:
      STAGE_NAME,
    architectureMigrationVersion:
      EXPECTED_ARCHITECTURE_VERSION,
    status:
      "completed",
    createdAtUtc:
      now,
    updatedAtUtc:
      now,
    completedAtUtc:
      now,
    sourcePlan: {
      stage:
        EXPECTED_STAGE5_NAME,
      runId:
        stage5.runId,
      reportPath:
        stage5.reportRelativePath,
      migrationPlanSha256:
        stage5.plan.migrationPlanSha256,
    },
    counts: {
      codeFilesScanned:
        rewritePlan.counts.codeFilesScanned,
      totalRewriteFiles:
        operations.length,
      applied:
        operations.length,
      rolledBack: 0,
      conflicts: 0,
      specifierRewrites:
        rewritePlan.counts.specifierRewrites,
      importRewrites:
        rewritePlan.counts.importRewrites,
      exportFromRewrites:
        rewritePlan.counts.exportFromRewrites,
      dynamicImportRewrites:
        rewritePlan.counts.dynamicImportRewrites,
      workerUrlRewrites:
        rewritePlan.counts.workerUrlRewrites,
      workerUrlReferencesValidated:
        validationAfter.counts.workerUrlReferencesSeen,
      unresolvedRelativeReferencesAfter:
        validationAfter.unresolved.length,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            stage13IdentityV3(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "Reescrita executada por TypeScript Compiler API; nenhuma substituição regex cega de código-fonte foi usada.",
      "Os specifiers foram recalculados a partir do source path lógico pré-Etapa 10 e do target path físico pós-Etapa 10.",
      "import, export from, import() e new URL(..., import.meta.url) são analisados pela AST.",
      "Todos os references relativos suportados foram revalidados contra arquivos existentes após a escrita.",
    ],
  };
}

function upgradeGlobalJournalToV3(
  globalV2,
  stage13Journal,
) {
  const operations =
    [
      ...globalV2.operations,
      ...stage13Journal.operations,
    ];

  const sourceJournals =
    Array.isArray(
      globalV2.sourceJournals,
    )
      ? [
          ...globalV2.sourceJournals,
        ]
      : [];

  if (
    !sourceJournals.some(
      (record) =>
        record.path ===
        STAGE13_JOURNAL_PATH,
    )
  ) {
    sourceJournals.push(
      {
        stage:
          STAGE_NAME,
        path:
          STAGE13_JOURNAL_PATH,
        statusAtConsolidation:
          "completed",
      },
    );
  }

  const now =
    new Date().toISOString();

  return {
    ...globalV2,
    schemaVersion: 3,
    journalRevision: 3,
    status:
      "migrated",
    updatedAtUtc:
      now,
    sourceJournals,
    counts: {
      ...globalV2.counts,
      totalOperations:
        operations.length,
      applied:
        operations.length,
      rolledBack: 0,
      conflicts: 0,
      stage13RewriteFiles:
        stage13Journal.counts.totalRewriteFiles,
      stage13SpecifierRewrites:
        stage13Journal.counts.specifierRewrites,
      stage13WorkerUrlsValidated:
        stage13Journal.counts.workerUrlReferencesValidated,
    },
    operationsIdentityAlgorithm:
      "semantic-sha256-v3",
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            stage13IdentityV3(
              operation,
            ),
        ),
      ),
    operations,
  };
}

function validateStage13JournalAndGlobal(
  rootDir,
  stage13Journal,
  globalJournal,
) {
  if (
    stage13Journal.schemaVersion !==
      1 ||
    stage13Journal.stage !==
      STAGE_NAME ||
    stage13Journal.status !==
      "completed" ||
    !Array.isArray(
      stage13Journal.operations,
    ) ||
    stage13Journal.operations.length !==
      EXPECTED_REWRITE_FILE_COUNT ||
    stage13Journal.counts?.specifierRewrites !==
      EXPECTED_REWRITE_SPECIFIER_COUNT ||
    stage13Journal.counts?.workerUrlReferencesValidated !==
      EXPECTED_WORKER_URL_REFERENCE_COUNT
  ) {
    fail(
      "Journal existente da Etapa 13 é incompatível.",
    );
  }

  const localIdentity =
    semanticSha256(
      stage13Journal.operations.map(
        (operation) =>
          stage13IdentityV3(
            operation,
          ),
      ),
    );

  if (
    localIdentity !==
    stage13Journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 da Etapa 13 divergiu.",
    );
  }

  for (
    const operation of
      stage13Journal.operations
  ) {
    const fileInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.filePath,
        ),
      );

    if (
      fileInfo.kind !==
        "file" ||
      fileInfo.sha256 !==
        operation.fileShaAfter ||
      fileInfo.bytes !==
        operation.fileBytesAfter
    ) {
      fail(
        `Arquivo reescrito divergiu do journal da Etapa 13: ${operation.filePath}`,
      );
    }

    for (
      const [
        backupPath,
        expectedSha,
      ] of
        [
          [
            operation.backupBeforePath,
            operation.backupBeforeSha256,
          ],
          [
            operation.backupAfterPath,
            operation.backupAfterSha256,
          ],
        ]
    ) {
      const backupInfo =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            backupPath,
          ),
        );

      if (
        backupInfo.kind !==
          "file" ||
        backupInfo.sha256 !==
          expectedSha
      ) {
        fail(
          `Backup da Etapa 13 inválido: ${backupPath}`,
        );
      }
    }
  }

  if (
    globalJournal.schemaVersion !==
      3 ||
    globalJournal.status !==
      "migrated" ||
    !Array.isArray(
      globalJournal.operations,
    ) ||
    globalJournal.operations.length !==
      EXPECTED_PRE_STAGE13_OPERATION_COUNT +
      EXPECTED_REWRITE_FILE_COUNT ||
    globalJournal.counts?.stage13RewriteFiles !==
      EXPECTED_REWRITE_FILE_COUNT ||
    globalJournal.counts?.stage13SpecifierRewrites !==
      EXPECTED_REWRITE_SPECIFIER_COUNT
  ) {
    fail(
      "Journal global v20 não está consolidado com a Etapa 13.",
    );
  }

  const globalIdentity =
    semanticSha256(
      globalJournal.operations.map(
        (operation) =>
          stage13IdentityV3(
            operation,
          ),
      ),
    );

  if (
    globalIdentity !==
    globalJournal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global v3 divergiu.",
    );
  }
}

function protectedProjectSnapshot(
  rootDir,
  mutablePaths,
) {
  const mutable =
    new Set(
      mutablePaths,
    );

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
        entry.isDirectory() &&
        shouldExcludeDirectory(
          relativePath,
        )
      ) {
        continue;
      }

      if (
        relativePath.startsWith(
          ".migration/",
        )
      ) {
        continue;
      }

      if (
        mutable.has(
          relativePath,
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

function ensureStage13DirectoryIsClean(
  rootDir,
) {
  const stage13Dir =
    fromPosixRelative(
      rootDir,
      ".migration/stage13",
    );

  if (
    !fs.existsSync(
      stage13Dir,
    )
  ) {
    return;
  }

  const journalPath =
    fromPosixRelative(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  if (
    fs.existsSync(
      journalPath,
    )
  ) {
    return;
  }

  const entries =
    fs.readdirSync(
      stage13Dir,
    );

  if (
    entries.length >
    0
  ) {
    fail(
      ".migration/stage13 já contém artefatos sem rewrite-journal.json consolidado. Não sobrescreva automaticamente.",
    );
  }
}

function rollbackOwnWrites(
  rootDir,
  filePlans,
  originalGlobalJournal,
) {
  const errors =
    [];

  for (
    const filePlan of
      filePlans
  ) {
    try {
      writeFileAtomic(
        fromPosixRelative(
          rootDir,
          filePlan.filePath,
        ),
        filePlan.beforeBuffer,
      );
    } catch (
      error
    ) {
      errors.push(
        `${filePlan.filePath}: ${
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

  try {
    writeFileAtomic(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      originalGlobalJournal,
    );
  } catch (
    error
  ) {
    errors.push(
      `v20-journal: ${
        error instanceof
        Error
          ? error.message
          : String(
              error,
            )
      }`,
    );
  }

  try {
    fs.rmSync(
      fromPosixRelative(
        rootDir,
        ".migration/stage13",
      ),
      {
        recursive:
          true,
        force:
          true,
      },
    );
  } catch (
    error
  ) {
    errors.push(
      `cleanup-stage13: ${
        error instanceof
        Error
          ? error.message
          : String(
              error,
            )
      }`,
    );
  }

  return errors;
}

function runStage13() {
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
    assertRepositoryRoot(
      process.cwd(),
    );

  validateModuleMap();

  const stage5 =
    loadApprovedStage5(
      rootDir,
    );

  const stage13JournalAbsolute =
    fromPosixRelative(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  const ts =
    loadTypeScript(
      rootDir,
    );

  if (
    fs.existsSync(
      stage13JournalAbsolute,
    )
  ) {
    const stage13Journal =
      readJson(
        stage13JournalAbsolute,
        STAGE13_JOURNAL_PATH,
      );

    const globalJournal =
      readJson(
        fromPosixRelative(
          rootDir,
          V20_JOURNAL_PATH,
        ),
        V20_JOURNAL_PATH,
      );

    validateStage13JournalAndGlobal(
      rootDir,
      stage13Journal,
      globalJournal,
    );

    const validation =
      validateCurrentRelativeReferences(
        ts,
        rootDir,
      );

    if (
      validation.unresolved.length >
      0
    ) {
      fail(
        `Etapa 13 possui ${String(validation.unresolved.length)} import(s) relativo(s) quebrado(s) no estado idempotente.`,
      );
    }

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 13 JÁ ESTÁ CONCLUÍDA                   ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] Arquivos reescritos: ${String(EXPECTED_REWRITE_FILE_COUNT)}/${String(EXPECTED_REWRITE_FILE_COUNT)}`,
    );
    console.log(
      `[OK] Specifiers reescritos: ${String(EXPECTED_REWRITE_SPECIFIER_COUNT)}/${String(EXPECTED_REWRITE_SPECIFIER_COUNT)}`,
    );
    console.log(
      `[OK] Worker URLs validadas: ${String(validation.counts.workerUrlReferencesSeen)}`,
    );
    console.log(
      "[OK] Imports relativos quebrados: 0",
    );
    return;
  }

  validateStage10Layout(
    rootDir,
    stage5,
  );

  loadAndValidateStage12(
    rootDir,
  );

  ensureStage13DirectoryIsClean(
    rootDir,
  );

  const globalV2 =
    loadGlobalJournalV2(
      rootDir,
      stage5,
    );

  const rewritePlan =
    planRewrites(
      ts,
      rootDir,
      stage5,
    );

  validateExpectedScope(
    rewritePlan,
  );

  const mutablePaths =
    rewritePlan.filePlans.map(
      (filePlan) =>
        filePlan.filePath,
    );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      mutablePaths,
    );

  const originalGlobalJournal =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
    );

  const appliedFilePlans =
    [];

  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 13: REESCRITA AUTOMÁTICA DOS IMPORTS   ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] Etapa 10: ${String(EXPECTED_STAGE10_MOVE_COUNT)}/${String(EXPECTED_STAGE10_MOVE_COUNT)} arquivos movidos e íntegros.`,
    );
    console.log(
      `[OK] Etapa 12: ${String(EXPECTED_STAGE12_EXTRACTION_COUNT)}/${String(EXPECTED_STAGE12_EXTRACTION_COUNT)} extrações íntegras.`,
    );
    console.log(
      `[OK] Journal global pré-Etapa 13: ${String(globalV2.operations.length)} operações.`,
    );
    console.log(
      `[OK] Arquivos de código analisados: ${String(rewritePlan.counts.codeFilesScanned)}`,
    );
    console.log(
      `[OK] References relativos analisados: ${String(rewritePlan.counts.relativeReferencesSeen)}`,
    );
    console.log(
      `[OK] Worker URLs encontradas: ${String(rewritePlan.counts.workerUrlReferencesSeen)}`,
    );
    console.log("");
    console.log(
      "=== ESCOPO EXATO DA ETAPA 13 ===",
    );
    console.log(
      `Arquivos a reescrever: ${String(rewritePlan.counts.filesRewritten)}`,
    );
    console.log(
      `Specifiers a reescrever: ${String(rewritePlan.counts.specifierRewrites)}`,
    );
    console.log(
      `  import: ${String(rewritePlan.counts.importRewrites)}`,
    );
    console.log(
      `  export from: ${String(rewritePlan.counts.exportFromRewrites)}`,
    );
    console.log(
      `  import(): ${String(rewritePlan.counts.dynamicImportRewrites)}`,
    );
    console.log(
      `  new URL(..., import.meta.url): ${String(rewritePlan.counts.workerUrlRewrites)} rewrite(s), ${String(rewritePlan.counts.workerUrlReferencesSeen)} reference(s) validada(s)`,
    );
    console.log(
      "Substituição regex cega: 0",
    );
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    const operations =
      [];

    for (
      let index =
        0;
      index <
        rewritePlan.filePlans.length;
      index +=
        1
    ) {
      const filePlan =
        rewritePlan.filePlans[
          index
        ];

      const backups =
        backupPathsFor(
          filePlan.filePath,
        );

      for (
        const [
          backupPath,
          buffer,
        ] of
          [
            [
              backups.before,
              filePlan.beforeBuffer,
            ],
            [
              backups.after,
              filePlan.afterBuffer,
            ],
          ]
      ) {
        const absoluteBackup =
          fromPosixRelative(
            rootDir,
            backupPath,
          );

        if (
          fs.existsSync(
            absoluteBackup,
          )
        ) {
          fail(
            `Backup da Etapa 13 já existe sem journal consolidado: ${backupPath}`,
          );
        }

        writeFileAtomic(
          absoluteBackup,
          buffer,
        );
      }

      writeFileAtomic(
        fromPosixRelative(
          rootDir,
          filePlan.filePath,
        ),
        filePlan.afterBuffer,
      );

      const info =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            filePlan.filePath,
          ),
        );

      if (
        info.kind !==
          "file" ||
        info.bytes !==
          filePlan.bytesAfter ||
        info.sha256 !==
          filePlan.shaAfter
      ) {
        fail(
          `Verificação pós-escrita falhou: ${filePlan.filePath}`,
        );
      }

      const operation =
        buildStage13Operation(
          filePlan,
          EXPECTED_PRE_STAGE13_OPERATION_COUNT +
            index +
            1,
          new Date().toISOString(),
        );

      operations.push(
        operation,
      );

      appliedFilePlans.push(
        filePlan,
      );

      console.log(
        `  [OK] ${filePlan.filePath} | ${String(filePlan.edits.length)} specifier(s)`,
      );
    }

    const validationAfter =
      validateCurrentRelativeReferences(
        ts,
        rootDir,
      );

    if (
      validationAfter.unresolved.length >
      0
    ) {
      const details =
        validationAfter.unresolved
          .slice(
            0,
            20,
          )
          .map(
            (
              record,
              index,
            ) =>
              `${String(index + 1)}. ${record.filePath} | ${record.kind} | ${record.specifier}`,
          );

      fail(
        [
          `Validação pós-rewrite encontrou ${String(validationAfter.unresolved.length)} reference(s) relativo(s) quebrado(s).`,
          ...details,
        ].join(
          "\n",
        ),
      );
    }

    if (
      validationAfter.counts.workerUrlReferencesSeen !==
      EXPECTED_WORKER_URL_REFERENCE_COUNT
    ) {
      fail(
        `Validação final encontrou ${String(validationAfter.counts.workerUrlReferencesSeen)} Worker URL(s), esperado ${String(EXPECTED_WORKER_URL_REFERENCE_COUNT)}.`,
      );
    }

    const stage13Journal =
      buildStage13Journal(
        stage5,
        rewritePlan,
        operations,
        validationAfter,
      );

    writeJsonAtomic(
      stage13JournalAbsolute,
      stage13Journal,
    );

    const globalV3 =
      upgradeGlobalJournalToV3(
        globalV2,
        stage13Journal,
      );

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      globalV3,
    );

    validateStage13JournalAndGlobal(
      rootDir,
      stage13Journal,
      globalV3,
    );

    const protectedAfter =
      protectedProjectSnapshot(
        rootDir,
        mutablePaths,
      );

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "Arquivo fora dos 108 arquivos planejados foi alterado pela Etapa 13.",
          `Digest protegido antes: ${protectedBefore.digest}`,
          `Digest protegido depois: ${protectedAfter.digest}`,
        ].join(
          "\n",
        ),
      );
    }

    console.log("");
    console.log(
      "=== VALIDAÇÃO FINAL ===",
    );
    console.log(
      `[OK] Arquivos reescritos: ${String(operations.length)}/${String(EXPECTED_REWRITE_FILE_COUNT)}`,
    );
    console.log(
      `[OK] Specifiers reescritos: ${String(rewritePlan.counts.specifierRewrites)}/${String(EXPECTED_REWRITE_SPECIFIER_COUNT)}`,
    );
    console.log(
      `[OK] References relativos pós-rewrite: ${String(validationAfter.counts.relativeReferencesSeen)}`,
    );
    console.log(
      "[OK] References relativos quebrados: 0",
    );
    console.log(
      `[OK] Worker URLs validadas: ${String(validationAfter.counts.workerUrlReferencesSeen)}/${String(EXPECTED_WORKER_URL_REFERENCE_COUNT)}`,
    );
    console.log(
      `[OK] Journal: ${STAGE13_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global v20: ${String(globalV3.operations.length)} operações (${String(EXPECTED_STAGE10_MOVE_COUNT)} Etapa 10 + ${String(EXPECTED_STAGE12_EXTRACTION_COUNT)} Etapa 12 + ${String(EXPECTED_REWRITE_FILE_COUNT)} Etapa 13).`,
    );
    console.log(
      `[OK] Rollback atualizado: ${ROLLBACK_SCRIPT_PATH}`,
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
      "  ETAPA 13 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "Os imports relativos foram recalculados por AST para o layout pós-Etapa 10/12 e todos os destinos relativos suportados existem.",
    );
  } catch (
    error
  ) {
    const compensationErrors =
      rollbackOwnWrites(
        rootDir,
        appliedFilePlans,
        originalGlobalJournal,
      );

    const originalMessage =
      error instanceof
      Error
        ? (
            error.stack ??
            error.message
          )
        : String(
            error,
          );

    if (
      compensationErrors.length ===
      0
    ) {
      fail(
        [
          originalMessage,
          `[OK] Compensação da Etapa 13 restaurou ${String(appliedFilePlans.length)} arquivo(s) reescrito(s) nesta execução.`,
        ].join(
          "\n",
        ),
      );
    }

    fail(
      [
        originalMessage,
        `A compensação encontrou ${String(compensationErrors.length)} erro(s):`,
        ...compensationErrors.map(
          (message) =>
            `  - ${message}`,
        ),
        "Não continue automaticamente.",
      ].join(
        "\n",
      ),
    );
  }
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
    runStage13();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 13 não concluída.",
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
