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
  "stage-12-extract-plugin-implementations";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_STAGE5_NAME =
  "stage-5-path-migration-plan";

const EXPECTED_STAGE10_NAME =
  "stage-10-engine-layout-move";

const EXPECTED_STAGE11_NAME =
  "stage-11-v20-journal-and-rollback";

const EXPECTED_MOVE_COUNT =
  93;

const EXPECTED_WORKER_COUNT =
  2;

const EXPECTED_STAGE10_BYTES =
  396456;

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const EXPECTED_EXTRACTION_COUNT =
  21;

const STAGE10_JOURNAL_PATH =
  ".migration/stage10/move-journal.json";

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE12_JOURNAL_PATH =
  ".migration/stage12/extraction-journal.json";

const ROLLBACK_SCRIPT_PATH =
  "scripts/architecture/rollback-migration.mjs";

const STAGE3_FILES_PATH_FALLBACK =
  ".migration/stage3/2026-10-03T23-03-19Z/files.json";

const EXTRACTION_SPECS =
  Object.freeze([
    Object.freeze({
      moduleKey: "steam",
      className: "SteamBridgeService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "assets",
      className: "AssetsManagerService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "physics",
      className: "PhysicsService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "storage",
      className: "StorageService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "world",
      className: "WorldService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "ui",
      className: "UIService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "anim",
      className: "AnimationService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "sprites",
      className: "SpritesService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "audio",
      className: "AudioService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "camera",
      className: "CameraService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "ai",
      className: "AIService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "vfx",
      className: "VFXService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "terrain",
      className: "TerrainService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "scripting",
      className: "ScriptingService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "streaming",
      className: "StreamingService",
      supportingNames: Object.freeze([
        "MutableVector3Streaming",
        "SECTOR_UPDATE_INTERVAL_SECONDS",
        "MAX_FRAME_DELTA_SECONDS",
      ]),
    }),
    Object.freeze({
      moduleKey: "overlay",
      className: "OverlayService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "security",
      className: "SecurityService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "modding",
      className: "ModdingService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "monetization",
      className: "MonetizationService",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "game-loop",
      className: "DeterministicGameLoop",
      supportingNames: Object.freeze([]),
    }),
    Object.freeze({
      moduleKey: "net",
      className: "NetworkService",
      supportingNames: Object.freeze([]),
    }),
  ]);

const EXCLUDED_CANONICAL_BRIDGES =
  Object.freeze([
    "input",
    "render",
  ]);

const FORBIDDEN_NON_CANONICAL_PLUGINS =
  Object.freeze([
    "debug",
    "player",
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
        "Execute a Etapa 12 exatamente na raiz do Projeto1.",
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
      "  node scripts/architecture/stage12-extract-plugin-implementations.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 12: extração de implementações embutidas em plugins

Uso:
  node scripts/architecture/stage12-extract-plugin-implementations.mjs

Escopo exato:
  - extrair 21 implementações técnicas hoje embutidas nos plugins canônicos;
  - criar 21 arquivos em src/engine/<module>/internal/;
  - transformar os 21 plugin.ts em bridges de composição/lifecycle;
  - manter input e render intactos, pois já são bridges sem classe técnica embutida;
  - manter debug intacto, pois é tooling;
  - manter player intacto, pois é experimental/orphaned;
  - registrar a transformação em .migration/stage12/extraction-journal.json;
  - anexar as 21 operações ao journal global v20.

Esta etapa NÃO:
  - reescreve imports do restante do projeto;
  - cria public/index.ts;
  - implementa @core;
  - altera manifests/capabilities;
  - move os 93 arquivos da Etapa 10 novamente;
  - toca em src/plugins/player/plugin.ts;
  - executa tsc, testes ou build como gate final.
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
        "Não foi possível carregar o pacote TypeScript.",
        "A Etapa 12 usa o TypeScript Compiler API para analisar os plugins.",
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

function moduleByKey() {
  return new Map(
    CANONICAL_MODULES.map(
      (moduleRecord) => [
        moduleRecord.key,
        moduleRecord,
      ],
    ),
  );
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

  if (
    EXTRACTION_SPECS.length !==
    EXPECTED_EXTRACTION_COUNT
  ) {
    fail(
      `Escopo da Etapa 12 deveria conter ${String(EXPECTED_EXTRACTION_COUNT)} extrações.`,
    );
  }

  const moduleMap =
    moduleByKey();

  const covered =
    new Set(
      [
        ...EXTRACTION_SPECS.map(
          (spec) =>
            spec.moduleKey,
        ),
        ...EXCLUDED_CANONICAL_BRIDGES,
      ],
    );

  if (
    covered.size !==
      EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      "As 21 extrações + input/render não cobrem exatamente os 23 módulos canônicos.",
    );
  }

  for (
    const spec of
      EXTRACTION_SPECS
  ) {
    const moduleRecord =
      moduleMap.get(
        spec.moduleKey,
      );

    if (
      moduleRecord ===
      undefined
    ) {
      fail(
        `Spec de extração usa módulo não canônico: ${spec.moduleKey}`,
      );
    }

    const expectedPlugin =
      `src/plugins/${spec.moduleKey}/plugin.ts`;

    if (
      moduleRecord.plugin !==
      expectedPlugin
    ) {
      fail(
        `Plugin canônico divergente para ${spec.moduleKey}: ${String(moduleRecord.plugin)}`,
      );
    }

    const expectedInternal =
      `src/engine/${spec.moduleKey}/internal`;

    if (
      moduleRecord.engine
        ?.internalRoot !==
      expectedInternal
    ) {
      fail(
        `internalRoot divergente para ${spec.moduleKey}: ${String(moduleRecord.engine?.internalRoot)}`,
      );
    }
  }

  for (
    const key of
      EXCLUDED_CANONICAL_BRIDGES
  ) {
    if (
      !moduleMap.has(
        key,
      )
    ) {
      fail(
        `Bridge excluída não é módulo canônico: ${key}`,
      );
    }
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

  const reportPath =
    fromPosixRelative(
      rootDir,
      reportRelativePath,
    );

  const report =
    readJson(
      reportPath,
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
      EXPECTED_MOVE_COUNT ||
    plan.counts
      ?.moveOperations !==
      EXPECTED_MOVE_COUNT ||
    plan.counts
      ?.workers !==
      EXPECTED_WORKER_COUNT ||
    plan.counts
      ?.totalBytes !==
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
      `Digest da Etapa 5 divergiu: ${computedDigest}`,
    );
  }

  return {
    runId,
    reportRelativePath,
    plan,
  };
}

function loadStage3Files(
  rootDir,
  stage5,
) {
  const relativePath =
    typeof stage5.plan.stage3
      ?.filesPath ===
      "string"
      ? stage5.plan.stage3.filesPath
      : STAGE3_FILES_PATH_FALLBACK;

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
      `files.json da Etapa 3 ausente: ${relativePath}`,
    );
  }

  const records =
    readJson(
      absolutePath,
      relativePath,
    );

  if (
    !Array.isArray(
      records,
    )
  ) {
    fail(
      "files.json da Etapa 3 não contém array.",
    );
  }

  return {
    relativePath,
    records,
    byPath:
      new Map(
        records.map(
          (record) => [
            record.path,
            record,
          ],
        ),
      ),
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
  let workers =
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
      workers +=
        1;
    }

    totalBytes +=
      operation.bytes;
  }

  if (
    workers !==
      EXPECTED_WORKER_COUNT ||
    totalBytes !==
      EXPECTED_STAGE10_BYTES
  ) {
    fail(
      "Layout da Etapa 10 diverge nos workers ou total de bytes.",
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
    `Transformação desconhecida no journal v20: ${String(operation.transformation)}`,
  );
}

