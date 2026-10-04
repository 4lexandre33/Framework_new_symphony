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
  "stage-15-install-core-alias";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_PRE_STAGE15_SCHEMA_VERSION =
  4;

const EXPECTED_POST_STAGE15_SCHEMA_VERSION =
  5;

const EXPECTED_PRE_STAGE15_OPERATION_COUNT =
  245;

const EXPECTED_STAGE10_MOVE_COUNT =
  93;

const EXPECTED_STAGE12_EXTRACTION_COUNT =
  21;

const EXPECTED_STAGE13_REWRITE_COUNT =
  108;

const EXPECTED_STAGE14_FACADE_COUNT =
  23;

const EXPECTED_STAGE15_CONFIG_COUNT =
  2;

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const EXPECTED_STAGE14_EXPORT_STATEMENT_COUNT =
  48;

const CORE_ALIAS =
  "@core";

const CORE_ENTRY =
  "src/core/index.ts";

const TSCONFIG_PATH =
  "tsconfig.json";

const VITE_CONFIG_PATH =
  "vite.config.ts";

const V20_JOURNAL_PATH =
  ".migration/v20-journal.json";

const STAGE14_JOURNAL_PATH =
  ".migration/stage14/facade-journal.json";

const STAGE15_JOURNAL_PATH =
  ".migration/stage15/core-alias-journal.json";

const STAGE15_BACKUP_ROOT =
  ".migration/stage15/backups";

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
      "  node scripts/architecture/stage15-install-core-alias.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 15: implantação real do alias @core

Uso:
  node scripts/architecture/stage15-install-core-alias.mjs

Escopo exato:
  - atualizar tsconfig.json com paths["@core"] -> ./src/core/index.ts;
  - atualizar vite.config.ts com alias exato /^@core$/ -> src/core/index.ts;
  - preservar todos os imports de código existentes;
  - registrar 2 operações reversíveis no journal global v20;
  - atualizar o rollback para reconhecer a Etapa 15.

