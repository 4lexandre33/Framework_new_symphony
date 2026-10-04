#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK_NAME =
  "rollback-migration-v20-v4";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const STAGE10_MOVE_TRANSFORMATION =
  "move-engine-implementation-to-module-internal";

const STAGE12_EXTRACTION_TRANSFORMATION =
  "extract-plugin-implementation";

const STAGE13_REWRITE_TRANSFORMATION =
  "rewrite-relative-module-specifiers";

const STAGE14_FACADE_TRANSFORMATION =
  "create-public-facade";

const EXPECTED_STAGE10_MOVE_COUNT =
  93;

const EXPECTED_STAGE12_EXTRACTION_COUNT =
  21;

const EXPECTED_STAGE13_REWRITE_COUNT =
  108;

const EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT =
  163;

const EXPECTED_STAGE14_FACADE_COUNT =
  23;

const EXPECTED_STAGE14_EXPORT_STATEMENT_COUNT =
  48;

const EXPECTED_WORKER_COUNT =
  2;

const EXPECTED_STAGE10_BYTES =
  396456;

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE10_JOURNAL_PATH =
  ".migration/stage10/move-journal.json";

const STAGE12_JOURNAL_PATH =
  ".migration/stage12/extraction-journal.json";

const STAGE13_JOURNAL_PATH =
  ".migration/stage13/rewrite-journal.json";

const STAGE14_JOURNAL_PATH =
  ".migration/stage14/facade-journal.json";

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

