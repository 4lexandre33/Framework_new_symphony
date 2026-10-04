#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  ARCHITECTURE_MIGRATION_VERSION,
  CANONICAL_MODULES,
} from "./module-map.mjs";

export const STAGE_NAME =
  "stage-18-check-boundaries";

const EXPECTED_ARCHITECTURE_VERSION =
  "v20";

const EXPECTED_CANONICAL_MODULE_COUNT =
  23;

const CODE_EXTENSIONS =
  new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
  ]);

const SCAN_ROOTS =
  Object.freeze([
    "src",
    "tests",
  ]);

const EXCLUDED_DIRECTORY_NAMES =
  new Set([
    ".git",
    ".migration",
    "node_modules",
    "dist",
    "coverage",
    "target",
    ".cache",
    ".turbo",
    ".vite",
  ]);

const TECHNICAL_EXTERNAL_MATCHERS =
  Object.freeze([
    Object.freeze({
      id: "three",
      matches(packageName) {
        return packageName === "three";
      },
    }),
    Object.freeze({
      id: "rapier",
      matches(packageName) {
        return (
          packageName === "@dimforge/rapier3d" ||
          packageName === "@dimforge/rapier3d-compat"
        );
      },
    }),
    Object.freeze({
      id: "tauri",
      matches(packageName) {
        return packageName.startsWith(
          "@tauri-apps/",
        );
      },
    }),
    Object.freeze({
      id: "babylon",
      matches(packageName) {
        return (
          packageName === "babylonjs" ||
          packageName.startsWith(
            "@babylonjs/",
          )
        );
      },
    }),
    Object.freeze({
      id: "steamworks",
      matches(packageName) {
        return (
          packageName === "steamworks" ||
          packageName === "steamworks.js" ||
          packageName.startsWith(
            "@steamworks/",
          )
        );
      },
    }),
  ]);