function loadV20JournalV1(
  rootDir,
  stage5,
) {
  const absolutePath =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    fail(
      `Pré-condição ausente: ${V20_JOURNAL_PATH}`,
    );
  }

  const journal =
    readJson(
      absolutePath,
      V20_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.journal !==
      "v20-architecture-migration-journal" ||
    journal.stage !==
      EXPECTED_STAGE11_NAME ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "migrated" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.totalOperations !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.applied !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.rolledBack !==
      0
  ) {
    fail(
      "O journal global v20 ainda não está no estado migrado esperado da Etapa 11.",
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
      "Journal global v20 referencia outro plano da Etapa 5.",
    );
  }

  const moveOperations =
    journal.operations.filter(
      (operation) =>
        operation.transformation ===
        "move-engine-implementation-to-module-internal",
    );

  if (
    moveOperations.length !==
    EXPECTED_MOVE_COUNT
  ) {
    fail(
      "Journal global v20 não contém exatamente as 93 operações da Etapa 10.",
    );
  }

  const computedIdentity =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          stage11IdentityV1(
            operation,
          ),
      ),
    );

  if (
    computedIdentity !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal v20 divergiu antes da Etapa 12.",
    );
  }

  return journal;
}

function loadStage10Journal(
  rootDir,
  stage5,
) {
  const absolutePath =
    fromPosixRelative(
      rootDir,
      STAGE10_JOURNAL_PATH,
    );

  const journal =
    readJson(
      absolutePath,
      STAGE10_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      EXPECTED_STAGE10_NAME ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.applied !==
      EXPECTED_MOVE_COUNT ||
    journal.counts
      ?.workers !==
      EXPECTED_WORKER_COUNT ||
    journal.counts
      ?.totalBytes !==
      EXPECTED_STAGE10_BYTES ||
    journal.sourcePlan
      ?.runId !==
      stage5.runId ||
    journal.sourcePlan
      ?.migrationPlanSha256 !==
      stage5.plan.migrationPlanSha256
  ) {
    fail(
      "Journal da Etapa 10 não representa 93/93 moves concluídos.",
    );
  }

  return journal;
}

function validateBaselinePluginFiles(
  rootDir,
  stage3,
) {
  const moduleMap =
    moduleByKey();

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    const pluginPath =
      moduleRecord.plugin;

    const baseline =
      stage3.byPath.get(
        pluginPath,
      );

    if (
      baseline ===
      undefined ||
    typeof baseline.sha256 !==
      "string" ||
    typeof baseline.bytes !==
      "number"
    ) {
      fail(
        `Plugin canônico ausente do baseline da Etapa 3: ${pluginPath}`,
      );
    }

    const info =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
      );

    if (
      info.kind !==
        "file" ||
      info.bytes !==
        baseline.bytes ||
      info.sha256 !==
        baseline.sha256
    ) {
      fail(
        [
          `Plugin divergiu do baseline antes da extração: ${pluginPath}`,
          `Esperado: ${String(baseline.bytes)} bytes / ${baseline.sha256}`,
          `Atual: ${String(info.bytes)} bytes / ${String(info.sha256)}`,
        ].join(
          "\n",
        ),
      );
    }
  }

  for (
    const key of
      FORBIDDEN_NON_CANONICAL_PLUGINS
  ) {
    const pluginPath =
      `src/plugins/${key}/plugin.ts`;

    if (
      !fs.existsSync(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
      )
    ) {
      fail(
        `Plugin protegido ausente: ${pluginPath}`,
      );
    }
  }

  if (
    !moduleMap.has(
      "game-loop",
    )
  ) {
    fail(
      "game-loop não está no module-map canônico.",
    );
  }
}

