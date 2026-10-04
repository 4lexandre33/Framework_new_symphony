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
  "stage-14-generate-public-facades";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const EXPECTED_STAGE10_MOVE_COUNT =
  93;

const EXPECTED_STAGE12_EXTRACTION_COUNT =
  21;

const EXPECTED_STAGE13_REWRITE_COUNT =
  108;

const EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT =
  163;

const EXPECTED_STAGE13_WORKER_URL_COUNT =
  2;

const EXPECTED_PRE_STAGE14_OPERATION_COUNT =
  EXPECTED_STAGE10_MOVE_COUNT +
  EXPECTED_STAGE12_EXTRACTION_COUNT +
  EXPECTED_STAGE13_REWRITE_COUNT;

const EXPECTED_FACADE_COUNT =
  EXPECTED_CANONICAL_MODULE_COUNT;

const EXPECTED_EXPORT_STATEMENT_COUNT =
  48;

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE13_JOURNAL_PATH =
  ".migration/stage13/rewrite-journal.json";

const STAGE14_JOURNAL_PATH =
  ".migration/stage14/facade-journal.json";

const STAGE14_BACKUP_ROOT =
  ".migration/stage14/backups/after";

const STAGE10_MOVE_TRANSFORMATION =
  "move-engine-implementation-to-module-internal";

const STAGE12_EXTRACTION_TRANSFORMATION =
  "extract-plugin-implementation";

const STAGE13_REWRITE_TRANSFORMATION =
  "rewrite-relative-module-specifiers";

const STAGE14_FACADE_TRANSFORMATION =
  "create-public-facade";

const FORBIDDEN_DIRECT_EXPORT_NAMES =
  Object.freeze([
    "PhysicsWorld",
    "InputManager",
    "SceneManager",
    "GPUParticleSystem",
  ]);

const FORBIDDEN_SOURCE_SEGMENTS =
  Object.freeze([
    "/internal/",
  ]);

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

  const absolute =
    path.join(
      rootDir,
      ...relativePath.split(
        "/",
      ),
    );

  const relativeBack =
    path.relative(
      rootDir,
      absolute,
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

  return absolute;
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
    if (
      allowFailure
    ) {
      return {
        status:
          result.status ??
          1,
        stdout:
          String(
            result.stdout ??
              "",
          ),
        stderr:
          String(
            result.stderr ??
              "",
          ),
      };
    }

    throw result.error;
  }

  const status =
    result.status ??
    1;

  const stdout =
    String(
      result.stdout ??
        "",
    );

  const stderr =
    String(
      result.stderr ??
        "",
    );

  if (
    status !==
      0 &&
    !allowFailure
  ) {
    fail(
      stderr.trim().length >
        0
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
    ).stdout.trim();

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
    ).stdout.trim();

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
        "Execute a Etapa 14 exatamente na raiz do Projeto1.",
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
      "  node scripts/architecture/generate-public-facades.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 14: geração das fachadas public/index.ts

Uso:
  node scripts/architecture/generate-public-facades.mjs

Escopo exato:
  - criar 23 arquivos src/engine/<module>/public/index.ts;
  - reexportar somente contracts e tokens declarados no module-map;
  - nunca reexportar implementações de internal, drivers concretos ou workers;
  - registrar a Etapa 14 no journal v20;
  - manter rollback independente de Git.

