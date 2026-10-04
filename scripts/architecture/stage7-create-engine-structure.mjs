#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
  FUNCTIONAL_MODULES,
  RUNTIME_MODULES,
} from "./module-map.mjs";

export const STAGE_NAME = "stage-7-create-engine-public-internal-structure";

const EXPECTED_FUNCTIONAL_MODULE_COUNT = 20;
const EXPECTED_RUNTIME_MODULE_COUNT = 3;
const EXPECTED_CANONICAL_MODULE_COUNT =
  EXPECTED_FUNCTIONAL_MODULE_COUNT +
  EXPECTED_RUNTIME_MODULE_COUNT;

const STAGE5_NAME = "stage-5-path-migration-plan";
const STAGE6_SCRIPT_RELATIVE_PATH =
  "scripts/architecture/migrate-v20.mjs";

const SCAN_EXCLUDED_TOP_LEVEL = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "target",
]);

const SCAN_EXCLUDED_RELATIVE_PREFIXES = Object.freeze([
  ".cache/",
  ".turbo/",
  ".vite/",
  "src-tauri/target/",
]);

function fail(message) {
  throw new Error(message);
}

function normalizeAbsolute(inputPath) {
  const resolved =
    path.resolve(inputPath);

  const normalized =
    path.normalize(resolved);

  return process.platform === "win32"
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

function fromPosixRelative(
  rootDir,
  relativePath,
) {
  return path.join(
    rootDir,
    ...relativePath.split("/"),
  );
}

function runCommand(
  executable,
  args,
  cwd,
  options = {},
) {
  const {
    allowFailure = false,
    inheritStdio = false,
  } = options;

  const result =
    spawnSync(
      executable,
      args,
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        stdio:
          inheritStdio
            ? "inherit"
            : [
                "ignore",
                "pipe",
                "pipe",
              ],
      },
    );

  if (result.error) {
    if (allowFailure) {
      return {
        status:
          result.status ?? 1,
        stdout:
          String(
            result.stdout ?? "",
          ),
        stderr:
          String(
            result.stderr ?? "",
          ),
      };
    }

    throw result.error;
  }

  const status =
    result.status ?? 1;

  const stdout =
    inheritStdio
      ? ""
      : String(
          result.stdout ?? "",
        );

  const stderr =
    inheritStdio
      ? ""
      : String(
          result.stderr ?? "",
        );

  if (
    status !== 0 &&
    !allowFailure
  ) {
    const message =
      stderr.trim().length > 0
        ? stderr.trim()
        : `${executable} ${args.join(" ")} falhou com código ${String(status)}.`;

    fail(
      message,
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
    {
      allowFailure,
    },
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
      ].join("\n"),
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
    argv.length === 1 &&
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
      "  node scripts/architecture/stage7-create-engine-structure.mjs",
    ].join("\n"),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 7: criação física de /public e /internal

Uso:
  node scripts/architecture/stage7-create-engine-structure.mjs

Esta etapa cria exclusivamente:
  src/engine/<module>/public/
  src/engine/<module>/internal/

para os 23 módulos canônicos da arquitetura v20.

Também cria o diretório raiz do módulo quando ele ainda não existe
(game.steam e game.loop no baseline aprovado).

Não move arquivos.
Não reescreve imports.
Não cria public/index.ts.
Não cria README.txt.
Não cria domain/, services/ ou app/flows/.
Não altera aliases, manifests, guardrails ou freeze-lock.
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
      (a, b) =>
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
      (a, b) =>
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
      (value) =>
        !actualSet.has(
          value,
        ),
    );

  const unexpected =
    actual.filter(
      (value) =>
        !expectedSet.has(
          value,
        ),
    );

  if (
    missing.length > 0 ||
    unexpected.length > 0
  ) {
    const lines = [
      `${label} diverge da fonte canônica.`,
    ];

    if (
      missing.length > 0
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
      unexpected.length > 0
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

function validateCanonicalModuleMap() {
  if (
    FUNCTIONAL_MODULES.length !==
    EXPECTED_FUNCTIONAL_MODULE_COUNT
  ) {
    fail(
      `A arquitetura v20 esperava ${String(EXPECTED_FUNCTIONAL_MODULE_COUNT)} módulos funcionais; module-map possui ${String(FUNCTIONAL_MODULES.length)}.`,
    );
  }

  if (
    RUNTIME_MODULES.length !==
    EXPECTED_RUNTIME_MODULE_COUNT
  ) {
    fail(
      `A arquitetura v20 esperava ${String(EXPECTED_RUNTIME_MODULE_COUNT)} módulos runtime; module-map possui ${String(RUNTIME_MODULES.length)}.`,
    );
  }

  if (
    CANONICAL_MODULES.length !==
    EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      `A arquitetura v20 esperava ${String(EXPECTED_CANONICAL_MODULE_COUNT)} módulos canônicos; module-map possui ${String(CANONICAL_MODULES.length)}.`,
    );
  }

  const moduleKeys =
    CANONICAL_MODULES.map(
      (moduleRecord) =>
        moduleRecord.key,
    );

  if (
    new Set(
      moduleKeys,
    ).size !==
    moduleKeys.length
  ) {
    fail(
      "module-map.mjs contém chaves de módulo duplicadas.",
    );
  }

  const targetDirectories =
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
      expectedRoot
    ) {
      fail(
        `Root inconsistente no module-map para ${moduleRecord.key}: ${String(moduleRecord.engine?.root)}`,
      );
    }

    if (
      moduleRecord.engine
        ?.publicRoot !==
      expectedPublic
    ) {
      fail(
        `publicRoot inconsistente no module-map para ${moduleRecord.key}: ${String(moduleRecord.engine?.publicRoot)}`,
      );
    }

    if (
      moduleRecord.engine
        ?.internalRoot !==
      expectedInternal
    ) {
      fail(
        `internalRoot inconsistente no module-map para ${moduleRecord.key}: ${String(moduleRecord.engine?.internalRoot)}`,
      );
    }

    targetDirectories.push(
      expectedRoot,
      expectedPublic,
      expectedInternal,
    );
  }

  if (
    new Set(
      targetDirectories,
    ).size !==
    targetDirectories.length
  ) {
    fail(
      "module-map.mjs gera diretórios-alvo duplicados.",
    );
  }

  return targetDirectories.sort(
    compareDirectories,
  );
}

