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
  "stage-8-create-conceptual-directories";

const STAGE3_NAME =
  "stage-3-architecture-inventory";

const EXPECTED_CONCEPTUAL_DIRECTORIES =
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

const SUPPORTING_DIRECTORIES =
  Object.freeze([
    "src/domain",
    "src/services",
  ]);

const REQUIRED_EXISTING_DIRECTORIES =
  Object.freeze([
    "src",
    "src/app",
    "src/engine",
  ]);

const SCAN_EXCLUDED_TOP_LEVEL =
  new Set([
    ".git",
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
    status !== 0 &&
    !allowFailure
  ) {
    fail(
      stderr.trim()
        .length >
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
      "  node scripts/architecture/stage8-create-conceptual-directories.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 8: criação dos diretórios conceituais

Uso:
  node scripts/architecture/stage8-create-conceptual-directories.mjs

Esta etapa cria exclusivamente a estrutura física:

  src/domain/
    ports/
    entities/
    economy/
    mechanics/
    narrative/
    evaluation/

  src/services/
    ui/
    usecases/
    diagnostics/

  src/app/flows/

Pré-condição:
  A Etapa 7 deve estar materializada, com /public e /internal
  presentes nos 23 módulos canônicos.

Esta etapa NÃO:
  - cria README.txt;
  - cria arquivos TypeScript;
  - move implementações;
  - reescreve imports;
  - cria public/index.ts;
  - altera aliases;
  - altera manifests;
  - altera guardrails;
  - altera freeze-lock;
  - grava artefatos em .migration.
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

function compareDirectories(
  a,
  b,
) {
  const depthA =
    a.split(
      "/",
    ).length;

  const depthB =
    b.split(
      "/",
    ).length;

  if (
    depthA !==
    depthB
  ) {
    return (
      depthA -
      depthB
    );
  }

  return a.localeCompare(
    b,
    "en",
  );
}

function compareStringSets(
  actualValues,
  expectedValues,
  label,
) {
  const actual =
    [
      ...new Set(
        actualValues,
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

  const expected =
    [
      ...new Set(
        expectedValues,
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
      (
        value,
      ) =>
        !actualSet.has(
          value,
        ),
    );

  const unexpected =
    actual.filter(
      (
        value,
      ) =>
        !expectedSet.has(
          value,
        ),
    );

  if (
    missing.length >
      0 ||
    unexpected.length >
      0
  ) {
    const lines =
      [
        `${label} diverge da arquitetura aprovada.`,
      ];

    if (
      missing.length >
      0
    ) {
      lines.push(
        "Ausentes:",
      );

      for (
        const value of
          missing
      ) {
        lines.push(
          `  - ${value}`,
        );
      }
    }

    if (
      unexpected.length >
      0
    ) {
      lines.push(
        "Inesperados:",
      );

      for (
        const value of
          unexpected
      ) {
        lines.push(
          `  - ${value}`,
        );
      }
    }

    fail(
      lines.join(
        "\n",
      ),
    );
  }
}

function assertPhysicalDirectory(
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
      `Pré-condição ausente: ${relativePath}/`,
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
      `${relativePath} deve ser um diretório físico.`,
    );
  }
}

function validateStage7Structure(
  rootDir,
) {
  for (
    const relativePath of
      REQUIRED_EXISTING_DIRECTORIES
  ) {
    assertPhysicalDirectory(
      rootDir,
      relativePath,
    );
  }

  if (
    CANONICAL_MODULES.length !==
    23
  ) {
    fail(
      `A arquitetura v20 esperava 23 módulos canônicos; module-map possui ${String(CANONICAL_MODULES.length)}.`,
    );
  }

  const requiredEngineDirectories =
    [];

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    const expectedRoot =
      `src/engine/${moduleRecord.key}`;

    const expectedPublic =
      `${expectedRoot}/public`;

    const expectedInternal =
      `${expectedRoot}/internal`;

    if (
      moduleRecord.engine
        ?.root !==
        expectedRoot ||
      moduleRecord.engine
        ?.publicRoot !==
        expectedPublic ||
      moduleRecord.engine
        ?.internalRoot !==
        expectedInternal
    ) {
      fail(
        `module-map inconsistente para ${moduleRecord.key}.`,
      );
    }

    requiredEngineDirectories.push(
      expectedRoot,
      expectedPublic,
      expectedInternal,
    );
  }

  compareStringSets(
    requiredEngineDirectories,
    requiredEngineDirectories,
    "Estrutura da Etapa 7",
  );

  for (
    const relativePath of
      requiredEngineDirectories
  ) {
    assertPhysicalDirectory(
      rootDir,
      relativePath,
    );
  }

  return requiredEngineDirectories;
}

function loadStage3ConceptualContract(
  rootDir,
) {
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

  if (
    !fs.existsSync(
      latestPath,
    )
  ) {
    fail(
      "Pré-condição ausente: .migration/stage3/LATEST",
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
      ".migration/stage3/LATEST está vazio.",
    );
  }

  const reportPath =
    path.join(
      stage3Root,
      runId,
      "architecture-inventory.json",
    );

  if (
    !fs.existsSync(
      reportPath,
    )
  ) {
    fail(
      `Relatório da Etapa 3 ausente: ${toPosixRelative(rootDir, reportPath)}`,
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
    STAGE3_NAME
  ) {
    fail(
      `Stage inesperado no inventário da Etapa 3: ${String(report.stage)}`,
    );
  }

  if (
    !Array.isArray(
      report.conceptualDirectories,
    )
  ) {
    fail(
      "architecture-inventory.json não contém conceptualDirectories.",
    );
  }

  const conceptualPaths =
    report.conceptualDirectories.map(
      (
        record,
      ) => {
        if (
          record ===
            null ||
          typeof record !==
            "object" ||
          typeof record.path !==
            "string"
        ) {
          fail(
            "Registro inválido em conceptualDirectories da Etapa 3.",
          );
        }

        if (
          record.kind !==
          "conceptual-directory"
        ) {
          fail(
            `Kind inválido para ${record.path}: ${String(record.kind)}`,
          );
        }

        return record.path;
      },
    );

  compareStringSets(
    conceptualPaths,
    EXPECTED_CONCEPTUAL_DIRECTORIES,
    "Diretórios conceituais da Etapa 3",
  );

  return {
    runId,
    reportPath:
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    conceptualPaths:
      [
        ...EXPECTED_CONCEPTUAL_DIRECTORIES,
      ],
  };
}

function assertTargetPathTypes(
  rootDir,
  requiredDirectories,
) {
  const conflicts =
    [];

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
      continue;
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isSymbolicLink()
    ) {
      conflicts.push(
        `${relativePath} é symlink`,
      );
      continue;
    }

    if (
      !stat.isDirectory()
    ) {
      conflicts.push(
        `${relativePath} existe, mas não é diretório`,
      );
    }
  }

  if (
    conflicts.length >
    0
  ) {
    fail(
      [
        "Há conflitos físicos nos diretórios-alvo da Etapa 8:",
        ...conflicts.map(
          (
            item,
          ) =>
            `  - ${item}`,
        ),
      ].join(
        "\n",
      ),
    );
  }
}

function sha256File(
  filePath,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      fs.readFileSync(
        filePath,
      ),
    )
    .digest(
      "hex",
    );
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
    (
      prefix,
    ) =>
      normalized ===
        prefix ||
      normalized.startsWith(
        prefix,
      ),
  );
}