const RULES =
  Object.freeze({
    ENGINE_INTERNAL_CROSS_MODULE:
      "BND001",
    ENGINE_PUBLIC_IMPORTS_INTERNAL:
      "BND002",
    PLUGIN_CROSS_MODULE_INTERNAL:
      "BND003",
    DOMAIN_IMPORTS_ENGINE:
      "BND004",
    DOMAIN_IMPORTS_UPPER_LAYER:
      "BND005",
    DOMAIN_IMPORTS_TECHNICAL_EXTERNAL:
      "BND006",
    SERVICES_IMPORTS_INTERNAL:
      "BND007",
    SERVICES_IMPORTS_PLUGIN:
      "BND008",
    SERVICES_IMPORTS_TECHNICAL_EXTERNAL:
      "BND009",
    APP_IMPORTS_INTERNAL:
      "BND010",
    APP_FLOWS_IMPORT_PLUGIN:
      "BND011",
    APP_FLOWS_IMPORT_TECHNICAL_EXTERNAL:
      "BND012",
    UNRESOLVED_PROJECT_REFERENCE:
      "BND013",
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

function isInsideRoot(
  rootDir,
  absolutePath,
) {
  const relative =
    path.relative(
      rootDir,
      absolutePath,
    );

  return (
    relative.length === 0 ||
    (
      !relative.startsWith(
        "..",
      ) &&
      !path.isAbsolute(
        relative,
      )
    )
  );
}

function parseArguments(
  argv,
) {
  if (
    argv.length === 0
  ) {
    return {
      help: false,
    };
  }

  if (
    argv.length === 1 &&
    (
      argv[0] === "--help" ||
      argv[0] === "-h"
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
      "  node scripts/architecture/check-boundaries.mjs",
    ].join(
      "\n",
    ),
  );
}

function printHelp() {
  console.log(`
Projeto1 — Etapa 18: fiscalização executável de boundaries

Uso:
  node scripts/architecture/check-boundaries.mjs

O checker é estritamente read-only e valida:
  - engine/X/internal não importa engine/Y/internal;
  - engine/X/public nunca importa internal;
  - plugins/X pode importar engine/X/internal;
  - plugins/X não pode importar engine/Y/internal;
  - domain não depende de engine, camadas superiores ou stack técnica concreta;
  - services usa domain/ports/APIs e não internals/plugins/drivers concretos;
  - app é composition root; app/flows não atravessa internals/plugins/drivers;
  - tests/** pode acessar internal explicitamente.

São analisados import, export ... from, import type expression,
import() literal e require() literal usando TypeScript Compiler API.
`);
}

function assertProjectRoot(
  rootDir,
) {
  const requiredFiles =
    [
      "package.json",
      "tsconfig.json",
      "scripts/architecture/module-map.mjs",
    ];

  const requiredDirectories =
    [
      "src",
      "src/engine",
      "src/plugins",
    ];

  for (
    const relativePath of
      requiredFiles
  ) {
    const absolutePath =
      path.join(
        rootDir,
        ...relativePath.split(
          "/",
        ),
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
      requiredDirectories
  ) {
    const absolutePath =
      path.join(
        rootDir,
        ...relativePath.split(
          "/",
        ),
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

function validateModuleMap() {
  if (
    ARCHITECTURE_MIGRATION_VERSION !==
      EXPECTED_ARCHITECTURE_VERSION
  ) {
    fail(
      `Arquitetura inesperada: ${String(ARCHITECTURE_MIGRATION_VERSION)}. Esperado: ${EXPECTED_ARCHITECTURE_VERSION}.`,
    );
  }

  if (
    !Array.isArray(
      CANONICAL_MODULES,
    ) ||
    CANONICAL_MODULES.length !==
      EXPECTED_CANONICAL_MODULE_COUNT
  ) {
    fail(
      `module-map deveria conter ${String(EXPECTED_CANONICAL_MODULE_COUNT)} módulos canônicos; atual: ${String(CANONICAL_MODULES.length)}.`,
    );
  }

  const seenKeys =
    new Set();

  for (
    const moduleRecord of
      CANONICAL_MODULES
  ) {
    if (
      typeof moduleRecord.key !==
        "string" ||
      moduleRecord.key.length ===
        0 ||
      seenKeys.has(
        moduleRecord.key,
      )
    ) {
      fail(
        `module-map contém key inválida ou duplicada: ${String(moduleRecord.key)}`,
      );
    }

    seenKeys.add(
      moduleRecord.key,
    );

    const expectedRoot =
      `src/engine/${moduleRecord.key}`;

    if (
      moduleRecord.engine?.root !==
        expectedRoot ||
      moduleRecord.engine?.publicRoot !==
        `${expectedRoot}/public` ||
      moduleRecord.engine?.internalRoot !==
        `${expectedRoot}/internal` ||
      moduleRecord.plugin !==
        `src/plugins/${moduleRecord.key}/plugin.ts`
    ) {
      fail(
        `module-map possui paths canônicos inesperados para ${moduleRecord.key}.`,
      );
    }
  }
}

function loadTypeScript(
  rootDir,
) {
  const attempts =
    [
      createRequire(
        import.meta.url,
      ),
      createRequire(
        path.join(
          rootDir,
          "package.json",
        ),
      ),
    ];

  const errors =
    [];

  for (
    const require of
      attempts
  ) {
    try {
      const ts =
        require(
          "typescript",
        );

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
        major < 5
      ) {
        fail(
          `TypeScript 5.x ou superior é necessário. Detectado: ${String(ts.version)}`,
        );
      }

      return ts;
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : String(
              error,
            ),
      );
    }
  }

  fail(
    [
      "Não foi possível carregar o pacote TypeScript.",
      "A Etapa 18 depende do TypeScript Compiler API.",
      ...errors.map(
        (message) =>
          `  - ${message}`,
      ),
    ].join(
      "\n",
    ),
  );
}

function loadCompilerOptions(
  ts,
  rootDir,
) {
  const configPath =
    path.join(
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
      `Falha lendo tsconfig.json: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n")}`,
    );
  }

  const parsed =
    ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      rootDir,
      undefined,
      configPath,
    );

  if (
    parsed.errors.length > 0
  ) {
    fail(
      `tsconfig.json contém erro(s): ${parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join(" | ")}`,
    );
  }

  return parsed.options;
}

function scriptKindForFile(
  ts,
  relativePath,
) {
  const extension =
    path.extname(
      relativePath,
    ).toLowerCase();

  switch (
    extension
  ) {
    case ".tsx":
      return ts.ScriptKind.TSX;

    case ".jsx":
      return ts.ScriptKind.JSX;

    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;

    case ".json":
      return ts.ScriptKind.JSON;

    default:
      return ts.ScriptKind.TS;
  }
}

function collectCodeFiles(
  rootDir,
) {
  const files =
    [];

  for (
    const scanRoot of
      SCAN_ROOTS
  ) {
    const absoluteRoot =
      path.join(
        rootDir,
        scanRoot,
      );

    if (
      !fs.existsSync(
        absoluteRoot,
      )
    ) {
      continue;
    }

    const stack =
      [
        absoluteRoot,
      ];

    while (
      stack.length > 0
    ) {
      const current =
        stack.pop();

      if (
        current === undefined
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
          entries.length - 1;
        index >= 0;
        index -= 1
      ) {
        const entry =
          entries[
            index
          ];

        if (
          entry.isSymbolicLink()
        ) {
          continue;
        }

        if (
          entry.isDirectory()
        ) {
          if (
            EXCLUDED_DIRECTORY_NAMES.has(
              entry.name,
            )
          ) {
            continue;
          }

          stack.push(
            path.join(
              current,
              entry.name,
            ),
          );

          continue;
        }

        if (
          !entry.isFile()
        ) {
          continue;
        }

        const extension =
          path.extname(
            entry.name,
          ).toLowerCase();

        if (
          !CODE_EXTENSIONS.has(
            extension,
          )
        ) {
          continue;
        }

        const absolutePath =
          path.join(
            current,
            entry.name,
          );

        files.push(
          {
            absolutePath,
            relativePath:
              toPosixRelative(
                rootDir,
                absolutePath,
              ),
          },
        );
      }
    }
  }

  files.sort(
    (
      a,
      b,
    ) =>
      a.relativePath.localeCompare(
        b.relativePath,
        "en",
      ),
  );

  return files;
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

function snapshotFiles(
  files,
) {
  const records =
    files.map(
      (file) => {
        const buffer =
          fs.readFileSync(
            file.absolutePath,
          );

        return {
          path:
            file.relativePath,
          bytes:
            buffer.byteLength,
          sha256:
            sha256Buffer(
              buffer,
            ),
        };
      },
    );

  const hash =
    crypto.createHash(
      "sha256",
    );

  for (
    const record of
      records
  ) {
    hash.update(
      `${record.path}\0${String(record.bytes)}\0${record.sha256}\n`,
      "utf8",
    );
  }

  return {
    count:
      records.length,
    digest:
      hash.digest(
        "hex",
      ),
  };
}

function moduleNameFromEnginePath(
  relativePath,
) {
  const match =
    /^src\/engine\/([^/]+)\//u.exec(
      relativePath,
    );

  return match?.[1] ??
    null;
}

function engineSectionFromPath(
  relativePath,
) {
  const match =
    /^src\/engine\/([^/]+)\/(internal|public)(?:\/|$)/u.exec(
      relativePath,
    );

  if (
    !match
  ) {
    return null;
  }

  return {
    moduleKey:
      match[1],
    section:
      match[2],
  };
}

function pluginNameFromPath(
  relativePath,
) {
  const match =
    /^src\/plugins\/([^/]+)(?:\/|$)/u.exec(
      relativePath,
    );

  return match?.[1] ??
    null;
}

function classifyProjectPath(
  relativePath,
) {
  if (
    relativePath.startsWith(
      "tests/",
    )
  ) {
    return {
      area: "tests",
      moduleKey: null,
      engineSection: null,
    };
  }

  const engineSection =
    engineSectionFromPath(
      relativePath,
    );

  if (
    engineSection !== null
  ) {
    return {
      area: "engine",
      moduleKey:
        engineSection.moduleKey,
      engineSection:
        engineSection.section,
    };
  }

  const engineModule =
    moduleNameFromEnginePath(
      relativePath,
    );

  if (
    engineModule !== null
  ) {
    return {
      area: "engine",
      moduleKey:
        engineModule,
      engineSection:
        "root",
    };
  }

  const pluginName =
    pluginNameFromPath(
      relativePath,
    );

  if (
    pluginName !== null
  ) {
    return {
      area: "plugins",
      moduleKey:
        pluginName,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/domain/",
    )
  ) {
    return {
      area: "domain",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/services/",
    )
  ) {
    return {
      area: "services",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/app/flows/",
    )
  ) {
    return {
      area: "app-flows",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/app/",
    )
  ) {
    return {
      area: "app",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/contracts/",
    )
  ) {
    return {
      area: "contracts",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/tokens/",
    )
  ) {
    return {
      area: "tokens",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/core/",
    )
  ) {
    return {
      area: "core",
      moduleKey: null,
      engineSection: null,
    };
  }

  if (
    relativePath.startsWith(
      "src/debug/",
    )
  ) {
    return {
      area: "debug",
      moduleKey: null,
      engineSection: null,
    };
  }

  return {
    area: "other",
    moduleKey: null,
    engineSection: null,
  };
}

function externalPackageName(
  specifier,
) {
  if (
    specifier.startsWith(
      "node:",
    )
  ) {
    return specifier;
  }

  if (
    specifier.startsWith(
      "@",
    )
  ) {
    const parts =
      specifier.split(
        "/",
      );

    return parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : specifier;
  }

  return specifier.split(
    "/",
  )[0];
}

function technicalExternalKind(
  specifier,
) {
  const packageName =
    externalPackageName(
      specifier,
    );

  for (
    const matcher of
      TECHNICAL_EXTERNAL_MATCHERS
  ) {
    if (
      matcher.matches(
        packageName,
      )
    ) {
      return matcher.id;
    }
  }

  return null;
}

function isProjectLikeSpecifier(
  specifier,
) {
  return (
    specifier.startsWith(
      ".",
    ) ||
    specifier === "@core" ||
    specifier.startsWith(
      "src/",
    )
  );
}

function normalizeResolvedProjectPath(
  rootDir,
  resolvedFileName,
) {
  const absolute =
    path.resolve(
      resolvedFileName,
    );

  if (
    !isInsideRoot(
      rootDir,
      absolute,
    )
  ) {
    return null;
  }

  return toPosixRelative(
    rootDir,
    absolute,
  );
}

function resolveSpecifier(
  ts,
  rootDir,
  compilerOptions,
  sourceAbsolutePath,
  specifier,
) {
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
    const projectPath =
      normalizeResolvedProjectPath(
        rootDir,
        resolution.resolvedFileName,
      );

    if (
      projectPath !== null
    ) {
      return {
        resolved: true,
        targetKind: "project",
        targetPath:
          projectPath,
        externalPackage: null,
      };
    }

    return {
      resolved: true,
      targetKind: "external",
      targetPath: null,
      externalPackage:
        externalPackageName(
          specifier,
        ),
    };
  }

  if (
    isProjectLikeSpecifier(
      specifier,
    )
  ) {
    return {
      resolved: false,
      targetKind: "project-unresolved",
      targetPath: null,
      externalPackage: null,
    };
  }

  return {
    resolved: false,
    targetKind: "external",
    targetPath: null,
    externalPackage:
      externalPackageName(
        specifier,
      ),
  };
}

function stringLiteralFromImportType(
  ts,
  node,
) {
  const argument =
    node.argument;

  if (
    ts.isLiteralTypeNode(
      argument,
    ) &&
    ts.isStringLiteralLike(
      argument.literal,
    )
  ) {
    return argument.literal;
  }

  return null;
}

function collectModuleReferences(
  ts,
  sourceFile,
) {
  const references =
    [];

  const pushLiteral =
    (
      kind,
      literal,
      isTypeOnly,
    ) => {
      const position =
        sourceFile.getLineAndCharacterOfPosition(
          literal.getStart(
            sourceFile,
          ),
        );

      references.push(
        {
          kind,
          specifier:
            literal.text,
          isTypeOnly,
          line:
            position.line + 1,
          column:
            position.character + 1,
        },
      );
    };

  const visit =
    (
      node,
    ) => {
      if (
        ts.isImportDeclaration(
          node,
        ) &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        pushLiteral(
          "import",
          node.moduleSpecifier,
          node.importClause?.isTypeOnly ===
            true,
        );
      } else if (
        ts.isExportDeclaration(
          node,
        ) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        pushLiteral(
          "export-from",
          node.moduleSpecifier,
          node.isTypeOnly ===
            true,
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
        pushLiteral(
          "import-equals",
          node.moduleReference.expression,
          node.isTypeOnly ===
            true,
        );
      } else if (
        ts.isImportTypeNode(
          node,
        )
      ) {
        const literal =
          stringLiteralFromImportType(
            ts,
            node,
          );

        if (
          literal !== null
        ) {
          pushLiteral(
            "import-type-expression",
            literal,
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
        pushLiteral(
          "dynamic-import",
          node.arguments[0],
          false,
        );
      } else if (
        ts.isCallExpression(
          node,
        ) &&
        ts.isIdentifier(
          node.expression,
        ) &&
        node.expression.text ===
          "require" &&
        node.arguments.length ===
          1 &&
        ts.isStringLiteralLike(
          node.arguments[0],
        )
      ) {
        pushLiteral(
          "require",
          node.arguments[0],
          false,
        );
      }

      ts.forEachChild(
        node,
        visit,
      );
    };

  visit(
    sourceFile,
  );

  return references;
}

function makeViolation(
  rule,
  reference,
  sourcePath,
  message,
  targetPath = null,
) {
  return {
    rule,
    sourcePath,
    line:
      reference.line,
    column:
      reference.column,
    kind:
      reference.kind,
    specifier:
      reference.specifier,
    targetPath,
    message,
  };
}

function evaluateReference(
  sourceClassification,
  targetClassification,
  resolution,
  reference,
  sourcePath,
) {
  const violations =
    [];

  if (
    sourceClassification.area ===
      "tests"
  ) {
    return violations;
  }

  if (
    resolution.targetKind ===
      "project-unresolved"
  ) {
    violations.push(
      makeViolation(
        RULES.UNRESOLVED_PROJECT_REFERENCE,
        reference,
        sourcePath,
        "Referência local/alias de projeto não pôde ser resolvida; a boundary não pode ser provada.",
      ),
    );

    return violations;
  }

  const technicalExternal =
    resolution.targetKind ===
      "external"
      ? technicalExternalKind(
          reference.specifier,
        )
      : null;

  if (
    sourceClassification.area ===
      "engine" &&
    sourceClassification.engineSection ===
      "internal" &&
    targetClassification?.area ===
      "engine" &&
    targetClassification.engineSection ===
      "internal" &&
    targetClassification.moduleKey !==
      sourceClassification.moduleKey
  ) {
    violations.push(
      makeViolation(
        RULES.ENGINE_INTERNAL_CROSS_MODULE,
        reference,
        sourcePath,
        `engine/${sourceClassification.moduleKey}/internal não pode importar implementação internal de engine/${targetClassification.moduleKey}.`,
        resolution.targetPath,
      ),
    );
  }

  if (
    sourceClassification.area ===
      "engine" &&
    sourceClassification.engineSection ===
      "public" &&
    targetClassification?.area ===
      "engine" &&
    targetClassification.engineSection ===
      "internal"
  ) {
    violations.push(
      makeViolation(
        RULES.ENGINE_PUBLIC_IMPORTS_INTERNAL,
        reference,
        sourcePath,
        "Uma fachada engine/<module>/public nunca pode importar qualquer /internal.",
        resolution.targetPath,
      ),
    );
  }

  if (
    sourceClassification.area ===
      "plugins" &&
    targetClassification?.area ===
      "engine" &&
    targetClassification.engineSection ===
      "internal" &&
    targetClassification.moduleKey !==
      sourceClassification.moduleKey
  ) {
    violations.push(
      makeViolation(
        RULES.PLUGIN_CROSS_MODULE_INTERNAL,
        reference,
        sourcePath,
        `plugins/${sourceClassification.moduleKey} só pode acessar internal do próprio módulo; destino pertence a engine/${targetClassification.moduleKey}.`,
        resolution.targetPath,
      ),
    );
  }

  if (
    sourceClassification.area ===
      "domain"
  ) {
    if (
      targetClassification?.area ===
        "engine"
    ) {
      violations.push(
        makeViolation(
          RULES.DOMAIN_IMPORTS_ENGINE,
          reference,
          sourcePath,
          "src/domain/** é puro e não pode depender de src/engine/**, inclusive fachadas públicas.",
          resolution.targetPath,
        ),
      );
    }

    if (
      targetClassification !== null &&
      [
        "services",
        "app",
        "app-flows",
        "plugins",
      ].includes(
        targetClassification.area,
      )
    ) {
      violations.push(
        makeViolation(
          RULES.DOMAIN_IMPORTS_UPPER_LAYER,
          reference,
          sourcePath,
          `src/domain/** não pode depender da camada ${targetClassification.area}.`,
          resolution.targetPath,
        ),
      );
    }

    if (
      technicalExternal !==
        null
    ) {
      violations.push(
        makeViolation(
          RULES.DOMAIN_IMPORTS_TECHNICAL_EXTERNAL,
          reference,
          sourcePath,
          `src/domain/** não pode importar tecnologia concreta (${technicalExternal}).`,
        ),
      );
    }
  }

  if (
    sourceClassification.area ===
      "services"
  ) {
    if (
      targetClassification?.area ===
        "engine" &&
      targetClassification.engineSection !==
        "public"
    ) {
      violations.push(
        makeViolation(
          RULES.SERVICES_IMPORTS_INTERNAL,
          reference,
          sourcePath,
          "src/services/** deve consumir APIs públicas; implementação concreta da engine é proibida.",
          resolution.targetPath,
        ),
      );
    }

    if (
      targetClassification?.area ===
        "plugins"
    ) {
      violations.push(
        makeViolation(
          RULES.SERVICES_IMPORTS_PLUGIN,
          reference,
          sourcePath,
          "src/services/** não pode depender de bridges concretas de src/plugins/**.",
          resolution.targetPath,
        ),
      );
    }

    if (
      technicalExternal !==
        null
    ) {
      violations.push(
        makeViolation(
          RULES.SERVICES_IMPORTS_TECHNICAL_EXTERNAL,
          reference,
          sourcePath,
          `src/services/** deve usar ports/APIs e não tecnologia concreta (${technicalExternal}).`,
        ),
      );
    }
  }

  if (
    (
      sourceClassification.area ===
        "app" ||
      sourceClassification.area ===
        "app-flows"
    ) &&
    targetClassification?.area ===
      "engine" &&
    targetClassification.engineSection ===
      "internal"
  ) {
    violations.push(
      makeViolation(
        RULES.APP_IMPORTS_INTERNAL,
        reference,
        sourcePath,
        "src/app/** compõe por plugins/APIs públicas e não deve atravessar engine/<module>/internal.",
        resolution.targetPath,
      ),
    );
  }

  if (
    sourceClassification.area ===
      "app-flows"
  ) {
    if (
      targetClassification?.area ===
        "plugins"
    ) {
      violations.push(
        makeViolation(
          RULES.APP_FLOWS_IMPORT_PLUGIN,
          reference,
          sourcePath,
          "src/app/flows/** recebe dependências do composition root e não importa plugin bridge diretamente.",
          resolution.targetPath,
        ),
      );
    }

    if (
      technicalExternal !==
        null
    ) {
      violations.push(
        makeViolation(
          RULES.APP_FLOWS_IMPORT_TECHNICAL_EXTERNAL,
          reference,
          sourcePath,
          `src/app/flows/** não usa tecnologia concreta diretamente (${technicalExternal}).`,
        ),
      );
    }
  }

  return violations;
}

function scanBoundaries(
  ts,
  rootDir,
  compilerOptions,
  files,
) {
  const violations =
    [];

  const counts =
    {
      filesAnalyzed: 0,
      referencesAnalyzed: 0,
      projectReferences: 0,
      externalReferences: 0,
      testsReferences: 0,
      testsInternalReferencesAllowed: 0,
      engineInternalFiles: 0,
      enginePublicFiles: 0,
      pluginFiles: 0,
      domainFiles: 0,
      servicesFiles: 0,
      appFiles: 0,
      appFlowFiles: 0,
    };

  for (
    const file of
      files
  ) {
    const sourceText =
      fs.readFileSync(
        file.absolutePath,
        "utf8",
      );

    const sourceFile =
      ts.createSourceFile(
        file.relativePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForFile(
          ts,
          file.relativePath,
        ),
      );

    if (
      sourceFile.parseDiagnostics.length > 0
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
          `Erro de parsing em ${file.relativePath}:`,
          ...diagnostics,
        ].join(
          "\n",
        ),
      );
    }

    const sourceClassification =
      classifyProjectPath(
        file.relativePath,
      );

    counts.filesAnalyzed +=
      1;

    if (
      sourceClassification.area ===
        "engine" &&
      sourceClassification.engineSection ===
        "internal"
    ) {
      counts.engineInternalFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "engine" &&
      sourceClassification.engineSection ===
        "public"
    ) {
      counts.enginePublicFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "plugins"
    ) {
      counts.pluginFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "domain"
    ) {
      counts.domainFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "services"
    ) {
      counts.servicesFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "app-flows"
    ) {
      counts.appFlowFiles +=
        1;
    } else if (
      sourceClassification.area ===
        "app"
    ) {
      counts.appFiles +=
        1;
    }

    const references =
      collectModuleReferences(
        ts,
        sourceFile,
      );

    for (
      const reference of
        references
    ) {
      counts.referencesAnalyzed +=
        1;

      const resolution =
        resolveSpecifier(
          ts,
          rootDir,
          compilerOptions,
          file.absolutePath,
          reference.specifier,
        );

      if (
        resolution.targetKind ===
          "project"
      ) {
        counts.projectReferences +=
          1;
      } else {
        counts.externalReferences +=
          1;
      }

      let targetClassification =
        null;

      if (
        resolution.targetKind ===
          "project" &&
        resolution.targetPath !==
          null
      ) {
        targetClassification =
          classifyProjectPath(
            resolution.targetPath,
          );
      }

      if (
        sourceClassification.area ===
          "tests"
      ) {
        counts.testsReferences +=
          1;

        if (
          targetClassification?.area ===
            "engine" &&
          targetClassification.engineSection ===
            "internal"
        ) {
          counts.testsInternalReferencesAllowed +=
            1;
        }
      }

      violations.push(
        ...evaluateReference(
          sourceClassification,
          targetClassification,
          resolution,
          reference,
          file.relativePath,
        ),
      );
    }
  }

  violations.sort(
    (
      a,
      b,
    ) =>
      a.sourcePath.localeCompare(
        b.sourcePath,
        "en",
      ) ||
      a.line -
        b.line ||
      a.column -
        b.column ||
      a.rule.localeCompare(
        b.rule,
        "en",
      ),
  );

  return {
    counts,
    violations,
  };
}

function printRuleMatrix() {
  console.log(
    "=== REGRAS EXECUTÁVEIS ===",
  );
  console.log(
    `[${RULES.ENGINE_INTERNAL_CROSS_MODULE}] engine/X/internal -> engine/Y/internal: proibido`,
  );
  console.log(
    `[${RULES.ENGINE_PUBLIC_IMPORTS_INTERNAL}] engine/X/public -> */internal: proibido`,
  );
  console.log(
    `[${RULES.PLUGIN_CROSS_MODULE_INTERNAL}] plugins/X -> engine/Y/internal (X != Y): proibido`,
  );
  console.log(
    "[ALLOW] plugins/X -> engine/X/internal: permitido",
  );
  console.log(
    `[${RULES.DOMAIN_IMPORTS_ENGINE}/${RULES.DOMAIN_IMPORTS_TECHNICAL_EXTERNAL}] domain -> engine/stack técnica concreta: proibido`,
  );
  console.log(
    `[${RULES.SERVICES_IMPORTS_INTERNAL}/${RULES.SERVICES_IMPORTS_PLUGIN}] services -> internals/plugins concretos: proibido`,
  );
  console.log(
    `[${RULES.APP_IMPORTS_INTERNAL}/${RULES.APP_FLOWS_IMPORT_PLUGIN}] app compõe plugins/APIs; app/flows não atravessa internals/plugins`,
  );
  console.log(
    "[ALLOW] tests/** -> internal: permitido explicitamente",
  );
}

function runStage18() {
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

  validateModuleMap();

  const ts =
    loadTypeScript(
      rootDir,
    );

  const compilerOptions =
    loadCompilerOptions(
      ts,
      rootDir,
    );

  const files =
    collectCodeFiles(
      rootDir,
    );

  if (
    files.length === 0
  ) {
    fail(
      "Nenhum arquivo de código foi encontrado em src/ ou tests/.",
    );
  }

  const before =
    snapshotFiles(
      files,
    );

  const result =
    scanBoundaries(
      ts,
      rootDir,
      compilerOptions,
      files,
    );

  const after =
    snapshotFiles(
      files,
    );

  if (
    before.digest !==
      after.digest ||
    before.count !==
      after.count
  ) {
    fail(
      [
        "O checker de boundaries alterou o conjunto de arquivos analisados, o que é proibido.",
        `Antes: ${String(before.count)} / ${before.digest}`,
        `Depois: ${String(after.count)} / ${after.digest}`,
      ].join(
        "\n",
      ),
    );
  }

  console.log(
    "============================================================",
  );
  console.log(
    "  PROJETO1 — ETAPA 18: FISCALIZAÇÃO DE BOUNDARIES         ",
  );
  console.log(
    "============================================================",
  );
  console.log("");
  console.log(
    `[OK] Arquitetura: ${EXPECTED_ARCHITECTURE_VERSION}`,
  );
  console.log(
    `[OK] Módulos canônicos: ${String(CANONICAL_MODULES.length)}`,
  );
  console.log(
    `[OK] TypeScript Compiler API: ${String(ts.version)}`,
  );
  console.log(
    `[OK] Arquivos de código analisados: ${String(result.counts.filesAnalyzed)}`,
  );
  console.log(
    `[OK] Referências de módulo analisadas: ${String(result.counts.referencesAnalyzed)}`,
  );
  console.log(
    `[OK] Referências de projeto: ${String(result.counts.projectReferences)}`,
  );
  console.log(
    `[OK] Referências externas: ${String(result.counts.externalReferences)}`,
  );
  console.log("");

  printRuleMatrix();

  console.log("");
  console.log(
    "=== COBERTURA ===",
  );
  console.log(
    `engine/*/internal: ${String(result.counts.engineInternalFiles)} arquivo(s)`,
  );
  console.log(
    `engine/*/public: ${String(result.counts.enginePublicFiles)} arquivo(s)`,
  );
  console.log(
    `plugins/*: ${String(result.counts.pluginFiles)} arquivo(s)`,
  );
  console.log(
    `domain: ${String(result.counts.domainFiles)} arquivo(s) de código`,
  );
  console.log(
    `services: ${String(result.counts.servicesFiles)} arquivo(s) de código`,
  );
  console.log(
    `app: ${String(result.counts.appFiles)} arquivo(s) de código`,
  );
  console.log(
    `app/flows: ${String(result.counts.appFlowFiles)} arquivo(s) de código`,
  );
  console.log(
    `tests: ${String(result.counts.testsReferences)} referência(s) analisada(s)`,
  );
  console.log(
    `tests -> internal permitidos: ${String(result.counts.testsInternalReferencesAllowed)}`,
  );

  console.log("");
  console.log(
    "=== RESULTADO ===",
  );

  if (
    result.violations.length > 0
  ) {
    console.log(
      `[ERRO] Violações de boundary: ${String(result.violations.length)}`,
    );
    console.log("");

    for (
      const violation of
        result.violations
    ) {
      console.log(
        `[${violation.rule}] ${violation.sourcePath}:${String(violation.line)}:${String(violation.column)}`,
      );
      console.log(
        `  ${violation.kind}: ${violation.specifier}`,
      );

      if (
        violation.targetPath !==
          null
      ) {
        console.log(
          `  destino: ${violation.targetPath}`,
        );
      }

      console.log(
        `  ${violation.message}`,
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
      "  ETAPA 18 — BOUNDARIES REPROVADOS                         ",
    );
    console.log(
      "============================================================",
    );

    process.exitCode =
      1;

    return;
  }

  console.log(
    "[OK] Violações de boundary: 0",
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
    "  ETAPA 18 CONCLUÍDA COM SUCESSO                           ",
  );
  console.log(
    "============================================================",
  );
  console.log(
    "As boundaries arquiteturais mínimas agora são fiscalizadas de forma executável.",
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
    runStage18();
  } catch (
    error
  ) {
    console.error("");
    console.error(
      "[ERRO] Etapa 18 não concluída.",
    );
    console.error(
      error instanceof Error
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