function isReferenceIdentifier(
  ts,
  node,
) {
  const parent =
    node.parent;

  if (
    !parent
  ) {
    return true;
  }

  if (
    ts.isDeclarationName(
      node,
    )
  ) {
    return false;
  }

  if (
    ts.isPropertyAccessExpression(
      parent,
    ) &&
    parent.name ===
      node
  ) {
    return false;
  }

  if (
    ts.isQualifiedName(
      parent,
    ) &&
    parent.right ===
      node
  ) {
    return false;
  }

  if (
    ts.isPropertyAssignment(
      parent,
    ) &&
    parent.name ===
      node &&
    !ts.isShorthandPropertyAssignment(
      parent,
    )
  ) {
    return false;
  }

  if (
    (
      ts.isMethodDeclaration(
        parent,
      ) ||
      ts.isPropertyDeclaration(
        parent,
      ) ||
      ts.isPropertySignature(
        parent,
      ) ||
      ts.isMethodSignature(
        parent,
      ) ||
      ts.isGetAccessorDeclaration(
        parent,
      ) ||
      ts.isSetAccessorDeclaration(
        parent,
      )
    ) &&
    parent.name ===
      node
  ) {
    return false;
  }

  if (
    ts.isImportSpecifier(
      parent,
    ) ||
    ts.isImportClause(
      parent,
    ) ||
    ts.isNamespaceImport(
      parent,
    ) ||
    ts.isExportSpecifier(
      parent,
    )
  ) {
    return false;
  }

  return true;
}

