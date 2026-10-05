#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
  TOOLING_PLUGINS,
  EXPERIMENTAL_PLUGINS,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-19-check-dependencies";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const COMPOSITION_ROOT =
  "src/app/createEnginePlugins.ts";

const BOOTSTRAPPED_AUXILIARY_PLUGINS =
  Object.freeze(
    [
      ...TOOLING_PLUGINS,
      ...EXPERIMENTAL_PLUGINS,
    ].filter(
      (record) =>
        record.bootstrapped ===
        true,
    ),
  );

const INACTIVE_AUXILIARY_PLUGINS =
  Object.freeze(
    [
      ...TOOLING_PLUGINS,
      ...EXPERIMENTAL_PLUGINS,
    ].filter(
      (record) =>
        record.bootstrapped !==
        true,
    ),
  );

const DEBUG_PLUGIN_PATH =
  TOOLING_PLUGINS.find(
    (record) =>
      record.pluginId ===
      "game.debug",
  )?.plugin ??
  null;

const PLAYER_PLUGIN_PATH =
  EXPERIMENTAL_PLUGINS.find(
    (record) =>
      record.pluginId ===
      "game.player",
  )?.plugin ??
  null;

const PLUGIN_KIND_RANK =
  Object.freeze({
    internal: 0,
    preloaded: 1,
    external: 2,
  });

const VALID_PLUGIN_KINDS =
  new Set([
    "internal",
    "preloaded",
    "external",
  ]);

const REQUIRED_PROJECT_FILES =
  Object.freeze([
    "package.json",
    "tsconfig.json",
    "scripts/architecture/module-map.mjs",
    "scripts/architecture/check-boundaries.mjs",
    COMPOSITION_ROOT,
    "src/core/contracts/capability-token.ts",
    "src/core/contracts/plugin-kind.ts",
    "src/core/contracts/plugin-manifest.ts",
    "src/core/internal/boot-order.ts",
    "src/core/internal/capability-registry.ts",
    "src/core/internal/semver.ts",
  ]);

const REQUIRED_PROJECT_DIRECTORIES =
  Object.freeze([
    "src",
    "src/app",
    "src/plugins",
    "src/tokens",
  ]);

const SOURCE_EXTENSIONS =
  Object.freeze([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ]);

