#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  ARCHITECTURE_MIGRATION_VERSION,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-16-migrate-external-core-imports";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_PRE_STAGE_SCHEMA =
  5;

const EXPECTED_PRE_STAGE_OPERATION_COUNT =
  247;

const EXPECTED_REWRITE_FILE_COUNT =
  103;

const EXPECTED_SPECIFIER_REWRITE_COUNT =
  108;

const EXPECTED_CORE_FACADE_FILE_COUNT =
  1;

const EXPECTED_PROMOTED_SYMBOL_COUNT =
  1;

const EXPECTED_STAGE16_OPERATION_COUNT =
  EXPECTED_REWRITE_FILE_COUNT +
  EXPECTED_CORE_FACADE_FILE_COUNT;

const EXPECTED_FINAL_OPERATION_COUNT =
  EXPECTED_PRE_STAGE_OPERATION_COUNT +
  EXPECTED_STAGE16_OPERATION_COUNT;

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE15_JOURNAL_PATH =
  ".migration/stage15/core-alias-journal.json";

const STAGE16_JOURNAL_PATH =
  ".migration/stage16/core-api-journal.json";

const STAGE16_BACKUP_ROOT =
  ".migration/stage16/backups";

const CORE_INDEX_PATH =
  "src/core/index.ts";

const ROLLBACK_SCRIPT_PATH =
  "scripts/architecture/rollback-migration.mjs";

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

const STAGE16_REWRITE_TRANSFORMATION =
  "migrate-external-core-import-to-public-facade";

const STAGE16_PROMOTION_TRANSFORMATION =
  "promote-core-symbol-to-public-facade";