function collectReferencedIdentifiers(
  ts,
  nodes,
) {
  const identifiers =
    new Set();

  const visit =
    (
      node,
    ) => {
      if (
        ts.isIdentifier(
          node,
        ) &&
        isReferenceIdentifier(
          ts,
          node,
        )
      ) {
        identifiers.add(
          node.text,
        );
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

  for (
    const node of
      nodes
  ) {
    visit(
      node,
    );
  }

  return identifiers;
}

function declaredNamesOfStatement(
  ts,
  statement,
) {
  const names =
    [];

  if (
    (
      ts.isClassDeclaration(
        statement,
      ) ||
      ts.isInterfaceDeclaration(
        statement,
      ) ||
      ts.isTypeAliasDeclaration(
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
    names.push(
      statement.name.text,
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

  return names;
}

function importBindings(
  ts,
  importDeclaration,
) {
  const clause =
    importDeclaration.importClause;

  if (
    !clause
  ) {
    return [];
  }

  const bindings =
    [];

  if (
    clause.name
  ) {
    bindings.push(
      {
        kind: "default",
        localName:
          clause.name.text,
        text:
          clause.name.text,
      },
    );
  }

  const namedBindings =
    clause.namedBindings;

  if (
    namedBindings &&
    ts.isNamespaceImport(
      namedBindings,
    )
  ) {
    bindings.push(
      {
        kind: "namespace",
        localName:
          namedBindings.name.text,
        text:
          `* as ${namedBindings.name.text}`,
      },
    );
  }

  if (
    namedBindings &&
    ts.isNamedImports(
      namedBindings,
    )
  ) {
    for (
      const element of
        namedBindings.elements
    ) {
      bindings.push(
        {
          kind: "named",
          localName:
            element.name.text,
          text:
            element.getText(),
        },
      );
    }
  }

  return bindings;
}

function renderFilteredImport(
  ts,
  importDeclaration,
  usedIdentifiers,
  moduleSpecifier,
) {
  const clause =
    importDeclaration.importClause;

  if (
    !clause
  ) {
    return null;
  }

  const bindings =
    importBindings(
      ts,
      importDeclaration,
    );

  const selected =
    bindings.filter(
      (binding) =>
        usedIdentifiers.has(
          binding.localName,
        ),
    );

  if (
    selected.length ===
    0
  ) {
    return null;
  }

  const defaultBinding =
    selected.find(
      (binding) =>
        binding.kind ===
        "default",
    );

  const namespaceBinding =
    selected.find(
      (binding) =>
        binding.kind ===
        "namespace",
    );

  const namedBindings =
    selected.filter(
      (binding) =>
        binding.kind ===
        "named",
    );

  const parts =
    [];

  if (
    defaultBinding
  ) {
    parts.push(
      defaultBinding.text,
    );
  }

  if (
    namespaceBinding
  ) {
    parts.push(
      namespaceBinding.text,
    );
  }

  if (
    namedBindings.length >
    0
  ) {
    parts.push(
      `{ ${namedBindings
        .map(
          (binding) =>
            binding.text,
        )
        .join(
          ", ",
        )} }`,
    );
  }

  const typePrefix =
    clause.isTypeOnly
      ? " type"
      : "";

  return `import${typePrefix} ${parts.join(", ")} from ${JSON.stringify(moduleSpecifier)};`;
}

function resolveRelativeImportTarget(
  rootDir,
  sourceRelativePath,
  specifier,
  stage5Mapping,
) {
  if (
    !specifier.startsWith(
      ".",
    )
  ) {
    return {
      external: true,
      targetRelativePath:
        null,
    };
  }

  const sourceDirectory =
    path.posix.dirname(
      sourceRelativePath,
    );

  const base =
    path.posix.normalize(
      path.posix.join(
        sourceDirectory,
        specifier,
      ),
    );

  const candidates =
    [];

  if (
    /\.[cm]?tsx?$/u.test(
      base,
    )
  ) {
    candidates.push(
      base,
    );
  } else {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.cts`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.mts`,
      `${base}/index.cts`,
    );
  }

  for (
    const candidate of
      candidates
  ) {
    const mapped =
      stage5Mapping[
        candidate
      ];

    if (
      typeof mapped ===
        "string"
    ) {
      const mappedAbsolute =
        fromPosixRelative(
          rootDir,
          mapped,
        );

      if (
        fs.existsSync(
          mappedAbsolute,
        )
      ) {
        return {
          external: false,
          targetRelativePath:
            mapped,
        };
      }
    }

    const absolute =
      fromPosixRelative(
        rootDir,
        candidate,
      );

    if (
      fs.existsSync(
        absolute,
      )
    ) {
      return {
        external: false,
        targetRelativePath:
          candidate,
      };
    }
  }

  fail(
    `Não foi possível resolver import ${JSON.stringify(specifier)} a partir de ${sourceRelativePath}.`,
  );
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

function rewriteImportSpecifierForInternal(
  rootDir,
  pluginPath,
  implementationPath,
  originalSpecifier,
  stage5Mapping,
  moduleKey,
) {
  const resolution =
    resolveRelativeImportTarget(
      rootDir,
      pluginPath,
      originalSpecifier,
      stage5Mapping,
    );

  if (
    resolution.external
  ) {
    return originalSpecifier;
  }

  const target =
    resolution.targetRelativePath;

  if (
    target.startsWith(
      "src/plugins/",
    )
  ) {
    fail(
      `Implementação internal de ${moduleKey} tentaria importar plugin: ${target}`,
    );
  }

  if (
    target.startsWith(
      "src/engine/",
    )
  ) {
    const ownPrefix =
      `src/engine/${moduleKey}/internal/`;

    if (
      !target.startsWith(
        ownPrefix,
      )
    ) {
      fail(
        `Implementação internal de ${moduleKey} tentaria importar internal de outro módulo: ${target}`,
      );
    }
  }

  return relativeModuleSpecifier(
    implementationPath,
    target,
  );
}

function addExportPrefix(
  ts,
  sourceFile,
  statement,
) {
  const text =
    sourceFile.text.slice(
      statement.getStart(
        sourceFile,
      ),
      statement.end,
    );

  const modifiers =
    ts.canHaveModifiers(
      statement,
    )
      ? ts.getModifiers(
          statement,
        ) ??
        []
      : [];

  const alreadyExported =
    modifiers.some(
      (modifier) =>
        modifier.kind ===
        ts.SyntaxKind.ExportKeyword,
    );

  return alreadyExported
    ? text
    : `export ${text}`;
}

function removeRanges(
  sourceText,
  ranges,
) {
  const sorted =
    [...ranges].sort(
      (a, b) =>
        b.start -
        a.start,
    );

  let output =
    sourceText;

  for (
    const range of
      sorted
  ) {
    output =
      `${output.slice(0, range.start)}${output.slice(range.end)}`;
  }

  return output;
}

function normalizeBodyAfterRemoval(
  body,
) {
  return body
    .replace(
      /^(?:[ \t]*\r?\n)+/u,
      "",
    )
    .replace(
      /\r\n/gu,
      "\n",
    )
    .replace(
      /\n{3,}/gu,
      "\n\n",
    )
    .replace(
      /[ \t]+\n/gu,
      "\n",
    )
    .trimEnd() +
    "\n";
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
      ts.ScriptKind.TS,
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
        `Erro de parsing TypeScript em ${relativePath}:`,
        ...diagnostics,
      ].join(
        "\n",
      ),
    );
  }

  return sourceFile;
}

function transformPlugin(
  ts,
  rootDir,
  spec,
  moduleRecord,
  stage5,
  sourceText,
) {
  const pluginPath =
    moduleRecord.plugin;

  const implementationPath =
    `${moduleRecord.engine.internalRoot}/${spec.className}.ts`;

  const sourceFile =
    parseSource(
      ts,
      pluginPath,
      sourceText,
    );

  const classes =
    sourceFile.statements.filter(
      (statement) =>
        ts.isClassDeclaration(
          statement,
        ),
    );

  if (
    classes.length !==
      1 ||
    classes[0].name
      ?.text !==
      spec.className
  ) {
    fail(
      `${pluginPath} deveria conter exatamente a classe técnica ${spec.className}.`,
    );
  }

  const classNode =
    classes[0];

  const namedStatements =
    new Map();

  for (
    const statement of
      sourceFile.statements
  ) {
    if (
      ts.isImportDeclaration(
        statement,
      )
    ) {
      continue;
    }

    for (
      const declaredName of
        declaredNamesOfStatement(
          ts,
          statement,
        )
    ) {
      if (
        namedStatements.has(
          declaredName,
        )
      ) {
        fail(
          `Declaração top-level duplicada em ${pluginPath}: ${declaredName}`,
        );
      }

      namedStatements.set(
        declaredName,
        statement,
      );
    }
  }

  const movedNames =
    [
      spec.className,
      ...spec.supportingNames,
    ];

  const movedStatements =
    [];

  for (
    const movedName of
      movedNames
  ) {
    const statement =
      namedStatements.get(
        movedName,
      );

    if (
      statement ===
      undefined
    ) {
      fail(
        `Declaração esperada para extração ausente em ${pluginPath}: ${movedName}`,
      );
    }

    if (
      !movedStatements.includes(
        statement,
      )
    ) {
      movedStatements.push(
        statement,
      );
    }
  }

  movedStatements.sort(
    (a, b) =>
      a.pos -
      b.pos,
  );

  const movedStatementSet =
    new Set(
      movedStatements,
    );

  const movedRefs =
    collectReferencedIdentifiers(
      ts,
      movedStatements,
    );

  const remainingStatements =
    sourceFile.statements.filter(
      (statement) =>
        !ts.isImportDeclaration(
          statement,
        ) &&
        !movedStatementSet.has(
          statement,
        ),
    );

  const remainingRefs =
    collectReferencedIdentifiers(
      ts,
      remainingStatements,
    );

  const allLocalNames =
    new Set(
      namedStatements.keys(),
    );

  const forbiddenLocalDependencies =
    [...movedRefs].filter(
      (identifier) =>
        allLocalNames.has(
          identifier,
        ) &&
        !movedNames.includes(
          identifier,
        ),
    );

  if (
    forbiddenLocalDependencies.length >
    0
  ) {
    fail(
      [
        `A extração de ${spec.className} deixaria dependência top-level no plugin ${pluginPath}.`,
        `Dependências não declaradas no escopo da Etapa 12: ${forbiddenLocalDependencies.join(", ")}`,
      ].join(
        "\n",
      ),
    );
  }

  const pluginImports =
    [];

  const internalImports =
    [];

  const importRanges =
    [];

  for (
    const statement of
      sourceFile.statements
  ) {
    if (
      !ts.isImportDeclaration(
        statement,
      )
    ) {
      continue;
    }

    importRanges.push(
      {
        start:
          statement.getFullStart(),
        end:
          statement.end,
      },
    );

    const originalSpecifier =
      statement.moduleSpecifier.text;

    const pluginImport =
      renderFilteredImport(
        ts,
        statement,
        remainingRefs,
        originalSpecifier,
      );

    if (
      pluginImport !==
        null
    ) {
      pluginImports.push(
        pluginImport,
      );
    }

    const rewrittenSpecifier =
      originalSpecifier.startsWith(
        ".",
      )
        ? rewriteImportSpecifierForInternal(
            rootDir,
            pluginPath,
            implementationPath,
            originalSpecifier,
            stage5.plan.mapping,
            spec.moduleKey,
          )
        : originalSpecifier;

    const internalImport =
      renderFilteredImport(
        ts,
        statement,
        movedRefs,
        rewrittenSpecifier,
      );

    if (
      internalImport !==
        null
    ) {
      internalImports.push(
        internalImport,
      );
    }
  }

  const namesNeededByPlugin =
    movedNames.filter(
      (name) =>
        remainingRefs.has(
          name,
        ),
    );

  if (
    !namesNeededByPlugin.includes(
      spec.className,
    )
  ) {
    fail(
      `${pluginPath} não referencia ${spec.className} depois da extração; bridge inesperada.`,
    );
  }

  const implementationImportSpecifier =
    relativeModuleSpecifier(
      pluginPath,
      implementationPath,
    );

  pluginImports.push(
    `import { ${namesNeededByPlugin.join(", ")} } from ${JSON.stringify(implementationImportSpecifier)};`,
  );

  const removalRanges =
    [
      ...importRanges,
      ...movedStatements.map(
        (statement) => ({
          start:
            statement.getFullStart(),
          end:
            statement.end,
        }),
      ),
    ];

  const body =
    normalizeBodyAfterRemoval(
      removeRanges(
        sourceText,
        removalRanges,
      ),
    );

  const pluginAfter =
    `${pluginImports.join("\n")}\n\n${body}`;

  const implementationNodesText =
    movedStatements.map(
      (statement) =>
        addExportPrefix(
          ts,
          sourceFile,
          statement,
        ),
    );

  const implementationAfter =
    `${
      internalImports.length >
      0
        ? `${internalImports.join("\n")}\n\n`
        : ""
    }${implementationNodesText.join("\n\n")}\n`;

  const parsedPluginAfter =
    parseSource(
      ts,
      pluginPath,
      pluginAfter,
    );

  const parsedImplementationAfter =
    parseSource(
      ts,
      implementationPath,
      implementationAfter,
    );

  const remainingClassDeclarations =
    parsedPluginAfter.statements.filter(
      (statement) =>
        ts.isClassDeclaration(
          statement,
        ),
    );

  if (
    remainingClassDeclarations.length !==
    0
  ) {
    fail(
      `Plugin bridge ainda contém classe top-level após transformação: ${pluginPath}`,
    );
  }

  const implementationClasses =
    parsedImplementationAfter.statements.filter(
      (statement) =>
        ts.isClassDeclaration(
          statement,
        ),
    );

  if (
    implementationClasses.length !==
      1 ||
    implementationClasses[0].name
      ?.text !==
      spec.className
  ) {
    fail(
      `Implementação extraída inválida: ${implementationPath}`,
    );
  }

  if (
    implementationAfter.includes(
      "src/plugins/"
    ) ||
    internalImports.some(
      (importLine) =>
        importLine.includes(
          "/plugins/",
        ),
    )
  ) {
    fail(
      `Implementação internal não pode importar plugins: ${implementationPath}`,
    );
  }

  const importedInternalSpecifier =
    JSON.stringify(
      implementationImportSpecifier,
    );

  if (
    !pluginAfter.includes(
      importedInternalSpecifier,
    )
  ) {
    fail(
      `Bridge não importa sua implementação internal: ${pluginPath}`,
    );
  }

  return {
    moduleKey:
      spec.moduleKey,
    capabilityId:
      moduleRecord.capabilityId,
    className:
      spec.className,
    exportedNames:
      movedNames,
    pluginPath,
    implementationPath,
    pluginBefore:
      sourceText,
    pluginAfter,
    implementationAfter,
    pluginShaBefore:
      sha256Text(
        sourceText,
      ),
    pluginShaAfter:
      sha256Text(
        pluginAfter,
      ),
    implementationShaAfter:
      sha256Text(
        implementationAfter,
      ),
    pluginBytesBefore:
      Buffer.byteLength(
        sourceText,
        "utf8",
      ),
    pluginBytesAfter:
      Buffer.byteLength(
        pluginAfter,
        "utf8",
      ),
    implementationBytes:
      Buffer.byteLength(
        implementationAfter,
        "utf8",
      ),
  };
}

function validateThinBridgePlugins(
  ts,
  rootDir,
) {
  for (
    const moduleKey of
      EXCLUDED_CANONICAL_BRIDGES
  ) {
    const pluginPath =
      `src/plugins/${moduleKey}/plugin.ts`;

    const source =
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
        "utf8",
      );

    const sourceFile =
      parseSource(
        ts,
        pluginPath,
        source,
      );

    const classes =
      sourceFile.statements.filter(
        (statement) =>
          ts.isClassDeclaration(
            statement,
          ),
      );

    if (
      classes.length !==
      0
    ) {
      fail(
        `${pluginPath} deveria permanecer bridge sem classe técnica na Etapa 12.`,
      );
    }
  }
}

function backupPathsFor(
  transformation,
) {
  const prefix =
    `.migration/stage12/backups/${transformation.moduleKey}`;

  return {
    pluginBefore:
      `${prefix}/plugin.before.ts`,
    pluginAfter:
      `${prefix}/plugin.after.ts`,
    implementationAfter:
      `${prefix}/${transformation.className}.after.ts`,
  };
}

function writeBackups(
  rootDir,
  transformations,
) {
  const records =
    [];

  for (
    const transformation of
      transformations
  ) {
    const paths =
      backupPathsFor(
        transformation,
      );

    const files =
      [
        {
          relativePath:
            paths.pluginBefore,
          content:
            transformation.pluginBefore,
        },
        {
          relativePath:
            paths.pluginAfter,
          content:
            transformation.pluginAfter,
        },
        {
          relativePath:
            paths.implementationAfter,
          content:
            transformation.implementationAfter,
        },
      ];

    for (
      const file of
        files
    ) {
      const absolute =
        fromPosixRelative(
          rootDir,
          file.relativePath,
        );

      if (
        fs.existsSync(
          absolute,
        )
      ) {
        fail(
          `Backup da Etapa 12 já existe sem journal consolidado: ${file.relativePath}`,
        );
      }

      writeTextAtomic(
        absolute,
        file.content,
      );
    }

    records.push(
      {
        moduleKey:
          transformation.moduleKey,
        ...paths,
        pluginBeforeSha256:
          sha256Text(
            transformation.pluginBefore,
          ),
        pluginAfterSha256:
          sha256Text(
            transformation.pluginAfter,
          ),
        implementationAfterSha256:
          sha256Text(
            transformation.implementationAfter,
          ),
      },
    );
  }

  return records;
}

function validateBackupRecord(
  rootDir,
  operation,
) {
  const checks =
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
      checks
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
        `Backup inválido da Etapa 12: ${relativePath}`,
      );
    }
  }
}