const RULES =
  Object.freeze({
    COMPOSITION:
      "DEP001",
    MANIFEST:
      "DEP002",
    SEMVER:
      "DEP003",
    CAPABILITY_PROVISION:
      "DEP004",
    CAPABILITY_REQUIRED:
      "DEP005",
    CAPABILITY_OPTIONAL:
      "DEP006",
    CAPABILITY_CONFLICT:
      "DEP007",
    PLUGIN_DEPENDENCY:
      "DEP008",
    PLUGIN_CYCLE:
      "DEP009",
    PROVIDER_AMBIGUITY:
      "DEP010",
    PLUGIN_KIND:
      "DEP011",
  });

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
      json: false,
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
      json: false,
    };
  }

  if (
    argv.length ===
      1 &&
    argv[0] ===
      "--json"
  ) {
    return {
      help: false,
      json: true,
    };
  }

  fail(
    [
      "Argumentos inválidos.",
      "Uso:",
      "  node scripts/architecture/check-dependencies.mjs",
      "  node scripts/architecture/check-dependencies.mjs --json",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 19: fiscalização do grafo de dependências

Uso:
  node scripts/architecture/check-dependencies.mjs
  node scripts/architecture/check-dependencies.mjs --json

O checker é estritamente read-only e valida:
  - capabilities fornecidas;
  - capabilities obrigatórias;
  - capabilities opcionais;
  - conflicts em capabilities, quando declarados;
  - versões e ranges semver;
  - dependências plugin -> plugin;
  - ciclos de dependsOn;
  - provider ambiguity respeitando priority;
  - regras de PluginKind usadas pelo Kernel.

O grafo analisado é o conjunto realmente registrado por
src/app/createEnginePlugins.ts. Todos os módulos canônicos do
module-map e todos os plugins auxiliares marcados bootstrapped devem
estar presentes; auxiliares não-bootstrapped permanecem fora da
composição.
`);
}

function assertProjectRoot(
  rootDir,
) {
  for (
    const relativePath of
      REQUIRED_PROJECT_FILES
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
        `Execute o checker na raiz do Projeto1. Arquivo obrigatório ausente: ${relativePath}`,
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
        `Arquivo obrigatório inválido: ${relativePath}`,
      );
    }
  }

  for (
    const relativePath of
      REQUIRED_PROJECT_DIRECTORIES
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
        `Diretório obrigatório ausente: ${relativePath}/`,
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
        `Diretório obrigatório inválido: ${relativePath}/`,
      );
    }
  }
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
        "A Etapa 19 usa o TypeScript Compiler API para ler composition root e manifests sem executar plugins.",
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

function collectFilesRecursively(
  rootDir,
  relativeRoot,
  predicate,
) {
  const absoluteRoot =
    fromPosixRelative(
      rootDir,
      relativeRoot,
    );

  if (
    !fs.existsSync(
      absoluteRoot,
    )
  ) {
    return [];
  }

  const out =
    [];

  const stack =
    [
      absoluteRoot,
    ];

  while (
    stack.length >
    0
  ) {
    const current =
      stack.pop();

    if (
      current ===
      undefined
    ) {
      continue;
    }

    const entries =
      fs.readdirSync(
        current,
        {
          withFileTypes: true,
        },
      );

    entries.sort(
      (
        left,
        right,
      ) =>
        left.name.localeCompare(
          right.name,
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
          current,
          entry.name,
        );

      if (
        entry.isSymbolicLink()
      ) {
        fail(
          `Symlink não suportado no escopo da Etapa 19: ${toPosixRelative(rootDir, absolute)}`,
        );
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
        const relative =
          toPosixRelative(
            rootDir,
            absolute,
          );

        if (
          predicate(
            relative,
          )
        ) {
          out.push(
            relative,
          );
        }
      }
    }
  }

  return out.sort(
    (
      left,
      right,
    ) =>
      left.localeCompare(
        right,
        "en",
      ),
  );
}

function dependencyInputFiles(
  rootDir,
) {
  const paths =
    new Set(
      REQUIRED_PROJECT_FILES,
    );

  for (
    const relativePath of
      collectFilesRecursively(
        rootDir,
        "src/plugins",
        (candidate) =>
          candidate.endsWith(
            ".ts",
          ),
      )
  ) {
    paths.add(
      relativePath,
    );
  }

  for (
    const relativePath of
      collectFilesRecursively(
        rootDir,
        "src/tokens",
        (candidate) =>
          candidate.endsWith(
            ".ts",
          ),
      )
  ) {
    paths.add(
      relativePath,
    );
  }

  return [...paths].sort(
    (
      left,
      right,
    ) =>
      left.localeCompare(
        right,
        "en",
      ),
  );
}

function snapshotFiles(
  rootDir,
  relativePaths,
) {
  const records =
    [];

  for (
    const relativePath of
      relativePaths
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
      records.push(
        {
          path:
            relativePath,
          kind:
            "missing",
        },
      );

      continue;
    }

    const stat =
      fs.lstatSync(
        absolutePath,
      );

    if (
      stat.isSymbolicLink()
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
      !stat.isFile()
    ) {
      records.push(
        {
          path:
            relativePath,
          kind:
            "non-file",
        },
      );

      continue;
    }

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

  return {
    count:
      records.length,
    digest:
      semanticSha256(
        records,
      ),
  };
}

function isExported(
  ts,
  node,
) {
  const modifiers =
    ts.canHaveModifiers(
      node,
    )
      ? ts.getModifiers(
          node,
        ) ??
        []
      : [];

  return modifiers.some(
    (modifier) =>
      modifier.kind ===
      ts.SyntaxKind.ExportKeyword,
  );
}

function propertyNameText(
  ts,
  name,
) {
  if (
    ts.isIdentifier(
      name,
    ) ||
    ts.isStringLiteral(
      name,
    ) ||
    ts.isNumericLiteral(
      name,
    )
  ) {
    return name.text;
  }

  return null;
}

function unwrapExpression(
  ts,
  expression,
) {
  let current =
    expression;

  while (
    ts.isParenthesizedExpression(
      current,
    ) ||
    ts.isAsExpression(
      current,
    ) ||
    ts.isTypeAssertionExpression(
      current,
    ) ||
    ts.isNonNullExpression(
      current,
    ) ||
    (
      typeof ts.isSatisfiesExpression ===
        "function" &&
      ts.isSatisfiesExpression(
        current,
      )
    )
  ) {
    current =
      current.expression;
  }

  return current;
}

function resolveModuleFile(
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
    [];

  if (
    SOURCE_EXTENSIONS.some(
      (extension) =>
        base.endsWith(
          extension,
        ),
    )
  ) {
    candidates.push(
      base,
    );
  } else {
    for (
      const extension of
        SOURCE_EXTENSIONS
    ) {
      candidates.push(
        `${base}${extension}`,
      );
    }

    for (
      const extension of
        SOURCE_EXTENSIONS
    ) {
      candidates.push(
        `${base}/index${extension}`,
      );
    }
  }

  for (
    const candidate of
      candidates
  ) {
    const absolute =
      fromPosixRelative(
        rootDir,
        candidate,
      );

    if (
      !fs.existsSync(
        absolute,
      )
    ) {
      continue;
    }

    const stat =
      fs.lstatSync(
        absolute,
      );

    if (
      stat.isSymbolicLink() ||
      !stat.isFile()
    ) {
      continue;
    }

    return candidate;
  }

  return null;
}

class StaticEvaluator {
  constructor(
    ts,
    rootDir,
  ) {
    this.ts =
      ts;

    this.rootDir =
      rootDir;

    this.contextCache =
      new Map();

    this.valueCache =
      new Map();

    this.inProgress =
      new Set();
  }

  loadContext(
    relativePath,
  ) {
    const cached =
      this.contextCache.get(
        relativePath,
      );

    if (
      cached
    ) {
      return cached;
    }

    const absolutePath =
      fromPosixRelative(
        this.rootDir,
        relativePath,
      );

    const sourceText =
      fs.readFileSync(
        absolutePath,
        "utf8",
      );

    const sourceFile =
      this.ts.createSourceFile(
        relativePath,
        sourceText,
        this.ts.ScriptTarget.Latest,
        true,
        relativePath.endsWith(
          ".tsx",
        )
          ? this.ts.ScriptKind.TSX
          : this.ts.ScriptKind.TS,
      );

    if (
      sourceFile.parseDiagnostics.length >
      0
    ) {
      const diagnostics =
        sourceFile.parseDiagnostics.map(
          (diagnostic) =>
            this.ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              "\n",
            ),
        );

      fail(
        [
          `Falha de parsing TypeScript em ${relativePath}:`,
          ...diagnostics,
        ].join(
          "\n",
        ),
      );
    }

    const variables =
      new Map();

    const exportedVariables =
      new Map();

    const imports =
      new Map();

    const functions =
      new Map();

    for (
      const statement of
        sourceFile.statements
    ) {
      if (
        this.ts.isVariableStatement(
          statement,
        )
      ) {
        for (
          const declaration of
            statement.declarationList.declarations
        ) {
          if (
            !this.ts.isIdentifier(
              declaration.name,
            ) ||
            declaration.initializer ===
              undefined
          ) {
            continue;
          }

          variables.set(
            declaration.name.text,
            declaration.initializer,
          );

          if (
            isExported(
              this.ts,
              statement,
            )
          ) {
            exportedVariables.set(
              declaration.name.text,
              declaration.initializer,
            );
          }
        }
      }

      if (
        this.ts.isFunctionDeclaration(
          statement,
        ) &&
        statement.name
      ) {
        functions.set(
          statement.name.text,
          statement,
        );
      }

      if (
        this.ts.isImportDeclaration(
          statement,
        ) &&
        this.ts.isStringLiteralLike(
          statement.moduleSpecifier,
        )
      ) {
        const moduleSpecifier =
          statement.moduleSpecifier.text;

        const clause =
          statement.importClause;

        if (
          clause?.name
        ) {
          imports.set(
            clause.name.text,
            {
              moduleSpecifier,
              importedName:
                "default",
            },
          );
        }

        const bindings =
          clause?.namedBindings;

        if (
          bindings &&
          this.ts.isNamedImports(
            bindings,
          )
        ) {
          for (
            const element of
              bindings.elements
          ) {
            imports.set(
              element.name.text,
              {
                moduleSpecifier,
                importedName:
                  element.propertyName
                    ?.text ??
                  element.name.text,
              },
            );
          }
        }
      }
    }

    const context =
      {
        relativePath,
        sourceText,
        sourceFile,
        variables,
        exportedVariables,
        imports,
        functions,
      };

    this.contextCache.set(
      relativePath,
      context,
    );

    return context;
  }

  evaluateExport(
    relativePath,
    exportName,
  ) {
    const cacheKey =
      `${relativePath}::${exportName}`;

    if (
      this.valueCache.has(
        cacheKey,
      )
    ) {
      return this.valueCache.get(
        cacheKey,
      );
    }

    if (
      this.inProgress.has(
        cacheKey,
      )
    ) {
      fail(
        `Ciclo de avaliação estática detectado em ${cacheKey}.`,
      );
    }

    this.inProgress.add(
      cacheKey,
    );

    try {
      const context =
        this.loadContext(
          relativePath,
        );

      const initializer =
        context.exportedVariables.get(
          exportName,
        );

      if (
        initializer ===
        undefined
      ) {
        fail(
          `Export estático "${exportName}" não encontrado em ${relativePath}.`,
        );
      }

      const value =
        this.evaluate(
          initializer,
          context,
          new Map(),
        );

      this.valueCache.set(
        cacheKey,
        value,
      );

      return value;
    } finally {
      this.inProgress.delete(
        cacheKey,
      );
    }
  }

  evaluateIdentifier(
    name,
    context,
    scope,
  ) {
    if (
      scope.has(
        name,
      )
    ) {
      return scope.get(
        name,
      );
    }

    if (
      name ===
        "undefined"
    ) {
      return undefined;
    }

    if (
      name ===
        "NaN"
    ) {
      return Number.NaN;
    }

    const local =
      context.variables.get(
        name,
      );

    if (
      local !==
      undefined
    ) {
      return this.evaluate(
        local,
        context,
        scope,
      );
    }

    const imported =
      context.imports.get(
        name,
      );

    if (
      imported !==
      undefined
    ) {
      if (
        !imported.moduleSpecifier.startsWith(
          ".",
        )
      ) {
        return {
          __externalImport:
            imported.moduleSpecifier,
          __importedName:
            imported.importedName,
        };
      }

      const targetPath =
        resolveModuleFile(
          this.rootDir,
          context.relativePath,
          imported.moduleSpecifier,
        );

      if (
        targetPath ===
        null
      ) {
        fail(
          `Import relativo não resolvido durante avaliação: ${context.relativePath} -> ${imported.moduleSpecifier}`,
        );
      }

      return this.evaluateExport(
        targetPath,
        imported.importedName,
      );
    }

    fail(
      `Identificador não resolvido durante avaliação estática em ${context.relativePath}: ${name}`,
    );
  }

  evaluateArrow(
    arrow,
    context,
    parentScope,
    argument,
  ) {
    if (
      arrow.parameters.length !==
      1 ||
      !this.ts.isIdentifier(
        arrow.parameters[0].name,
      )
    ) {
      fail(
        `Callback de map não suportado em ${context.relativePath}.`,
      );
    }

    const scope =
      new Map(
        parentScope,
      );

    scope.set(
      arrow.parameters[0].name.text,
      argument,
    );

    if (
      this.ts.isBlock(
        arrow.body,
      )
    ) {
      const returnStatement =
        arrow.body.statements.find(
          (statement) =>
            this.ts.isReturnStatement(
              statement,
            ) &&
            statement.expression !==
              undefined,
        );

      if (
        !returnStatement ||
        returnStatement.expression ===
          undefined
      ) {
        fail(
          `Callback de map sem return estático em ${context.relativePath}.`,
        );
      }

      return this.evaluate(
        returnStatement.expression,
        context,
        scope,
      );
    }

    return this.evaluate(
      arrow.body,
      context,
      scope,
    );
  }

  evaluate(
    rawExpression,
    context,
    scope,
  ) {
    const expression =
      unwrapExpression(
        this.ts,
        rawExpression,
      );

    if (
      this.ts.isStringLiteralLike(
        expression,
      )
    ) {
      return expression.text;
    }

    if (
      this.ts.isNumericLiteral(
        expression,
      )
    ) {
      return Number(
        expression.text,
      );
    }

    if (
      expression.kind ===
      this.ts.SyntaxKind.TrueKeyword
    ) {
      return true;
    }

    if (
      expression.kind ===
      this.ts.SyntaxKind.FalseKeyword
    ) {
      return false;
    }

    if (
      expression.kind ===
      this.ts.SyntaxKind.NullKeyword
    ) {
      return null;
    }

    if (
      this.ts.isPrefixUnaryExpression(
        expression,
      )
    ) {
      const operand =
        this.evaluate(
          expression.operand,
          context,
          scope,
        );

      if (
        typeof operand !==
        "number"
      ) {
        fail(
          `Operador unário sobre valor não numérico em ${context.relativePath}.`,
        );
      }

      if (
        expression.operator ===
        this.ts.SyntaxKind.MinusToken
      ) {
        return -operand;
      }

      if (
        expression.operator ===
        this.ts.SyntaxKind.PlusToken
      ) {
        return operand;
      }
    }

    if (
      this.ts.isIdentifier(
        expression,
      )
    ) {
      return this.evaluateIdentifier(
        expression.text,
        context,
        scope,
      );
    }

    if (
      this.ts.isArrayLiteralExpression(
        expression,
      )
    ) {
      return expression.elements.map(
        (element) =>
          this.evaluate(
            element,
            context,
            scope,
          ),
      );
    }

    if (
      this.ts.isObjectLiteralExpression(
        expression,
      )
    ) {
      const output =
        {};

      for (
        const property of
          expression.properties
      ) {
        if (
          this.ts.isSpreadAssignment(
            property,
          )
        ) {
          const spreadValue =
            this.evaluate(
              property.expression,
              context,
              scope,
            );

          if (
            spreadValue ===
              null ||
            typeof spreadValue !==
              "object" ||
            Array.isArray(
              spreadValue,
            )
          ) {
            fail(
              `Spread não-objeto em ${context.relativePath}.`,
            );
          }

          Object.assign(
            output,
            spreadValue,
          );

          continue;
        }

        if (
          this.ts.isPropertyAssignment(
            property,
          )
        ) {
          const name =
            propertyNameText(
              this.ts,
              property.name,
            );

          if (
            name ===
            null
          ) {
            fail(
              `Nome de propriedade computado não suportado em ${context.relativePath}.`,
            );
          }

          output[
            name
          ] =
            this.evaluate(
              property.initializer,
              context,
              scope,
            );

          continue;
        }

        if (
          this.ts.isShorthandPropertyAssignment(
            property,
          )
        ) {
          output[
            property.name.text
          ] =
            this.evaluateIdentifier(
              property.name.text,
              context,
              scope,
            );

          continue;
        }

        if (
          this.ts.isMethodDeclaration(
            property,
          ) ||
          this.ts.isGetAccessorDeclaration(
            property,
          ) ||
          this.ts.isSetAccessorDeclaration(
            property,
          )
        ) {
          const name =
            propertyNameText(
              this.ts,
              property.name,
            );

          if (
            name !==
            null
          ) {
            output[
              name
            ] =
              {
                __function:
                  true,
              };
          }

          continue;
        }

        fail(
          `Propriedade de objeto não suportada em ${context.relativePath}: ${this.ts.SyntaxKind[property.kind]}`,
        );
      }

      return output;
    }

    if (
      this.ts.isPropertyAccessExpression(
        expression,
      )
    ) {
      const base =
        this.evaluate(
          expression.expression,
          context,
          scope,
        );

      if (
        base ===
          null ||
        typeof base !==
          "object"
      ) {
        fail(
          `Property access sobre valor não-objeto em ${context.relativePath}: ${expression.getText(context.sourceFile)}`,
        );
      }

      return base[
        expression.name.text
      ];
    }

    if (
      this.ts.isCallExpression(
        expression,
      )
    ) {
      if (
        this.ts.isIdentifier(
          expression.expression,
        ) &&
        (
          expression.expression.text ===
            "defineCapability" ||
          expression.expression.text ===
            "defineAsyncCapability"
        )
      ) {
        const id =
          expression.arguments[0]
            ? this.evaluate(
                expression.arguments[0],
                context,
                scope,
              )
            : undefined;

        const version =
          expression.arguments[1]
            ? this.evaluate(
                expression.arguments[1],
                context,
                scope,
              )
            : "1.0.0";

        if (
          typeof id !==
            "string" ||
          typeof version !==
            "string"
        ) {
          fail(
            `defineCapability não pôde ser avaliado em ${context.relativePath}.`,
          );
        }

        return {
          id,
          version,
          __async:
            expression.expression.text ===
            "defineAsyncCapability",
        };
      }

      if (
        this.ts.isPropertyAccessExpression(
          expression.expression,
        ) &&
        expression.expression.name.text ===
          "map"
      ) {
        const source =
          this.evaluate(
            expression.expression.expression,
            context,
            scope,
          );

        const callback =
          expression.arguments[0];

        if (
          !Array.isArray(
            source,
          ) ||
          callback ===
            undefined ||
          !this.ts.isArrowFunction(
            callback,
          )
        ) {
          fail(
            `Array.map não-estático em ${context.relativePath}.`,
          );
        }

        return source.map(
          (entry) =>
            this.evaluateArrow(
              callback,
              context,
              scope,
              entry,
            ),
        );
      }

      fail(
        `Call expression não-estática em ${context.relativePath}: ${expression.getText(context.sourceFile)}`,
      );
    }

    if (
      this.ts.isArrowFunction(
        expression,
      ) ||
      this.ts.isFunctionExpression(
        expression,
      )
    ) {
      return {
        __function:
          true,
      };
    }

    if (
      this.ts.isTemplateExpression(
        expression,
      )
    ) {
      let value =
        expression.head.text;

      for (
        const span of
          expression.templateSpans
      ) {
        const evaluated =
          this.evaluate(
            span.expression,
            context,
            scope,
          );

        if (
          ![
            "string",
            "number",
            "boolean",
          ].includes(
            typeof evaluated,
          )
        ) {
          fail(
            `Template expression não-estático em ${context.relativePath}.`,
          );
        }

        value +=
          String(
            evaluated,
          ) +
          span.literal.text;
      }

      return value;
    }

    fail(
      `Expressão não suportada em avaliação estática (${context.relativePath}): ${this.ts.SyntaxKind[expression.kind]} -> ${expression.getText(context.sourceFile)}`,
    );
  }
}

function findReturnArray(
  ts,
  functionDeclaration,
) {
  if (
    functionDeclaration.body ===
      undefined
  ) {
    return null;
  }

  let found =
    null;

  const visit =
    (
      node,
    ) => {
      if (
        found !==
        null
      ) {
        return;
      }

      if (
        ts.isReturnStatement(
          node,
        ) &&
        node.expression !==
          undefined
      ) {
        const unwrapped =
          unwrapExpression(
            ts,
            node.expression,
          );

        if (
          ts.isArrayLiteralExpression(
            unwrapped,
          )
        ) {
          found =
            unwrapped;

          return;
        }
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

  visit(
    functionDeclaration.body,
  );

  return found;
}

function discoverActivePlugins(
  ts,
  rootDir,
  evaluator,
) {
  const context =
    evaluator.loadContext(
      COMPOSITION_ROOT,
    );

  const factory =
    context.functions.get(
      "createEnginePlugins",
    );

  if (
    factory ===
      undefined
  ) {
    fail(
      `${COMPOSITION_ROOT} não exporta createEnginePlugins().`,
    );
  }

  const returnArray =
    findReturnArray(
      ts,
      factory,
    );

  if (
    returnArray ===
      null
  ) {
    fail(
      `Não foi possível localizar o array retornado por createEnginePlugins() em ${COMPOSITION_ROOT}.`,
    );
  }

  const active =
    [];

  for (
    const element of
      returnArray.elements
  ) {
    const unwrapped =
      unwrapExpression(
        ts,
        element,
      );

    if (
      !ts.isCallExpression(
        unwrapped,
      ) ||
      !ts.isIdentifier(
        unwrapped.expression,
      )
    ) {
      fail(
        `Entrada não suportada na composição de plugins: ${element.getText(context.sourceFile)}`,
      );
    }

    const factoryName =
      unwrapped.expression.text;

    const imported =
      context.imports.get(
        factoryName,
      );

    if (
      imported ===
        undefined
    ) {
      fail(
        `Factory ${factoryName} usada em createEnginePlugins() não veio de import estático.`,
      );
    }

    const pluginPath =
      resolveModuleFile(
        rootDir,
        COMPOSITION_ROOT,
        imported.moduleSpecifier,
      );

    if (
      pluginPath ===
        null ||
      !/^src\/plugins\/[^/]+\/plugin\.ts$/u.test(
        pluginPath,
      )
    ) {
      fail(
        `Factory ${factoryName} não resolve para src/plugins/<id>/plugin.ts: ${imported.moduleSpecifier}`,
      );
    }

    active.push(
      {
        factoryName,
        importedName:
          imported.importedName,
        pluginPath,
      },
    );
  }

  return active;
}


function evaluateCapabilitiesExpression(
  ts,
  evaluator,
  expression,
  context,
  scope,
) {
  const unwrapped =
    unwrapExpression(
      ts,
      expression,
    );

  if (
    ts.isIdentifier(
      unwrapped,
    )
  ) {
    const local =
      context.variables.get(
        unwrapped.text,
      );

    if (
      local !==
        undefined
    ) {
      return evaluateCapabilitiesExpression(
        ts,
        evaluator,
        local,
        context,
        scope,
      );
    }

    const value =
      evaluator.evaluate(
        unwrapped,
        context,
        scope,
      );

    if (
      value !==
        null &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value,
      )
    ) {
      return value;
    }

    fail(
      `capabilities não pôde ser avaliado em ${context.relativePath}.`,
    );
  }

  if (
    !ts.isObjectLiteralExpression(
      unwrapped,
    )
  ) {
    const value =
      evaluator.evaluate(
        unwrapped,
        context,
        scope,
      );

    if (
      value !==
        null &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value,
      )
    ) {
      return value;
    }

    fail(
      `capabilities deve ser objeto estático em ${context.relativePath}.`,
    );
  }

  const output =
    {};

  for (
    const property of
      unwrapped.properties
  ) {
    if (
      ts.isSpreadAssignment(
        property,
      )
    ) {
      const spreadValue =
        evaluateCapabilitiesExpression(
          ts,
          evaluator,
          property.expression,
          context,
          scope,
        );

      Object.assign(
        output,
        spreadValue,
      );

      continue;
    }

    if (
      !ts.isPropertyAssignment(
        property,
      )
    ) {
      continue;
    }

    const name =
      propertyNameText(
        ts,
        property.name,
      );

    if (
      name ===
        "provides" ||
      name ===
        "consumes" ||
      name ===
        "conflicts"
    ) {
      output[
        name
      ] =
        evaluator.evaluate(
          property.initializer,
          context,
          scope,
        );
    }
  }

  return output;
}

function evaluateManifestExpression(
  ts,
  evaluator,
  expression,
  context,
  scope = new Map(),
) {
  const unwrapped =
    unwrapExpression(
      ts,
      expression,
    );

  if (
    ts.isIdentifier(
      unwrapped,
    )
  ) {
    const local =
      context.variables.get(
        unwrapped.text,
      );

    if (
      local !==
        undefined
    ) {
      return evaluateManifestExpression(
        ts,
        evaluator,
        local,
        context,
        scope,
      );
    }

    const importedValue =
      evaluator.evaluate(
        unwrapped,
        context,
        scope,
      );

    if (
      importedValue !==
        null &&
      typeof importedValue ===
        "object" &&
      !Array.isArray(
        importedValue,
      )
    ) {
      return importedValue;
    }

    fail(
      `Manifest não pôde ser avaliado por identifier em ${context.relativePath}: ${unwrapped.text}`,
    );
  }

  if (
    !ts.isObjectLiteralExpression(
      unwrapped,
    )
  ) {
    const value =
      evaluator.evaluate(
        unwrapped,
        context,
        scope,
      );

    if (
      value !==
        null &&
      typeof value ===
        "object" &&
      !Array.isArray(
        value,
      )
    ) {
      return value;
    }

    fail(
      `Manifest deve ser objeto estático em ${context.relativePath}.`,
    );
  }

  const output =
    {};

  const scalarFields =
    new Set([
      "id",
      "name",
      "version",
      "kind",
      "api",
      "authority",
    ]);

  for (
    const property of
      unwrapped.properties
  ) {
    if (
      ts.isSpreadAssignment(
        property,
      )
    ) {
      const spreadValue =
        evaluateManifestExpression(
          ts,
          evaluator,
          property.expression,
          context,
          scope,
        );

      Object.assign(
        output,
        spreadValue,
      );

      continue;
    }

    if (
      !ts.isPropertyAssignment(
        property,
      )
    ) {
      continue;
    }

    const name =
      propertyNameText(
        ts,
        property.name,
      );

    if (
      name ===
        null
    ) {
      continue;
    }

    if (
      scalarFields.has(
        name,
      ) ||
      name ===
        "dependsOn"
    ) {
      output[
        name
      ] =
        evaluator.evaluate(
          property.initializer,
          context,
          scope,
        );

      continue;
    }

    if (
      name ===
        "capabilities"
    ) {
      output.capabilities =
        evaluateCapabilitiesExpression(
          ts,
          evaluator,
          property.initializer,
          context,
          scope,
        );

      continue;
    }

    if (
      name ===
        "permissions" ||
      name ===
        "sandbox"
    ) {
      output[
        name
      ] =
        {
          __present:
            true,
        };
    }
  }

  return output;
}

function findInlineManifestExpression(
  ts,
  context,
  factoryName,
) {
  const factory =
    context.functions.get(
      factoryName,
    );

  if (
    factory ===
      undefined ||
    factory.body ===
      undefined
  ) {
    return null;
  }

  const candidates =
    [];

  const visit =
    (
      node,
    ) => {
      if (
        ts.isPropertyAssignment(
          node,
        )
      ) {
        const name =
          propertyNameText(
            ts,
            node.name,
          );

        if (
          name ===
            "manifest"
        ) {
          candidates.push(
            node.initializer,
          );
        }
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

  visit(
    factory.body,
  );

  for (
    const candidate of
      candidates
  ) {
    const unwrapped =
      unwrapExpression(
        ts,
        candidate,
      );

    if (
      ts.isObjectLiteralExpression(
        unwrapped,
      )
    ) {
      return candidate;
    }
  }

  return null;
}

function extractManifest(
  ts,
  evaluator,
  activePlugin,
) {
  const context =
    evaluator.loadContext(
      activePlugin.pluginPath,
    );

  const candidates =
    [];

  for (
    const [
      name,
      initializer,
    ] of
      context.exportedVariables
  ) {
    if (
      /Manifest$/u.test(
        name,
      )
    ) {
      candidates.push(
        {
          name,
          initializer,
        },
      );
    }
  }

  candidates.sort(
    (
      left,
      right,
    ) =>
      left.name.localeCompare(
        right.name,
        "en",
      ),
  );

  for (
    const candidate of
      candidates
  ) {
    try {
      const value =
        evaluateManifestExpression(
          ts,
          evaluator,
          candidate.initializer,
          context,
          new Map(),
        );

      if (
        value !==
          null &&
        typeof value ===
          "object" &&
        typeof value.id ===
          "string" &&
        typeof value.version ===
          "string" &&
        typeof value.kind ===
          "string"
      ) {
        return {
          source:
            `export const ${candidate.name}`,
          manifest:
            value,
        };
      }
    } catch {
      // Tenta o próximo candidato e, se necessário, o manifest inline.
    }
  }

  const inline =
    findInlineManifestExpression(
      ts,
      context,
      activePlugin.importedName,
    ) ??
    findInlineManifestExpression(
      ts,
      context,
      activePlugin.factoryName,
    );

  if (
    inline ===
      null
  ) {
    fail(
      `Manifest estático não encontrado em ${activePlugin.pluginPath}.`,
    );
  }

  const value =
    evaluateManifestExpression(
      ts,
      evaluator,
      inline,
      context,
      new Map(),
    );

  if (
    value ===
      null ||
    typeof value !==
      "object"
  ) {
    fail(
      `Manifest inline inválido em ${activePlugin.pluginPath}.`,
    );
  }

  return {
    source:
      "manifest inline da factory",
    manifest:
      value,
  };
}

function exactVersionParts(
  version,
) {
  if (
    typeof version !==
      "string"
  ) {
    return null;
  }

  const match =
    /^(\d+)\.(\d+)\.(\d+)$/u.exec(
      version.trim(),
    );

  if (
    !match
  ) {
    return null;
  }

  return {
    major:
      Number(
        match[1],
      ),
    minor:
      Number(
        match[2],
      ),
    patch:
      Number(
        match[3],
      ),
  };
}

function parseRangeVersion(
  input,
) {
  const match =
    /^(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?$/iu.exec(
      input.trim(),
    );

  if (
    !match
  ) {
    return null;
  }

  return {
    major:
      Number(
        match[1],
      ),
    minor:
      match[2] ===
        undefined ||
      match[2] ===
        "*" ||
      /^x$/iu.test(
        match[2],
      )
        ? -1
        : Number(
            match[2],
          ),
    patch:
      match[3] ===
        undefined ||
      match[3] ===
        "*" ||
      /^x$/iu.test(
        match[3],
      )
        ? -1
        : Number(
            match[3],
          ),
  };
}

function compareVersions(
  left,
  right,
) {
  if (
    left.major !==
    right.major
  ) {
    return left.major -
      right.major;
  }

  if (
    right.minor ===
    -1
  ) {
    return 0;
  }

  if (
    left.minor !==
    right.minor
  ) {
    return left.minor -
      right.minor;
  }

  if (
    right.patch ===
    -1
  ) {
    return 0;
  }

  return left.patch -
    right.patch;
}

function eqVersion(
  version,
  target,
) {
  if (
    target ===
      null
  ) {
    return false;
  }

  if (
    version.major !==
    target.major
  ) {
    return false;
  }

  if (
    target.minor ===
    -1
  ) {
    return true;
  }

  if (
    version.minor !==
    target.minor
  ) {
    return false;
  }

  if (
    target.patch ===
    -1
  ) {
    return true;
  }

  return version.patch ===
    target.patch;
}

function gtVersion(
  version,
  target,
) {
  if (
    target ===
      null
  ) {
    return false;
  }

  const comparison =
    compareVersions(
      version,
      target,
    );

  if (
    comparison >
    0
  ) {
    return true;
  }

  if (
    comparison <
    0
  ) {
    return false;
  }

  if (
    target.minor ===
    -1
  ) {
    return version.major >
      target.major;
  }

  if (
    target.patch ===
    -1
  ) {
    return version.minor >
      target.minor;
  }

  return false;
}

function ltVersion(
  version,
  target,
) {
  if (
    target ===
      null
  ) {
    return false;
  }

  const comparison =
    compareVersions(
      version,
      target,
    );

  if (
    comparison <
    0
  ) {
    return true;
  }

  return false;
}

function gteVersion(
  version,
  target,
) {
  return (
    eqVersion(
      version,
      target,
    ) ||
    gtVersion(
      version,
      target,
    )
  );
}

function lteVersion(
  version,
  target,
) {
  return (
    eqVersion(
      version,
      target,
    ) ||
    ltVersion(
      version,
      target,
    )
  );
}

function caretSatisfies(
  version,
  base,
) {
  if (
    base ===
      null ||
    !gteVersion(
      version,
      base,
    )
  ) {
    return false;
  }

  if (
    base.major >
    0
  ) {
    return version.major ===
      base.major;
  }

  if (
    base.minor >
    0
  ) {
    return (
      version.major ===
        0 &&
      version.minor ===
        base.minor
    );
  }

  return (
    version.major ===
      0 &&
    version.minor ===
      0 &&
    version.patch ===
      base.patch
  );
}

function tildeSatisfies(
  version,
  base,
) {
  if (
    base ===
      null ||
    !gteVersion(
      version,
      base,
    )
  ) {
    return false;
  }

  return (
    version.major ===
      base.major &&
    version.minor ===
      base.minor
  );
}

function wildcardSatisfies(
  version,
  range,
) {
  const target =
    parseRangeVersion(
      range,
    );

  if (
    target ===
      null
  ) {
    return false;
  }

  if (
    target.minor ===
    -1
  ) {
    return version.major ===
      target.major;
  }

  if (
    target.patch ===
    -1
  ) {
    return (
      version.major ===
        target.major &&
      version.minor ===
        target.minor
    );
  }

  return (
    version.major ===
      target.major &&
    version.minor ===
      target.minor &&
    version.patch ===
      target.patch
  );
}

function validateRangeSyntax(
  range,
) {
  if (
    typeof range !==
      "string"
  ) {
    return false;
  }

  const trimmed =
    range.trim();

  if (
    trimmed ===
      "" ||
    trimmed ===
      "*"
  ) {
    return true;
  }

  const parts =
    trimmed
      .split(
        /\s+/u,
      )
      .filter(
        Boolean,
      );

  return parts.every(
    (part) => {
      const match =
        /^(?:\^|~|>=|<=|>|<|=)?(.+)$/u.exec(
          part,
        );

      if (
        !match
      ) {
        return false;
      }

      return parseRangeVersion(
        match[1],
      ) !==
        null;
    },
  );
}

function satisfies(
  versionText,
  range,
) {
  const version =
    exactVersionParts(
      versionText,
    );

  if (
    version ===
      null ||
    !validateRangeSyntax(
      range,
    )
  ) {
    return false;
  }

  const trimmed =
    range.trim();

  if (
    trimmed ===
      "" ||
    trimmed ===
      "*"
  ) {
    return true;
  }

  const parts =
    trimmed
      .split(
        /\s+/u,
      )
      .filter(
        Boolean,
      );

  if (
    parts.length >
    1
  ) {
    return parts.every(
      (part) =>
        satisfies(
          versionText,
          part,
        ),
    );
  }

  if (
    trimmed.startsWith(
      "^",
    )
  ) {
    return caretSatisfies(
      version,
      parseRangeVersion(
        trimmed.slice(
          1,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      "~",
    )
  ) {
    return tildeSatisfies(
      version,
      parseRangeVersion(
        trimmed.slice(
          1,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      ">=",
    )
  ) {
    return gteVersion(
      version,
      parseRangeVersion(
        trimmed.slice(
          2,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      "<=",
    )
  ) {
    return lteVersion(
      version,
      parseRangeVersion(
        trimmed.slice(
          2,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      ">",
    )
  ) {
    return gtVersion(
      version,
      parseRangeVersion(
        trimmed.slice(
          1,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      "<",
    )
  ) {
    return ltVersion(
      version,
      parseRangeVersion(
        trimmed.slice(
          1,
        ),
      ),
    );
  }

  if (
    trimmed.startsWith(
      "=",
    )
  ) {
    return eqVersion(
      version,
      parseRangeVersion(
        trimmed.slice(
          1,
        ),
      ),
    );
  }

  return wildcardSatisfies(
    version,
    trimmed,
  );
}

function canPluginDependOn(
  fromKind,
  toKind,
) {
  return (
    PLUGIN_KIND_RANK[
      toKind
    ] <=
    PLUGIN_KIND_RANK[
      fromKind
    ]
  );
}

function canConsumeCapability(
  consumerKind,
  providerKind,
) {
  if (
    consumerKind ===
      "external"
  ) {
    return true;
  }

  return providerKind !==
    "external";
}

function asArray(
  value,
) {
  return Array.isArray(
    value,
  )
    ? value
    : [];
}

function normalizeProvision(
  raw,
) {
  if (
    raw ===
      null ||
    typeof raw !==
      "object" ||
    Array.isArray(
      raw,
    )
  ) {
    return null;
  }

  return {
    id:
      raw.id,
    version:
      raw.version,
    priority:
      raw.priority ??
      0,
  };
}

function normalizeRequirement(
  raw,
) {
  if (
    raw ===
      null ||
    typeof raw !==
      "object" ||
    Array.isArray(
      raw,
    )
  ) {
    return null;
  }

  return {
    id:
      raw.id,
    range:
      raw.range,
    optional:
      raw.optional ===
      true,
  };
}

function normalizeDependency(
  raw,
) {
  if (
    raw ===
      null ||
    typeof raw !==
      "object" ||
    Array.isArray(
      raw,
    )
  ) {
    return null;
  }

  return {
    id:
      raw.id,
    range:
      raw.range,
    optional:
      raw.optional ===
      true,
  };
}

function normalizeConflict(
  raw,
) {
  if (
    typeof raw ===
      "string"
  ) {
    return {
      id:
        raw,
      range:
        "*",
    };
  }

  if (
    raw !==
      null &&
    typeof raw ===
      "object" &&
    !Array.isArray(
      raw,
    )
  ) {
    return {
      id:
        raw.id,
      range:
        raw.range ??
        "*",
    };
  }

  return null;
}

function violation(
  rule,
  pluginId,
  pluginPath,
  message,
  details = {},
) {
  return {
    rule,
    pluginId,
    pluginPath,
    message,
    details,
  };
}

function validateComposition(
  activePlugins,
) {
  const violations =
    [];

  const counts =
    new Map();

  for (
    const active of
      activePlugins
  ) {
    counts.set(
      active.pluginPath,
      (
        counts.get(
          active.pluginPath,
        ) ??
        0
      ) +
        1,
    );
  }

  for (
    const [
      pluginPath,
      count,
    ] of
      counts
  ) {
    if (
      count >
      1
    ) {
      violations.push(
        violation(
          RULES.COMPOSITION,
          null,
          COMPOSITION_ROOT,
          `Plugin aparece ${String(count)} vezes na composição: ${pluginPath}`,
          {
            pluginPath,
            count,
          },
        ),
      );
    }
  }

  const activePaths =
    new Set(
      activePlugins.map(
        (entry) =>
          entry.pluginPath,
      ),
    );

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    if (
      !activePaths.has(
        moduleRecord.plugin,
      )
    ) {
      violations.push(
        violation(
          RULES.COMPOSITION,
          moduleRecord.capabilityId,
          COMPOSITION_ROOT,
          `Módulo canônico não está ativo em createEnginePlugins(): ${moduleRecord.plugin}`,
          {
            moduleKey:
              moduleRecord.key,
            expectedPlugin:
              moduleRecord.plugin,
          },
        ),
      );
    }
  }

  for (
    const record of
      BOOTSTRAPPED_AUXILIARY_PLUGINS
  ) {
    if (
      !activePaths.has(
        record.plugin,
      )
    ) {
      violations.push(
        violation(
          RULES.COMPOSITION,
          record.pluginId,
          COMPOSITION_ROOT,
          `Plugin auxiliar bootstrapped esperado não está ativo: ${record.plugin}`,
          {
            category:
              record.category,
            pluginPath:
              record.plugin,
          },
        ),
      );
    }
  }

  for (
    const record of
      INACTIVE_AUXILIARY_PLUGINS
  ) {
    if (
      activePaths.has(
        record.plugin,
      )
    ) {
      violations.push(
        violation(
          RULES.COMPOSITION,
          record.pluginId,
          COMPOSITION_ROOT,
          `Plugin auxiliar não-bootstrapped não pode estar ativo: ${record.plugin}`,
          {
            category:
              record.category,
            pluginPath:
              record.plugin,
          },
        ),
      );
    }
  }

  const expectedPaths =
    new Set(
      [
        ...CANONICAL_MODULES.map(
          (moduleRecord) =>
            moduleRecord.plugin,
        ),
        ...BOOTSTRAPPED_AUXILIARY_PLUGINS.map(
          (record) =>
            record.plugin,
        ),
      ],
    );

  for (
    const activePath of
      activePaths
  ) {
    if (
      !expectedPaths.has(
        activePath,
      )
    ) {
      violations.push(
        violation(
          RULES.COMPOSITION,
          null,
          COMPOSITION_ROOT,
          `Plugin first-party inesperado na composição v20: ${activePath}`,
        ),
      );
    }
  }

  return violations;
}

function validateManifestShape(
  record,
) {
  const violations =
    [];

  const manifest =
    record.manifest;

  if (
    typeof manifest.id !==
      "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/iu.test(
      manifest.id,
    )
  ) {
    violations.push(
      violation(
        RULES.MANIFEST,
        String(
          manifest.id ??
            "<unknown>",
        ),
        record.pluginPath,
        `manifest.id inválido: ${String(manifest.id)}`,
      ),
    );
  }

  if (
    typeof manifest.name !==
      "string" ||
    manifest.name.trim().length ===
      0
  ) {
    violations.push(
      violation(
        RULES.MANIFEST,
        manifest.id ??
          null,
        record.pluginPath,
        "manifest.name ausente ou vazio.",
      ),
    );
  }

  if (
    exactVersionParts(
      manifest.version,
    ) ===
      null
  ) {
    violations.push(
      violation(
        RULES.SEMVER,
        manifest.id ??
          null,
        record.pluginPath,
        `manifest.version deve ser semver concreto x.y.z: ${String(manifest.version)}`,
        {
          version:
            manifest.version,
        },
      ),
    );
  }

  if (
    !VALID_PLUGIN_KINDS.has(
      manifest.kind,
    )
  ) {
    violations.push(
      violation(
        RULES.PLUGIN_KIND,
        manifest.id ??
          null,
        record.pluginPath,
        `manifest.kind inválido: ${String(manifest.kind)}`,
        {
          kind:
            manifest.kind,
        },
      ),
    );
  } else {
    if (
      manifest.kind !==
        "external" &&
      manifest.sandbox !==
        undefined
    ) {
      violations.push(
        violation(
          RULES.PLUGIN_KIND,
          manifest.id,
          record.pluginPath,
          `manifest.sandbox só é válido para kind external; atual=${manifest.kind}.`,
        ),
      );
    }

    if (
      manifest.kind ===
        "external" &&
      manifest.permissions ===
        undefined
    ) {
      violations.push(
        violation(
          RULES.PLUGIN_KIND,
          manifest.id,
          record.pluginPath,
          "Plugin external precisa declarar permissions.",
        ),
      );
    }
  }

  return violations;
}

function canonicalModuleForPluginPath(
  pluginPath,
) {
  return CANONICAL_MODULES.find(
    (moduleRecord) =>
      moduleRecord.plugin ===
      pluginPath,
  ) ??
    null;
}

function validateGraph(
  manifestRecords,
) {
  const violations =
    [];

  const byId =
    new Map();

  const providers =
    new Map();

  const pluginEdges =
    new Map();

  const resolvedRequirements =
    [];

  const optionalUnresolved =
    [];

  let provisionsCount =
    0;

  let requiredRequirementsCount =
    0;

  let optionalRequirementsCount =
    0;

  let conflictsCount =
    0;

  let pluginDependenciesCount =
    0;

  let requiredPluginDependenciesCount =
    0;

  let optionalPluginDependenciesCount =
    0;

  for (
    const record of
      manifestRecords
  ) {
    violations.push(
      ...validateManifestShape(
        record,
      ),
    );

    const id =
      record.manifest.id;

    if (
      typeof id !==
      "string"
    ) {
      continue;
    }

    if (
      byId.has(
        id,
      )
    ) {
      violations.push(
        violation(
          RULES.MANIFEST,
          id,
          record.pluginPath,
          `Plugin id duplicado no grafo ativo: ${id}`,
          {
            otherPluginPath:
              byId.get(
                id,
              ).pluginPath,
          },
        ),
      );
    } else {
      byId.set(
        id,
        record,
      );
    }

    pluginEdges.set(
      id,
      [],
    );
  }

  for (
    const record of
      manifestRecords
  ) {
    const manifest =
      record.manifest;

    if (
      typeof manifest.id !==
        "string"
    ) {
      continue;
    }

    const capabilities =
      manifest.capabilities !==
        null &&
      typeof manifest.capabilities ===
        "object" &&
      !Array.isArray(
        manifest.capabilities,
      )
        ? manifest.capabilities
        : {};

    const rawProvides =
      capabilities.provides;

    if (
      rawProvides !==
        undefined &&
      !Array.isArray(
        rawProvides,
      )
    ) {
      violations.push(
        violation(
          RULES.CAPABILITY_PROVISION,
          manifest.id,
          record.pluginPath,
          "capabilities.provides deve ser array quando declarado.",
        ),
      );
    }

    const ownProvisionIds =
      new Set();

    for (
      const raw of
        asArray(
          rawProvides,
        )
    ) {
      provisionsCount +=
        1;

      const provision =
        normalizeProvision(
          raw,
        );

      if (
        provision ===
          null ||
        typeof provision.id !==
          "string" ||
        provision.id.length ===
          0
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_PROVISION,
            manifest.id,
            record.pluginPath,
            "Provision de capability inválida ou sem id.",
            {
              provision:
                raw,
            },
          ),
        );

        continue;
      }

      if (
        ownProvisionIds.has(
          provision.id,
        )
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_PROVISION,
            manifest.id,
            record.pluginPath,
            `Capability fornecida mais de uma vez pelo mesmo plugin: ${provision.id}`,
          ),
        );
      }

      ownProvisionIds.add(
        provision.id,
      );

      if (
        exactVersionParts(
          provision.version,
        ) ===
          null
      ) {
        violations.push(
          violation(
            RULES.SEMVER,
            manifest.id,
            record.pluginPath,
            `Versão concreta inválida em provides ${provision.id}: ${String(provision.version)}`,
          ),
        );

        continue;
      }

      if (
        typeof provision.priority !==
          "number" ||
        !Number.isFinite(
          provision.priority,
        )
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_PROVISION,
            manifest.id,
            record.pluginPath,
            `Priority inválida em provides ${provision.id}: ${String(provision.priority)}`,
          ),
        );

        continue;
      }

      const list =
        providers.get(
          provision.id,
        ) ??
        [];

      list.push(
        {
          pluginId:
            manifest.id,
          pluginPath:
            record.pluginPath,
          kind:
            manifest.kind,
          id:
            provision.id,
          version:
            provision.version,
          priority:
            provision.priority,
        },
      );

      providers.set(
        provision.id,
        list,
      );
    }

    const canonical =
      canonicalModuleForPluginPath(
        record.pluginPath,
      );

    if (
      canonical !==
        null
    ) {
      const expectedCapabilities =
        new Set([
          canonical.capabilityId,
        ]);

      for (
        const expectedId of
          expectedCapabilities
      ) {
        if (
          !ownProvisionIds.has(
            expectedId,
          )
        ) {
          violations.push(
            violation(
              RULES.CAPABILITY_PROVISION,
              manifest.id,
              record.pluginPath,
              `Módulo canônico ${canonical.key} não fornece capability mapeada: ${expectedId}`,
              {
                moduleKey:
                  canonical.key,
                expectedCapabilityId:
                  expectedId,
              },
            ),
          );
        }
      }
    }
  }

  for (
    const [
      capabilityId,
      list,
    ] of
      providers
  ) {
    list.sort(
      (
        left,
        right,
      ) =>
        right.priority -
          left.priority ||
        left.pluginId.localeCompare(
          right.pluginId,
          "en",
        ),
    );

    providers.set(
      capabilityId,
      list,
    );
  }

  for (
    const record of
      manifestRecords
  ) {
    const manifest =
      record.manifest;

    if (
      typeof manifest.id !==
        "string" ||
      !VALID_PLUGIN_KINDS.has(
        manifest.kind,
      )
    ) {
      continue;
    }

    const capabilities =
      manifest.capabilities !==
        null &&
      typeof manifest.capabilities ===
        "object" &&
      !Array.isArray(
        manifest.capabilities,
      )
        ? manifest.capabilities
        : {};

    const rawConsumes =
      capabilities.consumes;

    if (
      rawConsumes !==
        undefined &&
      !Array.isArray(
        rawConsumes,
      )
    ) {
      violations.push(
        violation(
          RULES.CAPABILITY_REQUIRED,
          manifest.id,
          record.pluginPath,
          "capabilities.consumes deve ser array quando declarado.",
        ),
      );
    }

    const seenRequirements =
      new Set();

    for (
      const raw of
        asArray(
          rawConsumes,
        )
    ) {
      const requirement =
        normalizeRequirement(
          raw,
        );

      if (
        requirement ===
          null ||
        typeof requirement.id !==
          "string" ||
        requirement.id.length ===
          0 ||
        typeof requirement.range !==
          "string"
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_REQUIRED,
            manifest.id,
            record.pluginPath,
            "Requirement de capability inválido.",
            {
              requirement:
                raw,
            },
          ),
        );

        continue;
      }

      if (
        requirement.optional
      ) {
        optionalRequirementsCount +=
          1;
      } else {
        requiredRequirementsCount +=
          1;
      }

      const duplicateKey =
        `${requirement.id}\0${requirement.range}\0${String(requirement.optional)}`;

      if (
        seenRequirements.has(
          duplicateKey,
        )
      ) {
        violations.push(
          violation(
            requirement.optional
              ? RULES.CAPABILITY_OPTIONAL
              : RULES.CAPABILITY_REQUIRED,
            manifest.id,
            record.pluginPath,
            `Requirement duplicado: ${requirement.id}@${requirement.range}`,
          ),
        );
      }

      seenRequirements.add(
        duplicateKey,
      );

      if (
        !validateRangeSyntax(
          requirement.range,
        )
      ) {
        violations.push(
          violation(
            RULES.SEMVER,
            manifest.id,
            record.pluginPath,
            `Range semver inválido em consumes ${requirement.id}: ${requirement.range}`,
          ),
        );

        continue;
      }

      const allProviders =
        providers.get(
          requirement.id,
        ) ??
        [];

      const semverMatches =
        allProviders.filter(
          (provider) =>
            satisfies(
              provider.version,
              requirement.range,
            ),
        );

      const eligible =
        semverMatches.filter(
          (provider) =>
            canConsumeCapability(
              manifest.kind,
              provider.kind,
            ),
        );

      if (
        eligible.length ===
          0
      ) {
        if (
          semverMatches.length >
          0
        ) {
          violations.push(
            violation(
              RULES.PLUGIN_KIND,
              manifest.id,
              record.pluginPath,
              `Plugin ${manifest.id} (${manifest.kind}) requer ${requirement.id}@${requirement.range}, mas providers semver-compatíveis estão em camada proibida.`,
              {
                capabilityId:
                  requirement.id,
                providers:
                  semverMatches.map(
                    (provider) => ({
                      pluginId:
                        provider.pluginId,
                      kind:
                        provider.kind,
                      version:
                        provider.version,
                    }),
                  ),
              },
            ),
          );

          continue;
        }

        if (
          requirement.optional
        ) {
          optionalUnresolved.push(
            {
              pluginId:
                manifest.id,
              capabilityId:
                requirement.id,
              range:
                requirement.range,
            },
          );

          continue;
        }

        violations.push(
          violation(
            RULES.CAPABILITY_REQUIRED,
            manifest.id,
            record.pluginPath,
            `Capability obrigatória sem provider compatível: ${requirement.id}@${requirement.range}`,
            {
              availableProviders:
                allProviders.map(
                  (provider) => ({
                    pluginId:
                      provider.pluginId,
                    version:
                      provider.version,
                    priority:
                      provider.priority,
                    kind:
                      provider.kind,
                  }),
                ),
            },
          ),
        );

        continue;
      }

      const topPriority =
        eligible[0].priority;

      const topProviders =
        eligible.filter(
          (provider) =>
            provider.priority ===
            topPriority,
        );

      if (
        topProviders.length >
        1
      ) {
        violations.push(
          violation(
            RULES.PROVIDER_AMBIGUITY,
            manifest.id,
            record.pluginPath,
            `Provider ambiguity para ${requirement.id}@${requirement.range}; ${String(topProviders.length)} providers empatam na maior priority (${String(topPriority)}).`,
            {
              capabilityId:
                requirement.id,
              range:
                requirement.range,
              providers:
                topProviders.map(
                  (provider) => ({
                    pluginId:
                      provider.pluginId,
                    version:
                      provider.version,
                    kind:
                      provider.kind,
                    priority:
                      provider.priority,
                  }),
                ),
            },
          ),
        );

        continue;
      }

      resolvedRequirements.push(
        {
          consumerPluginId:
            manifest.id,
          capabilityId:
            requirement.id,
          range:
            requirement.range,
          optional:
            requirement.optional,
          providerPluginId:
            eligible[0].pluginId,
          providerVersion:
            eligible[0].version,
          providerPriority:
            eligible[0].priority,
        },
      );
    }

    const rawConflicts =
      capabilities.conflicts;

    if (
      rawConflicts !==
        undefined &&
      !Array.isArray(
        rawConflicts,
      )
    ) {
      violations.push(
        violation(
          RULES.CAPABILITY_CONFLICT,
          manifest.id,
          record.pluginPath,
          "capabilities.conflicts deve ser array quando declarado.",
        ),
      );
    }

    for (
      const raw of
        asArray(
          rawConflicts,
        )
    ) {
      conflictsCount +=
        1;

      const conflict =
        normalizeConflict(
          raw,
        );

      if (
        conflict ===
          null ||
        typeof conflict.id !==
          "string" ||
        conflict.id.length ===
          0 ||
        typeof conflict.range !==
          "string" ||
        !validateRangeSyntax(
          conflict.range,
        )
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_CONFLICT,
            manifest.id,
            record.pluginPath,
            "Conflict de capability inválido.",
            {
              conflict:
                raw,
            },
          ),
        );

        continue;
      }

      const conflictingProviders =
        (
          providers.get(
            conflict.id,
          ) ??
          []
        ).filter(
          (provider) =>
            provider.pluginId !==
              manifest.id &&
            satisfies(
              provider.version,
              conflict.range,
            ),
        );

      if (
        conflictingProviders.length >
        0
      ) {
        violations.push(
          violation(
            RULES.CAPABILITY_CONFLICT,
            manifest.id,
            record.pluginPath,
            `Conflict ativo: ${manifest.id} declara incompatibilidade com capability ${conflict.id}@${conflict.range}.`,
            {
              providers:
                conflictingProviders.map(
                  (provider) => ({
                    pluginId:
                      provider.pluginId,
                    version:
                      provider.version,
                    priority:
                      provider.priority,
                  }),
                ),
            },
          ),
        );
      }
    }

    const rawDependencies =
      manifest.dependsOn;

    if (
      rawDependencies !==
        undefined &&
      !Array.isArray(
        rawDependencies,
      )
    ) {
      violations.push(
        violation(
          RULES.PLUGIN_DEPENDENCY,
          manifest.id,
          record.pluginPath,
          "dependsOn deve ser array quando declarado.",
        ),
      );
    }

    const seenDependencies =
      new Set();

    for (
      const raw of
        asArray(
          rawDependencies,
        )
    ) {
      pluginDependenciesCount +=
        1;

      const dependency =
        normalizeDependency(
          raw,
        );

      if (
        dependency ===
          null ||
        typeof dependency.id !==
          "string" ||
        dependency.id.length ===
          0 ||
        typeof dependency.range !==
          "string"
      ) {
        violations.push(
          violation(
            RULES.PLUGIN_DEPENDENCY,
            manifest.id,
            record.pluginPath,
            "Dependência plugin -> plugin inválida.",
            {
              dependency:
                raw,
            },
          ),
        );

        continue;
      }

      if (
        dependency.optional
      ) {
        optionalPluginDependenciesCount +=
          1;
      } else {
        requiredPluginDependenciesCount +=
          1;
      }

      if (
        seenDependencies.has(
          dependency.id,
        )
      ) {
        violations.push(
          violation(
            RULES.PLUGIN_DEPENDENCY,
            manifest.id,
            record.pluginPath,
            `dependsOn duplicado para ${dependency.id}.`,
          ),
        );
      }

      seenDependencies.add(
        dependency.id,
      );

      if (
        !validateRangeSyntax(
          dependency.range,
        )
      ) {
        violations.push(
          violation(
            RULES.SEMVER,
            manifest.id,
            record.pluginPath,
            `Range semver inválido em dependsOn ${dependency.id}: ${dependency.range}`,
          ),
        );

        continue;
      }

      const target =
        byId.get(
          dependency.id,
        );

      if (
        target ===
          undefined
      ) {
        if (
          dependency.optional
        ) {
          continue;
        }

        violations.push(
          violation(
            RULES.PLUGIN_DEPENDENCY,
            manifest.id,
            record.pluginPath,
            `Dependência obrigatória ausente: ${dependency.id}@${dependency.range}`,
          ),
        );

        continue;
      }

      if (
        !VALID_PLUGIN_KINDS.has(
          target.manifest.kind,
        )
      ) {
        continue;
      }

      if (
        !canPluginDependOn(
          manifest.kind,
          target.manifest.kind,
        )
      ) {
        violations.push(
          violation(
            RULES.PLUGIN_KIND,
            manifest.id,
            record.pluginPath,
            `Plugin ${manifest.id} (${manifest.kind}) não pode depender de ${dependency.id} (${target.manifest.kind}).`,
            {
              fromKind:
                manifest.kind,
              toKind:
                target.manifest.kind,
            },
          ),
        );
      }

      if (
        exactVersionParts(
          target.manifest.version,
        ) !==
          null &&
        !satisfies(
          target.manifest.version,
          dependency.range,
        )
      ) {
        violations.push(
          violation(
            RULES.PLUGIN_DEPENDENCY,
            manifest.id,
            record.pluginPath,
            `Versão incompatível em dependsOn: ${dependency.id}@${dependency.range}; encontrado ${target.manifest.version}.`,
            {
              required:
                dependency.range,
              found:
                target.manifest.version,
            },
          ),
        );
      }

      pluginEdges
        .get(
          manifest.id,
        )
        .push(
          dependency.id,
        );
    }
  }

  const cycles =
    detectCycles(
      pluginEdges,
    );

  for (
    const cycle of
      cycles
  ) {
    const owner =
      cycle[0];

    const record =
      byId.get(
        owner,
      );

    violations.push(
      violation(
        RULES.PLUGIN_CYCLE,
        owner,
        record
          ?.pluginPath ??
          COMPOSITION_ROOT,
        `Ciclo em dependsOn: ${cycle.join(" -> ")}`,
        {
          cycle,
        },
      ),
    );
  }

  return {
    violations,
    providers,
    byId,
    pluginEdges,
    resolvedRequirements,
    optionalUnresolved,
    cycles,
    counts: {
      plugins:
        manifestRecords.length,
      provisions:
        provisionsCount,
      providedCapabilityIds:
        providers.size,
      requiredCapabilityRequirements:
        requiredRequirementsCount,
      optionalCapabilityRequirements:
        optionalRequirementsCount,
      resolvedCapabilityRequirements:
        resolvedRequirements.length,
      optionalUnresolved:
        optionalUnresolved.length,
      conflictsDeclared:
        conflictsCount,
      pluginDependencies:
        pluginDependenciesCount,
      requiredPluginDependencies:
        requiredPluginDependenciesCount,
      optionalPluginDependencies:
        optionalPluginDependenciesCount,
      cycles:
        cycles.length,
      providerAmbiguities:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.PROVIDER_AMBIGUITY,
        ).length,
      pluginKindViolations:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.PLUGIN_KIND,
        ).length,
      semverViolations:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.SEMVER,
        ).length,
      activeConflicts:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.CAPABILITY_CONFLICT,
        ).length,
      missingRequiredCapabilities:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.CAPABILITY_REQUIRED,
        ).length,
      pluginDependencyViolations:
        violations.filter(
          (entry) =>
            entry.rule ===
            RULES.PLUGIN_DEPENDENCY,
        ).length,
    },
  };
}

function canonicalizeCycle(
  cycle,
) {
  const body =
    cycle.slice(
      0,
      -1,
    );

  if (
    body.length ===
      0
  ) {
    return cycle.join(
      "\0",
    );
  }

  const variants =
    [];

  for (
    let index = 0;
    index <
      body.length;
    index +=
      1
  ) {
    const rotated =
      [
        ...body.slice(
          index,
        ),
        ...body.slice(
          0,
          index,
        ),
      ];

    variants.push(
      rotated.join(
        "\0",
      ),
    );
  }

  variants.sort(
    (
      left,
      right,
    ) =>
      left.localeCompare(
        right,
        "en",
      ),
  );

  return variants[0];
}

function detectCycles(
  graph,
) {
  const state =
    new Map();

  const stack =
    [];

  const cycles =
    [];

  const seen =
    new Set();

  const visit =
    (
      pluginId,
    ) => {
      const currentState =
        state.get(
          pluginId,
        );

      if (
        currentState ===
        "done"
      ) {
        return;
      }

      if (
        currentState ===
        "visiting"
      ) {
        const startIndex =
          stack.lastIndexOf(
            pluginId,
          );

        const cycle =
          [
            ...stack.slice(
              startIndex,
            ),
            pluginId,
          ];

        const key =
          canonicalizeCycle(
            cycle,
          );

        if (
          !seen.has(
            key,
          )
        ) {
          seen.add(
            key,
          );

          cycles.push(
            cycle,
          );
        }

        return;
      }

      state.set(
        pluginId,
        "visiting",
      );

      stack.push(
        pluginId,
      );

      for (
        const dependencyId of
          graph.get(
            pluginId,
          ) ??
          []
      ) {
        if (
          graph.has(
            dependencyId,
          )
        ) {
          visit(
            dependencyId,
          );
        }
      }

      stack.pop();

      state.set(
        pluginId,
        "done",
      );
    };

  for (
    const pluginId of
      graph.keys()
  ) {
    visit(
      pluginId,
    );
  }

  return cycles;
}

function computeBootOrder(
  manifestRecords,
) {
  const byId =
    new Map(
      manifestRecords.map(
        (record) => [
          record.manifest.id,
          record,
        ],
      ),
    );

  const sorted =
    [...manifestRecords].sort(
      (
        left,
        right,
      ) =>
        (
          PLUGIN_KIND_RANK[
            left.manifest.kind
          ] ??
          Number.MAX_SAFE_INTEGER
        ) -
          (
            PLUGIN_KIND_RANK[
              right.manifest.kind
            ] ??
            Number.MAX_SAFE_INTEGER
          ),
    );

  const state =
    new Map();

  const order =
    [];

  const visit =
    (
      record,
    ) => {
      if (
        state.get(
          record.manifest.id,
        ) ===
        "done"
      ) {
        return;
      }

      if (
        state.get(
          record.manifest.id,
        ) ===
        "visiting"
      ) {
        return;
      }

      state.set(
        record.manifest.id,
        "visiting",
      );

      for (
        const dependency of
          asArray(
            record.manifest.dependsOn,
          )
      ) {
        const normalized =
          normalizeDependency(
            dependency,
          );

        if (
          normalized ===
            null
        ) {
          continue;
        }

        const target =
          byId.get(
            normalized.id,
          );

        if (
          target
        ) {
          visit(
            target,
          );
        }
      }

      state.set(
        record.manifest.id,
        "done",
      );

      order.push(
        record.manifest.id,
      );
    };

  for (
    const record of
      sorted
  ) {
    visit(
      record,
    );
  }

  return order;
}

function summarizeRuleCounts(
  violations,
) {
  const counts =
    {};

  for (
    const rule of
      Object.values(
        RULES,
      )
  ) {
    counts[
      rule
    ] =
      0;
  }

  for (
    const entry of
      violations
  ) {
    counts[
      entry.rule
    ] =
      (
        counts[
          entry.rule
        ] ??
        0
      ) +
        1;
  }

  return counts;
}

function printRuleMatrix() {
  console.log(
    "=== REGRAS FISCALIZADAS ===",
  );
  console.log(
    "DEP001 composição ativa (23 canônicos + game.debug; player inativo)",
  );
  console.log(
    "DEP002 shape/id/name dos manifests",
  );
  console.log(
    "DEP003 semver de manifests, provisions, consumes e dependsOn",
  );
  console.log(
    "DEP004 capabilities fornecidas e capability primária canônica",
  );
  console.log(
    "DEP005 capabilities obrigatórias",
  );
  console.log(
    "DEP006 capabilities opcionais",
  );
  console.log(
    "DEP007 capabilities.conflicts",
  );
  console.log(
    "DEP008 dependências plugin -> plugin",
  );
  console.log(
    "DEP009 ciclos em dependsOn",
  );
  console.log(
    "DEP010 provider ambiguity com desempate por priority",
  );
  console.log(
    "DEP011 regras de PluginKind do Kernel",
  );
}

function printViolation(
  entry,
) {
  console.log(
    `[${entry.rule}] ${entry.pluginId ?? "<grafo>"} | ${entry.pluginPath}`,
  );
  console.log(
    `  ${entry.message}`,
  );

  if (
    Object.keys(
      entry.details,
    ).length >
    0
  ) {
    console.log(
      `  detalhes: ${JSON.stringify(entry.details)}`,
    );
  }
}

function runStage19() {
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

  assertProjectRoot(
    rootDir,
  );

  assertArchitectureVersion();

  const ts =
    loadTypeScript();

  const inputFiles =
    dependencyInputFiles(
      rootDir,
    );

  const before =
    snapshotFiles(
      rootDir,
      inputFiles,
    );

  const evaluator =
    new StaticEvaluator(
      ts,
      rootDir,
    );

  const activePlugins =
    discoverActivePlugins(
      ts,
      rootDir,
      evaluator,
    );

  const compositionViolations =
    validateComposition(
      activePlugins,
    );

  const manifestRecords =
    activePlugins.map(
      (activePlugin) => {
        const extracted =
          extractManifest(
            ts,
            evaluator,
            activePlugin,
          );

        return {
          ...activePlugin,
          manifestSource:
            extracted.source,
          manifest:
            extracted.manifest,
        };
      },
    );

  const graph =
    validateGraph(
      manifestRecords,
    );

  const violations =
    [
      ...compositionViolations,
      ...graph.violations,
    ];

  const bootOrder =
    graph.cycles.length ===
      0
      ? computeBootOrder(
          manifestRecords,
        )
      : [];

  const ruleCounts =
    summarizeRuleCounts(
      violations,
    );

  const after =
    snapshotFiles(
      rootDir,
      inputFiles,
    );

  if (
    before.count !==
      after.count ||
    before.digest !==
      after.digest
  ) {
    fail(
      [
        "O checker de dependências alterou os inputs analisados, o que é proibido.",
        `Antes: ${String(before.count)} / ${before.digest}`,
        `Depois: ${String(after.count)} / ${after.digest}`,
      ].join(
        "\n",
      ),
    );
  }

  const result =
    {
      stage:
        STAGE_NAME,
      architectureMigrationVersion:
        EXPECTED_ARCHITECTURE_VERSION,
      typescriptVersion:
        String(
          ts.version,
        ),
      composition: {
        path:
          COMPOSITION_ROOT,
        activePluginCount:
          activePlugins.length,
        canonicalExpected:
          CANONICAL_MODULES.length,
        bootstrappedAuxiliaryExpected:
          BOOTSTRAPPED_AUXILIARY_PLUGINS.map(
            (record) => ({
              id:
                record.pluginId,
              path:
                record.plugin,
              category:
                record.category,
            }),
          ),
        inactiveAuxiliaryExpected:
          INACTIVE_AUXILIARY_PLUGINS.map(
            (record) => ({
              id:
                record.pluginId,
              path:
                record.plugin,
              category:
                record.category,
            }),
          ),
        debugExpected:
          DEBUG_PLUGIN_PATH,
        playerExpectedInactive:
          PLAYER_PLUGIN_PATH,
        activePlugins:
          manifestRecords.map(
            (record) => ({
              id:
                record.manifest.id,
              version:
                record.manifest.version,
              kind:
                record.manifest.kind,
              path:
                record.pluginPath,
              manifestSource:
                record.manifestSource,
            }),
          ),
      },
      counts: {
        ...graph.counts,
        violations:
          violations.length,
        inputsReadOnly:
          inputFiles.length,
      },
      bootOrder,
      providers:
        [...graph.providers.entries()].map(
          (
            [
              capabilityId,
              providers,
            ],
          ) => ({
            capabilityId,
            providers:
              providers.map(
                (provider) => ({
                  pluginId:
                    provider.pluginId,
                  kind:
                    provider.kind,
                  version:
                    provider.version,
                  priority:
                    provider.priority,
                }),
              ),
          }),
        ),
      resolvedRequirements:
        graph.resolvedRequirements,
      optionalUnresolved:
        graph.optionalUnresolved,
      cycles:
        graph.cycles,
      ruleCounts,
      violations,
      readOnly: {
        beforeDigest:
          before.digest,
        afterDigest:
          after.digest,
        unchanged:
          before.digest ===
            after.digest,
      },
    };

  if (
    options.json
  ) {
    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );
  } else {
    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 19: GRAFO DE DEPENDÊNCIAS              ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] TypeScript Compiler API: ${String(ts.version)}`,
    );
    console.log(
      `[OK] Plugins ativos: ${String(activePlugins.length)} (${String(CANONICAL_MODULES.length)} canônicos + ${String(BOOTSTRAPPED_AUXILIARY_PLUGINS.length)} auxiliares bootstrapped).`,
    );
    console.log(
      `[OK] game.player ativo: ${
        activePlugins.some(
          (entry) =>
            entry.pluginPath ===
            PLAYER_PLUGIN_PATH,
        )
          ? "sim"
          : "não"
      }`,
    );
    console.log(
      `[OK] Manifests analisados estaticamente: ${String(manifestRecords.length)}`,
    );
    console.log(
      `[OK] Registry auxiliar: ${String(BOOTSTRAPPED_AUXILIARY_PLUGINS.length)} ativo(s), ${String(INACTIVE_AUXILIARY_PLUGINS.length)} inativo(s).`,
    );
    console.log("");

    printRuleMatrix();

    console.log("");
    console.log(
      "=== GRAFO DE CAPABILITIES ===",
    );
    console.log(
      `Provisions declaradas: ${String(graph.counts.provisions)}`,
    );
    console.log(
      `Capability IDs fornecidos: ${String(graph.counts.providedCapabilityIds)}`,
    );
    console.log(
      `Requirements obrigatórios: ${String(graph.counts.requiredCapabilityRequirements)}`,
    );
    console.log(
      `Requirements opcionais: ${String(graph.counts.optionalCapabilityRequirements)}`,
    );
    console.log(
      `Requirements resolvidos: ${String(graph.counts.resolvedCapabilityRequirements)}`,
    );
    console.log(
      `Opcionais sem provider compatível: ${String(graph.counts.optionalUnresolved)}`,
    );
    console.log(
      `Conflicts declarados: ${String(graph.counts.conflictsDeclared)}`,
    );
    console.log(
      `Provider ambiguities: ${String(graph.counts.providerAmbiguities)}`,
    );

    console.log("");
    console.log(
      "=== GRAFO PLUGIN -> PLUGIN ===",
    );
    console.log(
      `dependsOn total: ${String(graph.counts.pluginDependencies)}`,
    );
    console.log(
      `dependsOn obrigatórios: ${String(graph.counts.requiredPluginDependencies)}`,
    );
    console.log(
      `dependsOn opcionais: ${String(graph.counts.optionalPluginDependencies)}`,
    );
    console.log(
      `Ciclos: ${String(graph.counts.cycles)}`,
    );
    console.log(
      `Boot order calculável: ${bootOrder.length === manifestRecords.length ? "sim" : "não"}`,
    );

    console.log("");
    console.log(
      "=== INTEGRIDADE ===",
    );
    console.log(
      `Semver violations: ${String(graph.counts.semverViolations)}`,
    );
    console.log(
      `PluginKind violations: ${String(graph.counts.pluginKindViolations)}`,
    );
    console.log(
      `Conflicts ativos/inválidos: ${String(graph.counts.activeConflicts)}`,
    );
    console.log(
      `Capabilities obrigatórias ausentes/inválidas: ${String(graph.counts.missingRequiredCapabilities)}`,
    );
    console.log(
      `Dependências plugin -> plugin inválidas: ${String(graph.counts.pluginDependencyViolations)}`,
    );

    console.log("");
    console.log(
      "=== RESULTADO ===",
    );

    if (
      violations.length >
      0
    ) {
      console.log(
        `[ERRO] Violações do grafo: ${String(violations.length)}`,
      );
      console.log("");

      for (
        const entry of
          violations
      ) {
        printViolation(
          entry,
        );
      }

      console.log("");
      console.log(
        `[OK] Prova read-only antes: ${before.digest}`,
      );
      console.log(
        `[OK] Prova read-only depois: ${after.digest}`,
      );
      console.log("");
      console.log(
        "============================================================",
      );
      console.log(
        "  ETAPA 19 — GRAFO DE DEPENDÊNCIAS REPROVADO              ",
      );
      console.log(
        "============================================================",
      );
    } else {
      console.log(
        "[OK] Violações do grafo: 0",
      );
      console.log(
        "[OK] Capabilities obrigatórias resolvem para provider único.",
      );
      console.log(
        "[OK] Capabilities opcionais obedecem ausência tolerada e semver.",
      );
      console.log(
        "[OK] Provider priority preservada; nenhum empate ambíguo.",
      );
      console.log(
        "[OK] dependsOn sem missing obrigatório, range inválido ou ciclo.",
      );
      console.log(
        "[OK] Regras de PluginKind compatíveis com o Kernel.",
      );
      console.log(
        `[OK] Prova read-only antes: ${before.digest}`,
      );
      console.log(
        `[OK] Prova read-only depois: ${after.digest}`,
      );
      console.log(
        "[OK] Nenhum arquivo foi criado, removido, movido ou reescrito.",
      );
      console.log("");
      console.log(
        "============================================================",
      );
      console.log(
        "  ETAPA 19 CONCLUÍDA COM SUCESSO                           ",
      );
      console.log(
        "============================================================",
      );
      console.log(
        "O grafo ativo de plugins/capabilities está consistente com semver, priority e PluginKind do Kernel.",
      );
    }
  }

  process.exitCode =
    violations.length ===
      0
      ? 0
      : 1;
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
    runStage19();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 19 não concluída.",
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