function parseArguments(
  argv,
) {
  if (
    argv.length ===
      1 &&
    argv[0] ===
      "--dry-run"
  ) {
    return {
      help: false,
      mode: "dry-run",
    };
  }

  if (
    argv.length ===
      1 &&
    argv[0] ===
      "--apply"
  ) {
    return {
      help: false,
      mode: "apply",
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
      mode: null,
    };
  }

  fail(
    [
      "O rollback exige modo explícito.",
      "Uso:",
      "  node scripts/architecture/rollback-migration.mjs --dry-run",
      "  node scripts/architecture/rollback-migration.mjs --apply",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — rollback da migração arquitetural v20

Uso:
  node scripts/architecture/rollback-migration.mjs --dry-run
  node scripts/architecture/rollback-migration.mjs --apply

Suporta:
  - Etapa 10: 93 moves para src/engine/<module>/internal/**;
  - Etapa 12: 21 extrações plugin -> internal, quando presentes no journal global.
  - Etapa 13: 108 arquivos com specifiers relativos reescritos, quando presentes no journal global;
  - Etapa 14: 23 fachadas public/index.ts, quando presentes no journal global.

Ordem de rollback:
  1. Etapa 14, em ordem reversa;
  2. Etapa 13, em ordem reversa;
  3. Etapa 12, em ordem reversa;
  4. Etapa 10, em ordem reversa.

O rollback NÃO usa Git.
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
      sourceStage:
        12,
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
    `Transformação não suportada: ${String(operation.transformation)}`,
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

function validateV20Journal(
  journal,
) {
  if (
    journal.journal !==
      "v20-architecture-migration-journal" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    !Array.isArray(
      journal.operations,
    )
  ) {
    fail(
      `Journal global inválido: ${V20_JOURNAL_PATH}`,
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

  const facades =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE14_FACADE_TRANSFORMATION,
    );

  if (
    moves.length !==
      EXPECTED_STAGE10_MOVE_COUNT
  ) {
    fail(
      `Journal global deveria conter ${String(EXPECTED_STAGE10_MOVE_COUNT)} moves da Etapa 10.`,
    );
  }

  const workers =
    moves.filter(
      (operation) =>
        operation.isWorker ===
        true,
    ).length;

  const moveBytes =
    moves.reduce(
      (
        sum,
        operation,
      ) =>
        sum +
        operation.bytes,
      0,
    );

  if (
    workers !==
      EXPECTED_WORKER_COUNT ||
    moveBytes !==
      EXPECTED_STAGE10_BYTES
  ) {
    fail(
      "Escopo da Etapa 10 no journal global divergiu.",
    );
  }

  if (
    journal.schemaVersion ===
      1
  ) {
    if (
      extractions.length !==
        0 ||
      rewrites.length !==
        0 ||
      facades.length !==
        0 ||
      journal.operations.length !==
        EXPECTED_STAGE10_MOVE_COUNT
    ) {
      fail(
        "Schema v1 só pode conter as 93 operações da Etapa 10.",
      );
    }

    const digest =
      semanticSha256(
        journal.operations.map(
          (operation) =>
            stage11IdentityV1(
              operation,
            ),
        ),
      );

    if (
      digest !==
      journal.operationsIdentitySha256
    ) {
      fail(
        "operationsIdentitySha256 v1 divergiu.",
      );
    }
  } else if (
    journal.schemaVersion ===
      2
  ) {
    if (
      extractions.length !==
        EXPECTED_STAGE12_EXTRACTION_COUNT ||
      rewrites.length !==
        0 ||
      facades.length !==
        0 ||
      journal.operations.length !==
        EXPECTED_STAGE10_MOVE_COUNT +
        EXPECTED_STAGE12_EXTRACTION_COUNT
    ) {
      fail(
        "Schema v2 deveria conter 93 moves + 21 extrações.",
      );
    }

    const digest =
      semanticSha256(
        journal.operations.map(
          (operation) =>
            identityV2(
              operation,
            ),
        ),
      );

    if (
      digest !==
      journal.operationsIdentitySha256
    ) {
      fail(
        "operationsIdentitySha256 v2 divergiu.",
      );
    }

    for (
      const operation of
        extractions
    ) {
      for (
        const relativePath of
          [
            operation.pluginPath,
            operation.implementationPath,
            operation.backupBeforePath,
            operation.backupAfterPath,
            operation.implementationBackupPath,
          ]
      ) {
        assertSafeRelativePath(
          relativePath,
          "Path da extração",
        );
      }

      if (
        !Array.isArray(
          operation.exportedNames,
        ) ||
        operation.exportedNames.length <
          1 ||
        operation.pluginPath !==
          operation.oldPath ||
        operation.implementationPath !==
          operation.newPath ||
        !/^[a-f0-9]{64}$/u.test(
          operation.pluginShaBefore,
        ) ||
        !/^[a-f0-9]{64}$/u.test(
          operation.pluginShaAfter,
        ) ||
        !/^[a-f0-9]{64}$/u.test(
          operation.implementationShaAfter,
        )
      ) {
        fail(
          `Entrada de extração inválida: ${String(operation.moduleKey)}`,
        );
      }
    }
  } else if (
    journal.schemaVersion ===
      3
  ) {
    if (
      extractions.length !==
        EXPECTED_STAGE12_EXTRACTION_COUNT ||
      rewrites.length !==
        EXPECTED_STAGE13_REWRITE_COUNT ||
      facades.length !==
        0 ||
      journal.operations.length !==
        EXPECTED_STAGE10_MOVE_COUNT +
        EXPECTED_STAGE12_EXTRACTION_COUNT +
        EXPECTED_STAGE13_REWRITE_COUNT ||
      journal.counts?.stage13RewriteFiles !==
        EXPECTED_STAGE13_REWRITE_COUNT ||
      journal.counts?.stage13SpecifierRewrites !==
        EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT
    ) {
      fail(
        "Schema v3 deveria conter 93 moves + 21 extrações + 108 rewrites.",
      );
    }

    const digest =
      semanticSha256(
        journal.operations.map(
          (operation) =>
            identityV3(
              operation,
            ),
        ),
      );

    if (
      digest !==
      journal.operationsIdentitySha256
    ) {
      fail(
        "operationsIdentitySha256 v3 divergiu.",
      );
    }

    for (
      const operation of
        extractions
    ) {
      for (
        const relativePath of
          [
            operation.pluginPath,
            operation.implementationPath,
            operation.backupBeforePath,
            operation.backupAfterPath,
            operation.implementationBackupPath,
          ]
      ) {
        assertSafeRelativePath(
          relativePath,
          "Path da extração",
        );
      }
    }

    for (
      const operation of
        rewrites
    ) {
      for (
        const relativePath of
          [
            operation.filePath,
            operation.backupBeforePath,
            operation.backupAfterPath,
          ]
      ) {
        assertSafeRelativePath(
          relativePath,
          "Path do rewrite",
        );
      }

      if (
        operation.filePath !==
          operation.oldPath ||
        operation.filePath !==
          operation.newPath ||
        !Array.isArray(
          operation.edits,
        ) ||
        operation.edits.length <
          1 ||
        !/^[a-f0-9]{64}$/u.test(
          operation.fileShaBefore,
        ) ||
        !/^[a-f0-9]{64}$/u.test(
          operation.fileShaAfter,
        )
      ) {
        fail(
          `Entrada de rewrite inválida: ${String(operation.filePath)}`,
        );
      }
    }
  } else if (
    journal.schemaVersion ===
      4
  ) {
    if (
      extractions.length !==
        EXPECTED_STAGE12_EXTRACTION_COUNT ||
      rewrites.length !==
        EXPECTED_STAGE13_REWRITE_COUNT ||
      facades.length !==
        EXPECTED_STAGE14_FACADE_COUNT ||
      journal.operations.length !==
        EXPECTED_STAGE10_MOVE_COUNT +
        EXPECTED_STAGE12_EXTRACTION_COUNT +
        EXPECTED_STAGE13_REWRITE_COUNT +
        EXPECTED_STAGE14_FACADE_COUNT ||
      journal.counts?.stage13RewriteFiles !==
        EXPECTED_STAGE13_REWRITE_COUNT ||
      journal.counts?.stage13SpecifierRewrites !==
        EXPECTED_STAGE13_SPECIFIER_REWRITE_COUNT ||
      journal.counts?.stage14PublicFacades !==
        EXPECTED_STAGE14_FACADE_COUNT ||
      journal.counts?.stage14ExportStatements !==
        EXPECTED_STAGE14_EXPORT_STATEMENT_COUNT ||
      journal.counts?.stage14InternalReexports !==
        0 ||
      journal.counts?.stage14ForbiddenConcreteExports !==
        0
    ) {
      fail(
        "Schema v4 deveria conter 93 moves + 21 extrações + 108 rewrites + 23 fachadas.",
      );
    }

    const digest =
      semanticSha256(
        journal.operations.map(
          (operation) =>
            identityV4(
              operation,
            ),
        ),
      );

    if (
      digest !==
      journal.operationsIdentitySha256
    ) {
      fail(
        "operationsIdentitySha256 v4 divergiu.",
      );
    }

    for (
      const operation of
        facades
    ) {
      if (
        !Array.isArray(
          operation.contractTargets,
        ) ||
        !Array.isArray(
          operation.tokenTargets,
        )
      ) {
        fail(
          `Entrada de fachada sem targets: ${String(operation.filePath)}`,
        );
      }

      for (
        const relativePath of
          [
            operation.filePath,
            operation.backupAfterPath,
            ...operation.contractTargets,
            ...operation.tokenTargets,
          ]
      ) {
        assertSafeRelativePath(
          relativePath,
          "Path da fachada",
        );
      }

      if (
        operation.filePath !==
          operation.oldPath ||
        operation.filePath !==
          operation.newPath ||
        !operation.filePath.endsWith(
          "/public/index.ts",
        ) ||
        operation.shaBefore !==
          null ||
        operation.contractTargets.length <
          1 ||
        operation.tokenTargets.length <
          1 ||
        !Array.isArray(
          operation.exportSpecifiers,
        ) ||
        operation.exportSpecifiers.length !==
          operation.contractTargets.length +
          operation.tokenTargets.length ||
        !/^[a-f0-9]{64}$/u.test(
          operation.fileShaAfter,
        ) ||
        operation.fileShaAfter !==
          operation.shaAfter ||
        operation.backupAfterSha256 !==
          operation.fileShaAfter
      ) {
        fail(
          `Entrada de fachada inválida: ${String(operation.filePath)}`,
        );
      }
    }
  } else {
    fail(
      `Schema do journal global não suportado: ${String(journal.schemaVersion)}`,
    );
  }

  return {
    moves,
    extractions,
    rewrites,
    facades,
  };
}

function validateBackup(
  rootDir,
  relativePath,
  expectedSha,
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
      `Backup inválido para rollback: ${relativePath}`,
    );
  }
}

function classifyMove(
  rootDir,
  operation,
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
    oldInfo.kind ===
      "file" &&
    oldInfo.bytes ===
      operation.bytes &&
    oldInfo.sha256 ===
      operation.shaBefore;

  const newMatches =
    newInfo.kind ===
      "file" &&
    newInfo.bytes ===
      operation.bytes &&
    newInfo.sha256 ===
      operation.shaAfter;

  if (
    !oldInfo.exists &&
    newMatches
  ) {
    return {
      state: "applied",
      oldInfo,
      newInfo,
    };
  }

  if (
    oldMatches &&
    !newInfo.exists
  ) {
    return {
      state: "rolled-back",
      oldInfo,
      newInfo,
    };
  }

  return {
    state: "conflict",
    oldInfo,
    newInfo,
  };
}

function classifyExtraction(
  rootDir,
  operation,
) {
  validateBackup(
    rootDir,
    operation.backupBeforePath,
    operation.backupBeforeSha256,
  );

  validateBackup(
    rootDir,
    operation.backupAfterPath,
    operation.backupAfterSha256,
  );

  validateBackup(
    rootDir,
    operation.implementationBackupPath,
    operation.implementationBackupSha256,
  );

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

  const applied =
    pluginInfo.kind ===
      "file" &&
    pluginInfo.sha256 ===
      operation.pluginShaAfter &&
    implementationInfo.kind ===
      "file" &&
    implementationInfo.sha256 ===
      operation.implementationShaAfter;

  if (
    applied
  ) {
    return {
      state: "applied",
      pluginInfo,
      implementationInfo,
    };
  }

  const rolledBack =
    pluginInfo.kind ===
      "file" &&
    pluginInfo.sha256 ===
      operation.pluginShaBefore &&
    !implementationInfo.exists;

  if (
    rolledBack
  ) {
    return {
      state: "rolled-back",
      pluginInfo,
      implementationInfo,
    };
  }

  return {
    state: "conflict",
    pluginInfo,
    implementationInfo,
  };
}


function classifyRewrite(
  rootDir,
  operation,
) {
  validateBackup(
    rootDir,
    operation.backupBeforePath,
    operation.backupBeforeSha256,
  );

  validateBackup(
    rootDir,
    operation.backupAfterPath,
    operation.backupAfterSha256,
  );

  const fileInfo =
    inspectRegularFile(
      fromPosixRelative(
        rootDir,
        operation.filePath,
      ),
    );

  if (
    fileInfo.kind ===
      "file" &&
    fileInfo.bytes ===
      operation.fileBytesAfter &&
    fileInfo.sha256 ===
      operation.fileShaAfter
  ) {
    return {
      state: "applied",
      fileInfo,
    };
  }

  if (
    fileInfo.kind ===
      "file" &&
    fileInfo.bytes ===
      operation.fileBytesBefore &&
    fileInfo.sha256 ===
      operation.fileShaBefore
  ) {
    return {
      state: "rolled-back",
      fileInfo,
    };
  }

  return {
    state: "conflict",
    fileInfo,
  };
}



function classifyFacade(
  rootDir,
  operation,
) {
  validateBackup(
    rootDir,
    operation.backupAfterPath,
    operation.backupAfterSha256,
  );

  const fileInfo =
    inspectRegularFile(
      fromPosixRelative(
        rootDir,
        operation.filePath,
      ),
    );

  if (
    fileInfo.kind ===
      "file" &&
    fileInfo.bytes ===
      operation.fileBytesAfter &&
    fileInfo.sha256 ===
      operation.fileShaAfter
  ) {
    return {
      state: "applied",
      fileInfo,
    };
  }

  if (
    !fileInfo.exists
  ) {
    return {
      state: "rolled-back",
      fileInfo,
    };
  }

  return {
    state: "conflict",
    fileInfo,
  };
}

function matchesExpectedFile(
  info,
  bytes,
  sha256,
) {
  return (
    info.kind ===
      "file" &&
    info.bytes ===
      bytes &&
    info.sha256 ===
      sha256
  );
}

function classifyMoveLayered(
  rootDir,
  operation,
  rewriteDirectByPath,
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
      operation.bytes,
      operation.shaBefore,
    );

  const newMatchesBase =
    matchesExpectedFile(
      newInfo,
      operation.bytes,
      operation.shaAfter,
    );

  if (
    !oldInfo.exists &&
    newMatchesBase
  ) {
    return {
      state: "applied",
      oldInfo,
      newInfo,
    };
  }

  const rewriteRecord =
    rewriteDirectByPath.get(
      operation.newPath,
    );

  if (
    !oldInfo.exists &&
    rewriteRecord?.state ===
      "applied" &&
    rewriteRecord.operation.fileShaBefore ===
      operation.shaAfter &&
    rewriteRecord.operation.fileBytesBefore ===
      operation.bytes &&
    matchesExpectedFile(
      newInfo,
      rewriteRecord.operation.fileBytesAfter,
      rewriteRecord.operation.fileShaAfter,
    )
  ) {
    return {
      state: "applied",
      oldInfo,
      newInfo,
      overlaidByStage13: true,
    };
  }

  if (
    oldMatches &&
    !newInfo.exists
  ) {
    return {
      state: "rolled-back",
      oldInfo,
      newInfo,
    };
  }

  return {
    state: "conflict",
    oldInfo,
    newInfo,
  };
}

function matchesExtractionPathWithOptionalRewrite(
  info,
  expectedSha,
  rewriteRecord,
) {
  if (
    info.kind ===
      "file" &&
    info.sha256 ===
      expectedSha
  ) {
    return true;
  }

  return (
    rewriteRecord?.state ===
      "applied" &&
    rewriteRecord.operation.fileShaBefore ===
      expectedSha &&
    info.kind ===
      "file" &&
    info.sha256 ===
      rewriteRecord.operation.fileShaAfter
  );
}

function classifyExtractionLayered(
  rootDir,
  operation,
  rewriteDirectByPath,
) {
  validateBackup(
    rootDir,
    operation.backupBeforePath,
    operation.backupBeforeSha256,
  );

  validateBackup(
    rootDir,
    operation.backupAfterPath,
    operation.backupAfterSha256,
  );

  validateBackup(
    rootDir,
    operation.implementationBackupPath,
    operation.implementationBackupSha256,
  );

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

  const pluginRewrite =
    rewriteDirectByPath.get(
      operation.pluginPath,
    );

  const implementationRewrite =
    rewriteDirectByPath.get(
      operation.implementationPath,
    );

  const applied =
    matchesExtractionPathWithOptionalRewrite(
      pluginInfo,
      operation.pluginShaAfter,
      pluginRewrite,
    ) &&
    matchesExtractionPathWithOptionalRewrite(
      implementationInfo,
      operation.implementationShaAfter,
      implementationRewrite,
    );

  if (
    applied
  ) {
    return {
      state: "applied",
      pluginInfo,
      implementationInfo,
    };
  }

  const rolledBack =
    pluginInfo.kind ===
      "file" &&
    pluginInfo.sha256 ===
      operation.pluginShaBefore &&
    !implementationInfo.exists;

  if (
    rolledBack
  ) {
    return {
      state: "rolled-back",
      pluginInfo,
      implementationInfo,
    };
  }

  return {
    state: "conflict",
    pluginInfo,
    implementationInfo,
  };
}

function inspectState(
  rootDir,
  operations,
) {
  const rewriteOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE13_REWRITE_TRANSFORMATION,
    );

  const moveOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE10_MOVE_TRANSFORMATION,
    );

  const extractionOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE12_EXTRACTION_TRANSFORMATION,
    );

  const facadeOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE14_FACADE_TRANSFORMATION,
    );

  const facadeByPath =
    new Map();

  for (
    const operation of
      facadeOperations
  ) {
    facadeByPath.set(
      operation.filePath,
      {
        operation,
        ...classifyFacade(
          rootDir,
          operation,
        ),
      },
    );
  }

  const rewriteDirectByPath =
    new Map();

  for (
    const operation of
      rewriteOperations
  ) {
    rewriteDirectByPath.set(
      operation.filePath,
      {
        operation,
        ...classifyRewrite(
          rootDir,
          operation,
        ),
      },
    );
  }

  const moveByNewPath =
    new Map();

  for (
    const operation of
      moveOperations
  ) {
    moveByNewPath.set(
      operation.newPath,
      {
        operation,
        ...classifyMoveLayered(
          rootDir,
          operation,
          rewriteDirectByPath,
        ),
      },
    );
  }

  const extractionByPluginPath =
    new Map();

  const extractionByImplementationPath =
    new Map();

  for (
    const operation of
      extractionOperations
  ) {
    const record =
      {
        operation,
        ...classifyExtractionLayered(
          rootDir,
          operation,
          rewriteDirectByPath,
        ),
      };

    extractionByPluginPath.set(
      operation.pluginPath,
      record,
    );

    extractionByImplementationPath.set(
      operation.implementationPath,
      record,
    );
  }

  const rewriteFinalByPath =
    new Map();

  for (
    const operation of
      rewriteOperations
  ) {
    const direct =
      rewriteDirectByPath.get(
        operation.filePath,
      );

    if (
      direct ===
      undefined
    ) {
      fail(
        `Estado direto de rewrite ausente: ${operation.filePath}`,
      );
    }

    if (
      direct.state ===
        "applied" ||
      direct.state ===
        "rolled-back"
    ) {
      rewriteFinalByPath.set(
        operation.filePath,
        direct,
      );
      continue;
    }

    const moveRecord =
      moveByNewPath.get(
        operation.filePath,
      );

    if (
      moveRecord?.state ===
        "rolled-back" &&
      operation.fileShaBefore ===
        moveRecord.operation.shaAfter
    ) {
      rewriteFinalByPath.set(
        operation.filePath,
        {
          operation,
          state: "rolled-back",
          layeredByStage10Rollback: true,
          fileInfo:
            direct.fileInfo,
        },
      );
      continue;
    }

    const extractionImplementation =
      extractionByImplementationPath.get(
        operation.filePath,
      );

    if (
      extractionImplementation?.state ===
        "rolled-back" &&
      operation.fileShaBefore ===
        extractionImplementation.operation.implementationShaAfter
    ) {
      rewriteFinalByPath.set(
        operation.filePath,
        {
          operation,
          state: "rolled-back",
          layeredByStage12Rollback: true,
          fileInfo:
            direct.fileInfo,
        },
      );
      continue;
    }

    const extractionPlugin =
      extractionByPluginPath.get(
        operation.filePath,
      );

    if (
      extractionPlugin?.state ===
        "rolled-back" &&
      operation.fileShaBefore ===
        extractionPlugin.operation.pluginShaAfter
    ) {
      rewriteFinalByPath.set(
        operation.filePath,
        {
          operation,
          state: "rolled-back",
          layeredByStage12Rollback: true,
          fileInfo:
            direct.fileInfo,
        },
      );
      continue;
    }

    rewriteFinalByPath.set(
      operation.filePath,
      direct,
    );
  }

  const records =
    operations.map(
      (operation) => {
        if (
          operation.transformation ===
          STAGE10_MOVE_TRANSFORMATION
        ) {
          return moveByNewPath.get(
            operation.newPath,
          );
        }

        if (
          operation.transformation ===
          STAGE12_EXTRACTION_TRANSFORMATION
        ) {
          return extractionByPluginPath.get(
            operation.pluginPath,
          );
        }

        if (
          operation.transformation ===
          STAGE13_REWRITE_TRANSFORMATION
        ) {
          return rewriteFinalByPath.get(
            operation.filePath,
          );
        }

        if (
          operation.transformation ===
          STAGE14_FACADE_TRANSFORMATION
        ) {
          return facadeByPath.get(
            operation.filePath,
          );
        }

        fail(
          `Transformação desconhecida durante inspeção: ${String(operation.transformation)}`,
        );
      },
    );

  if (
    records.some(
      (record) =>
        record ===
        undefined,
    )
  ) {
    fail(
      "Inspeção de rollback produziu record indefinido.",
    );
  }

  return {
    records,
    applied:
      records.filter(
        (record) =>
          record.state ===
          "applied",
      ),
    rolledBack:
      records.filter(
        (record) =>
          record.state ===
          "rolled-back",
      ),
    conflicts:
      records.filter(
        (record) =>
          record.state ===
          "conflict",
      ),
  };
}

function assertNoConflicts(
  state,
) {
  if (
    state.conflicts.length ===
    0
  ) {
    return;
  }

  const details =
    state.conflicts
      .slice(
        0,
        20,
      )
      .map(
        (
          record,
          index,
        ) =>
          `${String(index + 1)}. ${record.operation.transformation} | ${record.operation.oldPath} -> ${record.operation.newPath}`,
      );

  fail(
    [
      `Rollback bloqueado por ${String(state.conflicts.length)} conflito(s).`,
      ...details,
      state.conflicts.length >
        20
        ? `... e mais ${String(state.conflicts.length - 20)} conflito(s).`
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

function loadOptionalJournal(
  rootDir,
  relativePath,
) {
  const absolute =
    fromPosixRelative(
      rootDir,
      relativePath,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return null;
  }

  const stat =
    fs.lstatSync(
      absolute,
    );

  if (
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    fail(
      `Journal auxiliar inválido: ${relativePath}`,
    );
  }

  return readJson(
    absolute,
    relativePath,
  );
}

function snapshotJournalBuffers(
  rootDir,
) {
  const result =
    new Map();

  for (
    const relativePath of
      [
        V20_JOURNAL_PATH,
        STAGE10_JOURNAL_PATH,
        STAGE12_JOURNAL_PATH,
        STAGE13_JOURNAL_PATH,
        STAGE14_JOURNAL_PATH,
      ]
  ) {
    const absolute =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    result.set(
      relativePath,
      fs.existsSync(
        absolute,
      )
        ? fs.readFileSync(
            absolute,
          )
        : null,
    );
  }

  return result;
}

function restoreJournalBuffers(
  rootDir,
  buffers,
) {
  for (
    const [
      relativePath,
      buffer,
    ] of
      buffers
  ) {
    const absolute =
      fromPosixRelative(
        rootDir,
        relativePath,
      );

    if (
      buffer ===
      null
    ) {
      fs.rmSync(
        absolute,
        {
          force: true,
        },
      );
    } else {
      writeFileAtomic(
        absolute,
        buffer,
      );
    }
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
  operations,
) {
  const mutable =
    new Set();

  for (
    const operation of
      operations
  ) {
    if (
      operation.transformation ===
      STAGE10_MOVE_TRANSFORMATION
    ) {
      mutable.add(
        operation.oldPath,
      );
      mutable.add(
        operation.newPath,
      );
    } else if (
      operation.transformation ===
      STAGE12_EXTRACTION_TRANSFORMATION
    ) {
      mutable.add(
        operation.pluginPath,
      );
      mutable.add(
        operation.implementationPath,
      );
    } else if (
      operation.transformation ===
      STAGE13_REWRITE_TRANSFORMATION
    ) {
      mutable.add(
        operation.filePath,
      );
    } else if (
      operation.transformation ===
      STAGE14_FACADE_TRANSFORMATION
    ) {
      mutable.add(
        operation.filePath,
      );
    }
  }

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
            kind:
              "symlink",
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




function rollbackFacade(
  rootDir,
  operation,
) {
  const current =
    classifyFacade(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "rolled-back"
  ) {
    return;
  }

  if (
    current.state !==
      "applied"
  ) {
    fail(
      `Fachada não está em estado aplicável a rollback: ${operation.filePath}`,
    );
  }

  fs.rmSync(
    fromPosixRelative(
      rootDir,
      operation.filePath,
    ),
    {
      force: true,
    },
  );

  const finalState =
    classifyFacade(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "rolled-back"
  ) {
    fail(
      `Verificação pós-rollback falhou para fachada: ${operation.filePath}`,
    );
  }
}

function reapplyFacade(
  rootDir,
  operation,
) {
  const current =
    classifyFacade(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "applied"
  ) {
    return;
  }

  if (
    current.state !==
      "rolled-back"
  ) {
    fail(
      `Fachada não pode ser reaplicada durante compensação: ${operation.filePath}`,
    );
  }

  const backup =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.backupAfterPath,
      ),
    );

  if (
    sha256Buffer(
      backup,
    ) !==
    operation.fileShaAfter
  ) {
    fail(
      `Backup after divergiu durante compensação: ${operation.backupAfterPath}`,
    );
  }

  writeFileAtomic(
    fromPosixRelative(
      rootDir,
      operation.filePath,
    ),
    backup,
  );

  const finalState =
    classifyFacade(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "applied"
  ) {
    fail(
      `Compensação não reaplicou fachada: ${operation.filePath}`,
    );
  }
}

function rollbackRewrite(
  rootDir,
  operation,
) {
  const current =
    classifyRewrite(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "rolled-back"
  ) {
    return;
  }

  if (
    current.state !==
      "applied"
  ) {
    fail(
      `Rewrite não está em estado aplicável a rollback: ${operation.filePath}`,
    );
  }

  const beforeBuffer =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.backupBeforePath,
      ),
    );

  if (
    sha256Buffer(
      beforeBuffer,
    ) !==
    operation.fileShaBefore
  ) {
    fail(
      `Backup before divergiu: ${operation.backupBeforePath}`,
    );
  }

  writeFileAtomic(
    fromPosixRelative(
      rootDir,
      operation.filePath,
    ),
    beforeBuffer,
  );

  const finalState =
    classifyRewrite(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "rolled-back"
  ) {
    fail(
      `Verificação pós-rollback falhou para rewrite: ${operation.filePath}`,
    );
  }
}

function reapplyRewrite(
  rootDir,
  operation,
) {
  const current =
    classifyRewrite(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "applied"
  ) {
    return;
  }

  if (
    current.state !==
      "rolled-back"
  ) {
    fail(
      `Rewrite não pode ser reaplicado durante compensação: ${operation.filePath}`,
    );
  }

  const afterBuffer =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.backupAfterPath,
      ),
    );

  if (
    sha256Buffer(
      afterBuffer,
    ) !==
    operation.fileShaAfter
  ) {
    fail(
      `Backup after divergiu: ${operation.backupAfterPath}`,
    );
  }

  writeFileAtomic(
    fromPosixRelative(
      rootDir,
      operation.filePath,
    ),
    afterBuffer,
  );

  const finalState =
    classifyRewrite(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "applied"
  ) {
    fail(
      `Compensação não reaplicou rewrite: ${operation.filePath}`,
    );
  }
}

function rollbackExtraction(
  rootDir,
  operation,
) {
  const pluginAbsolute =
    fromPosixRelative(
      rootDir,
      operation.pluginPath,
    );

  const implementationAbsolute =
    fromPosixRelative(
      rootDir,
      operation.implementationPath,
    );

  const current =
    classifyExtraction(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "rolled-back"
  ) {
    return;
  }

  if (
    current.state !==
      "applied"
  ) {
    fail(
      `Extração não está em estado aplicável a rollback: ${operation.moduleKey}`,
    );
  }

  const beforeBuffer =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.backupBeforePath,
      ),
    );

  if (
    sha256Buffer(
      beforeBuffer,
    ) !==
    operation.pluginShaBefore
  ) {
    fail(
      `Backup before divergiu: ${operation.backupBeforePath}`,
    );
  }

  writeFileAtomic(
    pluginAbsolute,
    beforeBuffer,
  );

  fs.rmSync(
    implementationAbsolute,
    {
      force: true,
    },
  );

  const finalState =
    classifyExtraction(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "rolled-back"
  ) {
    fail(
      `Verificação pós-rollback falhou para extração: ${operation.moduleKey}`,
    );
  }
}

function reapplyExtraction(
  rootDir,
  operation,
) {
  const current =
    classifyExtraction(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "applied"
  ) {
    return;
  }

  if (
    current.state !==
      "rolled-back"
  ) {
    fail(
      `Extração não pode ser reaplicada durante compensação: ${operation.moduleKey}`,
    );
  }

  const pluginAfter =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.backupAfterPath,
      ),
    );

  const implementationAfter =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        operation.implementationBackupPath,
      ),
    );

  if (
    sha256Buffer(
      pluginAfter,
    ) !==
      operation.pluginShaAfter ||
    sha256Buffer(
      implementationAfter,
    ) !==
      operation.implementationShaAfter
  ) {
    fail(
      `Backup after divergiu durante compensação: ${operation.moduleKey}`,
    );
  }

  writeFileAtomic(
    fromPosixRelative(
      rootDir,
      operation.implementationPath,
    ),
    implementationAfter,
  );

  writeFileAtomic(
    fromPosixRelative(
      rootDir,
      operation.pluginPath,
    ),
    pluginAfter,
  );

  const finalState =
    classifyExtraction(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "applied"
  ) {
    fail(
      `Compensação não reaplicou extração: ${operation.moduleKey}`,
    );
  }
}

function rollbackMove(
  rootDir,
  operation,
) {
  const current =
    classifyMove(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "rolled-back"
  ) {
    return;
  }

  if (
    current.state !==
      "applied"
  ) {
    fail(
      `Move não está em estado aplicável a rollback: ${operation.oldPath}`,
    );
  }

  const oldAbsolute =
    fromPosixRelative(
      rootDir,
      operation.oldPath,
    );

  const newAbsolute =
    fromPosixRelative(
      rootDir,
      operation.newPath,
    );

  const oldParent =
    path.dirname(
      oldAbsolute,
    );

  if (
    !fs.existsSync(
      oldParent,
    ) ||
    !fs.lstatSync(
      oldParent,
    ).isDirectory()
  ) {
    fail(
      `Diretório-pai do oldPath ausente: ${toPosixRelative(rootDir, oldParent)}`,
    );
  }

  fs.renameSync(
    newAbsolute,
    oldAbsolute,
  );

  const finalState =
    classifyMove(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "rolled-back"
  ) {
    fail(
      `Verificação pós-rollback falhou: ${operation.oldPath}`,
    );
  }
}

function reapplyMove(
  rootDir,
  operation,
) {
  const current =
    classifyMove(
      rootDir,
      operation,
    );

  if (
    current.state ===
      "applied"
  ) {
    return;
  }

  if (
    current.state !==
      "rolled-back"
  ) {
    fail(
      `Move não pode ser reaplicado durante compensação: ${operation.oldPath}`,
    );
  }

  const oldAbsolute =
    fromPosixRelative(
      rootDir,
      operation.oldPath,
    );

  const newAbsolute =
    fromPosixRelative(
      rootDir,
      operation.newPath,
    );

  const newParent =
    path.dirname(
      newAbsolute,
    );

  if (
    !fs.existsSync(
      newParent,
    ) ||
    !fs.lstatSync(
      newParent,
    ).isDirectory()
  ) {
    fail(
      `Diretório internal ausente durante compensação: ${toPosixRelative(rootDir, newParent)}`,
    );
  }

  fs.renameSync(
    oldAbsolute,
    newAbsolute,
  );

  const finalState =
    classifyMove(
      rootDir,
      operation,
    );

  if (
    finalState.state !==
      "applied"
  ) {
    fail(
      `Compensação não reaplicou move: ${operation.oldPath}`,
    );
  }
}

function updateJournalsAfterSuccess(
  rootDir,
  v20,
  stage10,
  stage12,
  stage13,
  stage14,
) {
  const now =
    new Date().toISOString();

  for (
    const operation of
      v20.operations
  ) {
    operation.state =
      "rolled-back";

    operation.rollbackTimestampUtc =
      operation.rollbackTimestampUtc ??
      now;
  }

  v20.status =
    "rolled-back";

  v20.updatedAtUtc =
    now;

  v20.rolledBackAtUtc =
    now;

  v20.counts.applied =
    0;

  v20.counts.rolledBack =
    v20.operations.length;

  v20.counts.conflicts =
    0;

  v20.operationsIdentitySha256 =
    semanticSha256(
      v20.operations.map(
        (operation) =>
          v20.schemaVersion ===
            1
            ? stage11IdentityV1(
                operation,
              )
            : v20.schemaVersion ===
              2
              ? identityV2(
                  operation,
                )
              : v20.schemaVersion ===
                3
                ? identityV3(
                    operation,
                  )
                : identityV4(
                    operation,
                  ),
      ),
    );

  writeJsonAtomic(
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    ),
    v20,
  );

  if (
    stage10 !==
    null
  ) {
    stage10.status =
      "rolled-back-by-v20";

    stage10.updatedAtUtc =
      now;

    stage10.rolledBackAtUtc =
      now;

    stage10.counts.pending =
      EXPECTED_STAGE10_MOVE_COUNT;

    stage10.counts.applied =
      0;

    stage10.counts.conflicts =
      0;

    for (
      const operation of
        stage10.operations
    ) {
      operation.state =
        "rolled-back";

      operation.rollbackTimestampUtc =
        operation.rollbackTimestampUtc ??
        now;
    }

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        STAGE10_JOURNAL_PATH,
      ),
      stage10,
    );
  }

  if (
    stage12 !==
    null
  ) {
    stage12.status =
      "rolled-back";

    stage12.updatedAtUtc =
      now;

    stage12.rolledBackAtUtc =
      now;

    stage12.counts.applied =
      0;

    stage12.counts.rolledBack =
      EXPECTED_STAGE12_EXTRACTION_COUNT;

    stage12.counts.conflicts =
      0;

    for (
      const operation of
        stage12.operations
    ) {
      operation.state =
        "rolled-back";

      operation.rollbackTimestampUtc =
        operation.rollbackTimestampUtc ??
        now;
    }

    stage12.operationsIdentitySha256 =
      semanticSha256(
        stage12.operations.map(
          (operation) =>
            identityV2(
              operation,
            ),
        ),
      );

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        STAGE12_JOURNAL_PATH,
      ),
      stage12,
    );
  }

  if (
    stage13 !==
    null
  ) {
    stage13.status =
      "rolled-back";

    stage13.updatedAtUtc =
      now;

    stage13.rolledBackAtUtc =
      now;

    stage13.counts.applied =
      0;

    stage13.counts.rolledBack =
      EXPECTED_STAGE13_REWRITE_COUNT;

    stage13.counts.conflicts =
      0;

    for (
      const operation of
        stage13.operations
    ) {
      operation.state =
        "rolled-back";

      operation.rollbackTimestampUtc =
        operation.rollbackTimestampUtc ??
        now;
    }

    stage13.operationsIdentitySha256 =
      semanticSha256(
        stage13.operations.map(
          (operation) =>
            identityV3(
              operation,
            ),
        ),
      );

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        STAGE13_JOURNAL_PATH,
      ),
      stage13,
    );
  }


  if (
    stage14 !==
    null
  ) {
    stage14.status =
      "rolled-back";

    stage14.updatedAtUtc =
      now;

    stage14.rolledBackAtUtc =
      now;

    stage14.counts.applied =
      0;

    stage14.counts.rolledBack =
      EXPECTED_STAGE14_FACADE_COUNT;

    stage14.counts.conflicts =
      0;

    for (
      const operation of
        stage14.operations
    ) {
      operation.state =
        "rolled-back";

      operation.rollbackTimestampUtc =
        operation.rollbackTimestampUtc ??
        now;
    }

    stage14.operationsIdentitySha256 =
      semanticSha256(
        stage14.operations.map(
          (operation) =>
            identityV4(
              operation,
            ),
        ),
      );

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        STAGE14_JOURNAL_PATH,
      ),
      stage14,
    );
  }

}

function runDryRun(
  rootDir,
  v20,
  groups,
) {
  const state =
    inspectState(
      rootDir,
      v20.operations,
    );

  assertNoConflicts(
    state,
  );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      v20.operations,
    );

  const journalBuffersBefore =
    snapshotJournalBuffers(
      rootDir,
    );

  const moveApplied =
    state.applied.filter(
      (record) =>
        record.operation.transformation ===
        STAGE10_MOVE_TRANSFORMATION,
    ).length;

  const extractionApplied =
    state.applied.filter(
      (record) =>
        record.operation.transformation ===
        STAGE12_EXTRACTION_TRANSFORMATION,
    ).length;

  const rewriteApplied =
    state.applied.filter(
      (record) =>
        record.operation.transformation ===
        STAGE13_REWRITE_TRANSFORMATION,
    ).length;

  const facadeApplied =
    state.applied.filter(
      (record) =>
        record.operation.transformation ===
        STAGE14_FACADE_TRANSFORMATION,
    ).length;

  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ROLLBACK v20: DRY-RUN                        ",
  );
  console.log(
    "============================================================",
  );
  console.log("");
  console.log(
    `Etapa 14 aplicada: ${String(facadeApplied)}/${String(groups.facades.length)}`,
  );
  console.log(
    `Etapa 13 aplicada: ${String(rewriteApplied)}/${String(groups.rewrites.length)}`,
  );
  console.log(
    `Etapa 12 aplicada: ${String(extractionApplied)}/${String(groups.extractions.length)}`,
  );
  console.log(
    `Etapa 10 migrada: ${String(moveApplied)}/${String(groups.moves.length)}`,
  );
  console.log(
    `Já rolled-back: ${String(state.rolledBack.length)}/${String(v20.operations.length)}`,
  );
  console.log(
    "Conflitos: 0",
  );
  console.log("");
  console.log(
    `Operações que seriam revertidas agora: ${String(state.applied.length)}`,
  );

  if (
    groups.facades.length >
    0
  ) {
    console.log(
      "Ordem: Etapa 14, depois Etapa 13, depois Etapa 12, depois Etapa 10; todas em ordem reversa.",
    );
  } else if (
    groups.rewrites.length >
    0
  ) {
    console.log(
      "Ordem: Etapa 13, depois Etapa 12, depois Etapa 10; todas em ordem reversa.",
    );
  } else if (
    groups.extractions.length >
    0
  ) {
    console.log(
      "Ordem: Etapa 12 (sequence maior -> menor), depois Etapa 10 (93 -> 1).",
    );
  } else {
    console.log(
      "Ordem: Etapa 10, sequence 93 -> 1.",
    );
  }

  console.log(
    "Dependência do Git: nenhuma.",
  );

  const protectedAfter =
    protectedProjectSnapshot(
      rootDir,
      v20.operations,
    );

  const journalBuffersAfter =
    snapshotJournalBuffers(
      rootDir,
    );

  if (
    protectedBefore.digest !==
      protectedAfter.digest
  ) {
    fail(
      "Dry-run alterou conteúdo protegido.",
    );
  }

  for (
    const [
      relativePath,
      beforeBuffer,
    ] of
      journalBuffersBefore
  ) {
    const afterBuffer =
      journalBuffersAfter.get(
        relativePath,
      );

    const beforeSha =
      beforeBuffer ===
        null
        ? null
        : sha256Buffer(
            beforeBuffer,
          );

    const afterSha =
      afterBuffer ===
        null
        ? null
        : sha256Buffer(
            afterBuffer,
          );

    if (
      beforeSha !==
      afterSha
    ) {
      fail(
        `Dry-run alterou journal: ${relativePath}`,
      );
    }
  }

  console.log("");
  console.log(
    "=== PROVA READ-ONLY ===",
  );
  console.log(
    `[OK] Digest protegido antes: ${protectedBefore.digest}`,
  );
  console.log(
    `[OK] Digest protegido depois: ${protectedAfter.digest}`,
  );
  console.log(
    "[OK] Journals não alterados.",
  );
  console.log(
    "[OK] Nenhum arquivo foi movido, criado, removido ou reescrito.",
  );
  console.log("");
  console.log(
    "============================================================",
  );
  console.log(
    "  DRY-RUN DE ROLLBACK CONCLUÍDO COM SUCESSO                ",
  );
  console.log(
    "============================================================",
  );
}

function runApply(
  rootDir,
  v20,
  groups,
  stage10,
  stage12,
  stage13,
  stage14,
) {
  const initialState =
    inspectState(
      rootDir,
      v20.operations,
    );

  assertNoConflicts(
    initialState,
  );

  if (
    initialState.rolledBack.length ===
      v20.operations.length
  ) {
    updateJournalsAfterSuccess(
      rootDir,
      v20,
      stage10,
      stage12,
      stage13,
      stage14,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  ROLLBACK v20 JÁ ESTÁ CONCLUÍDO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] ${String(v20.operations.length)}/${String(v20.operations.length)} operações já estão rolled-back.`,
    );
    return;
  }

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      v20.operations,
    );

  const originalJournals =
    snapshotJournalBuffers(
      rootDir,
    );

  const originallyApplied =
    new Set(
      initialState.applied.map(
        (record) =>
          record.operation.sequence,
      ),
    );

  try {
    const facadesToRollback =
      groups.facades
        .filter(
          (operation) =>
            originallyApplied.has(
              operation.sequence,
            ),
        )
        .sort(
          (a, b) =>
            b.sequence -
            a.sequence,
        );

    const rewritesToRollback =
      groups.rewrites
        .filter(
          (operation) =>
            originallyApplied.has(
              operation.sequence,
            ),
        )
        .sort(
          (a, b) =>
            b.sequence -
            a.sequence,
        );

    const extractionsToRollback =
      groups.extractions
        .filter(
          (operation) =>
            originallyApplied.has(
              operation.sequence,
            ),
        )
        .sort(
          (a, b) =>
            b.sequence -
            a.sequence,
        );

    const movesToRollback =
      groups.moves
        .filter(
          (operation) =>
            originallyApplied.has(
              operation.sequence,
            ),
        )
        .sort(
          (a, b) =>
            b.sequence -
            a.sequence,
        );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ROLLBACK v20: APPLY                          ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `Fachadas Etapa 14 a reverter: ${String(facadesToRollback.length)}`,
    );
    console.log(
      `Rewrites Etapa 13 a reverter: ${String(rewritesToRollback.length)}`,
    );
    console.log(
      `Extrações Etapa 12 a reverter: ${String(extractionsToRollback.length)}`,
    );
    console.log(
      `Moves Etapa 10 a reverter: ${String(movesToRollback.length)}`,
    );
    console.log(
      "Dependência do Git: nenhuma.",
    );
    console.log("");
    console.log(
      "=== ROLLBACK ETAPA 14 ===",
    );

    for (
      const operation of
        facadesToRollback
    ) {
      rollbackFacade(
        rootDir,
        operation,
      );

      console.log(
        `  [OK] ${operation.filePath} removido`,
      );
    }

    console.log("");
    console.log(
      "=== ROLLBACK ETAPA 13 ===",
    );

    for (
      const operation of
        rewritesToRollback
    ) {
      rollbackRewrite(
        rootDir,
        operation,
      );

      console.log(
        `  [OK] ${operation.filePath} restaurado para o conteúdo pré-Etapa 13`,
      );
    }

    console.log("");
    console.log(
      "=== ROLLBACK ETAPA 12 ===",
    );

    for (
      const operation of
        extractionsToRollback
    ) {
      rollbackExtraction(
        rootDir,
        operation,
      );

      console.log(
        `  [OK] ${operation.implementationPath} removido | ${operation.pluginPath} restaurado`,
      );
    }

    console.log("");
    console.log(
      "=== ROLLBACK ETAPA 10 ===",
    );

    for (
      const operation of
        movesToRollback
    ) {
      rollbackMove(
        rootDir,
        operation,
      );

      console.log(
        `  [OK] ${operation.newPath} -> ${operation.oldPath}`,
      );
    }

    const finalState =
      inspectState(
        rootDir,
        v20.operations,
      );

    assertNoConflicts(
      finalState,
    );

    if (
      finalState.rolledBack.length !==
        v20.operations.length
    ) {
      fail(
        `Rollback final incompleto: ${String(finalState.rolledBack.length)}/${String(v20.operations.length)}.`,
      );
    }

    const protectedAfter =
      protectedProjectSnapshot(
        rootDir,
        v20.operations,
      );

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "Arquivo fora do escopo reversível foi alterado.",
          `Antes: ${protectedBefore.digest}`,
          `Depois: ${protectedAfter.digest}`,
        ].join(
          "\n",
        ),
      );
    }

    updateJournalsAfterSuccess(
      rootDir,
      v20,
      stage10,
      stage12,
      stage13,
      stage14,
    );

    console.log("");
    console.log(
      "=== VALIDAÇÃO FINAL ===",
    );
    console.log(
      `[OK] Operações rolled-back: ${String(finalState.rolledBack.length)}/${String(v20.operations.length)}`,
    );
    console.log(
      `[OK] Etapa 14 restaurada: ${String(groups.facades.length)}/${String(groups.facades.length)}`,
    );
    console.log(
      `[OK] Etapa 13 restaurada: ${String(groups.rewrites.length)}/${String(groups.rewrites.length)}`,
    );
    console.log(
      `[OK] Etapa 12 restaurada: ${String(groups.extractions.length)}/${String(groups.extractions.length)}`,
    );
    console.log(
      `[OK] Etapa 10 restaurada: ${String(groups.moves.length)}/${String(groups.moves.length)}`,
    );
    console.log(
      `[OK] Workers restaurados: ${String(EXPECTED_WORKER_COUNT)}/${String(EXPECTED_WORKER_COUNT)}`,
    );
    console.log(
      `[OK] Bytes Etapa 10 preservados: ${String(EXPECTED_STAGE10_BYTES)}`,
    );
    console.log(
      `[OK] Digest protegido antes: ${protectedBefore.digest}`,
    );
    console.log(
      `[OK] Digest protegido depois: ${protectedAfter.digest}`,
    );
    console.log(
      "[OK] Git não foi usado.",
    );
    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ROLLBACK v20 CONCLUÍDO COM SUCESSO                       ",
    );
    console.log(
      "============================================================",
    );
  } catch (
    error
  ) {
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

    const compensationErrors =
      [];

    try {
      const currentState =
        inspectState(
          rootDir,
          v20.operations,
        );

      const moveRecords =
        currentState.records.filter(
          (record) =>
            record.operation.transformation ===
              STAGE10_MOVE_TRANSFORMATION &&
            originallyApplied.has(
              record.operation.sequence,
            ) &&
            record.state ===
              "rolled-back",
        );

      for (
        const record of
          moveRecords.sort(
            (a, b) =>
              a.operation.sequence -
              b.operation.sequence,
          )
      ) {
        reapplyMove(
          rootDir,
          record.operation,
        );
      }

      const afterMoveState =
        inspectState(
          rootDir,
          v20.operations,
        );

      const extractionRecords =
        afterMoveState.records.filter(
          (record) =>
            record.operation.transformation ===
              STAGE12_EXTRACTION_TRANSFORMATION &&
            originallyApplied.has(
              record.operation.sequence,
            ) &&
            record.state ===
              "rolled-back",
        );

      for (
        const record of
          extractionRecords.sort(
            (a, b) =>
              a.operation.sequence -
              b.operation.sequence,
          )
      ) {
        reapplyExtraction(
          rootDir,
          record.operation,
        );
      }

      const afterExtractionState =
        inspectState(
          rootDir,
          v20.operations,
        );

      const rewriteRecords =
        afterExtractionState.records.filter(
          (record) =>
            record.operation.transformation ===
              STAGE13_REWRITE_TRANSFORMATION &&
            originallyApplied.has(
              record.operation.sequence,
            ) &&
            record.state ===
              "rolled-back",
        );

      for (
        const record of
          rewriteRecords.sort(
            (a, b) =>
              a.operation.sequence -
              b.operation.sequence,
          )
      ) {
        reapplyRewrite(
          rootDir,
          record.operation,
        );
      }

      const afterRewriteState =
        inspectState(
          rootDir,
          v20.operations,
        );

      const facadeRecords =
        afterRewriteState.records.filter(
          (record) =>
            record.operation.transformation ===
              STAGE14_FACADE_TRANSFORMATION &&
            originallyApplied.has(
              record.operation.sequence,
            ) &&
            record.state ===
              "rolled-back",
        );

      for (
        const record of
          facadeRecords.sort(
            (a, b) =>
              a.operation.sequence -
              b.operation.sequence,
          )
      ) {
        reapplyFacade(
          rootDir,
          record.operation,
        );
      }
    } catch (
      compensationError
    ) {
      compensationErrors.push(
        compensationError instanceof
        Error
          ? (
              compensationError.stack ??
              compensationError.message
            )
          : String(
              compensationError,
            ),
      );
    }

    try {
      restoreJournalBuffers(
        rootDir,
        originalJournals,
      );
    } catch (
      journalError
    ) {
      compensationErrors.push(
        `Falha restaurando journals: ${
          journalError instanceof
          Error
            ? journalError.message
            : String(
                journalError,
              )
        }`,
      );
    }

    if (
      compensationErrors.length ===
      0
    ) {
      const protectedAfterCompensation =
        protectedProjectSnapshot(
          rootDir,
          v20.operations,
        );

      if (
        protectedAfterCompensation.digest !==
        protectedBefore.digest
      ) {
        compensationErrors.push(
          `Digest protegido divergiu após compensação: ${protectedAfterCompensation.digest}`,
        );
      }
    }

    fail(
      [
        `Falha durante rollback: ${originalMessage}`,
        compensationErrors.length ===
          0
          ? "[OK] Compensação restaurou o estado anterior ao comando."
          : `Compensação encontrou ${String(compensationErrors.length)} erro(s).`,
        ...compensationErrors.map(
          (message) =>
            `  - ${message}`,
        ),
      ].join(
        "\n",
      ),
    );
  }
}

function runRollback() {
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

  const v20Absolute =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  if (
    !fs.existsSync(
      v20Absolute,
    )
  ) {
    fail(
      `Journal global ausente: ${V20_JOURNAL_PATH}`,
    );
  }

  const v20 =
    readJson(
      v20Absolute,
      V20_JOURNAL_PATH,
    );

  const groups =
    validateV20Journal(
      v20,
    );

  const stage10 =
    loadOptionalJournal(
      rootDir,
      STAGE10_JOURNAL_PATH,
    );

  const stage12 =
    loadOptionalJournal(
      rootDir,
      STAGE12_JOURNAL_PATH,
    );

  const stage13 =
    loadOptionalJournal(
      rootDir,
      STAGE13_JOURNAL_PATH,
    );

  const stage14 =
    loadOptionalJournal(
      rootDir,
      STAGE14_JOURNAL_PATH,
    );

  if (
    groups.extractions.length >
      0 &&
    stage12 ===
      null
  ) {
    fail(
      `Journal global contém Etapa 12, mas ${STAGE12_JOURNAL_PATH} está ausente.`,
    );
  }

  if (
    groups.rewrites.length >
      0 &&
    stage13 ===
      null
  ) {
    fail(
      `Journal global contém Etapa 13, mas ${STAGE13_JOURNAL_PATH} está ausente.`,
    );
  }

  if (
    groups.facades.length >
      0 &&
    stage14 ===
      null
  ) {
    fail(
      `Journal global contém Etapa 14, mas ${STAGE14_JOURNAL_PATH} está ausente.`,
    );
  }

  if (
    options.mode ===
      "dry-run"
  ) {
    runDryRun(
      rootDir,
      v20,
      groups,
    );

    return;
  }

  runApply(
    rootDir,
    v20,
    groups,
    stage10,
    stage12,
    stage13,
    stage14,
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
    runRollback();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Rollback v20 não concluído.",
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
