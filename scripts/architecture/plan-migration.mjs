#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
  EXPECTED_STAGE3_CONTRACT_AREAS,
  EXPECTED_STAGE3_ENGINE_MODULES,
  EXPECTED_STAGE3_PLUGINS,
  EXPECTED_STAGE3_TOKENS,
  EXPERIMENTAL_PLUGINS,
  FUNCTIONAL_MODULES,
  MODULE_MAP_SCHEMA_VERSION,
  STAGE_NAME as MODULE_MAP_STAGE_NAME,
  TOOLING_PLUGINS,
  RUNTIME_MODULES,
} from "./module-map.mjs";

export const MIGRATION_PLAN_SCHEMA_VERSION = 1;
export const STAGE_NAME = "stage-5-path-migration-plan";
export const STAGE5_OUTPUT_ROOT = ".migration/stage5";

const STAGE3_NAME =
  "stage-3-architecture-inventory";

const SOURCE_ENGINE_PREFIX =
  "src/engine/";

const RESERVED_TARGET_SEGMENTS =
  new Set([
    "public",
    "internal",
  ]);

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(
  inputPath,
) {
  const resolved =
    path.resolve(
      inputPath,
    );

  const normalized =
    path.normalize(
      resolved,
    );

  return (
    process.platform ===
    "win32"
      ? normalized.toLowerCase()
      : normalized
  );
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
    .join("/");
}

function fromPosixRelative(
  rootDir,
  relativePath,
) {
  return path.join(
    rootDir,
    ...relativePath.split("/"),
  );
}

function portablePathKey(
  relativePath,
) {
  return relativePath
    .normalize("NFKC")
    .replaceAll("\\", "/")
    .toLocaleLowerCase("en-US");
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
    if (
      allowFailure
    ) {
      return null;
    }

    throw result.error;
  }

  if (
    result.status !==
    0
  ) {
    if (
      allowFailure
    ) {
      return null;
    }

    const stderr =
      String(
        result.stderr ??
          "",
      ).trim();

    fail(
      stderr.length >
      0
        ? `${executable} ${args.join(" ")} falhou: ${stderr}`
        : `${executable} ${args.join(" ")} falhou com código ${String(result.status)}.`,
    );
  }

  return String(
    result.stdout ??
      "",
  ).trimEnd();
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

function assertRepositoryRoot(
  cwd,
) {
  const inside =
    runGit(
      [
        "rev-parse",
        "--is-inside-work-tree",
      ],
      cwd,
    );

  if (
    inside !==
    "true"
  ) {
    fail(
      "O diretório atual não pertence a um repositório Git.",
    );
  }

  const gitRootRaw =
    runGit(
      [
        "rev-parse",
        "--show-toplevel",
      ],
      cwd,
    );

  if (
    normalizeAbsolute(
      cwd,
    ) !==
    normalizeAbsolute(
      gitRootRaw,
    )
  ) {
    fail(
      [
        "Este script deve ser executado exatamente na raiz do repositório.",
        `Diretório atual: ${cwd}`,
        `Raiz detectada: ${gitRootRaw}`,
      ].join("\n"),
    );
  }

  return path.resolve(
    gitRootRaw,
  );
}

function assertFreezeStillUnlocked(
  rootDir,
) {
  const lockPath =
    path.join(
      rootDir,
      "tests",
      ".freeze-lock.json",
    );

  if (
    fs.existsSync(
      lockPath,
    )
  ) {
    fail(
      [
        "O freeze foi reativado antes da Etapa 5.",
        "tests/.freeze-lock.json existe novamente.",
        "A Etapa 5 exige o estado desbloqueado estabelecido pela Etapa 2.",
      ].join("\n"),
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
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function assertRegularFile(
  rootDir,
  relativePath,
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
      `Arquivo obrigatório ausente: ${relativePath}`,
    );
  }

  const stat =
    fs.lstatSync(
      absolutePath,
    );

  if (
    !stat.isFile()
  ) {
    fail(
      `Path deveria ser arquivo regular: ${relativePath}`,
    );
  }

  if (
    stat.isSymbolicLink()
  ) {
    fail(
      `Symlink não é aceito como arquivo de origem da migração: ${relativePath}`,
    );
  }

  return absolutePath;
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
      .join(",")}]`;
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
    .join(",")}}`;
}

function makeRunId(
  date,
) {
  return date
    .toISOString()
    .replace(
      /\.\d{3}Z$/u,
      "Z",
    )
    .replaceAll(
      ":",
      "-",
    );
}

function ensureDirectory(
  dirPath,
) {
  fs.mkdirSync(
    dirPath,
    {
      recursive:
        true,
    },
  );
}

function writeText(
  filePath,
  content,
) {
  fs.writeFileSync(
    filePath,
    content,
    {
      encoding:
        "utf8",
    },
  );
}