const ALLOWED_INTERNAL_PROMOTIONS =
  new Map([
    [
      "src/core/internal/semver.ts",
      new Set([
        "satisfies",
      ]),
    ],
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
      "  node scripts/architecture/migrate-core-api.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 16: migração dos imports externos do Core

Uso:
  node scripts/architecture/migrate-core-api.mjs

Escopo exato:
  - migrar consumidores externos de subpaths de src/core/** para @core;
  - usar TypeScript Compiler API para localizar referências de módulo;
  - validar que cada símbolo consumido pertence à fachada pública;
  - promover explicitamente somente o símbolo "satisfies" de internal/semver,
    pois ele é necessário ao carregamento/validação SemVer de plugins;
  - não reexportar internal/* ou runtime/* indiscriminadamente;
  - registrar backups before/after e journal reversível da Etapa 16;
  - anexar a Etapa 16 ao journal global v20.

Esta etapa NÃO:
  - corrige StateReplicator/NetworkApi (Etapa 17);
  - cria novas fachadas de engine (Etapa 14 já concluída);
  - altera aliases do TypeScript/Vite (Etapa 15 já concluída);
  - executa rollback real.
`);
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
        "Execute a Etapa 16 exatamente na raiz do Projeto1.",
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
        "Não foi possível carregar o pacote TypeScript.",
        "A Etapa 16 usa TypeScript Compiler API; execute npm install antes da migração.",
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

function loadTsConfig(
  ts,
  rootDir,
) {
  const configPath =
    fromPosixRelative(
      rootDir,
      "tsconfig.json",
    );

  const readResult =
    ts.readConfigFile(
      configPath,
      ts.sys.readFile,
    );

  if (
    readResult.error
  ) {
    fail(
      `tsconfig.json inválido: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n")}`,
    );
  }

  const raw =
    readResult.config;

  const alias =
    raw?.compilerOptions?.paths?.[
      "@core"
    ];

  if (
    !Array.isArray(
      alias,
    ) ||
    alias.length !==
      1 ||
    alias[0] !==
      "./src/core/index.ts"
  ) {
    fail(
      'Pré-condição da Etapa 15 ausente: compilerOptions.paths["@core"] deve ser ["./src/core/index.ts"].',
    );
  }

  const pathKeys =
    Object.keys(
      raw?.compilerOptions?.paths ??
        {},
    );

  if (
    pathKeys.some(
      (key) =>
        key.startsWith(
          "@core/",
        ),
    )
  ) {
    fail(
      "Alias wildcard @core/* é proibido.",
    );
  }

  const parsed =
    ts.parseJsonConfigFileContent(
      raw,
      ts.sys,
      rootDir,
      undefined,
      configPath,
    );

  if (
    parsed.errors.length >
    0
  ) {
    fail(
      [
        "tsconfig.json não pôde ser interpretado pelo TypeScript:",
        ...parsed.errors.map(
          (diagnostic) =>
            ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              "\n",
            ),
        ),
      ].join(
        "\n",
      ),
    );
  }

  return {
    configPath,
    raw,
    parsed,
  };
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

function collectTypeScriptFiles(
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
        entry.isSymbolicLink()
      ) {
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
        entry.isFile() &&
        /\.(?:ts|tsx|mts|cts)$/u.test(
          entry.name,
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

function scriptKindForPath(
  ts,
  relativePath,
) {
  if (
    relativePath.endsWith(
      ".tsx",
    )
  ) {
    return ts.ScriptKind.TSX;
  }

  return ts.ScriptKind.TS;
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
      scriptKindForPath(
        ts,
        relativePath,
      ),
    );

  if (
    sourceFile.parseDiagnostics.length >
    0
  ) {
    fail(
      [
        `Erro de parsing TypeScript em ${relativePath}:`,
        ...sourceFile.parseDiagnostics.map(
          (diagnostic) =>
            ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              "\n",
            ),
        ),
      ].join(
        "\n",
      ),
    );
  }

  return sourceFile;
}

function manualResolveRelativeModule(
  rootDir,
  sourceRelativePath,
  specifier,
) {
  if (
    !specifier.startsWith(
      ".",
    )
  ) {
    return null;
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
    /\.[cm]?tsx?$/u.test(
      base,
    )
      ? [
          base,
        ]
      : [
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.mts`,
          `${base}.cts`,
          `${base}/index.ts`,
          `${base}/index.tsx`,
          `${base}/index.mts`,
          `${base}/index.cts`,
        ];

  for (
    const candidate of
      candidates
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        candidate,
      );

    if (
      fs.existsSync(
        absolutePath,
      ) &&
      fs.lstatSync(
        absolutePath,
      ).isFile()
    ) {
      return candidate;
    }
  }

  return null;
}

function resolveModuleTarget(
  ts,
  rootDir,
  sourceRelativePath,
  specifier,
  compilerOptions,
) {
  const sourceAbsolutePath =
    fromPosixRelative(
      rootDir,
      sourceRelativePath,
    );

  const resolution =
    ts.resolveModuleName(
      specifier,
      sourceAbsolutePath,
      compilerOptions,
      ts.sys,
    ).resolvedModule;

  if (
    resolution
  ) {
    const absoluteResolved =
      path.resolve(
        resolution.resolvedFileName,
      );

    const relative =
      path.relative(
        rootDir,
        absoluteResolved,
      );

    if (
      !relative.startsWith(
        "..",
      ) &&
      !path.isAbsolute(
        relative,
      )
    ) {
      return toPosixRelative(
        rootDir,
        absoluteResolved,
      );
    }
  }

  return manualResolveRelativeModule(
    rootDir,
    sourceRelativePath,
    specifier,
  );
}

function leftmostEntityName(
  ts,
  entityName,
) {
  let current =
    entityName;

  while (
    ts.isQualifiedName(
      current,
    )
  ) {
    current =
      current.left;
  }

  return ts.isIdentifier(
    current,
  )
    ? current.text
    : null;
}

function collectModuleReferences(
  ts,
  sourceFile,
) {
  const references =
    [];

  function pushReference(
    literal,
    kind,
    node,
    importedNames,
    safeForFacadeRewrite,
    unsupportedReason = null,
  ) {
    const position =
      sourceFile.getLineAndCharacterOfPosition(
        literal.getStart(
          sourceFile,
        ),
      );

    references.push(
      {
        literal,
        kind,
        node,
        specifier:
          literal.text,
        importedNames,
        safeForFacadeRewrite,
        unsupportedReason,
        line:
          position.line +
          1,
        column:
          position.character +
          1,
      },
    );
  }

  function visit(
    node,
  ) {
    if (
      ts.isImportDeclaration(
        node,
      ) &&
      ts.isStringLiteralLike(
        node.moduleSpecifier,
      )
    ) {
      const clause =
        node.importClause;

      if (
        !clause
      ) {
        pushReference(
          node.moduleSpecifier,
          "import-side-effect",
          node,
          [],
          false,
          "import de side effect não pode ser redirecionado automaticamente para a fachada agregada",
        );
      } else {
        const importedNames =
          [];

        let safe =
          true;

        let reason =
          null;

        if (
          clause.name
        ) {
          importedNames.push(
            "default",
          );
        }

        if (
          clause.namedBindings
        ) {
          if (
            ts.isNamespaceImport(
              clause.namedBindings,
            )
          ) {
            importedNames.push(
              "*",
            );

            safe =
              false;

            reason =
              "namespace import de subpath não pode ser ampliado automaticamente para toda a fachada @core";
          } else {
            for (
              const element of
                clause.namedBindings.elements
            ) {
              importedNames.push(
                (
                  element.propertyName ??
                  element.name
                ).text,
              );
            }
          }
        }

        pushReference(
          node.moduleSpecifier,
          "import",
          node,
          importedNames,
          safe,
          reason,
        );
      }
    } else if (
      ts.isExportDeclaration(
        node,
      ) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(
        node.moduleSpecifier,
      )
    ) {
      if (
        !node.exportClause ||
        ts.isNamespaceExport(
          node.exportClause,
        )
      ) {
        pushReference(
          node.moduleSpecifier,
          "export-from",
          node,
          [
            "*",
          ],
          false,
          "export * / namespace export de subpath não pode ser ampliado automaticamente para toda a fachada @core",
        );
      } else {
        pushReference(
          node.moduleSpecifier,
          "export-from",
          node,
          node.exportClause.elements.map(
            (element) =>
              (
                element.propertyName ??
                element.name
              ).text,
          ),
          true,
        );
      }
    } else if (
      ts.isCallExpression(
        node,
      ) &&
      node.expression.kind ===
        ts.SyntaxKind.ImportKeyword &&
      node.arguments.length ===
        1 &&
      ts.isStringLiteralLike(
        node.arguments[0],
      )
    ) {
      pushReference(
        node.arguments[0],
        "dynamic-import",
        node,
        [
          "*",
        ],
        false,
        "dynamic import de subpath expõe namespace próprio e requer decisão manual",
      );
    } else if (
      ts.isImportTypeNode(
        node,
      ) &&
      ts.isLiteralTypeNode(
        node.argument,
      ) &&
      ts.isStringLiteralLike(
        node.argument.literal,
      )
    ) {
      const importedName =
        node.qualifier
          ? leftmostEntityName(
              ts,
              node.qualifier,
            )
          : null;

      pushReference(
        node.argument.literal,
        "import-type",
        node,
        importedName
          ? [
              importedName,
            ]
          : [
              "*",
            ],
        importedName !==
          null,
        importedName ===
          null
          ? "import type de namespace de subpath requer decisão manual"
          : null,
      );
    } else if (
      ts.isImportEqualsDeclaration(
        node,
      ) &&
      ts.isExternalModuleReference(
        node.moduleReference,
      ) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(
        node.moduleReference.expression,
      )
    ) {
      pushReference(
        node.moduleReference.expression,
        "import-equals",
        node,
        [
          "*",
        ],
        false,
        "import = require() de subpath requer decisão manual",
      );
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(
    sourceFile,
  );

  return references;
}

function loadPublicCoreExports(
  ts,
  rootDir,
  parsedConfig,
) {
  const program =
    ts.createProgram(
      parsedConfig.fileNames,
      parsedConfig.options,
    );

  const coreAbsolute =
    fromPosixRelative(
      rootDir,
      CORE_INDEX_PATH,
    );

  const sourceFile =
    program.getSourceFile(
      coreAbsolute,
    ) ??
    program.getSourceFile(
      CORE_INDEX_PATH,
    );

  if (
    !sourceFile
  ) {
    fail(
      `${CORE_INDEX_PATH} não foi resolvido pelo TypeScript Program.`,
    );
  }

  const checker =
    program.getTypeChecker();

  const moduleSymbol =
    checker.getSymbolAtLocation(
      sourceFile,
    );

  if (
    !moduleSymbol
  ) {
    fail(
      "A fachada @core não possui símbolo de módulo resolvível.",
    );
  }

  return new Set(
    checker.getExportsOfModule(
      moduleSymbol,
    ).map(
      (symbol) =>
        symbol.getName(),
    ),
  );
}

function scanExternalCoreReferences(
  ts,
  rootDir,
  parsedConfig,
  publicNames,
) {
  const references =
    [];

  const forbiddenAliasSubpaths =
    [];

  const blocked =
    [];

  const files =
    collectTypeScriptFiles(
      rootDir,
    );

  for (
    const relativePath of
      files
  ) {
    if (
      relativePath.startsWith(
        "src/core/",
      )
    ) {
      continue;
    }

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
        collectModuleReferences(
          ts,
          sourceFile,
        )
    ) {
      if (
        reference.specifier ===
        "@core"
      ) {
        continue;
      }

      if (
        reference.specifier.startsWith(
          "@core/",
        )
      ) {
        forbiddenAliasSubpaths.push(
          {
            filePath:
              relativePath,
            ...reference,
          },
        );

        continue;
      }

      const targetPath =
        resolveModuleTarget(
          ts,
          rootDir,
          relativePath,
          reference.specifier,
          parsedConfig.options,
        );

      if (
        targetPath ===
          null ||
        !targetPath.startsWith(
          "src/core/",
        )
      ) {
        continue;
      }

      const record =
        {
          filePath:
            relativePath,
          ...reference,
          targetPath,
        };

      references.push(
        record,
      );

      if (
        !reference.safeForFacadeRewrite
      ) {
        blocked.push(
          {
            ...record,
            missingPublicNames: [],
            reason:
              reference.unsupportedReason,
          },
        );

        continue;
      }

      const missingPublicNames =
        reference.importedNames.filter(
          (name) =>
            name !==
              "*" &&
            !publicNames.has(
              name,
            ),
        );

      if (
        missingPublicNames.length >
        0
      ) {
        blocked.push(
          {
            ...record,
            missingPublicNames,
            reason:
              "símbolo(s) ainda não exportado(s) pela fachada pública @core",
          },
        );
      }
    }
  }

  return {
    filesScanned:
      files.length,
    references,
    forbiddenAliasSubpaths,
    blocked,
  };
}

function decidePromotions(
  scanResult,
) {
  const promotions =
    new Map();

  const trulyBlocked =
    [];

  for (
    const record of
      scanResult.blocked
  ) {
    if (
      record.missingPublicNames.length ===
      0
    ) {
      trulyBlocked.push(
        record,
      );

      continue;
    }

    const allowed =
      ALLOWED_INTERNAL_PROMOTIONS.get(
        record.targetPath,
      );

    if (
      !allowed ||
      record.missingPublicNames.some(
        (name) =>
          !allowed.has(
            name,
          ),
      )
    ) {
      trulyBlocked.push(
        record,
      );

      continue;
    }

    if (
      !promotions.has(
        record.targetPath,
      )
    ) {
      promotions.set(
        record.targetPath,
        new Set(),
      );
    }

    const targetPromotions =
      promotions.get(
        record.targetPath,
      );

    for (
      const name of
        record.missingPublicNames
    ) {
      targetPromotions.add(
        name,
      );
    }
  }

  return {
    promotions,
    trulyBlocked,
  };
}

function formatBlockedRecords(
  records,
) {
  return records
    .slice(
      0,
      30,
    )
    .map(
      (record) =>
        `  ${record.filePath}:${String(record.line)}:${String(record.column)} | ${record.specifier} -> ${record.targetPath ?? "?"} | ${record.reason}${
          record.missingPublicNames.length >
          0
            ? ` | faltando: ${record.missingPublicNames.join(", ")}`
            : ""
        }`,
    )
    .join(
      "\n",
    );
}

function buildCoreFacadePromotion(
  ts,
  rootDir,
  promotions,
) {
  if (
    promotions.size ===
    0
  ) {
    return null;
  }

  if (
    promotions.size !==
      1 ||
    !promotions.has(
      "src/core/internal/semver.ts",
    )
  ) {
    fail(
      "A Etapa 16 só autoriza promoção explícita de satisfies em internal/semver.ts.",
    );
  }

  const symbols =
    [
      ...promotions.get(
        "src/core/internal/semver.ts",
      ),
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          "en",
        ),
    );

  if (
    symbols.length !==
      1 ||
    symbols[0] !==
      "satisfies"
  ) {
    fail(
      `Promoções internas inesperadas: ${symbols.join(", ")}`,
    );
  }

  const absolutePath =
    fromPosixRelative(
      rootDir,
      CORE_INDEX_PATH,
    );

  const before =
    fs.readFileSync(
      absolutePath,
      "utf8",
    );

  if (
    before.includes(
      'export * from "./internal',
    ) ||
    before.includes(
      "export * from './internal",
    ) ||
    before.includes(
      'export * from "./runtime',
    ) ||
    before.includes(
      "export * from './runtime",
    )
  ) {
    fail(
      `${CORE_INDEX_PATH} já contém reexport amplo de internal/runtime, o que viola a Etapa 16.`,
    );
  }

  const eol =
    before.includes(
      "\r\n",
    )
      ? "\r\n"
      : "\n";

  const addition =
    [
      "",
      "// ── Utilitário SemVer público ────────────────────────────────────────────",
      "// Exposto de forma explícita para validação de ranges de plugins/modding.",
      '// Não transforma `internal/*` em API pública genérica.',
      'export { satisfies } from "./internal/semver";',
      "",
    ].join(
      eol,
    );

  const after =
    `${before.trimEnd()}${addition}`;

  parseSource(
    ts,
    CORE_INDEX_PATH,
    after,
  );

  return {
    filePath:
      CORE_INDEX_PATH,
    before,
    after,
    promotedSymbols:
      symbols,
  };
}

function createRewritePlan(
  ts,
  rootDir,
  parsedConfig,
  effectivePublicNames,
) {
  const scanResult =
    scanExternalCoreReferences(
      ts,
      rootDir,
      parsedConfig,
      effectivePublicNames,
    );

  if (
    scanResult.forbiddenAliasSubpaths.length >
    0
  ) {
    fail(
      [
        "Foram encontrados imports @core/*, proibidos pela fachada exata da Etapa 15:",
        ...scanResult.forbiddenAliasSubpaths.map(
          (record) =>
            `  ${record.filePath}:${String(record.line)}:${String(record.column)} -> ${record.specifier}`,
        ),
      ].join(
        "\n",
      ),
    );
  }

  if (
    scanResult.blocked.length >
    0
  ) {
    fail(
      [
        "Ainda existem consumos do Core que não podem ser migrados automaticamente para @core:",
        formatBlockedRecords(
          scanResult.blocked,
        ),
      ].join(
        "\n",
      ),
    );
  }

  const grouped =
    new Map();

  for (
    const reference of
      scanResult.references
  ) {
    if (
      !grouped.has(
        reference.filePath,
      )
    ) {
      grouped.set(
        reference.filePath,
        [],
      );
    }

    grouped.get(
      reference.filePath,
    ).push(
      reference,
    );
  }

  const changes =
    [];

  for (
    const [
      filePath,
      references,
    ] of
      [
        ...grouped.entries(),
      ].sort(
        (a, b) =>
          a[0].localeCompare(
            b[0],
            "en",
          ),
      )
  ) {
    const absolutePath =
      fromPosixRelative(
        rootDir,
        filePath,
      );

    const before =
      fs.readFileSync(
        absolutePath,
        "utf8",
      );

    const sourceFile =
      parseSource(
        ts,
        filePath,
        before,
      );

    const edits =
      references.map(
        (reference) => {
          const start =
            reference.literal.getStart(
              sourceFile,
            );

          const end =
            reference.literal.getEnd();

          const quote =
            before[
              start
            ];

          if (
            quote !==
              '"' &&
            quote !==
              "'"
          ) {
            fail(
              `Literal de módulo sem aspas simples/duplas em ${filePath}:${String(reference.line)}.`,
            );
          }

          return {
            start,
            end,
            replacement:
              `${quote}@core${quote}`,
            kind:
              reference.kind,
            line:
              reference.line,
            column:
              reference.column,
            oldSpecifier:
              reference.specifier,
            newSpecifier:
              "@core",
            targetPath:
              reference.targetPath,
            importedNames:
              reference.importedNames,
          };
        },
      );

    let after =
      before;

    for (
      const edit of
        [
          ...edits,
        ].sort(
          (a, b) =>
            b.start -
            a.start,
        )
    ) {
      after =
        `${after.slice(0, edit.start)}${edit.replacement}${after.slice(edit.end)}`;
    }

    if (
      after ===
      before
    ) {
      fail(
        `Plano de rewrite não alterou ${filePath}.`,
      );
    }

    parseSource(
      ts,
      filePath,
      after,
    );

    changes.push(
      {
        filePath,
        before,
        after,
        edits:
          edits.map(
            ({
              start,
              end,
              replacement,
              ...journalEdit
            }) =>
              journalEdit,
          ),
      },
    );
  }

  return {
    filesScanned:
      scanResult.filesScanned,
    references:
      scanResult.references,
    changes,
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
    `Transformação anterior não suportada: ${String(operation.transformation)}`,
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

function identityV6(
  operation,
) {
  if (
    operation.transformation !==
      STAGE16_REWRITE_TRANSFORMATION &&
    operation.transformation !==
      STAGE16_PROMOTION_TRANSFORMATION
  ) {
    return identityV5(
      operation,
    );
  }

  return {
    sequence:
      operation.sequence,
    sourceStage: 16,
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
    rewriteCount:
      operation.rewriteCount,
    edits:
      operation.edits,
    newSpecifier:
      operation.newSpecifier,
    promotedSymbols:
      operation.promotedSymbols,
  };
}

function validatePreStageGlobalJournal(
  journal,
) {
  if (
    journal.schemaVersion !==
      EXPECTED_PRE_STAGE_SCHEMA ||
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
      EXPECTED_PRE_STAGE_OPERATION_COUNT
  ) {
    fail(
      `Pré-condição: journal v20 schema ${String(EXPECTED_PRE_STAGE_SCHEMA)} com ${String(EXPECTED_PRE_STAGE_OPERATION_COUNT)} operações em estado migrated.`,
    );
  }

  const digest =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV5(
            operation,
          ),
      ),
    );

  if (
    digest !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal global pré-Etapa 16 divergiu.",
    );
  }

  if (
    journal.counts?.stage15ConfigFiles !==
      2 ||
    journal.counts?.stage15TsconfigAliases !==
      1 ||
    journal.counts?.stage15ViteAliases !==
      1 ||
    journal.counts?.stage15SourceImportsRewritten !==
      0 ||
    journal.counts?.stage15WildcardAliases !==
      0
  ) {
    fail(
      "Counts da Etapa 15 no journal global são incompatíveis.",
    );
  }
}

function validateStage15Journal(
  rootDir,
  globalJournal,
) {
  const absolutePath =
    fromPosixRelative(
      rootDir,
      STAGE15_JOURNAL_PATH,
    );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    fail(
      `Pré-condição ausente: ${STAGE15_JOURNAL_PATH}`,
    );
  }

  const journal =
    readJson(
      absolutePath,
      STAGE15_JOURNAL_PATH,
    );

  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      "stage-15-install-core-alias" ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      2 ||
    journal.counts?.applied !==
      2 ||
    journal.counts?.sourceImportsRewritten !==
      0 ||
    journal.counts?.wildcardAliases !==
      0
  ) {
    fail(
      "Journal da Etapa 15 não representa a instalação exata do alias @core.",
    );
  }

  const expectedFiles =
    new Set([
      "tsconfig.json",
      "vite.config.ts",
    ]);

  for (
    const operation of
      journal.operations
  ) {
    if (
      operation.transformation !==
        STAGE15_ALIAS_TRANSFORMATION ||
      operation.aliasSpecifier !==
        "@core" ||
      operation.aliasTarget !==
        "src/core/index.ts" ||
      !expectedFiles.has(
        operation.filePath,
      )
    ) {
      fail(
        `Operação inesperada no journal da Etapa 15: ${String(operation.filePath)}`,
      );
    }

    const current =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.filePath,
        ),
      );

    if (
      current.kind !==
        "file" ||
      current.sha256 !==
        operation.fileShaAfter ||
      current.bytes !==
        operation.fileBytesAfter
    ) {
      fail(
        `Config da Etapa 15 divergiu: ${operation.filePath}`,
      );
    }

    for (
      const [
        backupPath,
        backupSha,
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
      const backup =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            backupPath,
          ),
        );

      if (
        backup.kind !==
          "file" ||
        backup.sha256 !==
          backupSha
      ) {
        fail(
          `Backup da Etapa 15 inválido: ${backupPath}`,
        );
      }
    }

    expectedFiles.delete(
      operation.filePath,
    );
  }

  if (
    expectedFiles.size !==
    0
  ) {
    fail(
      `Config(s) da Etapa 15 ausente(s): ${[...expectedFiles].join(", ")}`,
    );
  }

  const globalTail =
    globalJournal.operations.slice(
      -2,
    );

  if (
    semanticSha256(
      globalTail.map(
        (operation) =>
          identityV5(
            operation,
          ),
      ),
    ) !==
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV5(
            operation,
          ),
      ),
    )
  ) {
    fail(
      "As operações da Etapa 15 divergem do final do journal global.",
    );
  }

  return journal;
}

function runRollbackDryRunPreflight(
  rootDir,
) {
  const rollbackAbsolute =
    fromPosixRelative(
      rootDir,
      ROLLBACK_SCRIPT_PATH,
    );

  if (
    !fs.existsSync(
      rollbackAbsolute,
    )
  ) {
    fail(
      `Rollback obrigatório ausente: ${ROLLBACK_SCRIPT_PATH}`,
    );
  }

  const result =
    runCommand(
      process.execPath,
      [
        rollbackAbsolute,
        "--dry-run",
      ],
      rootDir,
      true,
    );

  if (
    result.status !==
    0
  ) {
    fail(
      [
        "O dry-run de rollback pré-Etapa 16 falhou; a migração foi bloqueada antes de qualquer write.",
        result.stdout.trim(),
        result.stderr.trim(),
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

function backupPathsFor(
  filePath,
) {
  return {
    before:
      `${STAGE16_BACKUP_ROOT}/before/${filePath}`,
    after:
      `${STAGE16_BACKUP_ROOT}/after/${filePath}`,
  };
}

function writeStage16Backups(
  rootDir,
  changes,
) {
  const backupRecords =
    new Map();

  for (
    const change of
      changes
  ) {
    const paths =
      backupPathsFor(
        change.filePath,
      );

    for (
      const relativePath of
        [
          paths.before,
          paths.after,
        ]
    ) {
      if (
        fs.existsSync(
          fromPosixRelative(
            rootDir,
            relativePath,
          ),
        )
      ) {
        fail(
          `Backup da Etapa 16 já existe sem journal consolidado: ${relativePath}`,
        );
      }
    }

    writeTextAtomic(
      fromPosixRelative(
        rootDir,
        paths.before,
      ),
      change.before,
    );

    writeTextAtomic(
      fromPosixRelative(
        rootDir,
        paths.after,
      ),
      change.after,
    );

    backupRecords.set(
      change.filePath,
      {
        ...paths,
        beforeSha256:
          sha256Text(
            change.before,
          ),
        afterSha256:
          sha256Text(
            change.after,
          ),
      },
    );
  }

  return backupRecords;
}

function buildOperation(
  change,
  backup,
  sequence,
  timestampUtc,
) {
  const beforeBytes =
    Buffer.byteLength(
      change.before,
      "utf8",
    );

  const afterBytes =
    Buffer.byteLength(
      change.after,
      "utf8",
    );

  const beforeSha =
    sha256Text(
      change.before,
    );

  const afterSha =
    sha256Text(
      change.after,
    );

  const isPromotion =
    change.kind ===
    STAGE16_PROMOTION_TRANSFORMATION;

  return {
    sequence,
    sourceStage: 16,
    moduleKey: null,
    capabilityId: null,
    isWorker: false,
    oldPath:
      change.filePath,
    newPath:
      change.filePath,
    bytes:
      afterBytes,
    shaBefore:
      beforeSha,
    shaAfter:
      afterSha,
    timestampUtc,
    transformation:
      change.kind,
    state:
      "applied",
    rollbackTimestampUtc:
      null,
    filePath:
      change.filePath,
    fileBytesBefore:
      beforeBytes,
    fileBytesAfter:
      afterBytes,
    fileShaBefore:
      beforeSha,
    fileShaAfter:
      afterSha,
    backupBeforePath:
      backup.before,
    backupBeforeSha256:
      backup.beforeSha256,
    backupAfterPath:
      backup.after,
    backupAfterSha256:
      backup.afterSha256,
    rewriteCount:
      isPromotion
        ? 0
        : change.edits.length,
    edits:
      isPromotion
        ? []
        : change.edits,
    newSpecifier:
      isPromotion
        ? null
        : "@core",
    promotedSymbols:
      isPromotion
        ? change.promotedSymbols
        : [],
  };
}

function buildStage16Journal(
  operations,
  scanStats,
  timestampUtc,
) {
  const rewriteOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE16_REWRITE_TRANSFORMATION,
    );

  const promotionOperations =
    operations.filter(
      (operation) =>
        operation.transformation ===
        STAGE16_PROMOTION_TRANSFORMATION,
    );

  return {
    schemaVersion: 1,
    stage:
      STAGE_NAME,
    architectureMigrationVersion:
      EXPECTED_ARCHITECTURE_VERSION,
    status:
      "completed",
    createdAtUtc:
      timestampUtc,
    updatedAtUtc:
      timestampUtc,
    completedAtUtc:
      timestampUtc,
    counts: {
      filesChanged:
        operations.length,
      sourceFilesRewritten:
        rewriteOperations.length,
      specifiersRewritten:
        rewriteOperations.reduce(
          (
            sum,
            operation,
          ) =>
            sum +
            operation.rewriteCount,
          0,
        ),
      coreFacadeFilesChanged:
        promotionOperations.length,
      promotedSymbols:
        promotionOperations.reduce(
          (
            sum,
            operation,
          ) =>
            sum +
            operation.promotedSymbols.length,
          0,
        ),
      typeScriptFilesScanned:
        scanStats.filesScanned,
      externalCoreSubpathReferencesBefore:
        scanStats.referencesBefore,
      forbiddenCoreSubpathImportsRemaining:
        0,
      wildcardInternalReexportsAdded:
        0,
      runtimeReexportsAdded:
        0,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV6(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "Etapa 16 migra somente consumidores externos do Core para o alias exato @core.",
      "A análise e as posições de rewrite são obtidas por TypeScript Compiler API.",
      "satisfies é promovido explicitamente porque o módulo de modding valida ranges SemVer de plugins.",
      "Nenhum export * de internal/* ou runtime/* é introduzido.",
      "A correção StateReplicationApi/StateReplicator pertence à Etapa 17.",
    ],
  };
}

function buildGlobalJournal(
  previous,
  stage16Journal,
  timestampUtc,
) {
  const operations =
    [
      ...previous.operations,
      ...stage16Journal.operations,
    ];

  const sourceJournals =
    Array.isArray(
      previous.sourceJournals,
    )
      ? [
          ...previous.sourceJournals,
        ]
      : [];

  if (
    !sourceJournals.some(
      (record) =>
        record.path ===
        STAGE16_JOURNAL_PATH,
    )
  ) {
    sourceJournals.push(
      {
        stage:
          STAGE_NAME,
        path:
          STAGE16_JOURNAL_PATH,
        statusAtConsolidation:
          stage16Journal.status,
      },
    );
  }

  return {
    ...previous,
    schemaVersion: 6,
    journalRevision: 6,
    status:
      "migrated",
    updatedAtUtc:
      timestampUtc,
    sourceJournals,
    counts: {
      ...previous.counts,
      totalOperations:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      stage16FilesChanged:
        stage16Journal.counts.filesChanged,
      stage16SourceFilesRewritten:
        stage16Journal.counts.sourceFilesRewritten,
      stage16SpecifierRewrites:
        stage16Journal.counts.specifiersRewritten,
      stage16CoreFacadeFilesChanged:
        stage16Journal.counts.coreFacadeFilesChanged,
      stage16PromotedSymbols:
        stage16Journal.counts.promotedSymbols,
      stage16ForbiddenCoreSubpathImportsRemaining:
        0,
      stage16WildcardInternalReexportsAdded:
        0,
      stage16RuntimeReexportsAdded:
        0,
    },
    operationsIdentityAlgorithm:
      "semantic-sha256-v6",
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV6(
              operation,
            ),
        ),
      ),
    operations,
  };
}

function validateExistingStage16(
  ts,
  rootDir,
  parsedConfig,
  journal,
  globalJournal,
) {
  if (
    journal.schemaVersion !==
      1 ||
    journal.stage !==
      STAGE_NAME ||
    journal.architectureMigrationVersion !==
      EXPECTED_ARCHITECTURE_VERSION ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_STAGE16_OPERATION_COUNT ||
    journal.counts?.sourceFilesRewritten !==
      EXPECTED_REWRITE_FILE_COUNT ||
    journal.counts?.specifiersRewritten !==
      EXPECTED_SPECIFIER_REWRITE_COUNT ||
    journal.counts?.coreFacadeFilesChanged !==
      EXPECTED_CORE_FACADE_FILE_COUNT ||
    journal.counts?.promotedSymbols !==
      EXPECTED_PROMOTED_SYMBOL_COUNT
  ) {
    fail(
      "Journal existente da Etapa 16 é incompatível.",
    );
  }

  const stageDigest =
    semanticSha256(
      journal.operations.map(
        (operation) =>
          identityV6(
            operation,
          ),
      ),
    );

  if (
    stageDigest !==
    journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal da Etapa 16 divergiu.",
    );
  }

  for (
    const operation of
      journal.operations
  ) {
    const current =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.filePath,
        ),
      );

    if (
      current.kind !==
        "file" ||
      current.bytes !==
        operation.fileBytesAfter ||
      current.sha256 !==
        operation.fileShaAfter
    ) {
      fail(
        `Filesystem divergiu da Etapa 16: ${operation.filePath}`,
      );
    }

    for (
      const [
        backupPath,
        backupSha,
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
      const backup =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            backupPath,
          ),
        );

      if (
        backup.kind !==
          "file" ||
        backup.sha256 !==
          backupSha
      ) {
        fail(
          `Backup da Etapa 16 divergiu: ${backupPath}`,
        );
      }
    }
  }

  if (
    globalJournal.schemaVersion !==
      6 ||
    globalJournal.status !==
      "migrated" ||
    !Array.isArray(
      globalJournal.operations,
    ) ||
    globalJournal.operations.length !==
      EXPECTED_FINAL_OPERATION_COUNT
  ) {
    fail(
      "Journal global não está consolidado com a Etapa 16.",
    );
  }

  const globalDigest =
    semanticSha256(
      globalJournal.operations.map(
        (operation) =>
          identityV6(
            operation,
          ),
      ),
    );

  if (
    globalDigest !==
    globalJournal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global divergiu após a Etapa 16.",
    );
  }

  const publicNames =
    loadPublicCoreExports(
      ts,
      rootDir,
      parsedConfig,
    );

  if (
    !publicNames.has(
      "satisfies",
    )
  ) {
    fail(
      "A fachada @core perdeu o export público explícito de satisfies.",
    );
  }

  const finalScan =
    scanExternalCoreReferences(
      ts,
      rootDir,
      parsedConfig,
      publicNames,
    );

  if (
    finalScan.references.length !==
      0 ||
    finalScan.forbiddenAliasSubpaths.length !==
      0 ||
    finalScan.blocked.length !==
      0
  ) {
    fail(
      "Etapa 16 existente ainda possui imports externos para subpaths do Core.",
    );
  }
}

function rollbackOwnWrites(
  rootDir,
  changes,
  originalGlobalJournalBuffer,
) {
  const errors =
    [];

  for (
    let index =
      changes.length -
      1;
    index >=
      0;
    index -=
      1
  ) {
    const change =
      changes[
        index
      ];

    try {
      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          change.filePath,
        ),
        change.before,
      );
    } catch (
      error
    ) {
      errors.push(
        `${change.filePath}: ${
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
        ".migration/stage16",
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
      `cleanup-stage16: ${
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

function runStage16() {
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

  if (
    ARCHITECTURE_MIGRATION_VERSION !==
    EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Arquitetura inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}. Esperado: ${EXPECTED_ARCHITECTURE_VERSION}.`,
    );
  }

  const ts =
    loadTypeScript();

  const tsConfig =
    loadTsConfig(
      ts,
      rootDir,
    );

  const globalJournalPath =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  const globalJournal =
    readJson(
      globalJournalPath,
      V20_JOURNAL_PATH,
    );

  const stage16Absolute =
    fromPosixRelative(
      rootDir,
      STAGE16_JOURNAL_PATH,
    );

  if (
    fs.existsSync(
      stage16Absolute,
    )
  ) {
    const stage16Journal =
      readJson(
        stage16Absolute,
        STAGE16_JOURNAL_PATH,
      );

    validateExistingStage16(
      ts,
      rootDir,
      tsConfig.parsed,
      stage16Journal,
      globalJournal,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 16 JÁ ESTÁ CONCLUÍDA                   ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[OK] Consumidores reescritos: ${String(EXPECTED_REWRITE_FILE_COUNT)}/${String(EXPECTED_REWRITE_FILE_COUNT)}`,
    );
    console.log(
      `[OK] Specifiers em @core: ${String(EXPECTED_SPECIFIER_REWRITE_COUNT)}/${String(EXPECTED_SPECIFIER_REWRITE_COUNT)}`,
    );
    console.log(
      "[OK] Símbolo público promovido explicitamente: satisfies",
    );
    console.log(
      "[OK] Imports externos para subpaths do Core restantes: 0",
    );
    return;
  }

  validatePreStageGlobalJournal(
    globalJournal,
  );

  validateStage15Journal(
    rootDir,
    globalJournal,
  );

  runRollbackDryRunPreflight(
    rootDir,
  );

  const publicNamesBefore =
    loadPublicCoreExports(
      ts,
      rootDir,
      tsConfig.parsed,
    );

  const initialScan =
    scanExternalCoreReferences(
      ts,
      rootDir,
      tsConfig.parsed,
      publicNamesBefore,
    );

  if (
    initialScan.forbiddenAliasSubpaths.length >
    0
  ) {
    fail(
      "Imports @core/* já existem antes da Etapa 16; abortando.",
    );
  }

  const promotionDecision =
    decidePromotions(
      initialScan,
    );

  if (
    promotionDecision.trulyBlocked.length >
    0
  ) {
    fail(
      [
        "A Etapa 16 encontrou consumo que não pertence à API pública do Core e não pode ser promovido automaticamente:",
        formatBlockedRecords(
          promotionDecision.trulyBlocked,
        ),
      ].join(
        "\n",
      ),
    );
  }

  const promotionChange =
    buildCoreFacadePromotion(
      ts,
      rootDir,
      promotionDecision.promotions,
    );

  const effectivePublicNames =
    new Set(
      publicNamesBefore,
    );

  for (
    const symbolSet of
      promotionDecision.promotions.values()
  ) {
    for (
      const symbolName of
        symbolSet
    ) {
      effectivePublicNames.add(
        symbolName,
      );
    }
  }

  const rewritePlan =
    createRewritePlan(
      ts,
      rootDir,
      tsConfig.parsed,
      effectivePublicNames,
    );

  const specifierCount =
    rewritePlan.changes.reduce(
      (
        sum,
        change,
      ) =>
        sum +
        change.edits.length,
      0,
    );

  const promotedSymbolCount =
    promotionChange
      ? promotionChange.promotedSymbols.length
      : 0;

  if (
    rewritePlan.changes.length !==
      EXPECTED_REWRITE_FILE_COUNT ||
    specifierCount !==
      EXPECTED_SPECIFIER_REWRITE_COUNT ||
    promotionChange ===
      null ||
    promotedSymbolCount !==
      EXPECTED_PROMOTED_SYMBOL_COUNT
  ) {
    fail(
      [
        "Escopo calculado da Etapa 16 diverge do estado aprovado do Projeto1_077.",
        `Consumidores calculados: ${String(rewritePlan.changes.length)} / esperado ${String(EXPECTED_REWRITE_FILE_COUNT)}`,
        `Specifiers calculados: ${String(specifierCount)} / esperado ${String(EXPECTED_SPECIFIER_REWRITE_COUNT)}`,
        `Promoções calculadas: ${String(promotedSymbolCount)} / esperado ${String(EXPECTED_PROMOTED_SYMBOL_COUNT)}`,
      ].join(
        "\n",
      ),
    );
  }

  const changes =
    [
      {
        ...promotionChange,
        kind:
          STAGE16_PROMOTION_TRANSFORMATION,
        edits: [],
      },
      ...rewritePlan.changes.map(
        (change) => ({
          ...change,
          kind:
            STAGE16_REWRITE_TRANSFORMATION,
          promotedSymbols: [],
        }),
      ),
    ];

  if (
    changes.length !==
    EXPECTED_STAGE16_OPERATION_COUNT
  ) {
    fail(
      `Operações Etapa 16 calculadas: ${String(changes.length)}; esperado: ${String(EXPECTED_STAGE16_OPERATION_COUNT)}.`,
    );
  }

  const mutablePaths =
    changes.map(
      (change) =>
        change.filePath,
    );

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
      mutablePaths,
    );

  const originalGlobalJournalBuffer =
    fs.readFileSync(
      globalJournalPath,
    );

  const appliedChanges =
    [];

  try {
    const backups =
      writeStage16Backups(
        rootDir,
        changes,
      );

    const now =
      new Date().toISOString();

    const operations =
      [];

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 16: IMPORTS EXTERNOS DO CORE           ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] Journal global pré-Etapa 16: ${String(globalJournal.operations.length)} operações / schema ${String(globalJournal.schemaVersion)}.`,
    );
    console.log(
      "[OK] Alias @core da Etapa 15: TypeScript + Vite íntegros.",
    );
    console.log(
      "[OK] Dry-run de rollback das Etapas anteriores: passou.",
    );
    console.log(
      `[OK] Arquivos TypeScript analisados: ${String(rewritePlan.filesScanned)}`,
    );
    console.log("");
    console.log(
      "=== ESCOPO EXATO DA ETAPA 16 ===",
    );
    console.log(
      `[PROMOTE] ${CORE_INDEX_PATH} -> export explícito { satisfies }`,
    );
    console.log(
      `[REWRITE] consumidores: ${String(rewritePlan.changes.length)}`,
    );
    console.log(
      `[REWRITE] specifiers: ${String(specifierCount)}`,
    );
    console.log(
      "[REEXPORT] internal/* indiscriminado: 0",
    );
    console.log(
      "[REEXPORT] runtime/*: 0",
    );
    console.log(
      "[ETAPA 17] StateReplicator/NetworkApi: 0 alterações",
    );
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    for (
      let index =
        0;
      index <
        changes.length;
      index +=
        1
    ) {
      const change =
        changes[
          index
        ];

      const backup =
        backups.get(
          change.filePath,
        );

      if (
        !backup
      ) {
        fail(
          `Backup ausente para ${change.filePath}`,
        );
      }

      writeTextAtomic(
        fromPosixRelative(
          rootDir,
          change.filePath,
        ),
        change.after,
      );

      const current =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            change.filePath,
          ),
        );

      if (
        current.kind !==
          "file" ||
        current.sha256 !==
          sha256Text(
            change.after,
          ) ||
        current.bytes !==
          Buffer.byteLength(
            change.after,
            "utf8",
          )
      ) {
        fail(
          `Verificação pós-write falhou: ${change.filePath}`,
        );
      }

      const operation =
        buildOperation(
          change,
          backup,
          EXPECTED_PRE_STAGE_OPERATION_COUNT +
            index +
            1,
          now,
        );

      operations.push(
        operation,
      );

      appliedChanges.push(
        change,
      );

      if (
        change.kind ===
        STAGE16_PROMOTION_TRANSFORMATION
      ) {
        console.log(
          `  [OK] ${change.filePath} | promove satisfies explicitamente`,
        );
      } else {
        console.log(
          `  [OK] ${change.filePath} | ${String(change.edits.length)} specifier(s) -> @core`,
        );
      }
    }

    const publicNamesAfter =
      loadPublicCoreExports(
        ts,
        rootDir,
        loadTsConfig(
          ts,
          rootDir,
        ).parsed,
      );

    if (
      !publicNamesAfter.has(
        "satisfies",
      )
    ) {
      fail(
        "satisfies não ficou exportado por @core após a promoção explícita.",
      );
    }

    const postScan =
      scanExternalCoreReferences(
        ts,
        rootDir,
        loadTsConfig(
          ts,
          rootDir,
        ).parsed,
        publicNamesAfter,
      );

    if (
      postScan.references.length !==
        0 ||
      postScan.forbiddenAliasSubpaths.length !==
        0 ||
      postScan.blocked.length !==
        0
    ) {
      fail(
        [
          "Pós-validação da Etapa 16 falhou.",
          `Subpath refs restantes: ${String(postScan.references.length)}`,
          `@core/* restantes: ${String(postScan.forbiddenAliasSubpaths.length)}`,
          `Bloqueados: ${String(postScan.blocked.length)}`,
        ].join(
          "\n",
        ),
      );
    }

    const stage16Journal =
      buildStage16Journal(
        operations,
        {
          filesScanned:
            rewritePlan.filesScanned,
          referencesBefore:
            rewritePlan.references.length,
        },
        now,
      );

    writeJsonAtomic(
      stage16Absolute,
      stage16Journal,
    );

    writeFileAtomic(
      fromPosixRelative(
        rootDir,
        `${STAGE16_BACKUP_ROOT}/v20-journal.before.json`,
      ),
      originalGlobalJournalBuffer,
    );

    const nextGlobal =
      buildGlobalJournal(
        globalJournal,
        stage16Journal,
        now,
      );

    if (
      nextGlobal.operations.length !==
      EXPECTED_FINAL_OPERATION_COUNT
    ) {
      fail(
        `Journal global final deveria conter ${String(EXPECTED_FINAL_OPERATION_COUNT)} operações; atual: ${String(nextGlobal.operations.length)}.`,
      );
    }

    writeJsonAtomic(
      globalJournalPath,
      nextGlobal,
    );

    const writtenStage16 =
      readJson(
        stage16Absolute,
        STAGE16_JOURNAL_PATH,
      );

    const writtenGlobal =
      readJson(
        globalJournalPath,
        V20_JOURNAL_PATH,
      );

    validateExistingStage16(
      ts,
      rootDir,
      loadTsConfig(
        ts,
        rootDir,
      ).parsed,
      writtenStage16,
      writtenGlobal,
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
          "Arquivo fora do escopo da Etapa 16 foi alterado.",
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
      `[OK] Arquivos alterados: ${String(writtenStage16.counts.filesChanged)}/${String(EXPECTED_STAGE16_OPERATION_COUNT)}`,
    );
    console.log(
      `[OK] Consumidores reescritos: ${String(writtenStage16.counts.sourceFilesRewritten)}/${String(EXPECTED_REWRITE_FILE_COUNT)}`,
    );
    console.log(
      `[OK] Specifiers migrados para @core: ${String(writtenStage16.counts.specifiersRewritten)}/${String(EXPECTED_SPECIFIER_REWRITE_COUNT)}`,
    );
    console.log(
      `[OK] Símbolos internal promovidos explicitamente: ${String(writtenStage16.counts.promotedSymbols)}/${String(EXPECTED_PROMOTED_SYMBOL_COUNT)} (satisfies)`,
    );
    console.log(
      "[OK] Reexport indiscriminado de internal: 0",
    );
    console.log(
      "[OK] Reexport de runtime: 0",
    );
    console.log(
      "[OK] Imports externos para subpaths do Core restantes: 0",
    );
    console.log(
      `[OK] Journal: ${STAGE16_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global v20: ${String(writtenGlobal.operations.length)} operações / schema ${String(writtenGlobal.schemaVersion)}.`,
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
      "  ETAPA 16 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "Todos os consumidores externos do Core agora usam a fachada pública @core; apenas satisfies foi promovido explicitamente de internal/semver.",
    );
  } catch (
    error
  ) {
    const compensationErrors =
      rollbackOwnWrites(
        rootDir,
        appliedChanges,
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
          "[OK] Compensação da Etapa 16 restaurou todos os arquivos alterados e o journal global anterior.",
        ].join(
          "\n",
        ),
      );
    }

    fail(
      [
        originalMessage,
        `Compensação encontrou ${String(compensationErrors.length)} erro(s):`,
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
    runStage16();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 16 não concluída.",
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