Esta etapa NÃO:
  - reescreve consumidores para usar as fachadas;
  - cria alias @core;
  - altera tsconfig.json ou vite.config.ts;
  - corrige o leak StateReplicator;
  - altera implementations em internal;
  - altera plugins, contracts ou tokens.
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
      recursive: true,
    },
  );

  const tempPath =
    `${filePath}.tmp-${String(process.pid)}`;

  fs.writeFileSync(
    tempPath,
    buffer,
    {
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

function writeTextAtomic(
  filePath,
  text,
) {
  writeFileAtomic(
    filePath,
    Buffer.from(
      text,
      "utf8",
    ),
  );
}

function writeJsonAtomic(
  filePath,
  value,
) {
  writeTextAtomic(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
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

function loadTypeScript() {
  const require =
    createRequire(
      import.meta.url,
    );

  let ts;

  try {
    ts =
      require(
        "typescript",
      );
  } catch (
    error
  ) {
    fail(
      [
        "Não foi possível carregar TypeScript.",
        "A Etapa 14 usa o Compiler API para validar as fachadas.",
        error instanceof
        Error
          ? error.message
          : String(
              error,
            ),
      ].join(
        "\n",
      ),
    );
  }

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

function identityV2(
  operation,
) {
  if (
    operation.transformation ===
    STAGE10_MOVE_TRANSFORMATION
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
    STAGE12_EXTRACTION_TRANSFORMATION
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
    `Transformação v2 não suportada: ${String(operation.transformation)}`,
  );
}

function identityV3(
  operation,
) {
  if (
    operation.transformation !==
    STAGE13_REWRITE_TRANSFORMATION
  ) {
    return identityV2(
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

function identityV4(
  operation,
) {
  if (
    operation.transformation !==
    STAGE14_FACADE_TRANSFORMATION
  ) {
    return identityV3(
      operation,
    );
  }

  return {
    sequence:
      operation.sequence,
    sourceStage: 14,
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
    shaBefore: null,
    shaAfter:
      operation.shaAfter,
    timestampUtc:
      operation.timestampUtc,
    transformation:
      operation.transformation,
    filePath:
      operation.filePath,
    fileBytesAfter:
      operation.fileBytesAfter,
    fileShaAfter:
      operation.fileShaAfter,
    backupAfterPath:
      operation.backupAfterPath,
    backupAfterSha256:
      operation.backupAfterSha256,
    contractTargets:
      operation.contractTargets,
    tokenTargets:
      operation.tokenTargets,
    exportSpecifiers:
      operation.exportSpecifiers,
  };
}

function validatePreStage14GlobalJournal(
  journal,
) {
  if (
    journal.schemaVersion !==
      3 ||
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
      EXPECTED_PRE_STAGE14_OPERATION_COUNT ||
    journal.counts
      ?.totalOperations !==
      EXPECTED_PRE_STAGE14_OPERATION_COUNT ||
    journal.counts
      ?.applied !==
      EXPECTED_PRE_STAGE14_OPERATION_COUNT ||
    journal.counts
      ?.rolledBack !==
      0 ||
    journal.counts
      ?.conflicts !==
      0 ||
    journal.counts
      ?.stage10MoveOperations !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    journal.counts
      ?.stage12Extractions !==
      EXPECTED_STAGE12_EXTRACTION_COUNT ||
    journal.counts
      ?.stage13RewriteFiles !==
      EXPECTED_STAGE13_REWRITE_COUNT ||
    journal.counts
      ?.stage13SpecifierRewrites !==
      EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT ||
    journal.counts
      ?.stage13WorkerUrlsValidated !==
      EXPECTED_STAGE13_WORKER_URL_COUNT
  ) {
    fail(
      "Journal global v20 não está no estado exato pós-Etapa 13.",
    );
  }

  const moves =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE10_MOVE_TRANSFORMATION,
    );

  const extractions =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE12_EXTRACTION_TRANSFORMATION,
    );

  const rewrites =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE13_REWRITE_TRANSFORMATION,
    );

  if (
    moves.length !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    extractions.length !==
      EXPECTED_STAGE12_EXTRACTION_COUNT ||
    rewrites.length !==
      EXPECTED_STAGE13_REWRITE_COUNT
  ) {
    fail(
      "Distribuição de operações do journal v20 divergiu antes da Etapa 14.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV3(
            operation,
          ),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal v20 divergiu antes da Etapa 14.",
    );
  }
}

function validateStage13Journal(
  rootDir,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  const journal =
    readJson(
      absolute,
      STAGE13_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      "stage-13-rewrite-imports" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_STAGE13_REWRITE_COUNT ||
    journal.counts
      ?.totalRewriteFiles !==
      EXPECTED_STAGE13_REWRITE_COUNT ||
    journal.counts
      ?.applied !==
      EXPECTED_STAGE13_REWRITE_COUNT ||
    journal.counts
      ?.rolledBack !==
      0 ||
    journal.counts
      ?.specifierRewrites !==
      EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT ||
    journal.counts
      ?.workerUrlReferencesValidated !==
      EXPECTED_STAGE13_WORKER_URL_COUNT ||
    journal.counts
      ?.unresolvedRelativeReferencesAfter !==
      0
  ) {
    fail(
      "Journal da Etapa 13 não está completed com 108 rewrites e 0 referências quebradas.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV3(
            operation,
          ),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal da Etapa 13 divergiu.",
    );
  }

  return journal;
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

  const keys =
    new Set();

  let exportStatementCount =
    0;

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    if (
      keys.has(
        moduleRecord.key,
      )
    ) {
      fail(
        `moduleKey duplicado: ${moduleRecord.key}`,
      );
    }

    keys.add(
      moduleRecord.key,
    );

    if (
      moduleRecord.engine
        ?.publicRoot !==
        `src/engine/${moduleRecord.key}/public` ||
      moduleRecord.engine
        ?.internalRoot !==
        `src/engine/${moduleRecord.key}/internal` ||
      !Array.isArray(
        moduleRecord.contracts,
      ) ||
      moduleRecord.contracts.length <
        1 ||
      !Array.isArray(
        moduleRecord.tokens,
      ) ||
      moduleRecord.tokens.length <
        1
    ) {
      fail(
        `Module-map incompleto para ${moduleRecord.key}.`,
      );
    }

    exportStatementCount +=
      moduleRecord.contracts.length +
      moduleRecord.tokens.length;
  }

  if (
    exportStatementCount !==
      EXPECTED_EXPORT_STATEMENT_COUNT
  ) {
    fail(
      `Esperados ${String(EXPECTED_EXPORT_STATEMENT_COUNT)} exports de contracts/tokens; module-map atual produz ${String(exportStatementCount)}.`,
    );
  }
}

function loadSourceFile(
  ts,
  rootDir,
  relativePath,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  const info =
    inspectRegularFile(
      absolute,
    );

  if (
    info.kind !==
      "file"
  ) {
    fail(
      `Fonte pública declarada no module-map não é arquivo regular: ${relativePath}`,
    );
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const sourceFile =
    ts.createSourceFile(
      relativePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  if (
    sourceFile.parseDiagnostics.length >
    0
  ) {
    fail(
      `Erro de parsing TypeScript na fonte pública: ${relativePath}`,
    );
  }

  return {
    text,
    sourceFile,
  };
}

function hasExportModifier(
  ts,
  node,
) {
  if (
    !ts.canHaveModifiers(
      node,
    )
  ) {
    return false;
  }

  const modifiers =
    ts.getModifiers(
      node,
    ) ??
    [];

  return modifiers.some(
    (modifier) =>
      modifier.kind ===
      ts.SyntaxKind.ExportKeyword,
  );
}

function declaredName(
  ts,
  statement,
) {
  if (
    (
      ts.isInterfaceDeclaration(
        statement,
      ) ||
      ts.isTypeAliasDeclaration(
        statement,
      ) ||
      ts.isClassDeclaration(
        statement,
      ) ||
      ts.isFunctionDeclaration(
        statement,
      ) ||
      ts.isEnumDeclaration(
        statement,
      )
    ) &&
    statement.name
  ) {
    return statement.name.text;
  }

  return null;
}

function validateAllowedPublicSource(
  ts,
  rootDir,
  relativePath,
) {
  for (
    const segment of
      FORBIDDEN_SOURCE_SEGMENTS
  ) {
    if (
      `/${relativePath}/`.includes(
        segment,
      )
    ) {
      fail(
        `Fonte de fachada aponta para internal: ${relativePath}`,
      );
    }
  }

  if (
    relativePath.startsWith(
      "src/engine/",
    )
  ) {
    fail(
      `Fachada não pode reexportar fonte de engine diretamente: ${relativePath}`,
    );
  }

  if (
    !relativePath.startsWith(
      "src/contracts/",
    ) &&
    !relativePath.startsWith(
      "src/tokens/",
    )
  ) {
    fail(
      `Fonte pública fora de contracts/tokens: ${relativePath}`,
    );
  }

  const {
    sourceFile,
  } =
    loadSourceFile(
      ts,
      rootDir,
      relativePath,
    );

  for (
    const statement of
      sourceFile.statements
  ) {
    const name =
      declaredName(
        ts,
        statement,
      );

    if (
      name !==
        null &&
      hasExportModifier(
        ts,
        statement,
      ) &&
      FORBIDDEN_DIRECT_EXPORT_NAMES.includes(
        name,
      )
    ) {
      fail(
        `Fonte pública exporta símbolo concreto proibido ${name}: ${relativePath}`,
      );
    }

    if (
      ts.isVariableStatement(
        statement,
      ) &&
      hasExportModifier(
        ts,
        statement,
      )
    ) {
      for (
        const declaration of
          statement.declarationList.declarations
      ) {
        if (
          ts.isIdentifier(
            declaration.name,
          ) &&
          FORBIDDEN_DIRECT_EXPORT_NAMES.includes(
            declaration.name.text,
          )
        ) {
          fail(
            `Fonte pública exporta símbolo concreto proibido ${declaration.name.text}: ${relativePath}`,
          );
        }
      }
    }

    if (
      ts.isExportDeclaration(
        statement,
      )
    ) {
      if (
        statement.exportClause &&
        ts.isNamedExports(
          statement.exportClause,
        )
      ) {
        for (
          const element of
            statement.exportClause.elements
        ) {
          const exportedName =
            element.name.text;

          if (
            FORBIDDEN_DIRECT_EXPORT_NAMES.includes(
              exportedName,
            )
          ) {
            fail(
              `Fonte pública reexporta símbolo concreto proibido ${exportedName}: ${relativePath}`,
            );
          }
        }
      }

      if (
        statement.moduleSpecifier &&
        ts.isStringLiteralLike(
          statement.moduleSpecifier,
        )
      ) {
        const specifier =
          statement.moduleSpecifier.text;

        if (
          specifier.includes(
            "/internal/"
          ) ||
          specifier.startsWith(
            "../engine/"
          )
        ) {
          fail(
            `Fonte pública contém reexport suspeito para engine/internal: ${relativePath} -> ${specifier}`,
          );
        }
      }
    }
  }
}


function collectDirectExportNames(
  ts,
  sourceFile,
) {
  const names =
    [];

  for (
    const statement of
      sourceFile.statements
  ) {
    if (
      hasExportModifier(
        ts,
        statement,
      )
    ) {
      const name =
        declaredName(
          ts,
          statement,
        );

      if (
        name !==
        null
      ) {
        names.push(
          name,
        );
      }

      if (
        ts.isVariableStatement(
          statement,
        )
      ) {
        for (
          const declaration of
            statement.declarationList.declarations
        ) {
          if (
            ts.isIdentifier(
              declaration.name,
            )
          ) {
            names.push(
              declaration.name.text,
            );
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(
        statement,
      ) &&
      statement.exportClause &&
      ts.isNamedExports(
        statement.exportClause,
      )
    ) {
      for (
        const element of
          statement.exportClause.elements
      ) {
        names.push(
          element.name.text,
        );
      }
    }
  }

  return names;
}

function validateNoDuplicateDirectExports(
  ts,
  rootDir,
  moduleRecord,
) {
  const sourcePaths =
    [
      ...moduleRecord.contracts,
      ...moduleRecord.tokens.map(
        (tokenRecord) =>
          tokenRecord.path,
      ),
    ];

  const owners =
    new Map();

  for (
    const relativePath of
      sourcePaths
  ) {
    const {
      sourceFile,
    } =
      loadSourceFile(
        ts,
        rootDir,
        relativePath,
      );

    for (
      const exportName of
        collectDirectExportNames(
          ts,
          sourceFile,
        )
    ) {
      const current =
        owners.get(
          exportName,
        ) ??
        [];

      current.push(
        relativePath,
      );

      owners.set(
        exportName,
        current,
      );
    }
  }

  const duplicates =
    [...owners.entries()]
      .filter(
        ([
          ,
          paths,
        ]) =>
          paths.length >
          1,
      );

  if (
    duplicates.length >
    0
  ) {
    fail(
      [
        `A fachada ${moduleRecord.engine.publicRoot}/index.ts teria exports diretos duplicados.`,
        ...duplicates.map(
          ([
            exportName,
            paths,
          ]) =>
            `  ${exportName}: ${paths.join(", ")}`,
        ),
      ].join(
        "\n",
      ),
    );
  }
}

function stripTypeScriptExtension(
  relativePath,
) {
  return relativePath.replace(
    /\.[cm]?tsx?$/u,
    "",
  );
}

function relativeModuleSpecifier(
  fromFileRelativePath,
  toFileRelativePath,
) {
  let relative =
    path.posix.relative(
      path.posix.dirname(
        fromFileRelativePath,
      ),
      stripTypeScriptExtension(
        toFileRelativePath,
      ),
    );

  if (
    !relative.startsWith(
      ".",
    )
  ) {
    relative =
      `./${relative}`;
  }

  return relative;
}

function buildFacade(
  moduleRecord,
) {
  const filePath =
    `${moduleRecord.engine.publicRoot}/index.ts`;

  const contractTargets =
    [...moduleRecord.contracts];

  const tokenTargets =
    moduleRecord.tokens.map(
      (tokenRecord) =>
        tokenRecord.path,
    );

  const targets =
    [
      ...contractTargets,
      ...tokenTargets,
    ];

  const exportSpecifiers =
    targets.map(
      (target) =>
        relativeModuleSpecifier(
          filePath,
          target,
        ),
    );

  const lines =
    [
      "/**",
      ` * Public API boundary for ${moduleRecord.capabilityId}.`,
      " *",
      " * Generated by scripts/architecture/generate-public-facades.mjs.",
      " * Exposes contracts and capability tokens only.",
      " * Concrete implementations are not part of this public facade.",
      " */",
      ...exportSpecifiers.map(
        (specifier) =>
          `export * from ${JSON.stringify(specifier)};`,
      ),
      "",
    ];

  const content =
    lines.join(
      "\n",
    );

  return {
    moduleKey:
      moduleRecord.key,
    capabilityId:
      moduleRecord.capabilityId,
    filePath,
    contractTargets,
    tokenTargets,
    exportSpecifiers,
    content,
    bytes:
      Buffer.byteLength(
        content,
        "utf8",
      ),
    sha256:
      sha256Text(
        content,
      ),
  };
}

function validatePublicDirectories(
  rootDir,
  allowIndexFiles,
) {
  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    const publicRoot =
      moduleRecord.engine.publicRoot;

    const absolute =
      fromPosixRelative(
        rootDir,
        publicRoot,
      );

    if (
      !fs.existsSync(
        absolute,
      )
    ) {
      fail(
        `Diretório public ausente: ${publicRoot}/`,
      );
    }

    const stat =
      fs.lstatSync(
        absolute,
      );

    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory()
    ) {
      fail(
        `Diretório public inválido: ${publicRoot}/`,
      );
    }

    const entries =
      fs.readdirSync(
        absolute,
        {
          withFileTypes: true,
        },
      );

    for (
      const entry of
        entries
    ) {
      if (
        allowIndexFiles &&
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name ===
          "index.ts"
      ) {
        continue;
      }

      fail(
        `Conteúdo inesperado em ${publicRoot}/ antes/depois da Etapa 14: ${entry.name}`,
      );
    }
  }
}

function validateFacadeWithAst(
  ts,
  rootDir,
  facade,
  sourceText,
) {
  const sourceFile =
    ts.createSourceFile(
      facade.filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  if (
    sourceFile.parseDiagnostics.length >
    0
  ) {
    fail(
      `Fachada gerada possui erro de parsing: ${facade.filePath}`,
    );
  }

  const statements =
    sourceFile.statements;

  if (
    statements.length !==
      facade.exportSpecifiers.length
  ) {
    fail(
      `Fachada ${facade.filePath} deveria conter somente ${String(facade.exportSpecifiers.length)} export declarations.`,
    );
  }

  const actualSpecifiers =
    [];

  for (
    const statement of
      statements
  ) {
    if (
      !ts.isExportDeclaration(
        statement,
      ) ||
      statement.exportClause !==
        undefined ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(
        statement.moduleSpecifier,
      )
    ) {
      fail(
        `Fachada contém declaração fora do padrão export * from: ${facade.filePath}`,
      );
    }

    const specifier =
      statement.moduleSpecifier.text;

    if (
      specifier.includes(
        "/internal/"
      ) ||
      specifier.includes(
        "/engine/"
      )
    ) {
      fail(
        `Fachada contém caminho proibido: ${facade.filePath} -> ${specifier}`,
      );
    }

    actualSpecifiers.push(
      specifier,
    );
  }

  if (
    semanticSha256(
      actualSpecifiers,
    ) !==
    semanticSha256(
      facade.exportSpecifiers,
    )
  ) {
    fail(
      `Specifiers da fachada divergiram: ${facade.filePath}`,
    );
  }

  for (
    let index = 0;
    index <
      facade.exportSpecifiers.length;
    index +=
      1
  ) {
    const specifier =
      facade.exportSpecifiers[
        index
      ];

    const target =
      [
        ...facade.contractTargets,
        ...facade.tokenTargets,
      ][index];

    const expected =
      relativeModuleSpecifier(
        facade.filePath,
        target,
      );

    if (
      specifier !==
      expected
    ) {
      fail(
        `Specifier não corresponde ao target: ${facade.filePath} -> ${specifier}`,
      );
    }

    const targetInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          target,
        ),
      );

    if (
      targetInfo.kind !==
        "file"
    ) {
      fail(
        `Target público deixou de existir: ${target}`,
      );
    }
  }

  for (
    const forbiddenName of
      FORBIDDEN_DIRECT_EXPORT_NAMES
  ) {
    if (
      sourceText.includes(
        forbiddenName,
      )
    ) {
      fail(
        `Fachada menciona símbolo concreto proibido ${forbiddenName}: ${facade.filePath}`,
      );
    }
  }

  if (
    /\.worker(?:["'])/u.test(
      sourceText,
    ) ||
    /Driver(?:["'];|\s+from)/u.test(
      sourceText,
    )
  ) {
    fail(
      `Fachada contém worker/driver concreto: ${facade.filePath}`,
    );
  }
}

function backupPathForFacade(
  facade,
) {
  return `${STAGE14_BACKUP_ROOT}/${facade.filePath}`;
}

function buildStage14Operation(
  facade,
  sequence,
  timestampUtc,
) {
  const backupAfterPath =
    backupPathForFacade(
      facade,
    );

  return {
    sequence,
    sourceStage: 14,
    moduleKey:
      facade.moduleKey,
    capabilityId:
      facade.capabilityId,
    isWorker: false,
    oldPath:
      facade.filePath,
    newPath:
      facade.filePath,
    bytes:
      facade.bytes,
    shaBefore: null,
    shaAfter:
      facade.sha256,
    timestampUtc,
    transformation:
      STAGE14_FACADE_TRANSFORMATION,
    state: "applied",
    rollbackTimestampUtc: null,
    filePath:
      facade.filePath,
    fileBytesAfter:
      facade.bytes,
    fileShaAfter:
      facade.sha256,
    backupAfterPath,
    backupAfterSha256:
      facade.sha256,
    contractTargets:
      facade.contractTargets,
    tokenTargets:
      facade.tokenTargets,
    exportSpecifiers:
      facade.exportSpecifiers,
  };
}

function buildStage14Journal(
  operations,
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
    counts: {
      totalFacades:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      exportStatements:
        operations.reduce(
          (
            sum,
            operation,
          ) =>
            sum +
            operation.exportSpecifiers.length,
          0,
        ),
      internalReexports:
        0,
      forbiddenConcreteExports:
        0,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV4(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "As fachadas public/index.ts reexportam somente contracts e tokens declarados no module-map.",
      "Nenhuma implementação de src/engine/**/internal, driver concreto ou worker é reexportada.",
      "Consumidores não são migrados para as fachadas nesta etapa.",
      "O alias @core pertence à Etapa 15.",
    ],
  };
}

function upgradeGlobalJournal(
  current,
  stage14Journal,
) {
  const operations =
    [
      ...current.operations,
      ...stage14Journal.operations,
    ];

  const sourceJournals =
    Array.isArray(
      current.sourceJournals,
    )
      ? [...current.sourceJournals]
      : [];

  if (
    !sourceJournals.some(
      (record) =>
        record.path ===
        STAGE14_JOURNAL_PATH,
    )
  ) {
    sourceJournals.push(
      {
        stage:
          STAGE_NAME,
        path:
          STAGE14_JOURNAL_PATH,
        statusAtConsolidation:
          stage14Journal.status,
      },
    );
  }

  const now =
    new Date().toISOString();

  return {
    ...current,
    schemaVersion: 4,
    journalRevision: 4,
    status: "migrated",
    updatedAtUtc:
      now,
    sourceJournals,
    counts: {
      ...current.counts,
      totalOperations:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      stage14PublicFacades:
        EXPECTED_FACADE_COUNT,
      stage14ExportStatements:
        EXPECTED_EXPORT_STATEMENT_COUNT,
      stage14InternalReexports:
        0,
      stage14ForbiddenConcreteExports:
        0,
    },
    operationsIdentityAlgorithm:
      "semantic-sha256-v4",
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV4(
              operation,
            ),
        ),
      ),
    operations,
  };
}

function validateCompletedState(
  ts,
  rootDir,
  stage14Journal,
  globalJournal,
) {
  if (
    stage14Journal.schemaVersion !==
      1 ||
    stage14Journal.stage !==
      STAGE_NAME ||
    stage14Journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    stage14Journal.status !==
      "completed" ||
    !Array.isArray(
      stage14Journal.operations,
    ) ||
    stage14Journal.operations.length !==
      EXPECTED_FACADE_COUNT ||
    stage14Journal.counts
      ?.totalFacades !==
      EXPECTED_FACADE_COUNT ||
    stage14Journal.counts
      ?.applied !==
      EXPECTED_FACADE_COUNT ||
    stage14Journal.counts
      ?.rolledBack !==
      0 ||
    stage14Journal.counts
      ?.exportStatements !==
      EXPECTED_EXPORT_STATEMENT_COUNT ||
    stage14Journal.counts
      ?.internalReexports !==
      0 ||
    stage14Journal.counts
      ?.forbiddenConcreteExports !==
      0
  ) {
    fail(
      "Journal existente da Etapa 14 é incompatível.",
    );
  }

  const stage14Identity =
    semanticSha256(
      stage14Journal.operations.map(
        (operation) =>
          identityV4(
            operation,
          ),
      ),
    );

  if (
    stage14Identity !==
    stage14Journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 da Etapa 14 divergiu.",
    );
  }

  const facades =
    CANONICAL_MODULES.map(
      (moduleRecord) =>
        buildFacade(
          moduleRecord,
        ),
    );

  const operationByPath =
    new Map(
      stage14Journal.operations.map(
        (operation) => [
          operation.filePath,
          operation,
        ],
      ),
    );

  for (
    const facade of
      facades
  ) {
    const operation =
      operationByPath.get(
        facade.filePath,
      );

    if (
      operation ===
        undefined
    ) {
      fail(
        `Journal da Etapa 14 perdeu fachada: ${facade.filePath}`,
      );
    }

    const currentInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          facade.filePath,
        ),
      );

    const backupInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.backupAfterPath,
        ),
      );

    if (
      currentInfo.kind !==
        "file" ||
      currentInfo.bytes !==
        facade.bytes ||
      currentInfo.sha256 !==
        facade.sha256 ||
      backupInfo.kind !==
        "file" ||
      backupInfo.sha256 !==
        facade.sha256
    ) {
      fail(
        `Fachada existente divergiu: ${facade.filePath}`,
      );
    }

    const text =
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          facade.filePath,
        ),
        "utf8",
      );

    validateFacadeWithAst(
      ts,
      rootDir,
      facade,
      text,
    );
  }

  validatePublicDirectories(
    rootDir,
    true,
  );

  if (
    globalJournal.schemaVersion !==
      4 ||
    globalJournal.status !==
      "migrated" ||
    !Array.isArray(
      globalJournal.operations,
    ) ||
    globalJournal.operations.length !==
      EXPECTED_PRE_STAGE14_OPERATION_COUNT +
      EXPECTED_FACADE_COUNT ||
    globalJournal.counts
      ?.stage14PublicFacades !==
      EXPECTED_FACADE_COUNT ||
    globalJournal.counts
      ?.stage14ExportStatements !==
      EXPECTED_EXPORT_STATEMENT_COUNT ||
    globalJournal.counts
      ?.stage14InternalReexports !==
      0 ||
    globalJournal.counts
      ?.stage14ForbiddenConcreteExports !==
      0
  ) {
    fail(
      "Journal global v20 não está consolidado com a Etapa 14.",
    );
  }

  const globalIdentity =
    semanticSha256(
      globalJournal.operations.map(
        (operation) =>
          identityV4(
            operation,
          ),
      ),
    );

  if (
    globalIdentity !==
    globalJournal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global divergiu após Etapa 14.",
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
          withFileTypes: true,
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

      const absolute =
        path.join(
          currentDir,
          entry.name,
        );

      const relativePath =
        toPosixRelative(
          rootDir,
          absolute,
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
            kind: "symlink",
            target:
              fs.readlinkSync(
                absolute,
              ),
          },
        );

        continue;
      }

      if (
        entry.isDirectory()
      ) {
        stack.push(
          absolute,
        );

        continue;
      }

      if (
        entry.isFile()
      ) {
        const stat =
          fs.statSync(
            absolute,
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
                absolute,
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

function cleanupStage14AfterFailure(
  rootDir,
  facades,
  originalGlobalJournal,
) {
  const errors =
    [];

  for (
    const facade of
      facades
  ) {
    try {
      fs.rmSync(
        fromPosixRelative(
          rootDir,
          facade.filePath,
        ),
        {
          force: true,
        },
      );
    } catch (
      error
    ) {
      errors.push(
        `${facade.filePath}: ${
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
      `${V20_JOURNAL_PATH}: ${
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
        ".migration/stage14",
      ),
      {
        recursive: true,
        force: true,
      },
    );
  } catch (
    error
  ) {
    errors.push(
      `.migration/stage14: ${
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

function runStage14() {
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

  const ts =
    loadTypeScript();

  const globalPath =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  if (
    !fs.existsSync(
      globalPath,
    )
  ) {
    fail(
      `Pré-condição ausente: ${V20_JOURNAL_PATH}`,
    );
  }

  const stage14JournalAbsolute =
    fromPosixRelative(
      rootDir,
      STAGE14_JOURNAL_PATH,
    );

  if (
    fs.existsSync(
      stage14JournalAbsolute,
    )
  ) {
    const stage14Journal =
      readJson(
        stage14JournalAbsolute,
        STAGE14_JOURNAL_PATH,
      );

    const globalJournal =
      readJson(
        globalPath,
        V20_JOURNAL_PATH,
      );

    validateCompletedState(
      ts,
      rootDir,
      stage14Journal,
      globalJournal,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 14 JÁ ESTÁ CONCLUÍDA                   ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] Fachadas: ${String(EXPECTED_FACADE_COUNT)}/${String(EXPECTED_FACADE_COUNT)}`,
    );
    console.log(
      `[OK] Reexports contracts/tokens: ${String(EXPECTED_EXPORT_STATEMENT_COUNT)}`,
    );
    console.log(
      "[OK] Reexports de internal: 0",
    );
    console.log(
      "[OK] Símbolos concretos proibidos: 0",
    );

    return;
  }

  validateStage13Journal(
    rootDir,
  );

  const globalJournal =
    readJson(
      globalPath,
      V20_JOURNAL_PATH,
    );

  validatePreStage14GlobalJournal(
    globalJournal,
  );

  validatePublicDirectories(
    rootDir,
    false,
  );

  const facades =
    CANONICAL_MODULES.map(
      (moduleRecord) =>
        buildFacade(
          moduleRecord,
        ),
    );

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    for (
      const contractPath of
        moduleRecord.contracts
    ) {
      validateAllowedPublicSource(
        ts,
        rootDir,
        contractPath,
      );
    }

    for (
      const tokenRecord of
        moduleRecord.tokens
    ) {
      validateAllowedPublicSource(
        ts,
        rootDir,
        tokenRecord.path,
      );
    }

    validateNoDuplicateDirectExports(
      ts,
      rootDir,
      moduleRecord,
    );
  }

  for (
    const facade of
      facades
  ) {
    validateFacadeWithAst(
      ts,
      rootDir,
      facade,
      facade.content,
    );

    const currentInfo =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          facade.filePath,
        ),
      );

    if (
      currentInfo.exists
    ) {
      fail(
        `Fachada já existe sem journal da Etapa 14: ${facade.filePath}`,
      );
    }
  }

  const mutablePaths =
    facades.map(
      (facade) =>
        facade.filePath,
    );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      mutablePaths,
    );

  const originalGlobalJournal =
    fs.readFileSync(
      globalPath,
    );

  try {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 14: FACHADAS PÚBLICAS                  ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] Journal global pré-Etapa 14: ${String(EXPECTED_PRE_STAGE14_OPERATION_COUNT)} operações.`,
    );
    console.log(
      `[OK] Módulos canônicos: ${String(EXPECTED_CANONICAL_MODULE_COUNT)}`,
    );
    console.log(
      `[OK] Fachadas planejadas: ${String(EXPECTED_FACADE_COUNT)}`,
    );
    console.log(
      `[OK] Reexports planejados: ${String(EXPECTED_EXPORT_STATEMENT_COUNT)} contracts/tokens.`,
    );
    console.log(
      "[OK] Reexports de internal planejados: 0",
    );
    console.log(
      "[OK] Implementações concretas planejadas: 0",
    );
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    const operations =
      [];

    for (
      let index = 0;
      index <
        facades.length;
      index +=
        1
    ) {
      const facade =
        facades[
          index
        ];

      const backupAfterPath =
        backupPathForFacade(
          facade,
        );

      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          backupAfterPath,
        ),
        facade.content,
      );

      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          facade.filePath,
        ),
        facade.content,
      );

      const currentInfo =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            facade.filePath,
          ),
        );

      const backupInfo =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            backupAfterPath,
          ),
        );

      if (
        currentInfo.kind !==
          "file" ||
        currentInfo.bytes !==
          facade.bytes ||
        currentInfo.sha256 !==
          facade.sha256 ||
        backupInfo.kind !==
          "file" ||
        backupInfo.sha256 !==
          facade.sha256
      ) {
        fail(
          `Falha verificando fachada recém-criada: ${facade.filePath}`,
        );
      }

      validateFacadeWithAst(
        ts,
        rootDir,
        facade,
        fs.readFileSync(
          fromPosixRelative(
            rootDir,
            facade.filePath,
          ),
          "utf8",
        ),
      );

      const operation =
        buildStage14Operation(
          facade,
          EXPECTED_PRE_STAGE14_OPERATION_COUNT +
            index +
            1,
          new Date().toISOString(),
        );

      operations.push(
        operation,
      );

      console.log(
        `  [OK] ${facade.filePath} | ${String(facade.exportSpecifiers.length)} reexport(s)`,
      );
    }

    const stage14Journal =
      buildStage14Journal(
        operations,
      );

    writeJsonAtomic(
      stage14JournalAbsolute,
      stage14Journal,
    );

    const upgradedGlobal =
      upgradeGlobalJournal(
        globalJournal,
        stage14Journal,
      );

    writeJsonAtomic(
      globalPath,
      upgradedGlobal,
    );

    validateCompletedState(
      ts,
      rootDir,
      stage14Journal,
      upgradedGlobal,
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
          "Arquivo fora das 23 fachadas foi alterado pela Etapa 14.",
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
      `[OK] Fachadas criadas: ${String(operations.length)}/${String(EXPECTED_FACADE_COUNT)}`,
    );
    console.log(
      `[OK] Reexports contracts/tokens: ${String(stage14Journal.counts.exportStatements)}/${String(EXPECTED_EXPORT_STATEMENT_COUNT)}`,
    );
    console.log(
      "[OK] Reexports de internal: 0",
    );
    console.log(
      "[OK] PhysicsWorld/InputManager/SceneManager/GPUParticleSystem reexportados: 0",
    );
    console.log(
      "[OK] Drivers concretos reexportados: 0",
    );
    console.log(
      "[OK] Workers reexportados: 0",
    );
    console.log(
      `[OK] Journal: ${STAGE14_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global v20: ${String(upgradedGlobal.operations.length)} operações (93 + 21 + 108 + 23).`,
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
      "  ETAPA 14 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "Os 23 módulos canônicos agora possuem public/index.ts expondo somente contracts e capability tokens.",
    );
  } catch (
    error
  ) {
    const cleanupErrors =
      cleanupStage14AfterFailure(
        rootDir,
        facades,
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
      cleanupErrors.length ===
      0
    ) {
      fail(
        [
          originalMessage,
          "[OK] Compensação da Etapa 14 removeu fachadas criadas e restaurou o journal global.",
        ].join(
          "\n",
        ),
      );
    }

    fail(
      [
        originalMessage,
        `Compensação encontrou ${String(cleanupErrors.length)} erro(s):`,
        ...cleanupErrors.map(
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
    runStage14();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 14 não concluída.",
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