Esta etapa NÃO:
  - migra imports externos do Core para @core;
  - cria @core/*;
  - expõe core/internal ou core/runtime;
  - altera src/core/index.ts;
  - altera fachadas de engine;
  - executa a Etapa 16.
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
        "Execute a Etapa 15 exatamente na raiz do Projeto1.",
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
        "A Etapa 15 usa o TypeScript Compiler API para validar tsconfig e vite.config.ts.",
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

function detectNewline(
  text,
) {
  if (
    text.includes(
      "\r\n",
    )
  ) {
    return "\r\n";
  }

  return "\n";
}

function replaceExactlyOnce(
  source,
  needle,
  replacement,
  label,
) {
  const first =
    source.indexOf(
      needle,
    );

  if (
    first <
    0
  ) {
    fail(
      `Âncora ausente em ${label}.`,
    );
  }

  const second =
    source.indexOf(
      needle,
      first +
      needle.length,
    );

  if (
    second >=
    0
  ) {
    fail(
      `Âncora duplicada em ${label}.`,
    );
  }

  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function parseTsconfigObject(
  ts,
  rootDir,
  text,
) {
  const parsed =
    ts.parseConfigFileTextToJson(
      fromPosixRelative(
        rootDir,
        TSCONFIG_PATH,
      ),
      text,
    );

  if (
    parsed.error
  ) {
    fail(
      `tsconfig.json inválido: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n")}`,
    );
  }

  if (
    parsed.config ===
      null ||
    typeof parsed.config !==
      "object"
  ) {
    fail(
      "tsconfig.json não produziu objeto de configuração.",
    );
  }

  return parsed.config;
}

function validateTsconfigBefore(
  ts,
  rootDir,
  text,
) {
  const config =
    parseTsconfigObject(
      ts,
      rootDir,
      text,
    );

  const compilerOptions =
    config.compilerOptions;

  if (
    compilerOptions ===
      null ||
    typeof compilerOptions !==
      "object"
  ) {
    fail(
      "tsconfig.json não possui compilerOptions.",
    );
  }

  const paths =
    compilerOptions.paths;

  if (
    paths !==
      undefined &&
    Object.prototype.hasOwnProperty.call(
      paths,
      CORE_ALIAS,
    )
  ) {
    fail(
      "tsconfig.json já possui paths[\"@core\"] sem journal da Etapa 15.",
    );
  }

  if (
    paths !==
      undefined &&
    Object.prototype.hasOwnProperty.call(
      paths,
      `${CORE_ALIAS}/*`,
    )
  ) {
    fail(
      "tsconfig.json possui @core/*, o que violaria a fachada única do Core.",
    );
  }
}

function transformTsconfig(
  ts,
  rootDir,
  before,
) {
  validateTsconfigBefore(
    ts,
    rootDir,
    before,
  );

  const newline =
    detectNewline(
      before,
    );

  const anchor =
    `    "noEmit": true,${newline}`;

  const replacement =
    [
      '    "noEmit": true,',
      '    "paths": {',
      '      "@core": ["./src/core/index.ts"]',
      "    },",
      "",
    ].join(
      newline,
    );

  const after =
    replaceExactlyOnce(
      before,
      anchor,
      replacement,
      TSCONFIG_PATH,
    );

  validateTsconfigAfter(
    ts,
    rootDir,
    after,
  );

  return after;
}

function validateTsconfigAfter(
  ts,
  rootDir,
  text,
) {
  const config =
    parseTsconfigObject(
      ts,
      rootDir,
      text,
    );

  const compilerOptions =
    config.compilerOptions;

  const paths =
    compilerOptions?.paths;

  if (
    paths ===
      null ||
    typeof paths !==
      "object"
  ) {
    fail(
      "tsconfig.json pós-Etapa 15 não possui compilerOptions.paths.",
    );
  }

  const corePath =
    paths[
      CORE_ALIAS
    ];

  if (
    !Array.isArray(
      corePath,
    ) ||
    corePath.length !==
      1 ||
    corePath[0] !==
      "./src/core/index.ts"
  ) {
    fail(
      "tsconfig.json não mapeia @core exatamente para ./src/core/index.ts.",
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      paths,
      `${CORE_ALIAS}/*`,
    )
  ) {
    fail(
      "tsconfig.json não pode definir @core/*.",
    );
  }

  const parsedConfig =
    ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      rootDir,
      undefined,
      fromPosixRelative(
        rootDir,
        TSCONFIG_PATH,
      ),
    );

  if (
    parsedConfig.errors.length >
    0
  ) {
    fail(
      `tsconfig.json pós-Etapa 15 contém erros: ${parsedConfig.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join(" | ")}`,
    );
  }

  const containingFile =
    fromPosixRelative(
      rootDir,
      "src/app/bootstrap.ts",
    );

  const resolution =
    ts.resolveModuleName(
      CORE_ALIAS,
      containingFile,
      parsedConfig.options,
      ts.sys,
    ).resolvedModule;

  const expectedCoreEntry =
    normalizeAbsolute(
      fromPosixRelative(
        rootDir,
        CORE_ENTRY,
      ),
    );

  if (
    resolution ===
      undefined ||
    normalizeAbsolute(
      resolution.resolvedFileName,
    ) !==
      expectedCoreEntry
  ) {
    fail(
      [
        "O resolver TypeScript não resolveu @core para src/core/index.ts.",
        `Resolvido: ${String(resolution?.resolvedFileName)}`,
        `Esperado: ${fromPosixRelative(rootDir, CORE_ENTRY)}`,
      ].join(
        "\n",
      ),
    );
  }
}

function parseTypeScriptSource(
  ts,
  relativePath,
  text,
) {
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
      [
        `Erro de parsing em ${relativePath}:`,
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

function getPropertyNameText(
  ts,
  name,
) {
  if (
    ts.isIdentifier(
      name,
    ) ||
    ts.isStringLiteral(
      name,
    )
  ) {
    return name.text;
  }

  return null;
}

function findDefineConfigObject(
  ts,
  sourceFile,
) {
  for (
    const statement of
      sourceFile.statements
  ) {
    if (
      !ts.isExportAssignment(
        statement,
      )
    ) {
      continue;
    }

    const expression =
      statement.expression;

    if (
      !ts.isCallExpression(
        expression,
      ) ||
      !ts.isIdentifier(
        expression.expression,
      ) ||
      expression.expression.text !==
        "defineConfig" ||
      expression.arguments.length !==
        1
    ) {
      continue;
    }

    const factory =
      expression.arguments[0];

    if (
      !ts.isArrowFunction(
        factory,
      ) &&
      !ts.isFunctionExpression(
        factory,
      )
    ) {
      continue;
    }

    if (
      ts.isParenthesizedExpression(
        factory.body,
      ) &&
      ts.isObjectLiteralExpression(
        factory.body.expression,
      )
    ) {
      return factory.body.expression;
    }

    if (
      ts.isObjectLiteralExpression(
        factory.body,
      )
    ) {
      return factory.body;
    }
  }

  fail(
    "vite.config.ts não possui export default defineConfig(() => ({ ... })) reconhecível.",
  );
}

function validateViteBefore(
  ts,
  text,
) {
  const sourceFile =
    parseTypeScriptSource(
      ts,
      VITE_CONFIG_PATH,
      text,
    );

  const configObject =
    findDefineConfigObject(
      ts,
      sourceFile,
    );

  const resolveProperty =
    configObject.properties.find(
      (property) =>
        ts.isPropertyAssignment(
          property,
        ) &&
        getPropertyNameText(
          ts,
          property.name,
        ) ===
          "resolve",
    );

  if (
    resolveProperty !==
      undefined
  ) {
    fail(
      "vite.config.ts já possui resolve; a Etapa 15 não sobrescreve configuração existente sem journal.",
    );
  }

  if (
    text.includes(
      CORE_ALIAS,
    )
  ) {
    fail(
      "vite.config.ts já contém referência a @core sem journal da Etapa 15.",
    );
  }
}

function transformViteConfig(
  ts,
  before,
) {
  validateViteBefore(
    ts,
    before,
  );

  const newline =
    detectNewline(
      before,
    );

  let after =
    before;

  const processImportAnchor =
    [
      '// @ts-expect-error type error without @types/node package',
      'import process from "node:process";',
    ].join(
      newline,
    );

  const processImportReplacement =
    [
      '// @ts-expect-error type error without @types/node package',
      'import { fileURLToPath } from "node:url";',
      '// @ts-expect-error type error without @types/node package',
      'import process from "node:process";',
    ].join(
      newline,
    );

  after =
    replaceExactlyOnce(
      after,
      processImportAnchor,
      processImportReplacement,
      VITE_CONFIG_PATH,
    );

  const hostAnchor =
    `const host = process.env.TAURI_DEV_HOST;${newline}`;

  const hostReplacement =
    [
      "const host = process.env.TAURI_DEV_HOST;",
      'const coreEntry = fileURLToPath(new URL("./src/core/index.ts", import.meta.url));',
      "",
    ].join(
      newline,
    );

  after =
    replaceExactlyOnce(
      after,
      hostAnchor,
      hostReplacement,
      VITE_CONFIG_PATH,
    );

  const defineConfigAnchor =
    `export default defineConfig(() => ({${newline}${newline}`;

  const resolveBlock =
    [
      "export default defineConfig(() => ({",
      "",
      "  resolve: {",
      "    alias: [",
      "      {",
      "        find: /^@core$/,",
      "        replacement: coreEntry,",
      "      },",
      "    ],",
      "  },",
      "",
    ].join(
      newline,
    );

  after =
    replaceExactlyOnce(
      after,
      defineConfigAnchor,
      resolveBlock,
      VITE_CONFIG_PATH,
    );

  validateViteAfter(
    ts,
    after,
  );

  return after;
}

function validateViteAfter(
  ts,
  text,
) {
  const sourceFile =
    parseTypeScriptSource(
      ts,
      VITE_CONFIG_PATH,
      text,
    );

  let hasFileUrlImport =
    false;

  let hasCoreEntry =
    false;

  for (
    const statement of
      sourceFile.statements
  ) {
    if (
      ts.isImportDeclaration(
        statement,
      ) &&
      ts.isStringLiteral(
        statement.moduleSpecifier,
      ) &&
      statement.moduleSpecifier.text ===
        "node:url"
    ) {
      const elements =
        statement.importClause
          ?.namedBindings &&
        ts.isNamedImports(
          statement.importClause.namedBindings,
        )
          ? statement.importClause.namedBindings.elements
          : [];

      hasFileUrlImport =
        elements.some(
          (element) =>
            element.name.text ===
            "fileURLToPath",
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
          ) &&
          declaration.name.text ===
            "coreEntry"
        ) {
          hasCoreEntry =
            declaration.initializer !==
              undefined &&
            declaration.initializer.getText(
              sourceFile,
            ) ===
              'fileURLToPath(new URL("./src/core/index.ts", import.meta.url))';
        }
      }
    }
  }

  if (
    !hasFileUrlImport ||
    !hasCoreEntry
  ) {
    fail(
      "vite.config.ts não materializou coreEntry via fileURLToPath(new URL(...)).",
    );
  }

  const configObject =
    findDefineConfigObject(
      ts,
      sourceFile,
    );

  const resolveProperty =
    configObject.properties.find(
      (property) =>
        ts.isPropertyAssignment(
          property,
        ) &&
        getPropertyNameText(
          ts,
          property.name,
        ) ===
          "resolve",
    );

  if (
    resolveProperty ===
      undefined ||
    !ts.isObjectLiteralExpression(
      resolveProperty.initializer,
    )
  ) {
    fail(
      "vite.config.ts não possui resolve object.",
    );
  }

  const aliasProperty =
    resolveProperty.initializer.properties.find(
      (property) =>
        ts.isPropertyAssignment(
          property,
        ) &&
        getPropertyNameText(
          ts,
          property.name,
        ) ===
          "alias",
    );

  if (
    aliasProperty ===
      undefined ||
    !ts.isArrayLiteralExpression(
      aliasProperty.initializer,
    ) ||
    aliasProperty.initializer.elements.length !==
      1
  ) {
    fail(
      "vite.config.ts deve possuir exatamente um alias configurado nesta etapa.",
    );
  }

  const aliasEntry =
    aliasProperty.initializer.elements[0];

  if (
    !ts.isObjectLiteralExpression(
      aliasEntry,
    )
  ) {
    fail(
      "Entrada de alias do Vite não é objeto.",
    );
  }

  const findProperty =
    aliasEntry.properties.find(
      (property) =>
        ts.isPropertyAssignment(
          property,
        ) &&
        getPropertyNameText(
          ts,
          property.name,
        ) ===
          "find",
    );

  const replacementProperty =
    aliasEntry.properties.find(
      (property) =>
        ts.isPropertyAssignment(
          property,
        ) &&
        getPropertyNameText(
          ts,
          property.name,
        ) ===
          "replacement",
    );

  if (
    findProperty ===
      undefined ||
    !ts.isRegularExpressionLiteral(
      findProperty.initializer,
    ) ||
    findProperty.initializer.text !==
      "/^@core$/"
  ) {
    fail(
      "Alias do Vite deve usar find: /^@core$/ para impedir subpaths @core/*.",
    );
  }

  if (
    replacementProperty ===
      undefined ||
    !ts.isIdentifier(
      replacementProperty.initializer,
    ) ||
    replacementProperty.initializer.text !==
      "coreEntry"
  ) {
    fail(
      "Alias do Vite deve usar replacement: coreEntry.",
    );
  }
}

function identityV2(
  operation,
) {
  if (
    operation.transformation ===
    STAGE10_MOVE_TRANSFORMATION
  ) {
    return {
      sequence:
        operation.sequence,
      sourceStage:
        operation.sourceStage ??
        10,
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

function validateGlobalV4(
  journal,
) {
  if (
    journal.schemaVersion !==
      EXPECTED_PRE_STAGE15_SCHEMA_VERSION ||
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
      EXPECTED_PRE_STAGE15_OPERATION_COUNT ||
    journal.counts?.totalOperations !==
      EXPECTED_PRE_STAGE15_OPERATION_COUNT ||
    journal.counts?.applied !==
      EXPECTED_PRE_STAGE15_OPERATION_COUNT ||
    journal.counts?.rolledBack !==
      0 ||
    journal.counts?.stage10MoveOperations !==
      EXPECTED_STAGE10_MOVE_COUNT ||
    journal.counts?.stage12Extractions !==
      EXPECTED_STAGE12_EXTRACTION_COUNT ||
    journal.counts?.stage13RewriteFiles !==
      EXPECTED_STAGE13_REWRITE_COUNT ||
    journal.counts?.stage14PublicFacades !==
      EXPECTED_STAGE14_FACADE_COUNT ||
    journal.counts?.stage14ExportStatements !==
      EXPECTED_STAGE14_EXPORT_STATEMENT_COUNT
  ) {
    fail(
      "Journal global não está no estado exato pré-Etapa 15 (schema v4 / 245 operações).",
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
      "operationsIdentitySha256 do journal global v4 divergiu.",
    );
  }
}

function validateStage14(
  rootDir,
) {
  const journal =
    readJson(
      fromPosixRelative(
        rootDir,
        STAGE14_JOURNAL_PATH,
      ),
      STAGE14_JOURNAL_PATH,
    );

  if (
    journal.stage !==
      "stage-14-generate-public-facades" ||
    journal.status !==
      "completed" ||
    !Array.isArray(
      journal.operations,
    ) ||
    journal.operations.length !==
      EXPECTED_STAGE14_FACADE_COUNT ||
    journal.counts?.totalFacades !==
      EXPECTED_STAGE14_FACADE_COUNT ||
    journal.counts?.applied !==
      EXPECTED_STAGE14_FACADE_COUNT ||
    journal.counts?.exportStatements !==
      EXPECTED_STAGE14_EXPORT_STATEMENT_COUNT ||
    journal.counts?.internalReexports !==
      0 ||
    journal.counts?.forbiddenConcreteExports !==
      0
  ) {
    fail(
      "Journal da Etapa 14 não está completed com 23 fachadas válidas.",
    );
  }

  for (
    const operation of
      journal.operations
  ) {
    const info =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.filePath,
        ),
      );

    if (
      info.kind !==
        "file" ||
      info.sha256 !==
        operation.fileShaAfter ||
      info.bytes !==
        operation.fileBytesAfter
    ) {
      fail(
        `Fachada da Etapa 14 divergiu: ${operation.filePath}`,
      );
    }
  }
}

function validateCoreEntry(
  rootDir,
) {
  const info =
    inspectRegularFile(
      fromPosixRelative(
        rootDir,
        CORE_ENTRY,
      ),
    );

  if (
    info.kind !==
      "file"
  ) {
    fail(
      `Fachada pública do Core ausente: ${CORE_ENTRY}`,
    );
  }
}

function countCoreAliasImports(
  ts,
  rootDir,
) {
  let count =
    0;

  const stack =
    [
      fromPosixRelative(
        rootDir,
        "src",
      ),
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

    for (
      const entry of
        entries
    ) {
      const absolute =
        path.join(
          current,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        stack.push(
          absolute,
        );
        continue;
      }

      if (
        !entry.isFile() ||
        !/\.[cm]?tsx?$/u.test(
          entry.name,
        )
      ) {
        continue;
      }

      const relativePath =
        toPosixRelative(
          rootDir,
          absolute,
        );

      const source =
        fs.readFileSync(
          absolute,
          "utf8",
        );

      const sourceFile =
        parseTypeScriptSource(
          ts,
          relativePath,
          source,
        );

      const visit =
        (
          node,
        ) => {
          if (
            (
              ts.isImportDeclaration(
                node,
              ) ||
              ts.isExportDeclaration(
                node,
              )
            ) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(
              node.moduleSpecifier,
            ) &&
            node.moduleSpecifier.text ===
              CORE_ALIAS
          ) {
            count +=
              1;
          }

          if (
            ts.isCallExpression(
              node,
            ) &&
            node.expression.kind ===
              ts.SyntaxKind.ImportKeyword &&
            node.arguments.length ===
              1 &&
            ts.isStringLiteral(
              node.arguments[0],
            ) &&
            node.arguments[0].text ===
              CORE_ALIAS
          ) {
            count +=
              1;
          }

          ts.forEachChild(
            node,
            visit,
          );
        };

      visit(
        sourceFile,
      );
    }
  }

  return count;
}

function backupPathsFor(
  filePath,
) {
  return {
    before:
      `${STAGE15_BACKUP_ROOT}/before/${filePath}`,
    after:
      `${STAGE15_BACKUP_ROOT}/after/${filePath}`,
  };
}

function buildOperation(
  filePath,
  configKind,
  beforeBuffer,
  afterBuffer,
  sequence,
  timestampUtc,
) {
  const backupPaths =
    backupPathsFor(
      filePath,
    );

  const beforeSha =
    sha256Buffer(
      beforeBuffer,
    );

  const afterSha =
    sha256Buffer(
      afterBuffer,
    );

  return {
    sequence,
    sourceStage: 15,
    moduleKey: null,
    capabilityId: null,
    isWorker: false,
    oldPath:
      filePath,
    newPath:
      filePath,
    bytes:
      afterBuffer.length,
    shaBefore:
      beforeSha,
    shaAfter:
      afterSha,
    timestampUtc,
    transformation:
      STAGE15_ALIAS_TRANSFORMATION,
    state:
      "applied",
    rollbackTimestampUtc:
      null,
    filePath,
    configKind,
    aliasSpecifier:
      CORE_ALIAS,
    aliasTarget:
      CORE_ENTRY,
    fileBytesBefore:
      beforeBuffer.length,
    fileBytesAfter:
      afterBuffer.length,
    fileShaBefore:
      beforeSha,
    fileShaAfter:
      afterSha,
    backupBeforePath:
      backupPaths.before,
    backupBeforeSha256:
      beforeSha,
    backupAfterPath:
      backupPaths.after,
    backupAfterSha256:
      afterSha,
  };
}

function validateOperationBackups(
  rootDir,
  operation,
) {
  for (
    const [
      relativePath,
      expectedSha,
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
        `Backup inválido da Etapa 15: ${relativePath}`,
      );
    }
  }
}

function buildStage15Journal(
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
      totalConfigs:
        EXPECTED_STAGE15_CONFIG_COUNT,
      applied:
        EXPECTED_STAGE15_CONFIG_COUNT,
      rolledBack:
        0,
      conflicts:
        0,
      tsconfigPathsAliases:
        1,
      viteResolveAliases:
        1,
      sourceImportsRewritten:
        0,
      wildcardAliases:
        0,
    },
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV5(
              operation,
            ),
        ),
      ),
    operations,
    notes: [
      "Etapa 15 instala somente o alias exato @core.",
      "TypeScript resolve @core para src/core/index.ts.",
      "Vite usa /^@core$/ para impedir @core/*.",
      "Nenhum import de consumidor é migrado nesta etapa; isso pertence à Etapa 16.",
    ],
  };
}

function upgradeGlobalJournal(
  journalV4,
  stage15Journal,
) {
  const operations =
    [
      ...journalV4.operations,
      ...stage15Journal.operations,
    ];

  const sourceJournals =
    Array.isArray(
      journalV4.sourceJournals,
    )
      ? [
          ...journalV4.sourceJournals,
        ]
      : [];

  sourceJournals.push(
    {
      stage:
        STAGE_NAME,
      path:
        STAGE15_JOURNAL_PATH,
      statusAtConsolidation:
        "completed",
    },
  );

  const now =
    new Date().toISOString();

  return {
    ...journalV4,
    schemaVersion:
      EXPECTED_POST_STAGE15_SCHEMA_VERSION,
    journalRevision: 5,
    status:
      "migrated",
    updatedAtUtc:
      now,
    sourceJournals,
    counts: {
      ...journalV4.counts,
      totalOperations:
        operations.length,
      applied:
        operations.length,
      rolledBack:
        0,
      conflicts:
        0,
      stage15ConfigFiles:
        EXPECTED_STAGE15_CONFIG_COUNT,
      stage15TsconfigAliases:
        1,
      stage15ViteAliases:
        1,
      stage15SourceImportsRewritten:
        0,
      stage15WildcardAliases:
        0,
    },
    operationsIdentityAlgorithm:
      "semantic-sha256-v5",
    operationsIdentitySha256:
      semanticSha256(
        operations.map(
          (operation) =>
            identityV5(
              operation,
            ),
        ),
      ),
    operations,
  };
}

function validateExistingStage15(
  ts,
  rootDir,
  stage15Journal,
  globalJournal,
) {
  if (
    stage15Journal.schemaVersion !==
      1 ||
    stage15Journal.stage !==
      STAGE_NAME ||
    stage15Journal.status !==
      "completed" ||
    !Array.isArray(
      stage15Journal.operations,
    ) ||
    stage15Journal.operations.length !==
      EXPECTED_STAGE15_CONFIG_COUNT ||
    stage15Journal.counts?.sourceImportsRewritten !==
      0 ||
    stage15Journal.counts?.wildcardAliases !==
      0
  ) {
    fail(
      "Journal existente da Etapa 15 é incompatível.",
    );
  }

  const stageDigest =
    semanticSha256(
      stage15Journal.operations.map(
        (operation) =>
          identityV5(
            operation,
          ),
      ),
    );

  if (
    stageDigest !==
    stage15Journal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 do journal da Etapa 15 divergiu.",
    );
  }

  for (
    const operation of
      stage15Journal.operations
  ) {
    const info =
      inspectRegularFile(
        fromPosixRelative(
          rootDir,
          operation.filePath,
        ),
      );

    if (
      info.kind !==
        "file" ||
      info.bytes !==
        operation.fileBytesAfter ||
      info.sha256 !==
        operation.fileShaAfter
    ) {
      fail(
        `Config da Etapa 15 divergiu: ${operation.filePath}`,
      );
    }

    validateOperationBackups(
      rootDir,
      operation,
    );
  }

  if (
    globalJournal.schemaVersion !==
      EXPECTED_POST_STAGE15_SCHEMA_VERSION ||
    globalJournal.status !==
      "migrated" ||
    !Array.isArray(
      globalJournal.operations,
    ) ||
    globalJournal.operations.length !==
      EXPECTED_PRE_STAGE15_OPERATION_COUNT +
      EXPECTED_STAGE15_CONFIG_COUNT ||
    globalJournal.counts?.stage15ConfigFiles !==
      EXPECTED_STAGE15_CONFIG_COUNT ||
    globalJournal.counts?.stage15SourceImportsRewritten !==
      0 ||
    globalJournal.counts?.stage15WildcardAliases !==
      0
  ) {
    fail(
      "Journal global não está consolidado com a Etapa 15.",
    );
  }

  const globalDigest =
    semanticSha256(
      globalJournal.operations.map(
        (operation) =>
          identityV5(
            operation,
          ),
      ),
    );

  if (
    globalDigest !==
    globalJournal.operationsIdentitySha256
  ) {
    fail(
      "operationsIdentitySha256 global v5 divergiu.",
    );
  }

  validateTsconfigAfter(
    ts,
    rootDir,
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        TSCONFIG_PATH,
      ),
      "utf8",
    ),
  );

  validateViteAfter(
    ts,
    fs.readFileSync(
      fromPosixRelative(
        rootDir,
        VITE_CONFIG_PATH,
      ),
      "utf8",
    ),
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

function protectedProjectSnapshot(
  rootDir,
) {
  const mutablePaths =
    new Set(
      [
        TSCONFIG_PATH,
        VITE_CONFIG_PATH,
      ],
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
        mutablePaths.has(
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

function rollbackOwnWrites(
  rootDir,
  originalFiles,
  originalGlobalJournal,
) {
  const errors =
    [];

  for (
    const [
      relativePath,
      buffer,
    ] of
      originalFiles
  ) {
    try {
      writeFileAtomic(
        fromPosixRelative(
          rootDir,
          relativePath,
        ),
        buffer,
      );
    } catch (
      error
    ) {
      errors.push(
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
        ".migration/stage15",
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
      `.migration/stage15: ${
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

function runStage15() {
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
      EXPECTED_ARCHITECTURE_VERSION ||
    CANONICAL_MODULES.length !==
      EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      "module-map não corresponde à arquitetura v20 com 23 módulos canônicos.",
    );
  }

  validateCoreEntry(
    rootDir,
  );

  validateStage14(
    rootDir,
  );

  const ts =
    loadTypeScript();

  const stage15JournalAbsolute =
    fromPosixRelative(
      rootDir,
      STAGE15_JOURNAL_PATH,
    );

  const globalJournalAbsolute =
    fromPosixRelative(
      rootDir,
      V20_JOURNAL_PATH,
    );

  const globalJournal =
    readJson(
      globalJournalAbsolute,
      V20_JOURNAL_PATH,
    );

  if (
    fs.existsSync(
      stage15JournalAbsolute,
    )
  ) {
    validateExistingStage15(
      ts,
      rootDir,
      readJson(
        stage15JournalAbsolute,
        STAGE15_JOURNAL_PATH,
      ),
      globalJournal,
    );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 15 JÁ ESTÁ CONCLUÍDA                   ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "[OK] tsconfig.json: @core -> ./src/core/index.ts",
    );
    console.log(
      "[OK] vite.config.ts: /^@core$/ -> coreEntry",
    );
    console.log(
      "[OK] @core/*: não configurado.",
    );
    console.log(
      "[OK] Imports de consumidores reescritos nesta etapa: 0.",
    );
    return;
  }

  validateGlobalV4(
    globalJournal,
  );

  const originalFiles =
    new Map(
      [
        TSCONFIG_PATH,
        VITE_CONFIG_PATH,
      ].map(
        (relativePath) => [
          relativePath,
          fs.readFileSync(
            fromPosixRelative(
              rootDir,
              relativePath,
            ),
          ),
        ],
      ),
    );

  const tsconfigBefore =
    originalFiles
      .get(
        TSCONFIG_PATH,
      )
      .toString(
        "utf8",
      );

  const viteBefore =
    originalFiles
      .get(
        VITE_CONFIG_PATH,
      )
      .toString(
        "utf8",
      );

  const sourceAliasImportsBefore =
    countCoreAliasImports(
      ts,
      rootDir,
    );

  const tsconfigAfter =
    transformTsconfig(
      ts,
      rootDir,
      tsconfigBefore,
    );

  const viteAfter =
    transformViteConfig(
      ts,
      viteBefore,
    );

  const plans =
    [
      {
        filePath:
          TSCONFIG_PATH,
        configKind:
          "typescript-paths",
        beforeBuffer:
          originalFiles.get(
            TSCONFIG_PATH,
          ),
        afterBuffer:
          Buffer.from(
            tsconfigAfter,
            "utf8",
          ),
      },
      {
        filePath:
          VITE_CONFIG_PATH,
        configKind:
          "vite-resolve-alias",
        beforeBuffer:
          originalFiles.get(
            VITE_CONFIG_PATH,
          ),
        afterBuffer:
          Buffer.from(
            viteAfter,
            "utf8",
          ),
      },
    ];

  const protectedBefore =
    protectedProjectSnapshot(
      rootDir,
    );

  const originalGlobalJournal =
    fs.readFileSync(
      globalJournalAbsolute,
    );

  try {
    const timestampUtc =
      new Date().toISOString();

    const operations =
      plans.map(
        (
          plan,
          index,
        ) =>
          buildOperation(
            plan.filePath,
            plan.configKind,
            plan.beforeBuffer,
            plan.afterBuffer,
            EXPECTED_PRE_STAGE15_OPERATION_COUNT +
              index +
              1,
            timestampUtc,
          ),
      );

    console.log(
      "============================================================",
    );
    console.log(
      "  PROJETO1 — ETAPA 15: ALIAS @core                        ",
    );
    console.log(
      "============================================================",
    );
    console.log("");
    console.log(
      `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
    );
    console.log(
      `[OK] Journal global pré-Etapa 15: ${String(EXPECTED_PRE_STAGE15_OPERATION_COUNT)} operações.`,
    );
    console.log(
      "[OK] Fachada pública do Core: src/core/index.ts",
    );
    console.log(
      "[OK] Fachadas de engine Etapa 14: 23/23.",
    );
    console.log("");
    console.log(
      "=== ESCOPO EXATO DA ETAPA 15 ===",
    );
    console.log(
      "Arquivos de configuração a alterar: 2",
    );
    console.log(
      "  [CONFIG] tsconfig.json",
    );
    console.log(
      "  [CONFIG] vite.config.ts",
    );
    console.log(
      'Alias TypeScript: "@core" -> "./src/core/index.ts"',
    );
    console.log(
      'Alias Vite: /^@core$/ -> fileURLToPath(new URL("./src/core/index.ts", import.meta.url))',
    );
    console.log(
      "Alias @core/*: 0",
    );
    console.log(
      "Imports de consumidores a reescrever: 0",
    );
    console.log("");
    console.log(
      "=== APLICAÇÃO TRANSACIONAL ===",
    );

    for (
      const [
        plan,
        operation,
      ] of
        plans.map(
          (
            plan,
            index,
          ) => [
            plan,
            operations[
              index
            ],
          ],
        )
    ) {
      const beforeAbsolute =
        fromPosixRelative(
          rootDir,
          operation.backupBeforePath,
        );

      const afterAbsolute =
        fromPosixRelative(
          rootDir,
          operation.backupAfterPath,
        );

      if (
        fs.existsSync(
          beforeAbsolute,
        ) ||
        fs.existsSync(
          afterAbsolute,
        )
      ) {
        fail(
          `Backup Etapa 15 já existe sem journal: ${operation.filePath}`,
        );
      }

      writeFileAtomic(
        beforeAbsolute,
        plan.beforeBuffer,
      );

      writeFileAtomic(
        afterAbsolute,
        plan.afterBuffer,
      );

      validateOperationBackups(
        rootDir,
        operation,
      );

      writeFileAtomic(
        fromPosixRelative(
          rootDir,
          plan.filePath,
        ),
        plan.afterBuffer,
      );

      const current =
        inspectRegularFile(
          fromPosixRelative(
            rootDir,
            plan.filePath,
          ),
        );

      if (
        current.bytes !==
          operation.fileBytesAfter ||
        current.sha256 !==
          operation.fileShaAfter
      ) {
        fail(
          `Verificação pós-write falhou: ${plan.filePath}`,
        );
      }

      console.log(
        `  [OK] ${plan.filePath}`,
      );
    }

    validateTsconfigAfter(
      ts,
      rootDir,
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          TSCONFIG_PATH,
        ),
        "utf8",
      ),
    );

    validateViteAfter(
      ts,
      fs.readFileSync(
        fromPosixRelative(
          rootDir,
          VITE_CONFIG_PATH,
        ),
        "utf8",
      ),
    );

    const sourceAliasImportsAfter =
      countCoreAliasImports(
        ts,
        rootDir,
      );

    if (
      sourceAliasImportsBefore !==
      sourceAliasImportsAfter
    ) {
      fail(
        `A Etapa 15 alterou o número de imports @core em src: ${String(sourceAliasImportsBefore)} -> ${String(sourceAliasImportsAfter)}.`,
      );
    }

    const stage15Journal =
      buildStage15Journal(
        operations,
      );

    writeJsonAtomic(
      stage15JournalAbsolute,
      stage15Journal,
    );

    const globalV5 =
      upgradeGlobalJournal(
        globalJournal,
        stage15Journal,
      );

    writeJsonAtomic(
      globalJournalAbsolute,
      globalV5,
    );

    validateExistingStage15(
      ts,
      rootDir,
      stage15Journal,
      globalV5,
    );

    const protectedAfter =
      protectedProjectSnapshot(
        rootDir,
      );

    if (
      protectedBefore.digest !==
      protectedAfter.digest
    ) {
      fail(
        [
          "Arquivo fora de tsconfig.json/vite.config.ts foi alterado pela Etapa 15.",
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
      "[OK] tsconfig.json resolve @core -> src/core/index.ts.",
    );
    console.log(
      "[OK] vite.config.ts resolve somente /^@core$/ -> src/core/index.ts.",
    );
    console.log(
      "[OK] @core/* configurado: 0",
    );
    console.log(
      `[OK] Imports @core em src antes/depois: ${String(sourceAliasImportsBefore)}/${String(sourceAliasImportsAfter)}`,
    );
    console.log(
      "[OK] Imports reescritos pela Etapa 15: 0",
    );
    console.log(
      `[OK] Journal: ${STAGE15_JOURNAL_PATH}`,
    );
    console.log(
      `[OK] Journal global v20: ${String(globalV5.operations.length)} operações (245 + 2).`,
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
      "  ETAPA 15 CONCLUÍDA COM SUCESSO                           ",
    );
    console.log(
      "============================================================",
    );
    console.log(
      "O alias exato @core está ativo no TypeScript e no Vite sem migrar imports de consumidores.",
    );
  } catch (
    error
  ) {
    const compensationErrors =
      rollbackOwnWrites(
        rootDir,
        originalFiles,
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
      compensationErrors.length ===
      0
    ) {
      fail(
        [
          originalMessage,
          "[OK] Compensação restaurou tsconfig.json, vite.config.ts e journal global.",
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
    runStage15();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 15 não concluída.",
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
