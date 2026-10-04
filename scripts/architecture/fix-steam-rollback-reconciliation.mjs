#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const FIX_NAME =
  "steam-consumer-boundary-journal-reconciliation";

const TARGET_PATH =
  "src/engine/net/internal/SteamP2PTransport.ts";

const FIX_REPORT_PATH =
  ".migration/fixes/steam-consumer-boundary/report.json";

const FIX_BEFORE_BACKUP_PATH =
  ".migration/fixes/steam-consumer-boundary/SteamP2PTransport.before.ts";

const RECONCILED_AFTER_BACKUP_PATH =
  ".migration/fixes/steam-consumer-boundary/SteamP2PTransport.reconciled-after.ts";

const RECONCILIATION_REPORT_PATH =
  ".migration/fixes/steam-consumer-boundary/journal-reconciliation.json";

const STAGE13_JOURNAL_PATH =
  ".migration/stage13/rewrite-journal.json";

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE15_JOURNAL_PATH =
  ".migration/stage15/core-alias-journal.json";

const ROLLBACK_SCRIPT_PATH =
  "scripts/architecture/rollback-migration.mjs";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_GLOBAL_SCHEMA =
  5;

const EXPECTED_GLOBAL_OPERATION_COUNT =
  247;

const EXPECTED_STAGE13_OPERATION_COUNT =
  108;

const EXPECTED_STAGE13_SEQUENCE =
  148;

const STAGE10_MOVE_TRANSFORMATION =
  "move-engine-implementation-to-module-internal";

const STAGE12_EXTRACTION_TRANSFORMATION =
  "extract-plugin-implementation";

const STAGE13_REWRITE_TRANSFORMATION =
  "rewrite-relative-module-specifiers";

const STAGE14_FACADE_TRANSFORMATION =
  "create-public-facade";

const STAGE15_ALIAS_TRANSFORMATION =
  "configure-core-alias";

const EXPECTED_STAGE13_OLD_AFTER_SHA =
  "7d8db18ed4a3708e17ab2f334ca32c31c83950db2f366f4d0e66bddd1dd5cd7d";

const EXPECTED_FIXED_SHA =
  "3b69e161e9130677713c1fe5b7b4f43651efc0bd3eb8b6ee819e3599affdb7c8";

const EXPECTED_FIXED_BYTES =
  5006;

function fail(message) {
  throw new Error(message);
}

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
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
      .map((entry) => stableStringify(entry))
      .join(",")}]`;
  }

  const keys =
    Object.keys(value).sort(
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
    .join(",")}}`;
}

function semanticSha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      stableStringify(value),
      "utf8",
    )
    .digest("hex");
}

function normalizeAbsolute(inputPath) {
  const normalized =
    path.normalize(
      path.resolve(inputPath),
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
    .split(path.sep)
    .join("/");
}

function assertSafeRelativePath(
  relativePath,
  label,
) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    fail(
      `${label} inválido: ${String(relativePath)}`,
    );
  }

  const segments =
    relativePath.split("/");

  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
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
      ...relativePath.split("/"),
    );

  const relativeBack =
    path.relative(
      rootDir,
      absolutePath,
    );

  if (
    relativeBack.startsWith("..") ||
    path.isAbsolute(relativeBack)
  ) {
    fail(
      `Path escapou da raiz do projeto: ${relativePath}`,
    );
  }

  return absolutePath;
}

