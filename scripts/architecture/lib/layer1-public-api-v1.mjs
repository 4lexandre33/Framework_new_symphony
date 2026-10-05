import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  compareLayer1BaselineCompatibility,
  loadLayer1Baseline,
  projectLayer1Module,
} from "./layer1-baseline-v1.mjs";

export const LAYER1_PUBLIC_API_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_PUBLIC_API_BASELINE_FILE =
  "LAYER1_PUBLIC_API_BASELINE_V1.json";

function normalizeSlashes(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function violation(
  code,
  scope,
  message,
) {
  return Object.freeze({
    code,
    scope,
    message,
  });
}

function fileExists(
  projectRoot,
  relativePath,
) {
  const target =
    path.join(
      projectRoot,
      ...relativePath.split(
        "/",
      ),
    );

  return (
    fs.existsSync(
      target,
    ) &&
    fs.statSync(
      target,
    ).isFile()
  );
}

function directoryExists(
  projectRoot,
  relativePath,
) {
  const target =
    path.join(
      projectRoot,
      ...relativePath.split(
        "/",
      ),
    );

  return (
    fs.existsSync(
      target,
    ) &&
    fs.statSync(
      target,
    ).isDirectory()
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

export function buildExpectedPublicFacade(
  moduleRecord,
) {
  const filePath =
    `${moduleRecord.engine.publicRoot}/index.ts`;

  const targets = [
    ...moduleRecord.contracts,
    ...moduleRecord.tokens.map(
      (token) =>
        token.path,
    ),
  ];

  const exportSpecifiers =
    targets.map(
      (target) =>
        relativeModuleSpecifier(
          filePath,
          target,
        ),
    );

  return Object.freeze({
    filePath,
    targets:
      Object.freeze(
        targets,
      ),
    exportSpecifiers:
      Object.freeze(
        exportSpecifiers,
      ),
  });
}

function loadTypeScript(
  projectRoot,
) {
  const attempts = [
    createRequire(
      import.meta.url,
    ),
    createRequire(
      path.join(
        projectRoot,
        "package.json",
      ),
    ),
  ];

  const errors = [];

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
        throw new Error(
          `TypeScript >= 5 é necessário; detectado ${String(ts.version)}.`,
        );
      }

      return ts;
    } catch (
      error
    ) {
      errors.push(
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  throw new Error(
    [
      "Não foi possível carregar TypeScript Compiler API.",
      ...errors.map(
        (message) =>
          `- ${message}`,
      ),
    ].join(
      "\n",
    ),
  );
}

export function fingerprintTypeScriptSource(
  ts,
  source,
) {
  const scanner =
    ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      source,
    );

  const parts = [];

  while (true) {
    const token =
      scanner.scan();

    if (
      token ===
      ts.SyntaxKind.EndOfFileToken
    ) {
      break;
    }

    parts.push(
      `${String(token)}:${scanner.getTokenText()}`,
    );
  }

  return crypto
    .createHash(
      "sha256",
    )
    .update(
      parts.join(
        "\n",
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}

function parseSource(
  ts,
  relativePath,
  source,
) {
  const sourceFile =
    ts.createSourceFile(
      relativePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  const diagnostics =
    sourceFile
      .parseDiagnostics ??
    [];

  return {
    sourceFile,
    diagnostics,
  };
}

function diagnosticText(
  ts,
  diagnostic,
) {
  return ts
    .flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
}

function getModuleSpecifiers(
  ts,
  sourceFile,
) {
  const values = [];

  function addLiteral(
    node,
  ) {
    if (
      node !== undefined &&
      ts.isStringLiteralLike(
        node,
      )
    ) {
      values.push(
        node.text,
      );
    }
  }

  function visit(
    node,
  ) {
    if (
      ts.isImportDeclaration(
        node,
      ) ||
      ts.isExportDeclaration(
        node,
      )
    ) {
      addLiteral(
        node.moduleSpecifier,
      );
    } else if (
      ts.isCallExpression(
        node,
      ) &&
      node.expression.kind ===
        ts.SyntaxKind.ImportKeyword
    ) {
      addLiteral(
        node.arguments[0],
      );
    } else if (
      ts.isImportTypeNode(
        node,
      ) &&
      ts.isLiteralTypeNode(
        node.argument,
      )
    ) {
      addLiteral(
        node.argument.literal,
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

  return values;
}

function hasDefaultExport(
  ts,
  sourceFile,
) {
  let found = false;

  function visit(
    node,
  ) {
    if (found) {
      return;
    }

    if (
      ts.isExportAssignment(
        node,
      )
    ) {
      found = true;
      return;
    }

    const modifiers =
      ts.canHaveModifiers(
        node,
      )
        ? ts.getModifiers(
            node,
          )
        : undefined;

    if (
      modifiers?.some(
        (modifier) =>
          modifier.kind ===
          ts.SyntaxKind.DefaultKeyword,
      )
    ) {
      found = true;
      return;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(
    sourceFile,
  );

  return found;
}

function resolveRelativeSourcePath(
  importerRelativePath,
  specifier,
) {
  if (
    !specifier.startsWith(
      ".",
    )
  ) {
    return null;
  }

  const joined =
    path.posix.normalize(
      path.posix.join(
        path.posix.dirname(
          importerRelativePath,
        ),
        specifier,
      ),
    );

  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.mts`,
    `${joined}.cts`,
    `${joined}/index.ts`,
  ];

  return candidates;
}

function sameContractArea(
  contractPath,
  candidatePath,
) {
  const prefix =
    "src/contracts/";

  if (
    !contractPath.startsWith(
      prefix,
    ) ||
    !candidatePath.startsWith(
      prefix,
    )
  ) {
    return false;
  }

  const left =
    contractPath
      .slice(
        prefix.length,
      )
      .split(
        "/",
      )[0];

  const right =
    candidatePath
      .slice(
        prefix.length,
      )
      .split(
        "/",
      )[0];

  return (
    left !== undefined &&
    left === right
  );
}

function inspectContract(
  ts,
  projectRoot,
  contractPath,
) {
  const violations = [];

  if (
    !fileExists(
      projectRoot,
      contractPath,
    )
  ) {
    return Object.freeze({
      fingerprint: null,
      moduleSpecifiers:
        Object.freeze([]),
      violations:
        Object.freeze([
          violation(
            "L1API010",
            contractPath,
            "contract ausente.",
          ),
        ]),
    });
  }

  const source =
    fs.readFileSync(
      path.join(
        projectRoot,
        ...contractPath.split(
          "/",
        ),
      ),
      "utf8",
    );

  const {
    sourceFile,
    diagnostics,
  } =
    parseSource(
      ts,
      contractPath,
      source,
    );

  for (
    const diagnostic of
    diagnostics
  ) {
    violations.push(
      violation(
        "L1API011",
        contractPath,
        `erro de parse: ${diagnosticText(ts, diagnostic)}`,
      ),
    );
  }

  if (
    hasDefaultExport(
      ts,
      sourceFile,
    )
  ) {
    violations.push(
      violation(
        "L1API012",
        contractPath,
        "default export não é permitido em contract público.",
      ),
    );
  }

  const specifiers =
    getModuleSpecifiers(
      ts,
      sourceFile,
    );

  for (
    const specifier of
    specifiers
  ) {
    if (
      specifier ===
      "@core"
    ) {
      continue;
    }

    if (
      !specifier.startsWith(
        ".",
      )
    ) {
      violations.push(
        violation(
          "L1API013",
          contractPath,
          `contract não pode importar pacote externo: ${specifier}.`,
        ),
      );

      continue;
    }

    const candidates =
      resolveRelativeSourcePath(
        contractPath,
        specifier,
      ) ??
      [];

    const resolved =
      candidates.find(
        (candidate) =>
          fileExists(
            projectRoot,
            candidate,
          ),
      );

    if (
      resolved ===
        undefined ||
      !sameContractArea(
        contractPath,
        resolved,
      )
    ) {
      violations.push(
        violation(
          "L1API014",
          contractPath,
          `import relativo escapa da própria área de contract: ${specifier}.`,
        ),
      );
    }
  }

  return Object.freeze({
    fingerprint:
      fingerprintTypeScriptSource(
        ts,
        source,
      ),
    moduleSpecifiers:
      Object.freeze(
        specifiers,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

function inspectToken(
  ts,
  projectRoot,
  moduleRecord,
  tokenRecord,
) {
  const tokenPath =
    tokenRecord.path;

  const violations = [];

  if (
    !fileExists(
      projectRoot,
      tokenPath,
    )
  ) {
    return Object.freeze({
      fingerprint: null,
      defineCapabilityCalls:
        Object.freeze([]),
      moduleSpecifiers:
        Object.freeze([]),
      violations:
        Object.freeze([
          violation(
            "L1API020",
            tokenPath,
            "token file ausente.",
          ),
        ]),
    });
  }

  const source =
    fs.readFileSync(
      path.join(
        projectRoot,
        ...tokenPath.split(
          "/",
        ),
      ),
      "utf8",
    );

  const {
    sourceFile,
    diagnostics,
  } =
    parseSource(
      ts,
      tokenPath,
      source,
    );

  for (
    const diagnostic of
    diagnostics
  ) {
    violations.push(
      violation(
        "L1API021",
        tokenPath,
        `erro de parse: ${diagnosticText(ts, diagnostic)}`,
      ),
    );
  }

  if (
    hasDefaultExport(
      ts,
      sourceFile,
    )
  ) {
    violations.push(
      violation(
        "L1API022",
        tokenPath,
        "default export não é permitido em capability token.",
      ),
    );
  }

  const contractPaths =
    new Set(
      moduleRecord.contracts,
    );

  const specifiers =
    getModuleSpecifiers(
      ts,
      sourceFile,
    );

  for (
    const specifier of
    specifiers
  ) {
    if (
      specifier ===
      "@core"
    ) {
      continue;
    }

    if (
      !specifier.startsWith(
        ".",
      )
    ) {
      // Tokens are part of Layer 1's technical public surface and may expose
      // first-class technical library types (e.g. Three.js).
      continue;
    }

    const candidates =
      resolveRelativeSourcePath(
        tokenPath,
        specifier,
      ) ??
      [];

    const resolved =
      candidates.find(
        (candidate) =>
          fileExists(
            projectRoot,
            candidate,
          ),
      );

    if (
      resolved ===
      undefined ||
      !contractPaths.has(
        resolved,
      )
    ) {
      violations.push(
        violation(
          "L1API023",
          tokenPath,
          `token relativo só pode importar contracts declarados pelo próprio módulo: ${specifier}.`,
        ),
      );
    }
  }

  const calls = [];

  function isExportedVariableStatement(
    node,
  ) {
    let current =
      node;

    while (
      current !== undefined &&
      !ts.isVariableStatement(
        current,
      )
    ) {
      current =
        current.parent;
    }

    if (
      current === undefined
    ) {
      return false;
    }

    const modifiers =
      ts.canHaveModifiers(
        current,
      )
        ? ts.getModifiers(
            current,
          )
        : undefined;

    return (
      modifiers?.some(
        (modifier) =>
          modifier.kind ===
          ts.SyntaxKind.ExportKeyword,
      ) ??
      false
    );
  }

  function visit(
    node,
  ) {
    if (
      ts.isCallExpression(
        node,
      ) &&
      ts.isIdentifier(
        node.expression,
      ) &&
      node.expression.text ===
        "defineCapability"
    ) {
      const idArgument =
        node.arguments[0];

      const versionArgument =
        node.arguments[1];

      calls.push(
        Object.freeze({
          capabilityId:
            idArgument !== undefined &&
            ts.isStringLiteralLike(
              idArgument,
            )
              ? idArgument.text
              : null,
          version:
            versionArgument !== undefined &&
            ts.isStringLiteralLike(
              versionArgument,
            )
              ? versionArgument.text
              : null,
          exported:
            isExportedVariableStatement(
              node,
            ),
        }),
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

  if (
    calls.length !==
    1
  ) {
    violations.push(
      violation(
        "L1API024",
        tokenPath,
        `esperado exatamente 1 defineCapability(); encontrado ${String(calls.length)}.`,
      ),
    );
  } else {
    const call =
      calls[0];

    if (
      call.capabilityId !==
      tokenRecord.capabilityId
    ) {
      violations.push(
        violation(
          "L1API025",
          tokenPath,
          `defineCapability id divergente. Registry=${tokenRecord.capabilityId}; source=${String(call.capabilityId)}.`,
        ),
      );
    }

    if (
      call.version !==
      tokenRecord.version
    ) {
      violations.push(
        violation(
          "L1API026",
          tokenPath,
          `defineCapability version divergente. Registry=${tokenRecord.version}; source=${String(call.version)}.`,
        ),
      );
    }

    if (
      call.exported !==
      true
    ) {
      violations.push(
        violation(
          "L1API027",
          tokenPath,
          "defineCapability precisa estar associado a export const público.",
        ),
      );
    }
  }

  if (
    tokenRecord.primary ===
      true &&
    tokenRecord.capabilityId !==
      moduleRecord.capabilityId
  ) {
    violations.push(
      violation(
        "L1API028",
        tokenPath,
        "primary token capabilityId diverge do capabilityId do módulo.",
      ),
    );
  }

  if (
    tokenRecord.primary ===
      true &&
    tokenRecord.version !==
      moduleRecord.capabilityVersion
  ) {
    violations.push(
      violation(
        "L1API029",
        tokenPath,
        "primary token version diverge da capabilityVersion do módulo.",
      ),
    );
  }

  return Object.freeze({
    fingerprint:
      fingerprintTypeScriptSource(
        ts,
        source,
      ),
    defineCapabilityCalls:
      Object.freeze(
        calls,
      ),
    moduleSpecifiers:
      Object.freeze(
        specifiers,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

function inspectFacade(
  ts,
  projectRoot,
  moduleRecord,
) {
  const expected =
    buildExpectedPublicFacade(
      moduleRecord,
    );

  const violations = [];

  if (
    !directoryExists(
      projectRoot,
      moduleRecord.engine
        .publicRoot,
    )
  ) {
    return Object.freeze({
      fingerprint: null,
      exportSpecifiers:
        Object.freeze([]),
      violations:
        Object.freeze([
          violation(
            "L1API030",
            moduleRecord.key,
            `public root ausente: ${moduleRecord.engine.publicRoot}.`,
          ),
        ]),
    });
  }

  const publicRoot =
    path.join(
      projectRoot,
      ...moduleRecord.engine
        .publicRoot
        .split("/"),
    );

  const publicFiles =
    fs.readdirSync(
      publicRoot,
      {
        withFileTypes: true,
      },
    )
      .filter(
        (entry) =>
          entry.isFile(),
      )
      .map(
        (entry) =>
          entry.name,
      )
      .sort();

  if (
    publicFiles.length !==
      1 ||
    publicFiles[0] !==
      "index.ts"
  ) {
    violations.push(
      violation(
        "L1API031",
        moduleRecord.key,
        `public root deve conter somente index.ts; atual: ${publicFiles.join(", ")}.`,
      ),
    );
  }

  if (
    !fileExists(
      projectRoot,
      expected.filePath,
    )
  ) {
    violations.push(
      violation(
        "L1API032",
        moduleRecord.key,
        `facade ausente: ${expected.filePath}.`,
      ),
    );

    return Object.freeze({
      fingerprint: null,
      exportSpecifiers:
        Object.freeze([]),
      violations:
        Object.freeze(
          violations,
        ),
    });
  }

  const source =
    fs.readFileSync(
      path.join(
        projectRoot,
        ...expected.filePath
          .split("/"),
      ),
      "utf8",
    );

  const {
    sourceFile,
    diagnostics,
  } =
    parseSource(
      ts,
      expected.filePath,
      source,
    );

  for (
    const diagnostic of
    diagnostics
  ) {
    violations.push(
      violation(
        "L1API033",
        moduleRecord.key,
        `facade parse error: ${diagnosticText(ts, diagnostic)}`,
      ),
    );
  }

  const exportSpecifiers = [];

  for (
    const statement of
    sourceFile.statements
  ) {
    if (
      !ts.isExportDeclaration(
        statement,
      ) ||
      statement.exportClause !==
        undefined ||
      statement.moduleSpecifier ===
        undefined ||
      !ts.isStringLiteralLike(
        statement.moduleSpecifier,
      )
    ) {
      violations.push(
        violation(
          "L1API034",
          moduleRecord.key,
          "facade pública deve conter somente export * from declarations.",
        ),
      );

      continue;
    }

    exportSpecifiers.push(
      statement
        .moduleSpecifier
        .text,
    );
  }

  if (
    JSON.stringify(
      exportSpecifiers,
    ) !==
    JSON.stringify(
      expected
        .exportSpecifiers,
    )
  ) {
    violations.push(
      violation(
        "L1API035",
        moduleRecord.key,
        `exports da facade divergentes. Esperado: ${expected.exportSpecifiers.join(", ")}. Atual: ${exportSpecifiers.join(", ")}.`,
      ),
    );
  }

  for (
    const specifier of
    exportSpecifiers
  ) {
    if (
      specifier.includes(
        "/internal/",
      ) ||
      specifier.includes(
        "/plugins/",
      )
    ) {
      violations.push(
        violation(
          "L1API036",
          moduleRecord.key,
          `facade vaza implementação: ${specifier}.`,
        ),
      );
    }
  }

  return Object.freeze({
    fingerprint:
      fingerprintTypeScriptSource(
        ts,
        source,
      ),
    exportSpecifiers:
      Object.freeze(
        exportSpecifiers,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function comparePublicApiBaselineCompatibility(
  baseline,
  currentEntries,
) {
  const violations = [];

  const currentByKey =
    new Map(
      currentEntries.map(
        (entry) => [
          entry.key,
          entry,
        ],
      ),
    );

  const baselineKeys =
    new Set();

  for (
    const expected of
    baseline.modules
  ) {
    baselineKeys.add(
      expected.key,
    );

    const current =
      currentByKey.get(
        expected.key,
      );

    if (
      current ===
      undefined
    ) {
      violations.push(
        violation(
          "L1API040",
          expected.key,
          "public API baseline module ausente.",
        ),
      );

      continue;
    }

    if (
      expected.capabilityId !==
        current.capabilityId ||
      expected.capabilityVersion !==
        current.capabilityVersion
    ) {
      violations.push(
        violation(
          "L1API041",
          expected.key,
          "capability identity/version divergiu da public API baseline.",
        ),
      );
    }

    if (
      expected.facade
        .fingerprint !==
      current.facade
        .fingerprint
    ) {
      violations.push(
        violation(
          "L1API042",
          expected.key,
          "facade pública mudou semanticamente; requer revisão/recertificação.",
        ),
      );
    }

    const currentContracts =
      new Map(
        current.contracts.map(
          (entry) => [
            entry.path,
            entry,
          ],
        ),
      );

    for (
      const expectedContract of
      expected.contracts
    ) {
      const currentContract =
        currentContracts.get(
          expectedContract.path,
        );

      if (
        currentContract ===
        undefined
      ) {
        violations.push(
          violation(
            "L1API043",
            expected.key,
            `contract da baseline desapareceu: ${expectedContract.path}.`,
          ),
        );
      } else if (
        currentContract
          .fingerprint !==
        expectedContract
          .fingerprint
      ) {
        violations.push(
          violation(
            "L1API044",
            expected.key,
            `contract público mudou semanticamente: ${expectedContract.path}.`,
          ),
        );
      }
    }

    const currentTokens =
      new Map(
        current.tokens.map(
          (entry) => [
            entry.path,
            entry,
          ],
        ),
      );

    for (
      const expectedToken of
      expected.tokens
    ) {
      const currentToken =
        currentTokens.get(
          expectedToken.path,
        );

      if (
        currentToken ===
        undefined
      ) {
        violations.push(
          violation(
            "L1API045",
            expected.key,
            `token da baseline desapareceu: ${expectedToken.path}.`,
          ),
        );
      } else if (
        currentToken
          .fingerprint !==
        expectedToken
          .fingerprint
      ) {
        violations.push(
          violation(
            "L1API046",
            expected.key,
            `token público mudou semanticamente: ${expectedToken.path}.`,
          ),
        );
      }
    }
  }

  const additionalModuleKeys =
    currentEntries
      .filter(
        (entry) =>
          !baselineKeys.has(
            entry.key,
          ),
      )
      .map(
        (entry) =>
          entry.key,
      )
      .sort();

  return Object.freeze({
    ok:
      violations.length ===
      0,
    additionalModuleKeys:
      Object.freeze(
        additionalModuleKeys,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function loadLayer1PublicApiBaseline(
  projectRoot =
    process.cwd(),
) {
  const target =
    path.join(
      path.resolve(
        projectRoot,
      ),
      LAYER1_PUBLIC_API_BASELINE_FILE,
    );

  if (
    !fs.existsSync(
      target,
    ) ||
    !fs.statSync(
      target,
    ).isFile()
  ) {
    throw new Error(
      `Public API baseline ausente: ${LAYER1_PUBLIC_API_BASELINE_FILE}`,
    );
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        target,
        "utf8",
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-public-api-v1-stage72" ||
    !Array.isArray(
      parsed.modules,
    )
  ) {
    throw new Error(
      "LAYER1_PUBLIC_API_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

async function loadModuleMap(
  projectRoot,
) {
  const target =
    path.join(
      projectRoot,
      "scripts",
      "architecture",
      "module-map.mjs",
    );

  return import(
    pathToFileURL(
      target,
    ).href
  );
}

async function collectCurrentPublicApi({
  projectRoot,
  moduleMap,
  ts,
}) {
  const entries = [];
  const violations = [];

  for (
    const rawModule of
    moduleMap
      .CANONICAL_MODULES
  ) {
    const moduleRecord =
      projectLayer1Module(
        rawModule,
      );

    const facade =
      inspectFacade(
        ts,
        projectRoot,
        moduleRecord,
      );

    violations.push(
      ...facade
        .violations,
    );

    const contracts = [];

    for (
      const contractPath of
      moduleRecord.contracts
    ) {
      const inspection =
        inspectContract(
          ts,
          projectRoot,
          contractPath,
        );

      violations.push(
        ...inspection
          .violations,
      );

      contracts.push(
        Object.freeze({
          path:
            contractPath,
          fingerprint:
            inspection
              .fingerprint,
        }),
      );
    }

    const tokens = [];

    for (
      const tokenRecord of
      moduleRecord.tokens
    ) {
      const inspection =
        inspectToken(
          ts,
          projectRoot,
          moduleRecord,
          tokenRecord,
        );

      violations.push(
        ...inspection
          .violations,
      );

      tokens.push(
        Object.freeze({
          path:
            tokenRecord.path,
          capabilityId:
            tokenRecord.capabilityId,
          version:
            tokenRecord.version,
          primary:
            tokenRecord.primary,
          fingerprint:
            inspection
              .fingerprint,
        }),
      );
    }

    entries.push(
      Object.freeze({
        key:
          moduleRecord.key,
        capabilityId:
          moduleRecord.capabilityId,
        capabilityVersion:
          moduleRecord
            .capabilityVersion,
        facade:
          Object.freeze({
            path:
              buildExpectedPublicFacade(
                moduleRecord,
              ).filePath,
            fingerprint:
              facade
                .fingerprint,
          }),
        contracts:
          Object.freeze(
            contracts,
          ),
        tokens:
          Object.freeze(
            tokens,
          ),
      }),
    );
  }

  return Object.freeze({
    entries:
      Object.freeze(
        entries,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export async function auditLayer1PublicApi({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const layer1Baseline =
    loadLayer1Baseline(
      absoluteRoot,
    );

  const publicApiBaseline =
    loadLayer1PublicApiBaseline(
      absoluteRoot,
    );

  const moduleMap =
    await loadModuleMap(
      absoluteRoot,
    );

  const currentModules =
    moduleMap
      .CANONICAL_MODULES
      .map(
        projectLayer1Module,
      );

  const layer1Compatibility =
    compareLayer1BaselineCompatibility(
      layer1Baseline,
      currentModules,
    );

  const ts =
    loadTypeScript(
      absoluteRoot,
    );

  const current =
    await collectCurrentPublicApi({
      projectRoot:
        absoluteRoot,
      moduleMap,
      ts,
    });

  const publicApiCompatibility =
    comparePublicApiBaselineCompatibility(
      publicApiBaseline,
      current.entries,
    );

  const violations = [
    ...layer1Compatibility
      .violations.map(
        (item) =>
          violation(
            "L1API001",
            item.scope,
            `Stage 71 baseline incompatível: ${item.message}`,
          ),
      ),
    ...current
      .violations,
    ...publicApiCompatibility
      .violations,
  ];

  if (
    publicApiBaseline
      .architectureMigrationVersion !==
    moduleMap
      .ARCHITECTURE_MIGRATION_VERSION
  ) {
    violations.push(
      violation(
        "L1API050",
        "module-map",
        "architecture migration version divergiu da API baseline.",
      ),
    );
  }

  if (
    publicApiBaseline
      .moduleMapSchemaVersion !==
    moduleMap
      .MODULE_MAP_SCHEMA_VERSION
  ) {
    violations.push(
      violation(
        "L1API051",
        "module-map",
        "module-map schema version divergiu da API baseline.",
      ),
    );
  }

  violations.sort(
    (
      left,
      right,
    ) => {
      if (
        left.code !==
        right.code
      ) {
        return left.code
          .localeCompare(
            right.code,
          );
      }

      if (
        left.scope !==
        right.scope
      ) {
        return left.scope
          .localeCompare(
            right.scope,
          );
      }

      return left.message
        .localeCompare(
          right.message,
        );
    },
  );

  const contractCount =
    current.entries.reduce(
      (
        total,
        entry,
      ) =>
        total +
        entry.contracts
          .length,
      0,
    );

  const tokenCount =
    current.entries.reduce(
      (
        total,
        entry,
      ) =>
        total +
        entry.tokens
          .length,
      0,
    );

  const publicFacadeCount =
    current.entries.length;

  return Object.freeze({
    version:
      LAYER1_PUBLIC_API_AUDIT_VERSION,
    baselineId:
      publicApiBaseline
        .baselineId,
    capturedModuleCount:
      publicApiBaseline
        .modules.length,
    currentModuleCount:
      current.entries
        .length,
    counts:
      Object.freeze({
        publicFacades:
          publicFacadeCount,
        contracts:
          contractCount,
        tokens:
          tokenCount,
        secondaryCapabilities:
          current.entries.reduce(
            (
              total,
              entry,
            ) =>
              total +
              entry.tokens
                .filter(
                  (token) =>
                    token.primary ===
                    false,
                )
                .length,
            0,
          ),
      }),
    compatibility:
      Object.freeze({
        stage71Baseline:
          layer1Compatibility
            .ok,
        publicApiBaseline:
          publicApiCompatibility
            .ok,
        additionalCanonicalModules:
          publicApiCompatibility
            .additionalModuleKeys,
      }),
    policy:
      Object.freeze({
        publicFacadeExportsOnlyDeclaredContractsAndTokens:
          true,
        contractsDependOnlyOnCoreOrSameContractArea:
          true,
        tokensMayUseTechnicalExternalTypes:
          true,
        tokenRelativeImportsRestrictedToOwnDeclaredContracts:
          true,
        semanticFingerprintIgnoresWhitespaceAndComments:
          true,
        additionalCanonicalModulesAllowed:
          true,
        existingBaselineApiChangesRequireRecertification:
          true,
      }),
    violations:
      Object.freeze(
        violations,
      ),
    ok:
      violations.length ===
      0,
  });
}

export function formatLayer1PublicApiAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 PUBLIC API / CONTRACTS / TOKENS AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] API baseline: ${result.baselineId}`,
    `[INFO] Baseline modules: ${String(result.capturedModuleCount)}`,
    `[INFO] Current canonical modules: ${String(result.currentModuleCount)}`,
    `[INFO] Public facades: ${String(result.counts.publicFacades)}`,
    `[INFO] Contracts: ${String(result.counts.contracts)}`,
    `[INFO] Tokens: ${String(result.counts.tokens)}`,
    `[INFO] Secondary capabilities: ${String(result.counts.secondaryCapabilities)}`,
    `[INFO] Additional canonical modules: ${String(result.compatibility.additionalCanonicalModules.length)}`,
    `[INFO] Semantic fingerprint ignores whitespace/comments: ${result.policy.semanticFingerprintIgnoresWhitespaceAndComments ? "YES" : "NO"}`,
    `[INFO] New canonical modules allowed: ${result.policy.additionalCanonicalModulesAllowed ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.compatibility
      .additionalCanonicalModules
      .length >
    0
  ) {
    lines.push(
      `[INFO] New canonical modules: ${result.compatibility.additionalCanonicalModules.join(", ")}`,
      "",
    );
  }

  if (result.ok) {
    lines.push(
      "[OK] Violações Public API / Contracts / Tokens: 0",
      "[OK] Public facades exportam somente contracts/tokens declarados.",
      "[OK] Contracts permanecem desacoplados de engine/plugins/camadas superiores.",
      "[OK] Capability IDs e versões dos tokens permanecem coerentes.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Public API / Contracts / Tokens: ${String(result.violations.length)}`,
    );

    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[${item.code}] ${item.scope} — ${item.message}`,
      );
    }
  }

  return lines.join(
    "\n",
  );
}