function writeJson(
  filePath,
  value,
) {
  writeText(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function getRepositoryMetadata(
  rootDir,
) {
  const head =
    runGit(
      [
        "rev-parse",
        "--verify",
        "HEAD",
      ],
      rootDir,
      true,
    );

  const branch =
    runGit(
      [
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
      ],
      rootDir,
      true,
    ) ??
    runGit(
      [
        "branch",
        "--show-current",
      ],
      rootDir,
      true,
    ) ??
    "";

  return {
    branch:
      branch.length >
      0
        ? branch
        : null,
    head,
    hasCommits:
      head !==
      null,
    gitVersion:
      runGit(
        [
          "--version",
        ],
        rootDir,
      ),
    status:
      runGit(
        [
          "status",
          "--short",
          "--branch",
          "--untracked-files=all",
        ],
        rootDir,
      ),
  };
}

function loadLatestStage4(
  rootDir,
) {
  const stage4Root =
    path.join(
      rootDir,
      ".migration",
      "stage4",
    );

  const latestPath =
    path.join(
      stage4Root,
      "LATEST",
    );

  if (
    !fs.existsSync(
      latestPath,
    )
  ) {
    fail(
      "Pré-condição ausente: .migration/stage4/LATEST",
    );
  }

  const runId =
    fs
      .readFileSync(
        latestPath,
        "utf8",
      )
      .trim();

  if (
    runId.length ===
    0
  ) {
    fail(
      ".migration/stage4/LATEST está vazio.",
    );
  }

  const runDir =
    path.join(
      stage4Root,
      runId,
    );

  const reportPath =
    path.join(
      runDir,
      "module-map-report.json",
    );

  const snapshotPath =
    path.join(
      runDir,
      "module-map.snapshot.json",
    );

  if (
    !fs.existsSync(
      reportPath,
    )
  ) {
    fail(
      `Relatório da Etapa 4 ausente: ${toPosixRelative(rootDir, reportPath)}`,
    );
  }

  if (
    !fs.existsSync(
      snapshotPath,
    )
  ) {
    fail(
      `Snapshot do module-map ausente: ${toPosixRelative(rootDir, snapshotPath)}`,
    );
  }

  const report =
    readJson(
      reportPath,
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    );

  const snapshot =
    readJson(
      snapshotPath,
      toPosixRelative(
        rootDir,
        snapshotPath,
      ),
    );

  if (
    report.stage !==
    MODULE_MAP_STAGE_NAME
  ) {
    fail(
      `Stage inesperado em module-map-report.json: ${String(report.stage)}`,
    );
  }

  if (
    report.status !==
    "passed"
  ) {
    fail(
      `A Etapa 4 mais recente não está aprovada. Status: ${String(report.status)}`,
    );
  }

  if (
    report.architectureMigrationVersion !==
    ARCHITECTURE_MIGRATION_VERSION
  ) {
    fail(
      `Versão arquitetural divergente na Etapa 4: ${String(report.architectureMigrationVersion)}`,
    );
  }

  if (
    report.sourceOfTruth !==
    "scripts/architecture/module-map.mjs"
  ) {
    fail(
      `Fonte de verdade inesperada na Etapa 4: ${String(report.sourceOfTruth)}`,
    );
  }

  return {
    runId,
    runDir,
    reportPath:
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    snapshotPath:
      toPosixRelative(
        rootDir,
        snapshotPath,
      ),
    report,
    snapshot,
  };
}

function buildCurrentModuleMapSnapshot() {
  return {
    schemaVersion:
      MODULE_MAP_SCHEMA_VERSION,
    architectureMigrationVersion:
      ARCHITECTURE_MIGRATION_VERSION,
    functionalModules:
      FUNCTIONAL_MODULES,
    runtimeModules:
      RUNTIME_MODULES,
    canonicalModules:
      CANONICAL_MODULES,
    toolingPlugins:
      TOOLING_PLUGINS,
    experimentalPlugins:
      EXPERIMENTAL_PLUGINS,
    expectedStage3: {
      engineModules:
        EXPECTED_STAGE3_ENGINE_MODULES,
      plugins:
        EXPECTED_STAGE3_PLUGINS,
      tokens:
        EXPECTED_STAGE3_TOKENS,
      contractAreas:
        EXPECTED_STAGE3_CONTRACT_AREAS,
    },
  };
}

function assertStage4MatchesCurrentModuleMap(
  stage4,
) {
  const current =
    buildCurrentModuleMapSnapshot();

  const expectedHash =
    sha256Text(
      stableStringify(
        stage4.snapshot,
      ),
    );

  const currentHash =
    sha256Text(
      stableStringify(
        current,
      ),
    );

  if (
    currentHash !==
    expectedHash
  ) {
    fail(
      [
        "scripts/architecture/module-map.mjs divergiu do snapshot aprovado na Etapa 4.",
        `Snapshot Etapa 4: ${expectedHash}`,
        `Module map atual: ${currentHash}`,
        "Execute novamente a Etapa 4 antes de gerar um novo plano de migração.",
      ].join("\n"),
    );
  }

  return {
    matches:
      true,
    snapshotSemanticSha256:
      expectedHash,
    currentSemanticSha256:
      currentHash,
  };
}

function loadStage3FromStage4(
  rootDir,
  stage4,
) {
  const reportPath =
    stage4.report
      ?.stage3
      ?.reportPath;

  if (
    typeof reportPath !==
      "string" ||
    reportPath.length ===
      0
  ) {
    fail(
      "A Etapa 4 não referencia o relatório da Etapa 3.",
    );
  }

  const absoluteReportPath =
    fromPosixRelative(
      rootDir,
      reportPath,
    );

  if (
    !fs.existsSync(
      absoluteReportPath,
    )
  ) {
    fail(
      `Relatório referenciado da Etapa 3 não existe: ${reportPath}`,
    );
  }

  const inventory =
    readJson(
      absoluteReportPath,
      reportPath,
    );

  if (
    inventory.stage !==
    STAGE3_NAME
  ) {
    fail(
      `Stage inesperado no inventário da Etapa 3: ${String(inventory.stage)}`,
    );
  }

  if (
    inventory.preconditions
      ?.freezeUnlocked !==
    true
  ) {
    fail(
      "O inventário da Etapa 3 não registra freeze desbloqueado.",
    );
  }

  if (
    inventory.parseErrorCount !==
    0
  ) {
    fail(
      `A Etapa 3 contém ${String(inventory.parseErrorCount)} erro(s) de parsing.`,
    );
  }

  const runDir =
    path.dirname(
      absoluteReportPath,
    );

  const filesPath =
    path.join(
      runDir,
      "files.json",
    );

  if (
    !fs.existsSync(
      filesPath,
    )
  ) {
    fail(
      `files.json da Etapa 3 ausente: ${toPosixRelative(rootDir, filesPath)}`,
    );
  }

  const files =
    readJson(
      filesPath,
      toPosixRelative(
        rootDir,
        filesPath,
      ),
    );

  if (
    !Array.isArray(
      files,
    )
  ) {
    fail(
      "files.json da Etapa 3 deveria conter um array.",
    );
  }

  return {
    runId:
      inventory.runId,
    reportPath,
    filesPath:
      toPosixRelative(
        rootDir,
        filesPath,
      ),
    inventory,
    files,
  };
}

function getStage3EngineFiles(
  stage3,
) {
  const records =
    stage3.files
      .filter(
        (record) =>
          record &&
          record.area ===
            "engine" &&
          typeof record.path ===
            "string" &&
          record.path.startsWith(
            SOURCE_ENGINE_PREFIX,
          ),
      )
      .map(
        (record) => ({
          path:
            record.path,
          bytes:
            record.bytes,
          extension:
            record.extension,
          module:
            record.module,
          sha256:
            record.sha256,
        }),
      )
      .sort(
        (a, b) =>
          a.path.localeCompare(
            b.path,
            "en",
          ),
      );

  const expectedFileCount =
    (stage3.inventory.engineModules ??
      []).reduce(
      (
        total,
        moduleRecord,
      ) =>
        total +
        Number(
          moduleRecord.fileCount ??
            0,
        ),
      0,
    );

  if (
    records.length !==
    expectedFileCount
  ) {
    fail(
      [
        "Inconsistência interna na Etapa 3.",
        `files.json contém ${String(records.length)} arquivo(s) de engine.`,
        `architecture-inventory.json declara ${String(expectedFileCount)} arquivo(s) de engine.`,
      ].join("\n"),
    );
  }

  return records;
}

function findModuleForSourcePath(
  sourcePath,
) {
  const matches =
    CANONICAL_MODULES.filter(
      (moduleRecord) =>
        sourcePath ===
          moduleRecord.engine.root ||
        sourcePath.startsWith(
          `${moduleRecord.engine.root}/`,
        ),
    );

  if (
    matches.length !==
    1
  ) {
    fail(
      `Não foi possível atribuir "${sourcePath}" a exatamente um módulo canônico.`,
    );
  }

  return matches[0];
}

function assertUnmigratedSourcePath(
  moduleRecord,
  sourcePath,
) {
  const relativeWithinModule =
    sourcePath.slice(
      `${moduleRecord.engine.root}/`
        .length,
    );

  if (
    relativeWithinModule.length ===
    0
  ) {
    fail(
      `Arquivo de origem inválido sem caminho relativo: ${sourcePath}`,
    );
  }

  const firstSegment =
    relativeWithinModule
      .split("/")[0];

  if (
    RESERVED_TARGET_SEGMENTS.has(
      firstSegment,
    )
  ) {
    fail(
      [
        `A árvore já contém arquivo em área reservada da arquitetura v20: ${sourcePath}`,
        "A Etapa 5 deve rodar antes da movimentação física para /public ou /internal.",
      ].join("\n"),
    );
  }

  return relativeWithinModule;
}

function assertNoCaseFoldDuplicates(
  paths,
  label,
) {
  const seen =
    new Map();

  for (
    const relativePath of
    paths
  ) {
    const key =
      portablePathKey(
        relativePath,
      );

    const previous =
      seen.get(
        key,
      );

    if (
      previous !==
      undefined &&
      previous !==
      relativePath
    ) {
      fail(
        `${label} possui colisão case-insensitive/Unicode: "${previous}" x "${relativePath}".`,
      );
    }

    seen.set(
      key,
      relativePath,
    );
  }
}

function collectActualEngineFiles(
  rootDir,
) {
  const records = [];

  const visitDirectory = (
    absoluteDir,
  ) => {
    const entries =
      fs
        .readdirSync(
          absoluteDir,
          {
            withFileTypes:
              true,
          },
        )
        .sort(
          (a, b) =>
            a.name.localeCompare(
              b.name,
              "en",
            ),
        );

    for (
      const entry of
      entries
    ) {
      const absolutePath =
        path.join(
          absoluteDir,
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
        fail(
          `Symlink não permitido dentro de src/engine durante a Etapa 5: ${relativePath}`,
        );
      }

      if (
        entry.isDirectory()
      ) {
        visitDirectory(
          absolutePath,
        );
        continue;
      }

      if (
        entry.isFile()
      ) {
        records.push(
          relativePath,
        );
      }
    }
  };

  const engineRoot =
    path.join(
      rootDir,
      "src",
      "engine",
    );

  if (
    !fs.existsSync(
      engineRoot,
    )
  ) {
    fail(
      "Diretório src/engine não existe.",
    );
  }

  visitDirectory(
    engineRoot,
  );

  records.sort(
    (a, b) =>
      a.localeCompare(
        b,
        "en",
      ),
  );

  return records;
}

function classifyActualEngineFiles(
  actualEngineFiles,
) {
  const sourceFiles = [];
  const reservedFiles = [];

  for (
    const relativePath of
    actualEngineFiles
  ) {
    const moduleRecord =
      CANONICAL_MODULES.find(
        (candidate) =>
          relativePath.startsWith(
            `${candidate.engine.root}/`,
          ),
      );

    if (
      !moduleRecord
    ) {
      sourceFiles.push(
        relativePath,
      );
      continue;
    }

    const relativeWithinModule =
      relativePath.slice(
        `${moduleRecord.engine.root}/`.length,
      );

    const firstSegment =
      relativeWithinModule
        .split("/")[0];

    if (
      RESERVED_TARGET_SEGMENTS.has(
        firstSegment,
      )
    ) {
      reservedFiles.push(
        relativePath,
      );
    } else {
      sourceFiles.push(
        relativePath,
      );
    }
  }

  return {
    sourceFiles,
    reservedFiles,
  };
}

function collectExistingReservedEntries(
  rootDir,
  reservedFiles,
) {
  const entries = [];
  const recorded = new Set();

  for (
    const moduleRecord of
    CANONICAL_MODULES
  ) {
    for (
      const reservedRoot of
      [
        moduleRecord.engine.publicRoot,
        moduleRecord.engine.internalRoot,
      ]
    ) {
      const absolutePath =
        fromPosixRelative(
          rootDir,
          reservedRoot,
        );

      if (
        !fs.existsSync(
          absolutePath,
        )
      ) {
        continue;
      }

      const stat =
        fs.lstatSync(
          absolutePath,
        );

      const entry = {
        type:
          "reserved-target-structure-already-exists",
        path:
          reservedRoot,
        kind:
          stat.isDirectory()
            ? "directory"
            : stat.isFile()
              ? "file"
              : stat.isSymbolicLink()
                ? "symlink"
                : "other",
      };

      entries.push(
        entry,
      );
      recorded.add(
        portablePathKey(
          reservedRoot,
        ),
      );
    }
  }

  for (
    const reservedFile of
    reservedFiles
  ) {
    const key =
      portablePathKey(
        reservedFile,
      );

    if (
      recorded.has(
        key,
      )
    ) {
      continue;
    }

    entries.push({
      type:
        "reserved-target-file-already-exists",
      path:
        reservedFile,
      kind:
        "file",
    });
  }

  return entries;
}

function compareExactPathSets(
  actual,
  expected,
  label,
) {
  const actualSet =
    new Set(
      actual,
    );

  const expectedSet =
    new Set(
      expected,
    );

  const missing =
    expected.filter(
      (relativePath) =>
        !actualSet.has(
          relativePath,
        ),
    );

  const unexpected =
    actual.filter(
      (relativePath) =>
        !expectedSet.has(
          relativePath,
        ),
    );

  if (
    missing.length >
      0 ||
    unexpected.length >
      0
  ) {
    fail(
      [
        `${label} divergiu da Etapa 3.`,
        `Ausentes: ${
          missing.length > 0
            ? missing.join(", ")
            : "(nenhum)"
        }`,
        `Inesperados: ${
          unexpected.length > 0
            ? unexpected.join(", ")
            : "(nenhum)"
        }`,
        "A Etapa 5 exige que src/engine ainda esteja no layout inventariado pela Etapa 3.",
      ].join("\n"),
    );
  }

  return {
    matches:
      true,
    count:
      expected.length,
    missing,
    unexpected,
  };
}

function validateSourceIntegrity(
  rootDir,
  stage3EngineFiles,
) {
  const verified = [];

  for (
    const record of
    stage3EngineFiles
  ) {
    const absolutePath =
      assertRegularFile(
        rootDir,
        record.path,
      );

    const stat =
      fs.statSync(
        absolutePath,
      );

    const actualSha256 =
      sha256File(
        absolutePath,
      );

    if (
      typeof record.sha256 !==
        "string" ||
      record.sha256.length !==
        64
    ) {
      fail(
        `Hash SHA-256 inválido no files.json da Etapa 3 para ${record.path}.`,
      );
    }

    if (
      actualSha256 !==
      record.sha256
    ) {
      fail(
        [
          `Arquivo de engine foi alterado desde a Etapa 3: ${record.path}`,
          `Etapa 3: ${record.sha256}`,
          `Atual:   ${actualSha256}`,
        ].join("\n"),
      );
    }

    if (
      Number.isFinite(
        record.bytes,
      ) &&
      stat.size !==
        record.bytes
    ) {
      fail(
        [
          `Tamanho divergente desde a Etapa 3: ${record.path}`,
          `Etapa 3: ${String(record.bytes)} bytes`,
          `Atual:   ${String(stat.size)} bytes`,
        ].join("\n"),
      );
    }

    verified.push({
      path:
        record.path,
      sha256:
        actualSha256,
      bytes:
        stat.size,
    });
  }

  const digestInput =
    verified
      .map(
        (record) =>
          `${record.path}\0${record.sha256}\0${String(record.bytes)}`,
      )
      .join("\n");

  return {
    verifiedFileCount:
      verified.length,
    scopeSha256:
      sha256Text(
        digestInput,
      ),
    files:
      verified,
  };
}

function buildDestinationPath(
  moduleRecord,
  sourcePath,
) {
  const relativeWithinModule =
    assertUnmigratedSourcePath(
      moduleRecord,
      sourcePath,
    );

  return `${moduleRecord.engine.internalRoot}/${relativeWithinModule}`;
}

function detectDestinationCollisions(
  rootDir,
  operations,
) {
  const collisions = [];
  const destinationOwners =
    new Map();

  const sourceKeys =
    new Map(
      operations.map(
        (operation) => [
          portablePathKey(
            operation.oldPath,
          ),
          operation.oldPath,
        ],
      ),
    );

  for (
    const operation of
    operations
  ) {
    const destinationKey =
      portablePathKey(
        operation.newPath,
      );

    const previousOwner =
      destinationOwners.get(
        destinationKey,
      );

    if (
      previousOwner !==
      undefined &&
      previousOwner.oldPath !==
        operation.oldPath
    ) {
      collisions.push({
        type:
          "duplicate-destination",
        newPath:
          operation.newPath,
        sources: [
          previousOwner.oldPath,
          operation.oldPath,
        ],
      });

      continue;
    }

    destinationOwners.set(
      destinationKey,
      operation,
    );

    const destinationAbsolute =
      fromPosixRelative(
        rootDir,
        operation.newPath,
      );

    if (
      fs.existsSync(
        destinationAbsolute,
      )
    ) {
      collisions.push({
        type:
          "destination-already-exists",
        oldPath:
          operation.oldPath,
        newPath:
          operation.newPath,
      });
    }

    const sourceAtDestination =
      sourceKeys.get(
        destinationKey,
      );

    if (
      sourceAtDestination !==
        undefined &&
      sourceAtDestination !==
        operation.oldPath
    ) {
      collisions.push({
        type:
          "destination-overlaps-source",
        oldPath:
          operation.oldPath,
        newPath:
          operation.newPath,
        sourceAtDestination,
      });
    }

    let parent =
      path.dirname(
        destinationAbsolute,
      );

    const rootAbsolute =
      path.resolve(
        rootDir,
      );

    while (
      normalizeAbsolute(
        parent,
      ) !==
      normalizeAbsolute(
        rootAbsolute,
      )
    ) {
      if (
        fs.existsSync(
          parent,
        )
      ) {
        const parentStat =
          fs.lstatSync(
            parent,
          );

        if (
          !parentStat.isDirectory()
        ) {
          collisions.push({
            type:
              "destination-parent-is-not-directory",
            oldPath:
              operation.oldPath,
            newPath:
              operation.newPath,
            blockingPath:
              toPosixRelative(
                rootDir,
                parent,
              ),
          });
        }

        break;
      }

      const next =
        path.dirname(
          parent,
        );

      if (
        next ===
        parent
      ) {
        break;
      }

      parent =
        next;
    }
  }

  return collisions;
}

function assertNoDestinationCollisions(
  collisions,
) {
  if (
    collisions.length ===
    0
  ) {
    return;
  }

  const preview =
    collisions
      .slice(
        0,
        20,
      )
      .map(
        (
          collision,
          index,
        ) =>
          `${String(index + 1)}. ${collision.type}: ${JSON.stringify(collision)}`,
      );

  fail(
    [
      `Foram detectadas ${String(collisions.length)} colisão(ões) de destino.`,
      ...preview,
      collisions.length >
      20
        ? `... e mais ${String(collisions.length - 20)} colisão(ões).`
        : "",
      "Nenhum plano foi aprovado.",
    ]
      .filter(
        (line) =>
          line.length >
          0,
      )
      .join("\n"),
  );
}

function buildMappingObject(
  operations,
) {
  const mapping = {};

  for (
    const operation of
    operations
  ) {
    mapping[
      operation.oldPath
    ] =
      operation.newPath;
  }

  return mapping;
}

function buildPlannedDirectories() {
  const directories =
    new Set();

  for (
    const moduleRecord of
    CANONICAL_MODULES
  ) {
    directories.add(
      moduleRecord.engine.root,
    );
    directories.add(
      moduleRecord.engine.publicRoot,
    );
    directories.add(
      moduleRecord.engine.internalRoot,
    );
  }

  return [
    ...directories,
  ].sort(
    (a, b) =>
      a.localeCompare(
        b,
        "en",
      ),
  );
}

function buildOperations(
  rootDir,
  stage3EngineFiles,
) {
  const operations =
    stage3EngineFiles.map(
      (record) => {
        const moduleRecord =
          findModuleForSourcePath(
            record.path,
          );

        if (
          record.module !==
            null &&
          record.module !==
            undefined &&
          record.module !==
            moduleRecord.engine.directoryName
        ) {
          fail(
            `Módulo divergente para ${record.path}: files.json=${String(record.module)}, module-map=${moduleRecord.key}.`,
          );
        }

        const relativeWithinModule =
          assertUnmigratedSourcePath(
            moduleRecord,
            record.path,
          );

        const newPath =
          buildDestinationPath(
            moduleRecord,
            record.path,
          );

        return {
          moduleKey:
            moduleRecord.key,
          moduleCategory:
            moduleRecord.category,
          layer:
            moduleRecord.layer,
          capabilityId:
            moduleRecord.capabilityId,
          oldPath:
            record.path,
          newPath,
          relativeWithinModule,
          fileName:
            path.posix.basename(
              record.path,
            ),
          extension:
            record.extension,
          bytes:
            record.bytes,
          sha256:
            record.sha256,
          isWorker:
            /\.worker\.[cm]?[jt]sx?$/u.test(
              record.path,
            ),
          operation:
            "move",
          rewriteImportsLater:
            true,
        };
      },
    );

  operations.sort(
    (a, b) =>
      a.oldPath.localeCompare(
        b.oldPath,
        "en",
      ),
  );

  assertNoCaseFoldDuplicates(
    operations.map(
      (operation) =>
        operation.oldPath,
    ),
    "Paths de origem",
  );

  assertNoCaseFoldDuplicates(
    operations.map(
      (operation) =>
        operation.newPath,
    ),
    "Paths de destino",
  );

  for (
    const operation of
    operations
  ) {
    const sourceAbsolute =
      fromPosixRelative(
        rootDir,
        operation.oldPath,
      );

    const destinationAbsolute =
      fromPosixRelative(
        rootDir,
        operation.newPath,
      );

    if (
      normalizeAbsolute(
        sourceAbsolute,
      ) ===
      normalizeAbsolute(
        destinationAbsolute,
      )
    ) {
      fail(
        `Mapeamento nulo detectado: ${operation.oldPath}`,
      );
    }

    const sourceRoot =
      normalizeAbsolute(
        path.dirname(
          sourceAbsolute,
        ),
      );

    const destinationRoot =
      normalizeAbsolute(
        path.dirname(
          destinationAbsolute,
        ),
      );

    if (
      destinationRoot ===
      sourceRoot
    ) {
      fail(
        `Destino não entrou em /internal para ${operation.oldPath}.`,
      );
    }
  }

  return operations;
}

function summarizeByModule(
  operations,
) {
  const summary =
    CANONICAL_MODULES.map(
      (moduleRecord) => {
        const moduleOperations =
          operations.filter(
            (operation) =>
              operation.moduleKey ===
              moduleRecord.key,
          );

        const totalBytes =
          moduleOperations.reduce(
            (
              total,
              operation,
            ) =>
              total +
              Number(
                operation.bytes ??
                  0,
              ),
            0,
          );

        const workerCount =
          moduleOperations.filter(
            (operation) =>
              operation.isWorker,
          ).length;

        return {
          moduleKey:
            moduleRecord.key,
          category:
            moduleRecord.category,
          layer:
            moduleRecord.layer,
          capabilityId:
            moduleRecord.capabilityId,
          sourceRoot:
            moduleRecord.engine.root,
          targetInternalRoot:
            moduleRecord.engine.internalRoot,
          targetPublicRoot:
            moduleRecord.engine.publicRoot,
          presentInStage3:
            moduleRecord.engine.presentInStage3,
          moveCount:
            moduleOperations.length,
          workerCount,
          totalBytes,
        };
      },
    );

  return summary;
}

function buildPlanDigest(
  operations,
) {
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

export function buildMigrationPlan(
  rootDir,
) {
  assertFreezeStillUnlocked(
    rootDir,
  );

  const stage4 =
    loadLatestStage4(
      rootDir,
    );

  const moduleMapValidation =
    assertStage4MatchesCurrentModuleMap(
      stage4,
    );

  const stage3 =
    loadStage3FromStage4(
      rootDir,
      stage4,
    );

  const stage3EngineFiles =
    getStage3EngineFiles(
      stage3,
    );

  const actualEngineFiles =
    collectActualEngineFiles(
      rootDir,
    );

  const actualEngineState =
    classifyActualEngineFiles(
      actualEngineFiles,
    );

  const sourcePathValidation =
    compareExactPathSets(
      actualEngineState.sourceFiles,
      stage3EngineFiles.map(
        (record) =>
          record.path,
      ),
      "src/engine (fontes ainda não migradas)",
    );

  const sourceIntegrity =
    validateSourceIntegrity(
      rootDir,
      stage3EngineFiles,
    );

  const operations =
    buildOperations(
      rootDir,
      stage3EngineFiles,
    );

  const collisions =
    detectDestinationCollisions(
      rootDir,
      operations,
    );

  collisions.push(
    ...collectExistingReservedEntries(
      rootDir,
      actualEngineState.reservedFiles,
    ),
  );

  assertNoDestinationCollisions(
    collisions,
  );

  const mapping =
    buildMappingObject(
      operations,
    );

  const plannedDirectories =
    buildPlannedDirectories();

  const modules =
    summarizeByModule(
      operations,
    );

  const workerMoves =
    operations
      .filter(
        (operation) =>
          operation.isWorker,
      )
      .map(
        (operation) => ({
          oldPath:
            operation.oldPath,
          newPath:
            operation.newPath,
        }),
      );

  const modulesWithMoves =
    modules.filter(
      (moduleRecord) =>
        moduleRecord.moveCount >
        0,
    );

  const modulesWithoutMoves =
    modules.filter(
      (moduleRecord) =>
        moduleRecord.moveCount ===
        0,
    );

  const totalBytes =
    operations.reduce(
      (
        total,
        operation,
      ) =>
        total +
        Number(
          operation.bytes ??
            0,
        ),
      0,
    );

  return {
    schemaVersion:
      MIGRATION_PLAN_SCHEMA_VERSION,
    stage:
      STAGE_NAME,
    architectureMigrationVersion:
      ARCHITECTURE_MIGRATION_VERSION,
    sourceOfTruth:
      "scripts/architecture/module-map.mjs",
    planner:
      "scripts/architecture/plan-migration.mjs",
    mode:
      "plan-only-no-file-moves",
    stage4: {
      runId:
        stage4.runId,
      reportPath:
        stage4.reportPath,
      snapshotPath:
        stage4.snapshotPath,
      moduleMapValidation,
    },
    stage3: {
      runId:
        stage3.runId,
      reportPath:
        stage3.reportPath,
      filesPath:
        stage3.filesPath,
      treeSha256:
        stage3.inventory
          .summary
          ?.treeSha256 ??
        null,
    },
    sourceValidation: {
      layoutMatchesStage3:
        sourcePathValidation.matches,
      sourceFileCount:
        sourcePathValidation.count,
      integrityVerifiedFileCount:
        sourceIntegrity.verifiedFileCount,
      sourceScopeSha256:
        sourceIntegrity.scopeSha256,
    },
    counts: {
      canonicalModules:
        CANONICAL_MODULES.length,
      functionalModules:
        FUNCTIONAL_MODULES.length,
      runtimeModules:
        RUNTIME_MODULES.length,
      modulesWithMoves:
        modulesWithMoves.length,
      modulesWithoutMoves:
        modulesWithoutMoves.length,
      moveOperations:
        operations.length,
      workers:
        workerMoves.length,
      plannedDirectories:
        plannedDirectories.length,
      destinationCollisions:
        collisions.length,
      totalBytes,
    },
    migrationPlanSha256:
      buildPlanDigest(
        operations,
      ),
    mapping,
    operations,
    modules,
    modulesWithoutMoves:
      modulesWithoutMoves.map(
        (moduleRecord) => ({
          moduleKey:
            moduleRecord.moduleKey,
          capabilityId:
            moduleRecord.capabilityId,
          sourceRoot:
            moduleRecord.sourceRoot,
          targetInternalRoot:
            moduleRecord.targetInternalRoot,
          reason:
            moduleRecord.presentInStage3
              ? "module-present-but-no-files"
              : "engine-root-absent-in-stage3",
        }),
      ),
    workerMoves,
    plannedDirectories,
    collisions,
    invariants: {
      noSourceFileMoved:
        true,
      noDestinationCollision:
        true,
      sourceLayoutEqualsStage3:
        true,
      sourceHashesEqualStage3:
        true,
      allDestinationsUnderOwnInternalRoot:
        operations.every(
          (operation) =>
            operation.newPath.startsWith(
              `${CANONICAL_MODULES.find(
                (moduleRecord) =>
                  moduleRecord.key ===
                  operation.moduleKey,
              ).engine.internalRoot}/`,
            ),
        ),
      publicDirectoriesUntouched:
        true,
      pluginFilesUntouched:
        true,
      tokenFilesUntouched:
        true,
      contractFilesUntouched:
        true,
    },
    notes: [
      "A Etapa 5 é exclusivamente de planejamento; nenhuma implementação é movida.",
      "Todo arquivo existente em src/engine no baseline da Etapa 3 é mapeado para src/engine/<module>/internal/ preservando o caminho relativo dentro do módulo.",
      "Workers são tratados como arquivos normais de implementação e também entram em /internal.",
      "game.steam e game.loop não possuíam diretórios próprios em src/engine na Etapa 3; por isso não geram move operations nesta etapa.",
      "A extração de implementações atualmente embutidas em plugins pertence à Etapa 12 e não é antecipada aqui.",
      "A criação física de /public e /internal pertence à Etapa 7 e não é executada aqui.",
      "A reescrita de imports pertence à Etapa 13 e não é executada aqui.",
      "O plano aborta antes de ser aprovado se houver dois arquivos destinados ao mesmo path ou se algum destino já estiver ocupado.",
    ],
  };
}

function buildSummary(
  report,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — ETAPA 5: MAPA COMPLETO oldPath → newPath",
    "============================================================",
    "",
    `Run ID: ${report.runId}`,
    `Status: ${report.status.toUpperCase()}`,
    `Migração arquitetural: ${report.architectureMigrationVersion}`,
    `Etapa 4 usada: ${report.plan.stage4.runId}`,
    `Etapa 3 usada: ${report.plan.stage3.runId}`,
    `Tree SHA-256 Etapa 3: ${String(report.plan.stage3.treeSha256)}`,
    `Source scope SHA-256: ${report.plan.sourceValidation.sourceScopeSha256}`,
    `Migration plan SHA-256: ${report.plan.migrationPlanSha256}`,
    "",
    `Módulos canônicos: ${String(report.plan.counts.canonicalModules)}`,
    `Módulos com arquivos a mover: ${String(report.plan.counts.modulesWithMoves)}`,
    `Módulos sem move operation: ${String(report.plan.counts.modulesWithoutMoves)}`,
    `Arquivos mapeados: ${String(report.plan.counts.moveOperations)}`,
    `Workers mapeados: ${String(report.plan.counts.workers)}`,
    `Bytes cobertos: ${String(report.plan.counts.totalBytes)}`,
    `Diretórios-alvo catalogados: ${String(report.plan.counts.plannedDirectories)}`,
    `Colisões de destino: ${String(report.plan.counts.destinationCollisions)}`,
    "",
    "Movimentos por módulo:",
  ];

  for (
    const moduleRecord of
    report.plan.modules
  ) {
    lines.push(
      `  - ${moduleRecord.moduleKey}: ${String(moduleRecord.moveCount)} arquivo(s), ${String(moduleRecord.workerCount)} worker(s), ${String(moduleRecord.totalBytes)} bytes`,
    );
  }

  lines.push("");
  lines.push("Workers:");

  if (
    report.plan.workerMoves.length ===
    0
  ) {
    lines.push(
      "  (nenhum)",
    );
  } else {
    for (
      const worker of
      report.plan.workerMoves
    ) {
      lines.push(
        `  - ${worker.oldPath} -> ${worker.newPath}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "old-to-new.json contém somente o objeto oldPath → newPath.",
  );
  lines.push(
    "migration-plan.json contém o plano completo, hashes, módulos, invariantes e operações.",
  );
  lines.push(
    "Nenhum arquivo de src/ foi criado, movido, renomeado ou reescrito pela Etapa 5.",
  );
  lines.push("");

  return lines.join("\n");
}

function writeArtifactChecksums(
  auditDir,
) {
  const files =
    fs
      .readdirSync(
        auditDir,
        {
          withFileTypes:
            true,
        },
      )
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name !==
            "artifact-checksums.sha256",
      )
      .map(
        (entry) =>
          entry.name,
      )
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            "en",
          ),
      );

  const lines =
    files.map(
      (fileName) =>
        `${sha256File(path.join(auditDir, fileName))}  ${fileName}`,
    );

  writeText(
    path.join(
      auditDir,
      "artifact-checksums.sha256",
    ),
    `${lines.join("\n")}\n`,
  );
}

function snapshotSourceTree(
  rootDir,
  plan,
) {
  const sourceFiles =
    plan.operations.map(
      (operation) =>
        operation.oldPath,
    );

  const records =
    sourceFiles.map(
      (relativePath) => {
        const absolutePath =
          assertRegularFile(
            rootDir,
            relativePath,
          );

        return {
          path:
            relativePath,
          sha256:
            sha256File(
              absolutePath,
            ),
          bytes:
            fs.statSync(
              absolutePath,
            ).size,
        };
      },
    );

  const digest =
    sha256Text(
      records
        .map(
          (record) =>
            `${record.path}\0${record.sha256}\0${String(record.bytes)}`,
        )
        .join("\n"),
    );

  return {
    fileCount:
      records.length,
    scopeSha256:
      digest,
    files:
      records,
  };
}

function assertPlannerDidNotMutateSources(
  before,
  after,
) {
  if (
    before.fileCount !==
      after.fileCount ||
    before.scopeSha256 !==
      after.scopeSha256
  ) {
    fail(
      [
        "A Etapa 5 detectou mutação nos arquivos-fonte durante o próprio planejamento.",
        `Antes: ${before.scopeSha256}`,
        `Depois: ${after.scopeSha256}`,
      ].join("\n"),
    );
  }
}

export function runStage5() {
  let auditDir =
    null;

  try {
    const rootDir =
      assertRepositoryRoot(
        process.cwd(),
      );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 5: MAPA COMPLETO oldPath → newPath      ",
    );
    console.log(
      "============================================================\n",
    );

    console.log(
      `[OK] Raiz Git: ${rootDir}`,
    );
    console.log(
      "[OK] Freeze permanece desbloqueado.",
    );

    console.log("");
    console.log(
      "[1/5] Validando Etapa 4 e fonte canônica dos módulos...",
    );

    const plan =
      buildMigrationPlan(
        rootDir,
      );

    console.log(
      `[OK] Etapa 4: ${plan.stage4.runId}`,
    );
    console.log(
      `[OK] Module map sem drift: ${plan.stage4.moduleMapValidation.currentSemanticSha256}`,
    );

    console.log("");
    console.log(
      "[2/5] Validando src/engine contra o inventário da Etapa 3...",
    );
    console.log(
      `[OK] ${String(plan.sourceValidation.sourceFileCount)} arquivos de engine presentes exatamente nos paths inventariados.`,
    );
    console.log(
      `[OK] ${String(plan.sourceValidation.integrityVerifiedFileCount)} hashes SHA-256 conferidos.`,
    );

    console.log("");
    console.log(
      "[3/5] Construindo mapeamento oldPath → newPath...",
    );
    console.log(
      `[OK] ${String(plan.counts.moveOperations)} move operations planejadas.`,
    );
    console.log(
      `[OK] ${String(plan.counts.workers)} workers incluídos.`,
    );
    console.log(
      `[OK] ${String(plan.counts.modulesWithoutMoves)} módulos sem arquivo físico a mover nesta etapa.`,
    );

    console.log("");
    console.log(
      "[4/5] Validando colisões de destino...",
    );
    console.log(
      `[OK] Colisões: ${String(plan.counts.destinationCollisions)}`,
    );
    console.log(
      `[OK] Plan SHA-256: ${plan.migrationPlanSha256}`,
    );

    const sourceBefore =
      snapshotSourceTree(
        rootDir,
        plan,
      );

    const repository =
      getRepositoryMetadata(
        rootDir,
      );

    const startedAt =
      new Date();

    const runId =
      makeRunId(
        startedAt,
      );

    auditDir =
      path.join(
        rootDir,
        STAGE5_OUTPUT_ROOT,
        runId,
      );

    ensureDirectory(
      auditDir,
    );

    console.log("");
    console.log(
      "[5/5] Gravando artefatos de planejamento...",
    );

    const report = {
      schemaVersion:
        MIGRATION_PLAN_SCHEMA_VERSION,
      stage:
        STAGE_NAME,
      status:
        "passed",
      architectureMigrationVersion:
        ARCHITECTURE_MIGRATION_VERSION,
      runId,
      generatedAtUtc:
        startedAt.toISOString(),
      projectRoot:
        rootDir,
      repository: {
        branch:
          repository.branch,
        head:
          repository.head,
        hasCommits:
          repository.hasCommits,
        gitVersion:
          repository.gitVersion,
      },
      plan,
    };

    writeJson(
      path.join(
        auditDir,
        "old-to-new.json",
      ),
      plan.mapping,
    );

    writeJson(
      path.join(
        auditDir,
        "migration-plan.json",
      ),
      report,
    );

    writeText(
      path.join(
        auditDir,
        "migration-plan-summary.txt",
      ),
      `${buildSummary(report)}\n`,
    );

    writeText(
      path.join(
        auditDir,
        "git-status.txt",
      ),
      `${repository.status}\n`,
    );

    const sourceAfter =
      snapshotSourceTree(
        rootDir,
        plan,
      );

    assertPlannerDidNotMutateSources(
      sourceBefore,
      sourceAfter,
    );

    writeJson(
      path.join(
        auditDir,
        "source-integrity.json",
      ),
      {
        before:
          sourceBefore,
        after:
          sourceAfter,
        unchanged:
          true,
      },
    );

    writeArtifactChecksums(
      auditDir,
    );

    const outputRoot =
      path.join(
        rootDir,
        STAGE5_OUTPUT_ROOT,
      );

    writeText(
      path.join(
        outputRoot,
        "LATEST",
      ),
      `${runId}\n`,
    );

    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "old-to-new.json"))}`,
    );
    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "migration-plan.json"))}`,
    );
    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "migration-plan-summary.txt"))}`,
    );
    console.log(
      `[OK] ${toPosixRelative(rootDir, path.join(auditDir, "source-integrity.json"))}`,
    );

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 5 CONCLUÍDA COM SUCESSO                            ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `Arquivos mapeados: ${String(plan.counts.moveOperations)}`,
    );
    console.log(
      `Colisões: ${String(plan.counts.destinationCollisions)}`,
    );
    console.log(
      `Plan SHA-256: ${plan.migrationPlanSha256}`,
    );
    console.log(
      "Nenhum arquivo de implementação foi movido.",
    );

    process.exitCode =
      0;
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.stack ||
          error.message
        : String(
            error,
          );

    console.error("");
    console.error(
      "[ERRO] Etapa 5 não concluída.",
    );
    console.error(
      message,
    );

    if (
      auditDir !==
        null &&
      fs.existsSync(
        auditDir,
      )
    ) {
      try {
        writeText(
          path.join(
            auditDir,
            "STAGE5_ERROR.txt",
          ),
          `${message}\n`,
        );
      } catch {
        // Não mascara o erro original.
      }
    }

    process.exitCode =
      1;
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
  runStage5();
}