function runGit(
  rootDir,
  args,
) {
  const result =
    spawnSync(
      "git",
      args,
      {
        cwd: rootDir,
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
    result.error ||
    (result.status ?? 1) !== 0
  ) {
    fail(
      `Falha executando git ${args.join(" ")}: ${
        result.error?.message ??
        String(result.stderr ?? "").trim()
      }`,
    );
  }

  return String(
    result.stdout ?? "",
  ).trim();
}

function assertRepositoryRoot(rootDir) {
  const inside =
    runGit(
      rootDir,
      [
        "rev-parse",
        "--is-inside-work-tree",
      ],
    );

  if (inside !== "true") {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRoot =
    runGit(
      rootDir,
      [
        "rev-parse",
        "--show-toplevel",
      ],
    );

  if (
    normalizeAbsolute(gitRoot) !==
    normalizeAbsolute(rootDir)
  ) {
    fail(
      [
        "Execute o reparo exatamente na raiz do Projeto1.",
        `Atual: ${rootDir}`,
        `Raiz Git: ${gitRoot}`,
      ].join("\n"),
    );
  }
}

function readJson(
  rootDir,
  relativePath,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  if (!fs.existsSync(absolute)) {
    fail(
      `Arquivo obrigatório ausente: ${relativePath}`,
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8",
      ),
    );
  } catch (error) {
    fail(
      `JSON inválido em ${relativePath}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function readBuffer(
  rootDir,
  relativePath,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  if (!fs.existsSync(absolute)) {
    fail(
      `Arquivo obrigatório ausente: ${relativePath}`,
    );
  }

  const stat =
    fs.lstatSync(absolute);

  if (
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    fail(
      `Arquivo obrigatório inválido: ${relativePath}`,
    );
  }

  return fs.readFileSync(absolute);
}

function writeBufferAtomic(
  rootDir,
  relativePath,
  buffer,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  fs.mkdirSync(
    path.dirname(absolute),
    {
      recursive: true,
    },
  );

  const tempPath =
    `${absolute}.tmp-${String(process.pid)}`;

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
      absolute,
    );
  } catch (error) {
    if (
      fs.existsSync(absolute)
    ) {
      fs.rmSync(
        absolute,
        {
          force: true,
        },
      );

      fs.renameSync(
        tempPath,
        absolute,
      );
    } else {
      throw error;
    }
  } finally {
    if (
      fs.existsSync(tempPath)
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

function writeJsonAtomic(
  rootDir,
  relativePath,
  value,
) {
  writeBufferAtomic(
    rootDir,
    relativePath,
    Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    ),
  );
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
      operation.isWorker === true,
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
        operation.sourceStage ?? 10,
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
    `Transformação não suportada no identity v2: ${String(operation.transformation)}`,
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

function identityV5(
  operation,
) {
  if (
    operation.transformation !==
    STAGE15_ALIAS_TRANSFORMATION
  ) {
    return identityV4(
      operation,
    );
  }

  return {
    sequence:
      operation.sequence,
    sourceStage: 15,
    moduleKey: null,
    capabilityId: null,
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
    configKind:
      operation.configKind,
    aliasSpecifier:
      operation.aliasSpecifier,
    aliasTarget:
      operation.aliasTarget,
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
  };
}

function validateStage15(
  rootDir,
) {
  const journal =
    readJson(
      rootDir,
      STAGE15_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !== 1 ||
    journal.stage !==
      "stage-15-install-core-alias" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !== "completed" ||
    journal.counts?.totalConfigs !== 2 ||
    journal.counts?.applied !== 2
  ) {
    fail(
      "A Etapa 15 não está no estado completed esperado.",
    );
  }
}

function validateStage13Journal(
  journal,
) {
  if (
    journal.schemaVersion !== 1 ||
    journal.stage !==
      "stage-13-rewrite-imports" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !== "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_STAGE13_OPERATION_COUNT
  ) {
    fail(
      "Journal da Etapa 13 incompatível.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV3(operation),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 da Etapa 13 divergiu antes do reparo.",
    );
  }
}

function validateGlobalJournal(
  journal,
) {
  if (
    journal.schemaVersion !==
      EXPECTED_GLOBAL_SCHEMA ||
    journal.journal !==
      "v20-architecture-migration-journal" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !== "migrated" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_GLOBAL_OPERATION_COUNT ||
    journal.counts?.totalOperations !==
      EXPECTED_GLOBAL_OPERATION_COUNT ||
    journal.counts?.applied !==
      EXPECTED_GLOBAL_OPERATION_COUNT ||
    journal.counts?.rolledBack !== 0 ||
    journal.counts?.conflicts !== 0
  ) {
    fail(
      "Journal global v20 não está no schema 5 migrado esperado.",
    );
  }

  const identity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV5(operation),
      ),
    );

  if (
    identity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal global divergiu antes do reparo.",
    );
  }
}

function getUniqueTargetOperation(
  operations,
  label,
) {
  const matches =
    operations.filter(
      (operation) =>
        operation.transformation ===
          STAGE13_REWRITE_TRANSFORMATION &&
        operation.filePath ===
          TARGET_PATH,
    );

  if (matches.length !== 1) {
    fail(
      `${label} deveria conter exatamente uma operação Stage 13 para ${TARGET_PATH}; atual: ${String(matches.length)}.`,
    );
  }

  const operation =
    matches[0];

  if (
    operation.sequence !==
      EXPECTED_STAGE13_SEQUENCE ||
    operation.sourceStage !== 13 ||
    operation.moduleKey !== "net" ||
    operation.capabilityId !==
      "game.net" ||
    operation.oldPath !==
      TARGET_PATH ||
    operation.newPath !==
      TARGET_PATH
  ) {
    fail(
      `${label}: identidade da operação ${TARGET_PATH} divergiu.`,
    );
  }

  return operation;
}

function validateFixReport(
  rootDir,
) {
  const report =
    readJson(
      rootDir,
      FIX_REPORT_PATH,
    );

  if (
    report.schemaVersion !== 1 ||
    report.kind !==
      "typed-boundary-fix" ||
    report.target !==
      TARGET_PATH ||
    report.publicFacade !==
      "src/engine/steam/public/index.ts" ||
    report.beforeSha256 !==
      EXPECTED_STAGE13_OLD_AFTER_SHA ||
    report.afterSha256 !==
      EXPECTED_FIXED_SHA
  ) {
    fail(
      "Relatório da correção Steam não corresponde ao reparo esperado.",
    );
  }

  const beforeBackup =
    readBuffer(
      rootDir,
      FIX_BEFORE_BACKUP_PATH,
    );

  if (
    sha256Buffer(beforeBackup) !==
    report.beforeSha256
  ) {
    fail(
      `Backup original da correção Steam divergiu: ${FIX_BEFORE_BACKUP_PATH}`,
    );
  }

  const currentTarget =
    readBuffer(
      rootDir,
      TARGET_PATH,
    );

  const currentSha =
    sha256Buffer(
      currentTarget,
    );

  if (
    currentSha !==
      report.afterSha256 ||
    currentSha !==
      EXPECTED_FIXED_SHA ||
    currentTarget.byteLength !==
      EXPECTED_FIXED_BYTES
  ) {
    fail(
      [
        `O arquivo corrigido não corresponde ao estado esperado: ${TARGET_PATH}`,
        `SHA atual: ${currentSha}`,
        `Bytes atuais: ${String(currentTarget.byteLength)}`,
      ].join("\n"),
    );
  }

  return {
    report,
    currentTarget,
    currentSha,
    currentBytes:
      currentTarget.byteLength,
  };
}

function appendCorrectionMetadata(
  container,
  correction,
) {
  const current =
    Array.isArray(
      container.postStageCorrections,
    )
      ? container.postStageCorrections
      : [];

  const filtered =
    current.filter(
      (entry) =>
        entry?.id !==
        correction.id,
    );

  container.postStageCorrections =
    [
      ...filtered,
      correction,
    ];
}

function updateOperation(
  operation,
  currentSha,
  currentBytes,
  correction,
) {
  operation.bytes =
    currentBytes;

  operation.shaAfter =
    currentSha;

  operation.fileBytesAfter =
    currentBytes;

  operation.fileShaAfter =
    currentSha;

  operation.backupAfterPath =
    RECONCILED_AFTER_BACKUP_PATH;

  operation.backupAfterSha256 =
    currentSha;

  appendCorrectionMetadata(
    operation,
    correction,
  );
}

function isAlreadyReconciled(
  rootDir,
  stage13Operation,
  globalOperation,
  currentSha,
  currentBytes,
) {
  const fieldsMatch =
    stage13Operation.bytes ===
      currentBytes &&
    stage13Operation.shaAfter ===
      currentSha &&
    stage13Operation.fileBytesAfter ===
      currentBytes &&
    stage13Operation.fileShaAfter ===
      currentSha &&
    stage13Operation.backupAfterPath ===
      RECONCILED_AFTER_BACKUP_PATH &&
    stage13Operation.backupAfterSha256 ===
      currentSha &&
    globalOperation.bytes ===
      currentBytes &&
    globalOperation.shaAfter ===
      currentSha &&
    globalOperation.fileBytesAfter ===
      currentBytes &&
    globalOperation.fileShaAfter ===
      currentSha &&
    globalOperation.backupAfterPath ===
      RECONCILED_AFTER_BACKUP_PATH &&
    globalOperation.backupAfterSha256 ===
      currentSha;

  if (!fieldsMatch) {
    return false;
  }

  const backupAbsolute =
    fromPosixRelative(
      rootDir,
      RECONCILED_AFTER_BACKUP_PATH,
    );

  if (!fs.existsSync(backupAbsolute)) {
    return false;
  }

  return (
    sha256Buffer(
      fs.readFileSync(
        backupAbsolute,
      ),
    ) === currentSha
  );
}

function validateUnreconciledState(
  stage13Operation,
  globalOperation,
  fixReport,
) {
  for (
    const [
      label,
      operation,
    ] of
      [
        [
          "Stage 13",
          stage13Operation,
        ],
        [
          "Journal global",
          globalOperation,
        ],
      ]
  ) {
    if (
      operation.bytes !== 5068 ||
      operation.shaAfter !==
        fixReport.beforeSha256 ||
      operation.fileBytesAfter !==
        5068 ||
      operation.fileShaAfter !==
        fixReport.beforeSha256 ||
      operation.backupAfterSha256 !==
        fixReport.beforeSha256 ||
      operation.backupAfterPath !==
        ".migration/stage13/backups/after/src/engine/net/internal/SteamP2PTransport.ts"
    ) {
      fail(
        `${label} já divergiu do estado pré-reconciliação conhecido; nada foi alterado.`,
      );
    }
  }
}

function runRollbackDryRun(
  rootDir,
) {
  const rollbackAbsolute =
    fromPosixRelative(
      rootDir,
      ROLLBACK_SCRIPT_PATH,
    );

  if (!fs.existsSync(rollbackAbsolute)) {
    fail(
      `Rollback ausente: ${ROLLBACK_SCRIPT_PATH}`,
    );
  }

  const result =
    spawnSync(
      process.execPath,
      [
        rollbackAbsolute,
        "--dry-run",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        windowsHide: true,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  const stdout =
    String(
      result.stdout ?? "",
    );

  const stderr =
    String(
      result.stderr ?? "",
    );

  if (
    result.error ||
    (result.status ?? 1) !== 0
  ) {
    fail(
      [
        "O rollback --dry-run ainda falha após a reconciliação.",
        stdout.trim(),
        stderr.trim(),
      ]
        .filter(
          (line) =>
            line.length > 0,
        )
        .join("\n"),
    );
  }

  if (
    !stdout.includes(
      "DRY-RUN DE ROLLBACK CONCLUÍDO COM SUCESSO",
    )
  ) {
    fail(
      "Rollback --dry-run retornou código zero, mas não confirmou conclusão esperada.",
    );
  }

  return stdout;
}

function protectedSnapshot(
  rootDir,
) {
  const excludedTopLevel =
    new Set([
      ".git",
      ".migration",
      "node_modules",
      "dist",
      "coverage",
      "target",
    ]);

  const records =
    [];

  const stack =
    [
      rootDir,
    ];

  while (stack.length > 0) {
    const currentDir =
      stack.pop();

    if (
      currentDir === undefined
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
        entries.length - 1;
      index >= 0;
      index -= 1
    ) {
      const entry =
        entries[index];

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

      const topLevel =
        relativePath.split("/")[0];

      if (
        entry.isDirectory() &&
        excludedTopLevel.has(
          topLevel,
        )
      ) {
        continue;
      }

      if (
        relativePath.startsWith(
          "src-tauri/target/",
        ) ||
        relativePath.startsWith(
          ".cache/",
        ) ||
        relativePath.startsWith(
          ".turbo/",
        ) ||
        relativePath.startsWith(
          ".vite/",
        )
      ) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        records.push({
          path:
            relativePath,
          kind:
            "symlink",
          target:
            fs.readlinkSync(
              absolute,
            ),
        });

        continue;
      }

      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }

      if (entry.isFile()) {
        const stat =
          fs.statSync(absolute);

        records.push({
          path:
            relativePath,
          kind:
            "file",
          bytes:
            stat.size,
          sha256:
            sha256Buffer(
              fs.readFileSync(
                absolute,
              ),
            ),
        });
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
      semanticSha256(records),
  };
}

function restoreOriginal(
  rootDir,
  originals,
) {
  const errors =
    [];

  for (
    const [
      relativePath,
      original,
    ] of
      originals
  ) {
    try {
      const absolute =
        fromPosixRelative(
          rootDir,
          relativePath,
        );

      if (
        original === null
      ) {
        fs.rmSync(
          absolute,
          {
            force: true,
          },
        );
      } else {
        writeBufferAtomic(
          rootDir,
          relativePath,
          original,
        );
      }
    } catch (error) {
      errors.push(
        `${relativePath}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  return errors;
}

function main() {
  const rootDir =
    path.resolve(
      process.cwd(),
    );

  assertRepositoryRoot(rootDir);
  validateStage15(rootDir);

  const fixed =
    validateFixReport(rootDir);

  const stage13 =
    readJson(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  validateStage13Journal(stage13);

  const global =
    readJson(
      rootDir,
      V20_JOURNAL_PATH,
    );

  validateGlobalJournal(global);

  const stage13Operation =
    getUniqueTargetOperation(
      stage13.operations,
      "Journal da Etapa 13",
    );

  const globalOperation =
    getUniqueTargetOperation(
      global.operations,
      "Journal global v20",
    );

  const protectedBefore =
    protectedSnapshot(rootDir);

  if (
    isAlreadyReconciled(
      rootDir,
      stage13Operation,
      globalOperation,
      fixed.currentSha,
      fixed.currentBytes,
    )
  ) {
    const rollbackOutput =
      runRollbackDryRun(rootDir);

    const protectedAfter =
      protectedSnapshot(rootDir);

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        "Execução idempotente alterou arquivos fora de .migration.",
      );
    }

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — REPARO JÁ APLICADO",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] ${TARGET_PATH} já está reconciliado com os journals.`,
    );
    console.log(
      `[OK] SHA atual: ${fixed.currentSha}`,
    );
    console.log(
      "[OK] rollback --dry-run: aprovado.",
    );
    console.log(
      `[OK] Digest protegido: ${protectedAfter.digest}`,
    );
    console.log("");
    console.log(
      rollbackOutput.trim(),
    );
    return;
  }

  validateUnreconciledState(
    stage13Operation,
    globalOperation,
    fixed.report,
  );

  const originalStage13 =
    readBuffer(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  const originalGlobal =
    readBuffer(
      rootDir,
      V20_JOURNAL_PATH,
    );

  const reconciledAfterAbsolute =
    fromPosixRelative(
      rootDir,
      RECONCILED_AFTER_BACKUP_PATH,
    );

  const reconciliationReportAbsolute =
    fromPosixRelative(
      rootDir,
      RECONCILIATION_REPORT_PATH,
    );

  const originals =
    new Map([
      [
        STAGE13_JOURNAL_PATH,
        originalStage13,
      ],
      [
        V20_JOURNAL_PATH,
        originalGlobal,
      ],
      [
        RECONCILED_AFTER_BACKUP_PATH,
        fs.existsSync(
          reconciledAfterAbsolute,
        )
          ? fs.readFileSync(
              reconciledAfterAbsolute,
            )
          : null,
      ],
      [
        RECONCILIATION_REPORT_PATH,
        fs.existsSync(
          reconciliationReportAbsolute,
        )
          ? fs.readFileSync(
              reconciliationReportAbsolute,
            )
          : null,
      ],
    ]);

  const now =
    new Date().toISOString();

  const correction = {
    id:
      FIX_NAME,
    appliedAtUtc:
      now,
    target:
      TARGET_PATH,
    previousExpectedSha256:
      fixed.report.beforeSha256,
    reconciledExpectedSha256:
      fixed.currentSha,
    reconciledExpectedBytes:
      fixed.currentBytes,
    sourceFixReport:
      FIX_REPORT_PATH,
    sourceFixBeforeBackup:
      FIX_BEFORE_BACKUP_PATH,
    reconciledAfterBackup:
      RECONCILED_AFTER_BACKUP_PATH,
    reason:
      "A correção typed-boundary-fix foi aplicada após a Etapa 13; o rollback v5 ainda esperava o SHA anterior e classificava SteamP2PTransport.ts como conflict.",
  };

  try {
    writeBufferAtomic(
      rootDir,
      RECONCILED_AFTER_BACKUP_PATH,
      fixed.currentTarget,
    );

    updateOperation(
      stage13Operation,
      fixed.currentSha,
      fixed.currentBytes,
      correction,
    );

    stage13.updatedAtUtc =
      now;

    appendCorrectionMetadata(
      stage13,
      correction,
    );

    stage13.operationsIdentitySha256 =
      semanticSha256(
        stage13.operations.map(
          (operation) =>
            identityV3(operation),
        ),
      );

    writeJsonAtomic(
      rootDir,
      STAGE13_JOURNAL_PATH,
      stage13,
    );

    updateOperation(
      globalOperation,
      fixed.currentSha,
      fixed.currentBytes,
      correction,
    );

    global.updatedAtUtc =
      now;

    appendCorrectionMetadata(
      global,
      correction,
    );

    global.operationsIdentitySha256 =
      semanticSha256(
        global.operations.map(
          (operation) =>
            identityV5(operation),
        ),
      );

    writeJsonAtomic(
      rootDir,
      V20_JOURNAL_PATH,
      global,
    );

    const persistedStage13 =
      readJson(
        rootDir,
        STAGE13_JOURNAL_PATH,
      );

    const persistedGlobal =
      readJson(
        rootDir,
        V20_JOURNAL_PATH,
      );

    validateStage13Journal(
      persistedStage13,
    );

    validateGlobalJournal(
      persistedGlobal,
    );

    const persistedAfterBackup =
      readBuffer(
        rootDir,
        RECONCILED_AFTER_BACKUP_PATH,
      );

    if (
      sha256Buffer(
        persistedAfterBackup,
      ) !==
      fixed.currentSha
    ) {
      fail(
        "Backup reconciliado pós-fix divergiu.",
      );
    }

    const targetAfter =
      readBuffer(
        rootDir,
        TARGET_PATH,
      );

    if (
      sha256Buffer(
        targetAfter,
      ) !==
      fixed.currentSha ||
      targetAfter.byteLength !==
      fixed.currentBytes
    ) {
      fail(
        "O reparo de journals alterou o arquivo-fonte, o que é proibido.",
      );
    }

    const rollbackOutput =
      runRollbackDryRun(rootDir);

    const protectedAfter =
      protectedSnapshot(rootDir);

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "O reparo alterou conteúdo fora de .migration.",
          `Digest antes: ${protectedBefore.digest}`,
          `Digest depois: ${protectedAfter.digest}`,
        ].join("\n"),
      );
    }

    const report = {
      schemaVersion: 1,
      kind:
        "post-stage-journal-reconciliation",
      id:
        FIX_NAME,
      status:
        "completed",
      completedAtUtc:
        now,
      target:
        TARGET_PATH,
      sourceFixReport:
        FIX_REPORT_PATH,
      sourceFixBeforeSha256:
        fixed.report.beforeSha256,
      fixedSourceSha256:
        fixed.currentSha,
      fixedSourceBytes:
        fixed.currentBytes,
      stage13: {
        journal:
          STAGE13_JOURNAL_PATH,
        operationSequence:
          EXPECTED_STAGE13_SEQUENCE,
        previousExpectedSha256:
          EXPECTED_STAGE13_OLD_AFTER_SHA,
        reconciledExpectedSha256:
          fixed.currentSha,
        reconciledExpectedBytes:
          fixed.currentBytes,
        reconciledAfterBackup:
          RECONCILED_AFTER_BACKUP_PATH,
        operationsIdentitySha256:
          persistedStage13.operationsIdentitySha256,
      },
      global: {
        journal:
          V20_JOURNAL_PATH,
        schemaVersion:
          persistedGlobal.schemaVersion,
        totalOperations:
          persistedGlobal.operations.length,
        operationsIdentitySha256:
          persistedGlobal.operationsIdentitySha256,
      },
      rollbackDryRun: {
        command:
          "node scripts/architecture/rollback-migration.mjs --dry-run",
        passed:
          true,
      },
      protectedDigest: {
        before:
          protectedBefore.digest,
        after:
          protectedAfter.digest,
      },
    };

    writeJsonAtomic(
      rootDir,
      RECONCILIATION_REPORT_PATH,
      report,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — REPARO DE CONSISTÊNCIA DO ROLLBACK",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Fonte preservada: ${TARGET_PATH}`,
    );
    console.log(
      `[OK] SHA corrigido preservado: ${fixed.currentSha}`,
    );
    console.log(
      `[OK] Bytes: ${String(fixed.currentBytes)}`,
    );
    console.log(
      `[OK] Stage 13 reconciliado: operação sequence ${String(EXPECTED_STAGE13_SEQUENCE)}.`,
    );
    console.log(
      `[OK] Backup pós-fix: ${RECONCILED_AFTER_BACKUP_PATH}`,
    );
    console.log(
      `[OK] Journal Stage 13: ${STAGE13_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global: ${V20_JOURNAL_PATH} (${String(EXPECTED_GLOBAL_OPERATION_COUNT)} operações)`,
    );
    console.log(
      `[OK] Relatório: ${RECONCILIATION_REPORT_PATH}`,
    );
    console.log(
      `[OK] Digest protegido antes: ${protectedBefore.digest}`,
    );
    console.log(
      `[OK] Digest protegido depois: ${protectedAfter.digest}`,
    );
    console.log(
      "[OK] Nenhum arquivo de src/, scripts/, tests/ ou configuração foi alterado.",
    );
    console.log("");
    console.log(
      "=== VALIDAÇÃO DO ROLLBACK ===",
    );
    console.log(
      rollbackOutput.trim(),
    );
    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  REPARO CONCLUÍDO COM SUCESSO",
    );
    console.log(
      "============================================================",
    );
  } catch (error) {
    const restoreErrors =
      restoreOriginal(
        rootDir,
        originals,
      );

    const originalMessage =
      error instanceof Error
        ? (
            error.stack ??
            error.message
          )
        : String(error);

    if (
      restoreErrors.length === 0
    ) {
      fail(
        [
          originalMessage,
          "[OK] Compensação restaurou journals/backups ao estado anterior ao reparo.",
        ].join("\n"),
      );
    }

    fail(
      [
        originalMessage,
        `Compensação encontrou ${String(restoreErrors.length)} erro(s):`,
        ...restoreErrors.map(
          (message) =>
            `  - ${message}`,
        ),
        "Não continue automaticamente.",
      ].join("\n"),
    );
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(
    "[ERRO] Reparo não concluído.",
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
