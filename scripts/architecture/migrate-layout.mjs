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

export const STAGE_NAME =
  "stage-10-engine-layout-move";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const STAGE5_NAME =
  "stage-5-path-migration-plan";

const EXPECTED_MOVE_COUNT =
  93;

const EXPECTED_WORKER_COUNT =
  2;

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const EXPECTED_STAGE7_DIRECTORY_COUNT =
  69;

const EXPECTED_CONCEPTUAL_README_COUNT =
  10;

const STAGE10_JOURNAL_PATH =
  ".migration/stage10/move-journal.json";

const EXPECTED_CONCEPTUAL_AREAS =
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

function fromPosixRelative(
  rootDir,
  relativePath,
) {
  return path.join(
    rootDir,
    ...relativePath.split(
      "/",
    ),
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
    ).stdout.trim();

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
    ).stdout.trim();

  if (
    gitRootRaw.length ===
    0
  ) {
    fail(
      "Não foi possível determinar a raiz do repositório Git.",
    );
  }

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
      ].join(
        "\n",
      ),
    );
  }

  return path.resolve(
    gitRootRaw,
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
      "  node scripts/architecture/migrate-layout.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 10: movimentação transacional do layout da Engine

Uso:
  node scripts/architecture/migrate-layout.mjs

Pré-condições:
  - arquitetura v20;
  - freeze desbloqueado;
  - plano aprovado da Etapa 5 íntegro;
  - 93 move operations aprovadas, incluindo 2 workers;
  - Etapa 7 materializada: 69/69 diretórios canônicos;
  - Etapa 8 materializada: 10/10 diretórios conceituais;
  - Etapa 9 materializada: 10/10 README.txt conceituais;
  - sources e destinations compatíveis com os SHA-256 da Etapa 5.

Esta etapa faz exclusivamente:
  - mover as 93 implementações já mapeadas pela Etapa 5 para
    src/engine/<module>/internal/**;
  - mover terrain.worker.ts e streaming.worker.ts junto com seus módulos;
  - preservar bytes e SHA-256 de todos os arquivos movidos;
  - registrar todas as operações no journal da Etapa 10;
  - desfazer automaticamente os moves feitos pela execução atual se houver falha.

Esta etapa NÃO:
  - reescreve imports;
  - cria public/index.ts;
  - extrai implementação de plugins;
  - altera tokens, contracts ou plugins;
  - altera aliases;
  - altera manifests;
  - altera guardrails ou freeze-lock;
  - executa TypeScript/build/testes que dependem dos imports antigos;
  - cria o rollback-migration.mjs da Etapa 11;
  - cria .migration/v20-journal.json da Etapa 11.
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
  value,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      value,
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
      (
        a,
        b,
      ) =>
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

function assertFreezeUnlocked(
  rootDir,
) {
  const locks =
    [
      ".freeze-lock.json",
      "tests/.freeze-lock.json",
    ];

  const present =
    locks.filter(
      (relativePath) =>
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            relativePath,
          ),
        ),
    );

  if (
    present.length >
    0
  ) {
    fail(
      `Freeze deve permanecer desbloqueado antes da Etapa 10. Lock(s) presente(s): ${present.join(", ")}`,
    );
  }
}

function assertRealDirectory(
  rootDir,
  relativePath,
  label,
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
      `${label} ausente: ${relativePath}/`,
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
      `${label} inválido; esperado diretório real: ${relativePath}/`,
    );
  }
}

function assertRegularFile(
  rootDir,
  relativePath,
  label,
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
      `${label} ausente: ${relativePath}`,
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
      `${label} inválido; esperado arquivo regular: ${relativePath}`,
    );
  }
}

function validateStage7Structure(
  rootDir,
) {
  const expected =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    expected.push(
      moduleRecord.engine.root,
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  if (
    expected.length !==
    EXPECTED_STAGE7_DIRECTORY_COUNT
  ) {
    fail(
      `Module map não produz ${String(EXPECTED_STAGE7_DIRECTORY_COUNT)} diretórios estruturais da Etapa 7; atual: ${String(expected.length)}.`,
    );
  }

  for (
    const relativePath of
      expected
  ) {
    assertRealDirectory(
      rootDir,
      relativePath,
      "Pré-condição da Etapa 7",
    );
  }

  return expected;
}

function validateStages8And9(
  rootDir,
) {
  if (
    EXPECTED_CONCEPTUAL_AREAS.length !==
    EXPECTED_CONCEPTUAL_README_COUNT
  ) {
    fail(
      `Quantidade interna inválida de áreas conceituais: ${String(EXPECTED_CONCEPTUAL_AREAS.length)}.`,
    );
  }

  for (
    const directory of
      EXPECTED_CONCEPTUAL_AREAS
  ) {
    assertRealDirectory(
      rootDir,
      directory,
      "Pré-condição da Etapa 8",
    );

    const readmePath =
      `${directory}/README.txt`;

    assertRegularFile(
      rootDir,
      readmePath,
      "Pré-condição da Etapa 9",
    );

    const absoluteDirectory =
      fromPosixRelative(
        rootDir,
        directory,
      );

    const entries =
      fs.readdirSync(
        absoluteDirectory,
        {
          withFileTypes:
            true,
        },
      );

    const unexpected =
      entries
        .filter(
          (entry) =>
            !(
              entry.isFile() &&
              !entry.isSymbolicLink() &&
              entry.name ===
                "README.txt"
            ),
        )
        .map(
          (entry) =>
            `${directory}/${entry.name}`,
        );

    if (
      unexpected.length >
      0
    ) {
      fail(
        `Área conceitual contém conteúdo além de README.txt antes da Etapa 10: ${unexpected.join(", ")}`,
      );
    }
  }
}

function loadApprovedStage5Plan(
  rootDir,
) {
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

  const reportPath =
    path.join(
      stage5Root,
      runId,
      "migration-plan.json",
    );

  if (
    !fs.existsSync(
      reportPath,
    )
  ) {
    fail(
      `Plano aprovado da Etapa 5 ausente: ${toPosixRelative(rootDir, reportPath)}`,
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
    report.plan?.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      "Plano da Etapa 5 pertence a uma versão arquitetural diferente de v20.",
    );
  }

  return {
    runId,
    reportPath:
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    report,
    plan:
      report.plan,
  };
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
        `oldPath duplicado no plano da Etapa 5: ${operation.oldPath}`,
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
  const values =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    values.push(
      moduleRecord.engine.root,
      moduleRecord.engine.publicRoot,
      moduleRecord.engine.internalRoot,
    );
  }

  return values.sort(
    (
      a,
      b,
    ) =>
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
    [
      ...new Set(
        actual,
      ),
    ].sort(
      (
        a,
        b,
      ) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  const expectedSorted =
    [
      ...new Set(
        expected,
      ),
    ].sort(
      (
        a,
        b,
      ) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  return (
    actualSorted.length ===
      expectedSorted.length &&
    actualSorted.every(
      (
        value,
        index,
      ) =>
        value ===
        expectedSorted[
          index
        ],
    )
  );
}

function validateApprovedPlan(
  stage5,
) {
  const plan =
    stage5.plan;

  if (
    plan ===
      null ||
    typeof plan !==
      "object"
  ) {
    fail(
      "migration-plan.json não contém plan válido.",
    );
  }

  if (
    !Array.isArray(
      plan.operations,
    )
  ) {
    fail(
      "Plano aprovado não contém operations[].",
    );
  }

  if (
    plan.operations.length !==
    EXPECTED_MOVE_COUNT
  ) {
    fail(
      `Plano aprovado deveria conter ${String(EXPECTED_MOVE_COUNT)} moves; atual: ${String(plan.operations.length)}.`,
    );
  }

  const workers =
    plan.operations.filter(
      (operation) =>
        operation.isWorker ===
        true,
    );

  if (
    workers.length !==
    EXPECTED_WORKER_COUNT
  ) {
    fail(
      `Plano aprovado deveria conter ${String(EXPECTED_WORKER_COUNT)} workers; atual: ${String(workers.length)}.`,
    );
  }

  const workerNames =
    workers
      .map(
        (operation) =>
          operation.fileName,
      )
      .sort(
        (
          a,
          b,
        ) =>
          a.localeCompare(
            b,
            "en",
          ),
      );

  const expectedWorkerNames =
    [
      "streaming.worker.ts",
      "terrain.worker.ts",
    ];

  if (
    !compareStringSets(
      workerNames,
      expectedWorkerNames,
    )
  ) {
    fail(
      `Workers inesperados no plano: ${workerNames.join(", ")}`,
    );
  }

  if (
    plan.counts?.moveOperations !==
      EXPECTED_MOVE_COUNT ||
    plan.counts?.workers !==
      EXPECTED_WORKER_COUNT ||
    plan.counts?.canonicalModules !==
      EXPECTED_CANONICAL_MODULE_COUNT ||
    plan.counts?.plannedDirectories !==
      EXPECTED_STAGE7_DIRECTORY_COUNT ||
    plan.counts?.destinationCollisions !==
      0
  ) {
    fail(
      "Counts do plano aprovado da Etapa 5 não correspondem ao escopo congelado da Etapa 10.",
    );
  }

  const computedDigest =
    buildPlanDigest(
      plan.operations,
    );

  if (
    computedDigest !==
    plan.migrationPlanSha256
  ) {
    fail(
      `Digest interno do plano da Etapa 5 divergiu. Aprovado=${String(plan.migrationPlanSha256)}; calculado=${computedDigest}.`,
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
      "Mapping oldPath → newPath do plano não corresponde às operations aprovadas.",
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
      "plannedDirectories da Etapa 5 divergem do module-map canônico atual.",
    );
  }

  const moduleByKey =
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
      "move"
    ) {
      fail(
        `Operação não suportada na Etapa 10: ${String(operation.operation)} em ${String(operation.oldPath)}.`,
      );
    }

    if (
      typeof operation.oldPath !==
        "string" ||
      typeof operation.newPath !==
        "string" ||
      typeof operation.sha256 !==
        "string" ||
      typeof operation.bytes !==
        "number" ||
      typeof operation.moduleKey !==
        "string"
    ) {
      fail(
        "Operação incompleta no plano aprovado da Etapa 5.",
      );
    }

    if (
      oldPaths.has(
        operation.oldPath,
      ) ||
      newPaths.has(
        operation.newPath,
      )
    ) {
      fail(
        `Path duplicado no plano: ${operation.oldPath} -> ${operation.newPath}`,
      );
    }

    oldPaths.add(
      operation.oldPath,
    );

    newPaths.add(
      operation.newPath,
    );

    const moduleRecord =
      moduleByKey.get(
        operation.moduleKey,
      );

    if (
      moduleRecord ===
      undefined
    ) {
      fail(
        `moduleKey não canônico no plano: ${operation.moduleKey}`,
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
        `oldPath fora da raiz legada do próprio módulo: ${operation.oldPath}`,
      );
    }

    if (
      !operation.newPath.startsWith(
        expectedNewPrefix,
      )
    ) {
      fail(
        `newPath fora de internal do próprio módulo: ${operation.newPath}`,
      );
    }

    const expectedNewPath =
      `${moduleRecord.engine.internalRoot}/${operation.relativeWithinModule}`;

    if (
      operation.newPath !==
      expectedNewPath
    ) {
      fail(
        `newPath não preserva relativeWithinModule: ${operation.oldPath} -> ${operation.newPath}`,
      );
    }

    if (
      !/^[a-f0-9]{64}$/u.test(
        operation.sha256,
      )
    ) {
      fail(
        `SHA-256 inválido no plano para ${operation.oldPath}.`,
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
        `bytes inválido no plano para ${operation.oldPath}.`,
      );
    }

    totalBytes +=
      operation.bytes;
  }

  if (
    totalBytes !==
    plan.counts.totalBytes
  ) {
    fail(
      `Total de bytes das operations (${String(totalBytes)}) diverge de plan.counts.totalBytes (${String(plan.counts.totalBytes)}).`,
    );
  }

  return {
    operations:
      plan.operations,
    workers,
    totalBytes,
    migrationPlanSha256:
      plan.migrationPlanSha256,
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
      kind: stat.isDirectory()
        ? "directory"
        : "other",
      bytes: null,
      sha256: null,
    };
  }

  return {
    exists: true,
    kind: "file",
    bytes: stat.size,
    sha256:
      sha256File(
        absolutePath,
      ),
  };
}

function assertFileMatchesOperation(
  info,
  operation,
  relativePath,
) {
  if (
    info.kind !==
    "file"
  ) {
    fail(
      `Esperado arquivo regular em ${relativePath}; encontrado: ${info.kind}.`,
    );
  }

  if (
    info.bytes !==
      operation.bytes ||
    info.sha256 !==
      operation.sha256
  ) {
    fail(
      [
        `Integridade divergente em ${relativePath}.`,
        `Esperado bytes=${String(operation.bytes)} sha256=${operation.sha256}`,
        `Atual bytes=${String(info.bytes)} sha256=${String(info.sha256)}`,
      ].join(
        "\n",
      ),
    );
  }
}

function classifyOperationState(
  rootDir,
  operation,
) {
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

  const oldInfo =
    inspectRegularFile(
      oldAbsolute,
    );

  const newInfo =
    inspectRegularFile(
      newAbsolute,
    );

  if (
    oldInfo.exists &&
    newInfo.exists
  ) {
    return {
      state: "conflict-both-exist",
      oldInfo,
      newInfo,
    };
  }

  if (
    !oldInfo.exists &&
    !newInfo.exists
  ) {
    return {
      state: "conflict-both-missing",
      oldInfo,
      newInfo,
    };
  }

  if (
    oldInfo.exists
  ) {
    assertFileMatchesOperation(
      oldInfo,
      operation,
      operation.oldPath,
    );

    return {
      state: "pending",
      oldInfo,
      newInfo,
    };
  }

  assertFileMatchesOperation(
    newInfo,
    operation,
    operation.newPath,
  );

  return {
    state: "applied",
    oldInfo,
    newInfo,
  };
}

function inspectMigrationState(
  rootDir,
  operations,
) {
  const records =
    [];

  for (
    const operation of
      operations
  ) {
    const inspection =
      classifyOperationState(
        rootDir,
        operation,
      );

    records.push(
      {
        operation,
        ...inspection,
      },
    );
  }

  const pending =
    records.filter(
      (record) =>
        record.state ===
        "pending",
    );

  const applied =
    records.filter(
      (record) =>
        record.state ===
        "applied",
    );

  const conflicts =
    records.filter(
      (record) =>
        record.state.startsWith(
          "conflict-",
        ),
    );

  return {
    records,
    pending,
    applied,
    conflicts,
  };
}

function assertNoConflicts(
  migrationState,
) {
  if (
    migrationState.conflicts.length ===
    0
  ) {
    return;
  }

  const details =
    migrationState.conflicts.map(
      (
        record,
        index,
      ) =>
        `${String(index + 1)}. ${record.state}: ${record.operation.oldPath} -> ${record.operation.newPath}`,
    );

  fail(
    [
      `Foram detectado(s) ${String(migrationState.conflicts.length)} conflito(s) no layout da Etapa 10.`,
      ...details,
    ].join(
      "\n",
    ),
  );
}

function journalAbsolutePath(
  rootDir,
) {
  return fromPosixRelative(
    rootDir,
    STAGE10_JOURNAL_PATH,
  );
}

function loadExistingJournal(
  rootDir,
) {
  const absolutePath =
    journalAbsolutePath(
      rootDir,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    return null;
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
      `Journal inválido; esperado arquivo regular: ${STAGE10_JOURNAL_PATH}`,
    );
  }

  return readJson(
    absolutePath,
    STAGE10_JOURNAL_PATH,
  );
}

function buildJournal(
  rootDir,
  stage5,
  validatedPlan,
  migrationState,
  existingJournal,
) {
  const now =
    new Date().toISOString();

  const previousByOldPath =
    new Map(
      Array.isArray(
        existingJournal?.operations,
      )
        ? existingJournal.operations.map(
            (entry) => [
              entry.oldPath,
              entry,
            ],
          )
        : [],
    );

  const stateByOldPath =
    new Map(
      migrationState.records.map(
        (record) => [
          record.operation.oldPath,
          record.state,
        ],
      ),
    );

  return {
    schemaVersion: 1,
    stage: STAGE_NAME,
    architectureMigrationVersion:
      EXPECTED_ARCHITECTURE_VERSION,
    status:
      existingJournal?.status ??
      "prepared",
    createdAtUtc:
      existingJournal?.createdAtUtc ??
      now,
    updatedAtUtc:
      now,
    completedAtUtc:
      existingJournal?.completedAtUtc ??
      null,
    projectRoot:
      rootDir,
    sourcePlan: {
      stage:
        STAGE5_NAME,
      runId:
        stage5.runId,
      reportPath:
        stage5.reportPath,
      migrationPlanSha256:
        validatedPlan.migrationPlanSha256,
    },
    counts: {
      totalOperations:
        EXPECTED_MOVE_COUNT,
      workers:
        EXPECTED_WORKER_COUNT,
      totalBytes:
        validatedPlan.totalBytes,
      pending:
        migrationState.pending.length,
      applied:
        migrationState.applied.length,
      conflicts:
        migrationState.conflicts.length,
    },
    operations:
      validatedPlan.operations.map(
        (
          operation,
          index,
        ) => {
          const previous =
            previousByOldPath.get(
              operation.oldPath,
            );

          const state =
            stateByOldPath.get(
              operation.oldPath,
            );

          return {
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
            state:
              state ===
              "applied"
                ? "moved"
                : "pending",
            timestampUtc:
              state ===
              "applied"
                ? previous?.timestampUtc ??
                  now
                : null,
            recoveredFromFilesystem:
              state ===
                "applied" &&
              previous?.timestampUtc ===
                undefined,
          };
        },
      ),
    notes: [
      "Journal específico da Etapa 10; a Etapa 11 criará .migration/v20-journal.json e rollback-migration.mjs.",
      "Nenhum import é reescrito nesta etapa.",
      "Os SHA-256 antes/depois são iguais porque a transformação é somente rename/move de path.",
    ],
  };
}

function validateExistingJournal(
  existingJournal,
  stage5,
  validatedPlan,
) {
  if (
    existingJournal ===
    null
  ) {
    return;
  }

  if (
    existingJournal.schemaVersion !==
      1 ||
    existingJournal.stage !==
      STAGE_NAME ||
    existingJournal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Journal existente incompatível: ${STAGE10_JOURNAL_PATH}`,
    );
  }

  if (
    existingJournal.sourcePlan?.runId !==
      stage5.runId ||
    existingJournal.sourcePlan?.migrationPlanSha256 !==
      validatedPlan.migrationPlanSha256
  ) {
    fail(
      "Journal existente pertence a outro plano da Etapa 5.",
    );
  }

  if (
    !Array.isArray(
      existingJournal.operations,
    ) ||
    existingJournal.operations.length !==
      EXPECTED_MOVE_COUNT
  ) {
    fail(
      "Journal existente não contém as 93 operações da Etapa 10.",
    );
  }

  const expectedIdentity =
    validatedPlan.operations.map(
      (operation) => ({
        oldPath:
          operation.oldPath,
        newPath:
          operation.newPath,
        shaBefore:
          operation.sha256,
        shaAfter:
          operation.sha256,
      }),
    );

  const journalIdentity =
    existingJournal.operations.map(
      (entry) => ({
        oldPath:
          entry.oldPath,
        newPath:
          entry.newPath,
        shaBefore:
          entry.shaBefore,
        shaAfter:
          entry.shaAfter,
      }),
    );

  if (
    semanticSha256(
      expectedIdentity,
    ) !==
    semanticSha256(
      journalIdentity,
    )
  ) {
    fail(
      "Journal existente diverge das operações aprovadas da Etapa 5.",
    );
  }

  if (
    existingJournal.status ===
    "rollback-failed"
  ) {
    fail(
      "Journal indica rollback-failed. Não é seguro continuar automaticamente.",
    );
  }
}

function ensureParentDirectory(
  filePath,
) {
  fs.mkdirSync(
    path.dirname(
      filePath,
    ),
    {
      recursive: true,
    },
  );
}

function writeJsonAtomic(
  filePath,
  value,
) {
  ensureParentDirectory(
    filePath,
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

function walkProjectFiles(
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
      ).sort(
        (
          a,
          b,
        ) =>
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

  return records.sort(
    (
      a,
      b,
    ) =>
      a.path.localeCompare(
        b.path,
        "en",
      ),
  );
}

function protectedProjectSnapshot(
  rootDir,
  operations,
) {
  const mutablePaths =
    new Set(
      operations.flatMap(
        (operation) => [
          operation.oldPath,
          operation.newPath,
        ],
      ),
    );

  const records =
    walkProjectFiles(
      rootDir,
    ).filter(
      (record) =>
        !mutablePaths.has(
          record.path,
        ),
    );

  return {
    records,
    digest:
      semanticSha256(
        records,
      ),
  };
}

function updateJournalCounts(
  journal,
  migrationState,
) {
  journal.counts.pending =
    migrationState.pending.length;
  journal.counts.applied =
    migrationState.applied.length;
  journal.counts.conflicts =
    migrationState.conflicts.length;
  journal.updatedAtUtc =
    new Date().toISOString();
}

function journalEntryByOldPath(
  journal,
) {
  return new Map(
    journal.operations.map(
      (entry) => [
        entry.oldPath,
        entry,
      ],
    ),
  );
}

function performMove(
  rootDir,
  operation,
) {
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

  const sourceBefore =
    inspectRegularFile(
      oldAbsolute,
    );

  assertFileMatchesOperation(
    sourceBefore,
    operation,
    operation.oldPath,
  );

  if (
    fs.existsSync(
      newAbsolute,
    )
  ) {
    fail(
      `Destino passou a existir durante a transação: ${operation.newPath}`,
    );
  }

  assertRealDirectory(
    rootDir,
    toPosixRelative(
      rootDir,
      path.dirname(
        newAbsolute,
      ),
    ),
    "Diretório de destino",
  );

  fs.renameSync(
    oldAbsolute,
    newAbsolute,
  );

  const sourceAfter =
    inspectRegularFile(
      oldAbsolute,
    );

  const destinationAfter =
    inspectRegularFile(
      newAbsolute,
    );

  if (
    sourceAfter.exists
  ) {
    fail(
      `Source continuou presente após move: ${operation.oldPath}`,
    );
  }

  assertFileMatchesOperation(
    destinationAfter,
    operation,
    operation.newPath,
  );
}

function rollbackMovesFromCurrentRun(
  rootDir,
  movedThisRun,
  journal,
) {
  const rollbackErrors =
    [];

  const entries =
    journalEntryByOldPath(
      journal,
    );

  for (
    let index =
      movedThisRun.length -
      1;
    index >=
      0;
    index -=
      1
  ) {
    const operation =
      movedThisRun[
        index
      ];

    try {
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

      const oldInfo =
        inspectRegularFile(
          oldAbsolute,
        );

      const newInfo =
        inspectRegularFile(
          newAbsolute,
        );

      if (
        oldInfo.exists
      ) {
        fail(
          `Rollback não pode sobrescrever source existente: ${operation.oldPath}`,
        );
      }

      assertFileMatchesOperation(
        newInfo,
        operation,
        operation.newPath,
      );

      fs.renameSync(
        newAbsolute,
        oldAbsolute,
      );

      const restored =
        inspectRegularFile(
          oldAbsolute,
        );

      assertFileMatchesOperation(
        restored,
        operation,
        operation.oldPath,
      );

      const entry =
        entries.get(
          operation.oldPath,
        );

      if (
        entry !==
        undefined
      ) {
        entry.state =
          "rolled-back";
        entry.rollbackTimestampUtc =
          new Date().toISOString();
      }
    } catch (
      error
    ) {
      rollbackErrors.push(
        {
          oldPath:
            operation.oldPath,
          newPath:
            operation.newPath,
          message:
            error instanceof
            Error
              ? error.message
              : String(
                  error,
                ),
        },
      );
    }
  }

  return rollbackErrors;
}

function verifyCompletedLayout(
  rootDir,
  operations,
) {
  const state =
    inspectMigrationState(
      rootDir,
      operations,
    );

  assertNoConflicts(
    state,
  );

  if (
    state.pending.length !==
      0 ||
    state.applied.length !==
      EXPECTED_MOVE_COUNT
  ) {
    fail(
      `Layout final incompleto: pending=${String(state.pending.length)}, applied=${String(state.applied.length)}.`,
    );
  }

  return state;
}

function printPlanSummary(
  stage5,
  validatedPlan,
  migrationState,
) {
  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 10: MOVE TRANSACIONAL DA ENGINE        ",
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
    `[OK] Migration plan SHA-256: ${validatedPlan.migrationPlanSha256}`,
  );
  console.log(
    `[OK] Move operations aprovadas: ${String(validatedPlan.operations.length)}`,
  );
  console.log(
    `[OK] Workers aprovados: ${String(validatedPlan.workers.length)}`,
  );
  console.log(
    `[OK] Bytes cobertos: ${String(validatedPlan.totalBytes)}`,
  );
  console.log(
    `[OK] Pendentes agora: ${String(migrationState.pending.length)}`,
  );
  console.log(
    `[OK] Já aplicados com hash exato: ${String(migrationState.applied.length)}`,
  );
  console.log("");
  console.log(
    "=== ESCOPO EXATO DA ETAPA 10 ===",
  );

  for (
    const operation of
      validatedPlan.operations
  ) {
    const workerTag =
      operation.isWorker ===
      true
        ? " [WORKER]"
        : "";

    console.log(
      `  [MOVE${workerTag}] ${operation.oldPath} -> ${operation.newPath}`,
    );
  }

  console.log("");
  console.log(
    "Imports reescritos nesta etapa: 0",
  );
  console.log(
    "public/index.ts criados nesta etapa: 0",
  );
  console.log(
    "Implementações extraídas de plugins nesta etapa: 0",
  );
}

function runStage10() {
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

  assertArchitectureVersion();
  assertFreezeUnlocked(
    rootDir,
  );

  validateStage7Structure(
    rootDir,
  );

  validateStages8And9(
    rootDir,
  );

  const stage5 =
    loadApprovedStage5Plan(
      rootDir,
    );

  const validatedPlan =
    validateApprovedPlan(
      stage5,
    );

  const existingJournal =
    loadExistingJournal(
      rootDir,
    );

  validateExistingJournal(
    existingJournal,
    stage5,
    validatedPlan,
  );

  const initialState =
    inspectMigrationState(
      rootDir,
      validatedPlan.operations,
    );

  assertNoConflicts(
    initialState,
  );

  if (
    existingJournal ===
      null &&
    initialState.applied.length >
      0
  ) {
    fail(
      [
        "Foram encontrados moves já aplicados, mas o journal da Etapa 10 não existe.",
        "A Etapa 10 não continuará para não legitimar uma migração parcial/manual sem trilha de auditoria.",
      ].join(
        "\n",
      ),
    );
  }

  if (
    existingJournal?.status ===
      "completed" &&
    initialState.pending.length >
      0
  ) {
    fail(
      "Journal está completed, mas o filesystem voltou a conter sources antigos. Estado inconsistente.",
    );
  }

  printPlanSummary(
    stage5,
    validatedPlan,
    initialState,
  );

  if (
    initialState.pending.length ===
      0 &&
    initialState.applied.length ===
      EXPECTED_MOVE_COUNT
  ) {
    if (
      existingJournal?.status !==
      "completed"
    ) {
      fail(
        "Todos os moves já estão aplicados, porém o journal não está completed. Estado exige auditoria manual.",
      );
    }

    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 10 JÁ ESTÁ CONCLUÍDA                              ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] 93/93 arquivos já estão nos destinos /internal com hashes exatos.",
    );
    console.log(
      `[OK] Journal preservado sem alteração: ${STAGE10_JOURNAL_PATH}`,
    );
    return;
  }

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      validatedPlan.operations,
    );

  const journal =
    buildJournal(
      rootDir,
      stage5,
      validatedPlan,
      initialState,
      existingJournal,
    );

  const journalPath =
    journalAbsolutePath(
      rootDir,
    );

  journal.status =
    "prepared";
  journal.updatedAtUtc =
    new Date().toISOString();

  writeJsonAtomic(
    journalPath,
    journal,
  );

  const journalEntries =
    journalEntryByOldPath(
      journal,
    );

  const movedThisRun =
    [];

  console.log("");
  console.log(
    "=== APLICAÇÃO TRANSACIONAL ===",
  );

  try {
    journal.status =
      "in-progress";
    journal.updatedAtUtc =
      new Date().toISOString();

    writeJsonAtomic(
      journalPath,
      journal,
    );

    for (
      const record of
        initialState.pending
    ) {
      const operation =
        record.operation;

      performMove(
        rootDir,
        operation,
      );

      movedThisRun.push(
        operation,
      );

      const entry =
        journalEntries.get(
          operation.oldPath,
        );

      if (
        entry ===
        undefined
      ) {
        fail(
          `Journal perdeu operação: ${operation.oldPath}`,
        );
      }

      entry.state =
        "moved";
      entry.timestampUtc =
        new Date().toISOString();
      entry.recoveredFromFilesystem =
        false;

      const intermediateState =
        inspectMigrationState(
          rootDir,
          validatedPlan.operations,
        );

      assertNoConflicts(
        intermediateState,
      );

      updateJournalCounts(
        journal,
        intermediateState,
      );

      writeJsonAtomic(
        journalPath,
        journal,
      );

      console.log(
        `  [OK] ${operation.oldPath} -> ${operation.newPath}`,
      );
    }

    const finalState =
      verifyCompletedLayout(
        rootDir,
        validatedPlan.operations,
      );

    const protectedAfter =
      protectedProjectSnapshot(
        rootDir,
        validatedPlan.operations,
      );

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "Arquivo fora do conjunto de 93 move operations foi alterado durante a Etapa 10.",
          `Digest protegido antes: ${protectedBefore.digest}`,
          `Digest protegido depois: ${protectedAfter.digest}`,
        ].join(
          "\n",
        ),
      );
    }

    updateJournalCounts(
      journal,
      finalState,
    );

    journal.status =
      "completed";
    journal.completedAtUtc =
      new Date().toISOString();
    journal.protectedDigestBefore =
      protectedBefore.digest;
    journal.protectedDigestAfter =
      protectedAfter.digest;
    journal.updatedAtUtc =
      journal.completedAtUtc;

    writeJsonAtomic(
      journalPath,
      journal,
    );

    console.log("");
    console.log(
      `[OK] Movidos nesta execução: ${String(movedThisRun.length)}`,
    );
    console.log(
      `[OK] Layout final: ${String(finalState.applied.length)}/${String(EXPECTED_MOVE_COUNT)} em /internal.`,
    );
    console.log(
      `[OK] Workers: ${String(validatedPlan.workers.length)}/${String(EXPECTED_WORKER_COUNT)} movidos com o mesmo SHA-256.`,
    );
    console.log(
      `[OK] Bytes preservados: ${String(validatedPlan.totalBytes)}.`,
    );
    console.log(
      `[OK] Journal da Etapa 10: ${STAGE10_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Digest protegido antes: ${protectedBefore.digest}`,
    );
    console.log(
      `[OK] Digest protegido depois: ${protectedAfter.digest}`,
    );
    console.log(
      "[OK] Nenhum arquivo fora dos 93 paths planejados foi alterado.",
    );
    console.log(
      "[OK] Imports reescritos: 0.",
    );
    console.log("");
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 10 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "As 93 implementações aprovadas agora residem em src/engine/<module>/internal/** com bytes e SHA-256 preservados.",
    );
  } catch (
    error
  ) {
    const originalMessage =
      error instanceof
      Error
        ? error.message
        : String(
            error,
          );

    const rollbackErrors =
      rollbackMovesFromCurrentRun(
        rootDir,
        movedThisRun,
        journal,
      );

    const stateAfterRollback =
      inspectMigrationState(
        rootDir,
        validatedPlan.operations,
      );

    updateJournalCounts(
      journal,
      stateAfterRollback,
    );

    journal.status =
      rollbackErrors.length ===
      0
        ? "rolled-back-after-error"
        : "rollback-failed";
    journal.lastError =
      originalMessage;
    journal.rollbackErrors =
      rollbackErrors;
    journal.updatedAtUtc =
      new Date().toISOString();

    try {
      writeJsonAtomic(
        journalPath,
        journal,
      );
    } catch (
      journalError
    ) {
      rollbackErrors.push(
        {
          oldPath:
            null,
          newPath:
            STAGE10_JOURNAL_PATH,
          message:
            `Falha ao persistir estado do journal: ${
              journalError instanceof
              Error
                ? journalError.message
                : String(
                    journalError,
                  )
            }`,
        },
      );
    }

    if (
      rollbackErrors.length ===
      0
    ) {
      const protectedAfterRollback =
        protectedProjectSnapshot(
          rootDir,
          validatedPlan.operations,
        );

      if (
        protectedBefore.digest !==
        protectedAfterRollback.digest
      ) {
        fail(
          [
            `Falha original: ${originalMessage}`,
            "Rollback dos moves terminou, mas o digest protegido divergiu.",
            `Antes: ${protectedBefore.digest}`,
            `Depois do rollback: ${protectedAfterRollback.digest}`,
          ].join(
            "\n",
          ),
        );
      }

      fail(
        [
          `Falha durante a Etapa 10: ${originalMessage}`,
          `[OK] Rollback automático concluiu ${String(movedThisRun.length)} move(s) feitos nesta execução.`,
          `Journal: ${STAGE10_JOURNAL_PATH}`,
        ].join(
          "\n",
        ),
      );
    }

    fail(
      [
        `Falha durante a Etapa 10: ${originalMessage}`,
        `Rollback automático apresentou ${String(rollbackErrors.length)} erro(s).`,
        ...rollbackErrors.map(
          (
            rollbackError,
            index,
          ) =>
            `${String(index + 1)}. ${String(rollbackError.oldPath)} <- ${String(rollbackError.newPath)}: ${rollbackError.message}`,
        ),
        `Journal: ${STAGE10_JOURNAL_PATH}`,
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
    runStage10();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 10 não concluída.",
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