function buildStage12Operation(
  transformation,
  backup,
  sequence,
  timestampUtc,
) {
  return {
    sequence,
    sourceStage: 12,
    moduleKey:
      transformation.moduleKey,
    capabilityId:
      transformation.capabilityId,
    isWorker: false,
    oldPath:
      transformation.pluginPath,
    newPath:
      transformation.implementationPath,
    bytes:
      transformation.implementationBytes,
    shaBefore:
      transformation.pluginShaBefore,
    shaAfter:
      transformation.implementationShaAfter,
    timestampUtc,
    transformation:
      "extract-plugin-implementation",
    state:
      "applied",
    rollbackTimestampUtc:
      null,
    pluginPath:
      transformation.pluginPath,
    implementationPath:
      transformation.implementationPath,
    className:
      transformation.className,
    exportedNames:
      transformation.exportedNames,
    pluginBytesBefore:
      transformation.pluginBytesBefore,
    pluginBytesAfter:
      transformation.pluginBytesAfter,
    implementationBytes:
      transformation.implementationBytes,
    pluginShaBefore:
      transformation.pluginShaBefore,
    pluginShaAfter:
      transformation.pluginShaAfter,
    implementationShaAfter:
      transformation.implementationShaAfter,
    backupBeforePath:
      backup.pluginBefore,
    backupBeforeSha256:
      backup.pluginBeforeSha256,
    backupAfterPath:
      backup.pluginAfter,
    backupAfterSha256:
      backup.pluginAfterSha256,
    implementationBackupPath:
      backup.implementationAfter,
    implementationBackupSha256:
      backup.implementationAfterSha256,
  };
}