function compareDirectories(
  a,
  b,
) {
  const depthA =
    a.split("/").length;

  const depthB =
    b.split("/").length;

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

function loadApprovedStage5(
  rootDir,
  expectedTargetDirectories,
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
      `Relatório da Etapa 5 ausente: ${toPosixRelative(rootDir, reportPath)}`,
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
    STAGE5_NAME
  ) {
    fail(
      `Stage inesperado em migration-plan.json: ${String(report.stage)}`,
    );
  }

  if (
    report.status !==
    "passed"
  ) {
    fail(
      `A Etapa 5 não está aprovada. Status: ${String(report.status)}`,
    );
  }

  if (
    report.architectureMigrationVersion !==
    ARCHITECTURE_MIGRATION_VERSION
  ) {
    fail(
      `Versão arquitetural divergente na Etapa 5: ${String(report.architectureMigrationVersion)}`,
    );
  }

  const plan =
    report.plan;

  if (
    plan === null ||
    typeof plan !==
      "object" ||
    Array.isArray(
      plan,
    )
  ) {
    fail(
      "migration-plan.json não contém plan válido.",
    );
  }

  if (
    plan.architectureMigrationVersion !==
    ARCHITECTURE_MIGRATION_VERSION
  ) {
    fail(
      `Versão arquitetural divergente no plan da Etapa 5: ${String(plan.architectureMigrationVersion)}`,
    );
  }

  if (
    plan.sourceOfTruth !==
    "scripts/architecture/module-map.mjs"
  ) {
    fail(
      `Fonte canônica inesperada na Etapa 5: ${String(plan.sourceOfTruth)}`,
    );
  }

  if (
    !Array.isArray(
      plan.plannedDirectories,
    )
  ) {
    fail(
      "migration-plan.json não contém plannedDirectories.",
    );
  }

  compareStringSets(
    plan.plannedDirectories,
    expectedTargetDirectories,
    "plannedDirectories da Etapa 5",
  );

  if (
    Array.isArray(
      plan.collisions,
    ) &&
    plan.collisions.length >
      0
  ) {
    fail(
      `A Etapa 5 contém ${String(plan.collisions.length)} colisão(ões) de destino.`,
    );
  }

  const invariants =
    plan.invariants ?? {};

  const requiredInvariants = [
    "noDestinationCollision",
    "sourceLayoutEqualsStage3",
    "sourceHashesEqualStage3",
    "allDestinationsUnderOwnInternalRoot",
    "publicDirectoriesUntouched",
    "pluginFilesUntouched",
    "tokenFilesUntouched",
    "contractFilesUntouched",
  ];

  for (
    const invariant of
      requiredInvariants
  ) {
    if (
      invariants[invariant] !==
      true
    ) {
      fail(
        `Invariante da Etapa 5 não aprovada: ${invariant}`,
      );
    }
  }

  return {
    runId,
    reportPath:
      toPosixRelative(
        rootDir,
        reportPath,
      ),
    report,
  };
}