function snapshotNonDirectoryEntries(
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
            kind:
              "symlink",
            path:
              relativePath,
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
            kind:
              "file",
            path:
              relativePath,
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
    (
      a,
      b,
    ) => {
      const byPath =
        a.path.localeCompare(
          b.path,
          "en",
        );

      if (
        byPath !==
        0
      ) {
        return byPath;
      }

      return a.kind.localeCompare(
        b.kind,
        "en",
      );
    },
  );

  return records;
}

function snapshotDirectories(
  rootDir,
) {
  const directories =
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
        entries[index];

      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      ) {
        continue;
      }

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
          true,
        )
      ) {
        continue;
      }

      directories.push(
        relativePath,
      );

      stack.push(
        absolutePath,
      );
    }
  }

  directories.sort(
    compareDirectories,
  );

  return directories;
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
        (
          entry,
        ) =>
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
      (
        key,
      ) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(
      ",",
    )}}`;
}

function sha256Value(
  value,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      stableStringify(
        value,
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}

function verifyFilesUnchanged(
  before,
  after,
) {
  const beforeDigest =
    sha256Value(
      before,
    );

  const afterDigest =
    sha256Value(
      after,
    );

  if (
    beforeDigest !==
    afterDigest
  ) {
    const beforeByKey =
      new Map(
        before.map(
          (
            record,
          ) => [
            `${record.kind}\0${record.path}`,
            record,
          ],
        ),
      );

    const afterByKey =
      new Map(
        after.map(
          (
            record,
          ) => [
            `${record.kind}\0${record.path}`,
            record,
          ],
        ),
      );

    const details =
      [];

    for (
      const [
        key,
        beforeRecord,
      ] of
        beforeByKey
    ) {
      const afterRecord =
        afterByKey.get(
          key,
        );

      if (
        afterRecord ===
        undefined
      ) {
        details.push(
          `REMOVIDO: ${beforeRecord.path}`,
        );
      } else if (
        stableStringify(
          beforeRecord,
        ) !==
        stableStringify(
          afterRecord,
        )
      ) {
        details.push(
          `ALTERADO: ${beforeRecord.path}`,
        );
      }
    }

    for (
      const [
        key,
        afterRecord,
      ] of
        afterByKey
    ) {
      if (
        !beforeByKey.has(
          key,
        )
      ) {
        details.push(
          `CRIADO: ${afterRecord.path}`,
        );
      }
    }

    fail(
      [
        "A Etapa 8 alterou arquivo ou symlink, o que é proibido.",
        ...details
          .slice(
            0,
            50,
          )
          .map(
            (
              item,
            ) =>
              `  - ${item}`,
          ),
      ].join(
        "\n",
      ),
    );
  }

  return {
    beforeDigest,
    afterDigest,
  };
}

function verifyDirectoryDelta(
  beforeDirectories,
  afterDirectories,
  expectedAddedDirectories,
) {
  const beforeSet =
    new Set(
      beforeDirectories,
    );

  const afterSet =
    new Set(
      afterDirectories,
    );

  const added =
    afterDirectories.filter(
      (
        relativePath,
      ) =>
        !beforeSet.has(
          relativePath,
        ),
    );

  const removed =
    beforeDirectories.filter(
      (
        relativePath,
      ) =>
        !afterSet.has(
          relativePath,
        ),
    );

  compareStringSets(
    added,
    expectedAddedDirectories,
    "Diretórios efetivamente adicionados",
  );

  if (
    removed.length >
    0
  ) {
    fail(
      [
        "A Etapa 8 removeu diretório(s), o que é proibido:",
        ...removed.map(
          (
            relativePath,
          ) =>
            `  - ${relativePath}`,
        ),
      ].join(
        "\n",
      ),
    );
  }

  return {
    added,
    removed,
  };
}

function createRequiredDirectories(
  rootDir,
  orderedDirectories,
) {
  const created =
    [];

  const preserved =
    [];

  try {
    for (
      const relativePath of
        orderedDirectories
    ) {
      const absolutePath =
        fromPosixRelative(
          rootDir,
          relativePath,
        );

      if (
        fs.existsSync(
          absolutePath,
        )
      ) {
        const stat =
          fs.lstatSync(
            absolutePath,
          );

        if (
          stat.isSymbolicLink() ||
          !stat.isDirectory()
        ) {
          fail(
            `Conflito detectado durante criação: ${relativePath}`,
          );
        }

        preserved.push(
          relativePath,
        );

        continue;
      }

      const parentPath =
        path.dirname(
          absolutePath,
        );

      if (
        !fs.existsSync(
          parentPath,
        )
      ) {
        fail(
          `Diretório pai ausente fora da ordem prevista: ${toPosixRelative(rootDir, parentPath)}`,
        );
      }

      const parentStat =
        fs.lstatSync(
          parentPath,
        );

      if (
        parentStat.isSymbolicLink() ||
        !parentStat.isDirectory()
      ) {
        fail(
          `Diretório pai inválido: ${toPosixRelative(rootDir, parentPath)}`,
        );
      }

      fs.mkdirSync(
        absolutePath,
      );

      created.push(
        relativePath,
      );

      console.log(
        `[CREATE] ${relativePath}/`,
      );
    }

    return {
      created,
      preserved,
    };
  } catch (
    error
  ) {
    rollbackCreatedDirectories(
      rootDir,
      created,
    );

    throw error;
  }
}

function rollbackCreatedDirectories(
  rootDir,
  createdDirectories,
) {
  const rollbackErrors =
    [];

  const reverse =
    [
      ...createdDirectories,
    ].sort(
      (
        a,
        b,
      ) =>
        compareDirectories(
          b,
          a,
        ),
    );

  for (
    const relativePath of
      reverse
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
      continue;
    }

    try {
      const stat =
        fs.lstatSync(
          absolutePath,
        );

      if (
        stat.isDirectory() &&
        !stat.isSymbolicLink()
      ) {
        fs.rmdirSync(
          absolutePath,
        );
      } else {
        rollbackErrors.push(
          `${relativePath}: deixou de ser diretório físico`,
        );
      }
    } catch (
      error
    ) {
      rollbackErrors.push(
        `${relativePath}: ${
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

  if (
    rollbackErrors.length >
    0
  ) {
    console.error(
      "",
    );
    console.error(
      "[ALERTA] Rollback estrutural incompleto:",
    );

    for (
      const item of
        rollbackErrors
    ) {
      console.error(
        `  - ${item}`,
      );
    }
  }
}