function buildStage12Journal(
  stage5,
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
      totalExtractions:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      createdImplementationFiles:
        operations.length,
      rewrittenPluginBridges:
        operations.length,
      stage10MoveOperationsPreserved:
        EXPECTED_MOVE_COUNT,
      playerTouched:
        0,
      debugTouched:
        0,
      inputTouched:
        0,
      renderTouched:
        0,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            stage12IdentityV2(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "Etapa 12 extrai somente implementações técnicas embutidas em 21 plugins canônicos.",
      "input e render permanecem bridges existentes; debug é tooling; player é experimental/orphaned.",
      "Nenhum import global do restante do projeto é reescrito nesta etapa.",
      "Os backups before/after permitem rollback sem depender do Git.",
    ],
  };
}

function upgradeGlobalJournal(
  v20,
  stage12Journal,
) {
  const moveOperations =
    v20.operations.map(
      (operation) => ({
        ...operation,
        sourceStage:
          operation.sourceStage ??
          10,
      }),
    );

  const extractionOperations =
    stage12Journal.operations.map(
      (operation, index) => ({
        ...operation,
        sequence:
          EXPECTED_MOVE_COUNT +
          index +
          1,
      }),
    );

  const operations =
    [
      ...moveOperations,
      ...extractionOperations,
    ];

  const now =
    new Date().toISOString();

  const sourceJournals =
    Array.isArray(
      v20.sourceJournals,
    )
      ? [...v20.sourceJournals]
      : [];

  if (
    !sourceJournals.some(
      (record) =>
        record.path ===
        STAGE12_JOURNAL_PATH,
    )
  ) {
    sourceJournals.push(
      {
        stage:
          STAGE_NAME,
        path:
          STAGE12_JOURNAL_PATH,
        statusAtConsolidation:
          stage12Journal.status,
      },
    );
  }

  const implementationBytes =
    extractionOperations.reduce(
      (
        sum,
        operation,
      ) =>
        sum +
        operation.implementationBytes,
      0,
    );

  return {
    ...v20,
    schemaVersion: 2,
    journalRevision: 2,
    status:
      "migrated",
    updatedAtUtc:
      now,
    sourceJournals,
    counts: {
      ...v20.counts,
      totalOperations:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      stage10MoveOperations:
        EXPECTED_MOVE_COUNT,
      stage12Extractions:
        EXPECTED_EXTRACTION_COUNT,
      workers:
        EXPECTED_WORKER_COUNT,
      stage10TotalBytes:
        EXPECTED_STAGE10_BYTES,
      stage12ImplementationBytes:
        implementationBytes,
    },
    operationsIdentityAlgorithm:
      "semantic-sha256-v2",
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            stage12IdentityV2(
              operation,
            ),
        ),
      ),
    operations,
  };
}