function assertEngineRoot(
  rootDir,
) {
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
      "Diretório src/engine ausente.",
    );
  }

  const stat =
    fs.lstatSync(
      engineRoot,
    );

  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory()
  ) {
    fail(
      "src/engine deve ser um diretório físico, não arquivo ou symlink.",
    );
  }
}

function assertTargetPathTypes(
  rootDir,
  targetDirectories,
) {
  const conflicts =
    [];

  for (
    const relativePath of
      targetDirectories
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
        "Há conflitos físicos nos diretórios-alvo da Etapa 7:",
        ...conflicts.map(
          (item) =>
            `  - ${item}`,
        ),
      ].join("\n"),
    );
  }
}

function runMandatoryStage6DryRun(
  rootDir,
) {
  const stage6Script =
    path.join(
      rootDir,
      ...STAGE6_SCRIPT_RELATIVE_PATH.split("/"),
    );

  if (
    !fs.existsSync(
      stage6Script,
    )
  ) {
    fail(
      `Pré-condição ausente: ${STAGE6_SCRIPT_RELATIVE_PATH}`,
    );
  }

  const stat =
    fs.lstatSync(
      stage6Script,
    );

  if (
    stat.isSymbolicLink() ||
    !stat.isFile()
  ) {
    fail(
      `${STAGE6_SCRIPT_RELATIVE_PATH} deve ser arquivo físico.`,
    );
  }

  console.log(
    "",
  );
  console.log(
    "=== PRÉ-CONDIÇÃO: ETAPA 6 ===",
  );
  console.log(
    "Executando novamente o dry-run obrigatório imediatamente antes da mutação estrutural...",
  );
  console.log(
    "",
  );

  const result =
    runCommand(
      process.execPath,
      [
        stage6Script,
        "--dry-run",
      ],
      rootDir,
      {
        allowFailure: true,
        inheritStdio: true,
      },
    );

  if (
    result.status !==
    0
  ) {
    fail(
      [
        `A Etapa 6 bloqueou a migração com código ${String(result.status)}.`,
        "Nenhum diretório da Etapa 7 foi criado.",
        "Corrija os bloqueadores do dry-run antes de executar a Etapa 7.",
      ].join("\n"),
    );
  }

  console.log(
    "",
  );
  console.log(
    "[OK] Etapa 6 aprovada imediatamente antes da Etapa 7.",
  );
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
    (prefix) =>
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

  const stack = [
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
        records.push({
          kind: "symlink",
          path:
            relativePath,
          target:
            fs.readlinkSync(
              absolutePath,
            ),
        });
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

        records.push({
          kind: "file",
          path:
            relativePath,
          bytes:
            stat.size,
          sha256:
            sha256File(
              absolutePath,
            ),
        });
      }
    }
  }

  records.sort(
    (a, b) => {
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

  const stack = [
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
        entries.length - 1;
      index >= 0;
      index -= 1
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
          (record) => [
            `${record.kind}\0${record.path}`,
            record,
          ],
        ),
      );

    const afterByKey =
      new Map(
        after.map(
          (record) => [
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
        "A Etapa 7 alterou arquivo ou symlink, o que é proibido.",
        ...details
          .slice(
            0,
            50,
          )
          .map(
            (item) =>
              `  - ${item}`,
          ),
      ].join("\n"),
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
      (relativePath) =>
        !beforeSet.has(
          relativePath,
        ),
    );

  const removed =
    beforeDirectories.filter(
      (relativePath) =>
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
        "A Etapa 7 removeu diretório(s), o que é proibido:",
        ...removed.map(
          (relativePath) =>
            `  - ${relativePath}`,
        ),
      ].join("\n"),
    );
  }

  return {
    added,
    removed,
  };
}