function verifyRequiredDirectories(
  rootDir,
  requiredDirectories,
) {
  for (
    const relativePath of
      requiredDirectories
  ) {
    assertPhysicalDirectory(
      rootDir,
      relativePath,
    );
  }
}

function assertNoStage9ArtifactsCreated(
  rootDir,
) {
  const unexpectedReadmes =
    EXPECTED_CONCEPTUAL_DIRECTORIES.filter(
      (
        relativePath,
      ) =>
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            `${relativePath}/README.txt`,
          ),
        ),
    );

  if (
    unexpectedReadmes.length >
    0
  ) {
    console.log(
      "[INFO] README.txt já existente em área conceitual foi preservado; a Etapa 8 não o criou nem alterou.",
    );
  }
}

export function runStage8() {
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

  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 8: DIRETÓRIOS CONCEITUAIS             ",
  );
  console.log(
    "============================================================",
  );
  console.log(
    "",
  );
  console.log(
    `[OK] Raiz Git: ${rootDir}`,
  );
  console.log(
    `[OK] Arquitetura: ${ARCHITECTURE_MIGRATION_VERSION}`,
  );

  const stage7Directories =
    validateStage7Structure(
      rootDir,
    );

  console.log(
    `[OK] Etapa 7 materializada: ${String(stage7Directories.length)} diretórios engine validados.`,
  );

  const stage3 =
    loadStage3ConceptualContract(
      rootDir,
    );

  console.log(
    `[OK] Contrato conceitual validado contra Etapa 3: ${stage3.runId}`,
  );
  console.log(
    `[OK] Inventário: ${stage3.reportPath}`,
  );

  const requiredDirectories =
    [
      ...SUPPORTING_DIRECTORIES,
      ...stage3.conceptualPaths,
    ].sort(
      compareDirectories,
    );

  assertTargetPathTypes(
    rootDir,
    requiredDirectories,
  );

  const filesBefore =
    snapshotNonDirectoryEntries(
      rootDir,
    );

  const directoriesBefore =
    snapshotDirectories(
      rootDir,
    );

  const directoriesBeforeSet =
    new Set(
      directoriesBefore,
    );

  const expectedAddedDirectories =
    requiredDirectories.filter(
      (
        relativePath,
      ) =>
        !directoriesBeforeSet.has(
          relativePath,
        ),
    );

  console.log(
    "",
  );
  console.log(
    "=== ESTRUTURA CANÔNICA DA ETAPA 8 ===",
  );
  console.log(
    `Áreas conceituais: ${String(stage3.conceptualPaths.length)}`,
  );
  console.log(
    `Diretórios de suporte: ${String(SUPPORTING_DIRECTORIES.length)}`,
  );
  console.log(
    `Diretórios físicos sob responsabilidade desta etapa: ${String(requiredDirectories.length)}`,
  );
  console.log(
    "",
  );

  for (
    const relativePath of
      stage3.conceptualPaths
  ) {
    console.log(
      `  - ${relativePath}/`,
    );
  }

  console.log(
    "",
  );
  console.log(
    "=== APLICAÇÃO DA ETAPA 8 ===",
  );

  let creationResult =
    null;

  try {
    creationResult =
      createRequiredDirectories(
        rootDir,
        requiredDirectories,
      );

    verifyRequiredDirectories(
      rootDir,
      requiredDirectories,
    );

    const filesAfter =
      snapshotNonDirectoryEntries(
        rootDir,
      );

    const fileIntegrity =
      verifyFilesUnchanged(
        filesBefore,
        filesAfter,
      );

    const directoriesAfter =
      snapshotDirectories(
        rootDir,
      );

    const directoryDelta =
      verifyDirectoryDelta(
        directoriesBefore,
        directoriesAfter,
        expectedAddedDirectories,
      );

    assertNoStage9ArtifactsCreated(
      rootDir,
    );

    console.log(
      "",
    );
    console.log(
      "=== VALIDAÇÃO ===",
    );
    console.log(
      `[OK] Diretórios criados: ${String(creationResult.created.length)}`,
    );
    console.log(
      `[OK] Diretórios já existentes: ${String(creationResult.preserved.length)}`,
    );
    console.log(
      `[OK] Áreas conceituais validadas: ${String(stage3.conceptualPaths.length)}`,
    );
    console.log(
      `[OK] Diretórios adicionados exatamente como planejado: ${String(directoryDelta.added.length)}`,
    );
    console.log(
      `[OK] Arquivos/symlinks antes: ${String(filesBefore.length)}`,
    );
    console.log(
      `[OK] SHA estrutural de arquivos antes: ${fileIntegrity.beforeDigest}`,
    );
    console.log(
      `[OK] SHA estrutural de arquivos depois: ${fileIntegrity.afterDigest}`,
    );
    console.log(
      "[OK] Nenhum arquivo foi criado, movido, removido ou reescrito.",
    );
    console.log(
      "[OK] Nenhum README.txt foi criado.",
    );
    console.log(
      "[OK] Nenhum arquivo TypeScript foi criado.",
    );
    console.log(
      "[OK] Nenhuma implementação foi movida.",
    );

    console.log(
      "",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 8 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "Os 10 diretórios conceituais foram materializados sem antecipar a Etapa 9.",
    );

    process.exitCode =
      0;
  } catch (
    error
  ) {
    if (
      creationResult !==
        null &&
      creationResult.created.length >
        0
    ) {
      rollbackCreatedDirectories(
        rootDir,
        creationResult.created,
      );
    }

    throw error;
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
    runStage8();
  } catch (
    error
  ) {
    console.error(
      "",
    );
    console.error(
      "[ERRO] Etapa 8 não concluída.",
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