function validateCurrentStage12State(
  rootDir,
  stage12Journal,
  v20Journal,
) {
  if (
    stage12Journal.schemaVersion !==
      1 ||
    stage12Journal.stage !==
      STAGE_NAME ||
    stage12Journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    stage12Journal.status !==
      "completed" ||
    !Array.isArray(
      stage12Journal.operations,
    ) ||
    stage12Journal.operations.length !==
      EXPECTED_EXTRACTION_COUNT
  ) {
    fail(
      "Journal existente da Etapa 12 é incompatível.",
    );
  }

  const computedStage12Identity =
    semanticSha256(
      stage12Journal.operations.map(
        (operation) =>
          stage12IdentityV2(
            operation,
          ),
      ),
    );

  if (
    computedStage12Identity !==
    stage12Journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal da Etapa 12 divergiu.",
    );
  }

  for (
    const operation of
      stage12Journal.operations
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
        `Etapa 12 existente divergiu no filesystem: ${operation.moduleKey}`,
      );
    }

    validateBackupRecord(
      rootDir,
      operation,
    );
  }

  if (
    v20Journal.schemaVersion !==
      2 ||
    v20Journal.status !==
      "migrated" ||
    !Array.isArray(
      v20Journal.operations,
    ) ||
    v20Journal.operations.length !==
      EXPECTED_MOVE_COUNT +
      EXPECTED_EXTRACTION_COUNT ||
    v20Journal.counts
      ?.stage12Extractions !==
      EXPECTED_EXTRACTION_COUNT
  ) {
    fail(
      "Journal global v20 não está consolidado com a Etapa 12.",
    );
  }

  const computedGlobalIdentity =
    semanticSha256(
      v20Journal.operations.map(
        (operation) =>
          stage12IdentityV2(
            operation,
          ),
      ),
    );

  if (
    computedGlobalIdentity !==
    v20Journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global divergiu após Etapa 12.",
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

function validateProtectedPluginHashes(
  rootDir,
  stage3,
) {
  for (
    const pluginKey of
      FORBIDDEN_NON_CANONICAL_PLUGINS
  ) {
    const pluginPath =
      `src/plugins/${pluginKey}/plugin.ts`;

    const baseline =
      stage3.byPath.get(
        pluginPath,
      );

    if (
      baseline ===
      undefined
    ) {
      fail(
        `Baseline protegido ausente para ${pluginPath}`,
      );
    }

    const info =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
      );

    if (
      info.kind !==
        "file" ||
      info.sha256 !==
        baseline.sha256
    ) {
      fail(
        `Plugin protegido foi alterado: ${pluginPath}`,
      );
    }
  }

  for (
    const moduleKey of
      EXCLUDED_CANONICAL_BRIDGES
  ) {
    const pluginPath =
      `src/plugins/${moduleKey}/plugin.ts`;

    const baseline =
      stage3.byPath.get(
        pluginPath,
      );

    const info =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
      );

    if (
      baseline ===
        undefined ||
      info.kind !==
        "file" ||
      info.sha256 !==
        baseline.sha256
    ) {
      fail(
        `Bridge excluída foi alterada: ${pluginPath}`,
      );
    }
  }
}