function createTargetDirectories(
  rootDir,
  targetDirectories,
) {
  const created =
    [];

  const preserved =
    [];

  try {
    for (
      const relativePath of
        targetDirectories
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
  } catch (error) {
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
      (a, b) =>
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
    } catch (error) {
      rollbackErrors.push(
        `${relativePath}: ${
          error instanceof Error
            ? error.message
            : String(error)
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

function verifyTargetDirectories(
  rootDir,
  targetDirectories,
) {
  for (
    const relativePath of
      targetDirectories
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
        `Diretório esperado ausente após Etapa 7: ${relativePath}`,
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
        `Path estrutural inválido após Etapa 7: ${relativePath}`,
      );
    }
  }
}

function printPlan(
  targetDirectories,
) {
  console.log(
    "",
  );
  console.log(
    "=== ESTRUTURA CANÔNICA DA ETAPA 7 ===",
  );
  console.log(
    `Módulos funcionais: ${String(FUNCTIONAL_MODULES.length)}`,
  );
  console.log(
    `Módulos runtime: ${String(RUNTIME_MODULES.length)}`,
  );
  console.log(
    `Módulos canônicos: ${String(CANONICAL_MODULES.length)}`,
  );
  console.log(
    `Diretórios estruturais alvo: ${String(targetDirectories.length)}`,
  );
  console.log(
    "",
  );

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    console.log(
      `[${moduleRecord.capabilityId}]`,
    );
    console.log(
      `  ${moduleRecord.engine.root}/`,
    );
    console.log(
      `  ${moduleRecord.engine.publicRoot}/`,
    );
    console.log(
      `  ${moduleRecord.engine.internalRoot}/`,
    );
  }
}

export function runStage7() {
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
    "  PROJETO1 — ETAPA 7: CRIAÇÃO FÍSICA /public E /internal  ",
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

  const targetDirectories =
    validateCanonicalModuleMap();

  assertEngineRoot(
    rootDir,
  );

  const stage5 =
    loadApprovedStage5(
      rootDir,
      targetDirectories,
    );

  console.log(
    `[OK] Etapa 5 aprovada: ${stage5.runId}`,
  );
  console.log(
    `[OK] Plano: ${stage5.reportPath}`,
  );

  assertTargetPathTypes(
    rootDir,
    targetDirectories,
  );

  runMandatoryStage6DryRun(
    rootDir,
  );

  assertTargetPathTypes(
    rootDir,
    targetDirectories,
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
    targetDirectories.filter(
      (relativePath) =>
        !directoriesBeforeSet.has(
          relativePath,
        ),
    );

  printPlan(
    targetDirectories,
  );

  console.log(
    "",
  );
  console.log(
    "=== APLICAÇÃO DA ETAPA 7 ===",
  );

  let creationResult =
    null;

  try {
    creationResult =
      createTargetDirectories(
        rootDir,
        targetDirectories,
      );

    verifyTargetDirectories(
      rootDir,
      targetDirectories,
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
      `[OK] Total estrutural validado: ${String(targetDirectories.length)}`,
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
      `[OK] Diretórios adicionados exatamente como planejado: ${String(directoryDelta.added.length)}`,
    );
    console.log(
      "[OK] Nenhum arquivo foi criado, movido, removido ou reescrito.",
    );
    console.log(
      "[OK] Nenhum public/index.ts foi criado.",
    );
    console.log(
      "[OK] Nenhum README.txt conceitual foi criado.",
    );
    console.log(
      "[OK] Nenhum diretório domain/, services/ ou app/flows/ foi criado por esta etapa.",
    );

    console.log(
      "",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "  ETAPA 7 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "A fronteira física /public vs /internal agora existe para todos os 23 módulos canônicos.",
    );

    process.exitCode =
      0;
  } catch (error) {
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
    runStage7();
  } catch (error) {
    console.error(
      "",
    );
    console.error(
      "[ERRO] Etapa 7 não concluída.",
    );
    console.error(
      error instanceof Error
        ? (
            error.stack ??
            error.message
          )
        : String(error),
    );

    process.exitCode =
      1;
  }
}