function rollbackStage12OwnWrites(
  rootDir,
  transformations,
  originalGlobalJournalBuffer,
) {
  const errors =
    [];

  for (
    let index =
      transformations.length -
      1;
    index >=
      0;
    index -=
      1
  ) {
    const transformation =
      transformations[
        index
      ];

    try {
      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          transformation.pluginPath,
        ),
        transformation.pluginBefore,
      );

      fs.rmSync(
        fromPosixRelative(
          rootDir,
          transformation.implementationPath,
        ),
        {
          force: true,
        },
      );
    } catch (
      error
    ) {
      errors.push(
        `${transformation.moduleKey}: ${
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
      originalGlobalJournalBuffer,
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
        ".migration/stage12",
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
      `cleanup-stage12: ${
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

function runStage12() {
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

  validateStage10Layout(
    rootDir,
    stage5,
  );

  loadStage10Journal(
    rootDir,
    stage5,
  );

  const existingStage12Path =
    fromPosixRelative(
      rootDir,
      STAGE12_JOURNAL_PATH,
    );

  const currentV20 =
    readJson(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      V20_JOURNAL_PATH,
    );

  if (
    fs.existsSync(
      existingStage12Path,
    )
  ) {
    const stage12Journal =
      readJson(
        existingStage12Path,
        STAGE12_JOURNAL_PATH,
      );

    validateCurrentStage12State(
      rootDir,
      stage12Journal,
      currentV20,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 12 JÁ ESTÁ CONCLUÍDA                   ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] Extrações: ${String(EXPECTED_EXTRACTION_COUNT)}/${String(EXPECTED_EXTRACTION_COUNT)}`,
    );
    console.log(
      "[OK] Plugins transformados em bridges: 21/21",
    );
    console.log(
      "[OK] player/debug/input/render preservados.",
    );
    console.log(
      "[OK] Journal global v20 consolidado.",
    );
    return;
  }

  const v20 =
    loadV20JournalV1(
      rootDir,
      stage5,
    );

  const stage3 =
    loadStage3Files(
      rootDir,
      stage5,
    );

  validateBaselinePluginFiles(
    rootDir,
    stage3,
  );

  validateProtectedPluginHashes(
    rootDir,
    stage3,
  );

  const ts =
    loadTypeScript();

  validateThinBridgePlugins(
    ts,
    rootDir,
  );

  const moduleMap =
    moduleByKey();

  const transformations =
    [];

  for (
    const spec of
      EXTRACTION_SPECS
  ) {
    const moduleRecord =
      moduleMap.get(
        spec.moduleKey,
      );

    if (
      moduleRecord ===
      undefined
    ) {
      fail(
        `Módulo ausente: ${spec.moduleKey}`,
      );
    }

    const pluginPath =
      moduleRecord.plugin;

    const implementationPath =
      `${moduleRecord.engine.internalRoot}/${spec.className}.ts`;

    const implementationAbsolute =
      fromPosixRelative(
        rootDir,
        implementationPath,
      );

    if (
      fs.existsSync(
        implementationAbsolute,
      )
    ) {
      fail(
        `Destino da Etapa 12 já existe sem journal: ${implementationPath}`,
      );
    }

    const source =
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          pluginPath,
        ),
        "utf8",
      );

    const transformed =
      transformPlugin(
        ts,
        rootDir,
        spec,
        moduleRecord,
        stage5,
        source,
      );

    transformations.push(
      transformed,
    );
  }

  if (
    transformations.length !==
    EXPECTED_EXTRACTION_COUNT
  ) {
    fail(
      "Quantidade de transformações calculadas divergiu de 21.",
    );
  }

  const mutablePaths =
    transformations.flatMap(
      (transformation) => [
        transformation.pluginPath,
        transformation.implementationPath,
      ],
    );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      mutablePaths,
    );

  const originalGlobalJournalBuffer =
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
    );

  const applied =
    [];

  try {
    const backups =
      writeBackups(
        rootDir,
        transformations,
      );

    const backupByModule =
      new Map(
        backups.map(
          (record) => [
            record.moduleKey,
            record,
          ],
        ),
      );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 12: EXTRAÇÃO DOS PLUGINS               ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] Etapa 10: ${String(EXPECTED_MOVE_COUNT)}/${String(EXPECTED_MOVE_COUNT)} arquivos em /internal.`,
    );
    console.log(
      `[OK] Etapa 11: journal global em estado migrated.`,
    );
    console.log(
      `[OK] Extrações planejadas: ${String(EXPECTED_EXTRACTION_COUNT)}`,
    );
    console.log(
      "[OK] input/render: bridges já finas, fora da extração.",
    );
    console.log(
      "[OK] debug: tooling, fora da extração.",
    );
    console.log(
      "[OK] player: experimental/orphaned, intocado.",
    );
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    const stage12Operations =
      [];

    for (
      let index = 0;
      index <
        transformations.length;
      index +=
        1
    ) {
      const transformation =
        transformations[
          index
        ];

      const backup =
        backupByModule.get(
          transformation.moduleKey,
        );

      if (
        backup ===
        undefined
      ) {
        fail(
          `Backup ausente para ${transformation.moduleKey}`,
        );
      }

      applied.push(
        transformation,
      );

      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          transformation.implementationPath,
        ),
        transformation.implementationAfter,
      );

      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          transformation.pluginPath,
        ),
        transformation.pluginAfter,
      );

      const pluginInfo =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            transformation.pluginPath,
          ),
        );

      const implementationInfo =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            transformation.implementationPath,
          ),
        );

      if (
        pluginInfo.sha256 !==
          transformation.pluginShaAfter ||
        implementationInfo.sha256 !==
          transformation.implementationShaAfter
      ) {
        fail(
          `SHA pós-extração divergiu em ${transformation.moduleKey}.`,
        );
      }

      const timestampUtc =
        new Date().toISOString();

      const operation =
        buildStage12Operation(
          transformation,
          backup,
          EXPECTED_MOVE_COUNT +
            index +
            1,
          timestampUtc,
        );

      stage12Operations.push(
        operation,
      );

      console.log(
        `  [OK] ${transformation.pluginPath} -> bridge | ${transformation.implementationPath}`,
      );
    }

    const stage12Journal =
      buildStage12Journal(
        stage5,
        stage12Operations,
      );

    writeJsonAtomic(
      existingStage12Path,
      stage12Journal,
    );

    for (
      const operation of
        stage12Journal.operations
    ) {
      validateBackupRecord(
        rootDir,
        operation,
      );
    }

    const upgradedV20 =
      upgradeGlobalJournal(
        v20,
        stage12Journal,
      );

    writeJsonAtomic(
      fromPosixRelative(
        rootDir,
        V20_JOURNAL_PATH,
      ),
      upgradedV20,
    );

    validateCurrentStage12State(
      rootDir,
      stage12Journal,
      upgradedV20,
    );

    validateProtectedPluginHashes(
      rootDir,
      stage3,
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
          "Arquivo fora dos 42 paths da Etapa 12 foi alterado.",
          `Digest protegido antes: ${protectedBefore.digest}`,
          `Digest protegido depois: ${protectedAfter.digest}`,
        ].join(
          "\n",
        ),
      );
    }

    const implementationBytes =
      stage12Operations.reduce(
        (
          sum,
          operation,
        ) =>
          sum +
          operation.implementationBytes,
        0,
      );

    console.log("");
    console.log(
      "=== VALIDAÇÃO FINAL ===",
    );
    console.log(
      `[OK] Implementações extraídas: ${String(stage12Operations.length)}/${String(EXPECTED_EXTRACTION_COUNT)}`,
    );
    console.log(
      `[OK] Plugin bridges reescritos: ${String(stage12Operations.length)}/${String(EXPECTED_EXTRACTION_COUNT)}`,
    );
    console.log(
      `[OK] Novos bytes em internal: ${String(implementationBytes)}`,
    );
    console.log(
      `[OK] Journal: ${STAGE12_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global v20: ${String(upgradedV20.operations.length)} operações (93 Etapa 10 + 21 Etapa 12).`,
    );
    console.log(
      `[OK] Rollback atualizado: ${ROLLBACK_SCRIPT_PATH}`,
    );
    console.log(
      "[OK] player/debug/input/render: nenhum byte alterado.",
    );
    console.log(
      "[OK] Imports globais reescritos: 0.",
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
      "  ETAPA 12 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "As 21 implementações técnicas foram removidas dos plugin bridges e materializadas em seus próprios src/engine/<module>/internal/**.",
    );
  } catch (
    error
  ) {
    const compensationErrors =
      rollbackStage12OwnWrites(
        rootDir,
        applied,
        originalGlobalJournalBuffer,
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
          "[OK] Compensação da Etapa 12 restaurou os plugins e removeu implementações criadas nesta execução.",
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
    runStage12();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 12 não concluída.",
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
