import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

export const PORTABILITY_GATE_VERSION =
  "2.0.0";

export const PORTABILITY_RULES =
  Object.freeze({
    PRT001:
      "domain imports/exports must remain inside src/domain",
    PRT002:
      "domain cannot use Node/DOM/browser/platform runtime globals",
    PRT003:
      "domain cannot use wall-clock/timer globals",
    PRT004:
      "domain cannot use global/external entropy",
    PRT005:
      "domain cannot reference rendering/physics spatial implementation symbols",
    PRT006:
      "domain cannot declare dimension-specific *2D/*3D model types",
    PRT007:
      "domain cannot use CommonJS require or triple-slash external references",
    PRT008:
      "domain TypeScript sources must parse without diagnostics",
  });

const BANNED_RUNTIME_GLOBALS =
  new Set([
    "window",
    "document",
    "navigator",
    "localStorage",
    "sessionStorage",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "MessageChannel",
    "BroadcastChannel",
    "HTMLElement",
    "HTMLCanvasElement",
    "OffscreenCanvas",
    "ImageBitmap",
    "ImageData",
    "CanvasRenderingContext2D",
    "WebGLRenderingContext",
    "WebGL2RenderingContext",
    "GPU",
    "GPUDevice",
    "AudioContext",
    "OfflineAudioContext",
    "KeyboardEvent",
    "MouseEvent",
    "PointerEvent",
    "TouchEvent",
    "Gamepad",
    "process",
    "Buffer",
    "__dirname",
    "__filename",
    "Deno",
    "Bun",
    "Steamworks",
  ]);

const BANNED_WALL_CLOCK_GLOBALS =
  new Set([
    "Date",
    "performance",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]);

const BANNED_TECHNICAL_IDENTIFIERS =
  new Set([
    "Vector2",
    "Vector3",
    "Vector4",
    "Matrix3",
    "Matrix4",
    "Quaternion",
    "Euler",
    "Object3D",
    "Mesh",
    "InstancedMesh",
    "Sprite",
    "Camera",
    "PerspectiveCamera",
    "OrthographicCamera",
    "Scene",
    "Raycaster",
    "Texture",
    "Material",
    "ShaderMaterial",
    "WebGLRenderer",
    "Collider",
    "RigidBody",
    "RigidBodyDesc",
    "ColliderDesc",
    "PhysicsWorld",
    "RapierWorld",
    "RigidBodyHandle",
    "ColliderHandle",
  ]);

const DIMENSIONAL_DECLARATION =
  /(?:2D|3D)$/u;

function normalizeSlashes(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function relativeDisplay(
  root,
  file,
) {
  return normalizeSlashes(
    path.relative(
      root,
      file,
    ),
  );
}

function listTypeScriptFiles(
  domainRoot,
) {
  const files = [];
  const stack = [
    domainRoot,
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
      (left, right) =>
        left.name.localeCompare(
          right.name,
        ),
    );

    for (
      const entry of entries
    ) {
      const full =
        path.join(
          current,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        stack.push(full);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(
          ".ts",
        ) &&
        !entry.name.endsWith(
          ".d.ts",
        )
      ) {
        files.push(full);
      }
    }
  }

  files.sort();
  return files;
}

function isInside(
  root,
  candidate,
) {
  const relative =
    path.relative(
      root,
      candidate,
    );

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(
        `..${path.sep}`,
      ) &&
      !path.isAbsolute(
        relative,
      )
    )
  );
}

function resolveRelativeModule(
  importer,
  specifier,
) {
  return path.resolve(
    path.dirname(
      importer,
    ),
    specifier,
  );
}

function collectModuleReferences(
  sourceFile,
) {
  const references =
    [];

  function push(
    kind,
    node,
    specifier,
  ) {
    references.push({
      kind,
      specifier,
      line:
        sourceFile
          .getLineAndCharacterOfPosition(
            node.getStart(
              sourceFile,
            ),
          )
          .line +
        1,
    });
  }

  function visit(node) {
    if (
      ts.isImportDeclaration(
        node,
      ) ||
      ts.isExportDeclaration(
        node,
      )
    ) {
      if (
        node.moduleSpecifier !==
          undefined &&
        ts.isStringLiteralLike(
          node.moduleSpecifier,
        )
      ) {
        push(
          ts.isImportDeclaration(
            node,
          )
            ? "import"
            : "export",
          node,
          node.moduleSpecifier
            .text,
        );
      }
    }

    if (
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
      push(
        "import-type",
        node,
        node.argument.literal
          .text,
      );
    }

    if (
      ts.isCallExpression(
        node,
      ) &&
      node.expression.kind ===
        ts.SyntaxKind
          .ImportKeyword &&
      node.arguments.length >
        0
    ) {
      const first =
        node.arguments[0];

      if (
        first !== undefined &&
        ts.isStringLiteralLike(
          first,
        )
      ) {
        push(
          "dynamic-import",
          node,
          first.text,
        );
      }
    }

    if (
      ts.isCallExpression(
        node,
      ) &&
      ts.isIdentifier(
        node.expression,
      ) &&
      node.expression.text ===
        "require"
    ) {
      const first =
        node.arguments[0];

      push(
        "require",
        node,
        first !== undefined &&
        ts.isStringLiteralLike(
          first,
        )
          ? first.text
          : "<dynamic>",
      );
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return references;
}

function isDeclarationName(
  node,
) {
  const parent =
    node.parent;

  if (
    parent === undefined
  ) {
    return false;
  }

  if (
    "name" in parent &&
    parent.name === node
  ) {
    return true;
  }

  return false;
}

function isPropertyNamePosition(
  node,
) {
  const parent =
    node.parent;

  if (
    parent === undefined
  ) {
    return false;
  }

  if (
    (
      ts.isPropertyAccessExpression(
        parent,
      ) ||
      ts.isPropertyAssignment(
        parent,
      ) ||
      ts.isPropertySignature(
        parent,
      ) ||
      ts.isMethodDeclaration(
        parent,
      ) ||
      ts.isMethodSignature(
        parent,
      )
    ) &&
    parent.name === node
  ) {
    return true;
  }

  return false;
}

function isImportExportBinding(
  node,
) {
  let current =
    node.parent;

  while (
    current !== undefined
  ) {
    if (
      ts.isImportDeclaration(
        current,
      ) ||
      ts.isExportDeclaration(
        current,
      )
    ) {
      return true;
    }

    if (
      ts.isSourceFile(
        current,
      )
    ) {
      break;
    }

    current =
      current.parent;
  }

  return false;
}

function collectIdentifierUses(
  sourceFile,
) {
  const uses =
    [];

  function visit(node) {
    if (
      ts.isIdentifier(node)
    ) {
      if (
        !isDeclarationName(
          node,
        ) &&
        !isPropertyNamePosition(
          node,
        ) &&
        !isImportExportBinding(
          node,
        )
      ) {
        uses.push({
          name:
            node.text,
          line:
            sourceFile
              .getLineAndCharacterOfPosition(
                node.getStart(
                  sourceFile,
                ),
              )
              .line +
            1,
        });
      }
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return uses;
}

function collectTechnicalIdentifiers(
  sourceFile,
) {
  const values =
    [];

  function visit(node) {
    if (
      ts.isIdentifier(node) &&
      BANNED_TECHNICAL_IDENTIFIERS.has(
        node.text,
      )
    ) {
      values.push({
        name:
          node.text,
        line:
          sourceFile
            .getLineAndCharacterOfPosition(
              node.getStart(
                sourceFile,
              ),
            )
            .line +
          1,
      });
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return values;
}

function collectDimensionalDeclarations(
  sourceFile,
) {
  const values =
    [];

  function checkNamedDeclaration(
    node,
  ) {
    const name =
      node.name;

    if (
      name !== undefined &&
      ts.isIdentifier(name) &&
      DIMENSIONAL_DECLARATION.test(
        name.text,
      )
    ) {
      values.push({
        name:
          name.text,
        line:
          sourceFile
            .getLineAndCharacterOfPosition(
              name.getStart(
                sourceFile,
              ),
            )
            .line +
          1,
      });
    }
  }

  function visit(node) {
    if (
      ts.isClassDeclaration(
        node,
      ) ||
      ts.isInterfaceDeclaration(
        node,
      ) ||
      ts.isTypeAliasDeclaration(
        node,
      ) ||
      ts.isEnumDeclaration(
        node,
      ) ||
      ts.isFunctionDeclaration(
        node,
      )
    ) {
      checkNamedDeclaration(
        node,
      );
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return values;
}

function collectForbiddenEntropy(
  sourceFile,
) {
  const values =
    [];

  function visit(node) {
    if (
      ts.isPropertyAccessExpression(
        node,
      ) &&
      ts.isIdentifier(
        node.expression,
      ) &&
      node.expression.text ===
        "Math" &&
      node.name.text ===
        "random"
    ) {
      values.push({
        name:
          "Math.random",
        line:
          sourceFile
            .getLineAndCharacterOfPosition(
              node.getStart(
                sourceFile,
              ),
            )
            .line +
          1,
      });
    }

    if (
      ts.isPropertyAccessExpression(
        node,
      ) &&
      ts.isIdentifier(
        node.expression,
      ) &&
      node.expression.text ===
        "crypto" &&
      (
        node.name.text ===
          "getRandomValues" ||
        node.name.text ===
          "randomUUID"
      )
    ) {
      values.push({
        name:
          `crypto.${node.name.text}`,
        line:
          sourceFile
            .getLineAndCharacterOfPosition(
              node.getStart(
                sourceFile,
              ),
            )
            .line +
          1,
      });
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(sourceFile);

  return values;
}

function violation(
  rule,
  file,
  line,
  message,
) {
  return Object.freeze({
    rule,
    file,
    line,
    message,
  });
}

function compareViolation(
  left,
  right,
) {
  if (
    left.file !== right.file
  ) {
    return left.file <
      right.file
      ? -1
      : 1;
  }

  if (
    left.line !== right.line
  ) {
    return (
      left.line -
      right.line
    );
  }

  if (
    left.rule !== right.rule
  ) {
    return left.rule <
      right.rule
      ? -1
      : 1;
  }

  return left.message.localeCompare(
    right.message,
  );
}

export function auditDomainPortability({
  projectRoot =
    process.cwd(),

  domainRoot =
    path.join(
      projectRoot,
      "src",
      "domain",
    ),
} = {}) {
  const absoluteProjectRoot =
    path.resolve(
      projectRoot,
    );

  const absoluteDomainRoot =
    path.resolve(
      domainRoot,
    );

  if (
    !fs.existsSync(
      absoluteDomainRoot,
    ) ||
    !fs.statSync(
      absoluteDomainRoot,
    ).isDirectory()
  ) {
    throw new Error(
      `Domain root inexistente: ${absoluteDomainRoot}`,
    );
  }

  const files =
    listTypeScriptFiles(
      absoluteDomainRoot,
    );

  const violations =
    [];

  const counts = {
    files: files.length,
    moduleReferences: 0,
    identifiers: 0,
    technicalIdentifiers: 0,
    dimensionalDeclarations: 0,
  };

  for (
    const file of files
  ) {
    const sourceText =
      fs.readFileSync(
        file,
        "utf8",
      );

    const sourceFile =
      ts.createSourceFile(
        file,
        sourceText,
        ts.ScriptTarget.ES2020,
        true,
        ts.ScriptKind.TS,
      );

    const relativeFile =
      relativeDisplay(
        absoluteProjectRoot,
        file,
      );

    if (
      sourceFile
        .parseDiagnostics
        .length > 0
    ) {
      for (
        const diagnostic of
        sourceFile
          .parseDiagnostics
      ) {
        const start =
          diagnostic.start ?? 0;

        const line =
          sourceFile
            .getLineAndCharacterOfPosition(
              start,
            )
            .line +
          1;

        violations.push(
          violation(
            "PRT008",
            relativeFile,
            line,
            ts.flattenDiagnosticMessageText(
              diagnostic.messageText,
              "\n",
            ),
          ),
        );
      }
    }

    const references =
      collectModuleReferences(
        sourceFile,
      );

    counts.moduleReferences +=
      references.length;

    for (
      const reference of
      references
    ) {
      if (
        reference.kind ===
          "require"
      ) {
        violations.push(
          violation(
            "PRT007",
            relativeFile,
            reference.line,
            `CommonJS require proibido (${reference.specifier}).`,
          ),
        );

        continue;
      }

      if (
        !reference.specifier
          .startsWith(".")
      ) {
        violations.push(
          violation(
            "PRT001",
            relativeFile,
            reference.line,
            `module specifier externo proibido "${reference.specifier}".`,
          ),
        );

        continue;
      }

      const resolved =
        resolveRelativeModule(
          file,
          reference.specifier,
        );

      if (
        !isInside(
          absoluteDomainRoot,
          resolved,
        )
      ) {
        violations.push(
          violation(
            "PRT001",
            relativeFile,
            reference.line,
            `module specifier sai de src/domain: "${reference.specifier}".`,
          ),
        );
      }
    }

    for (
      const referenced of
      sourceFile.referencedFiles
    ) {
      violations.push(
        violation(
          "PRT007",
          relativeFile,
          sourceFile
            .getLineAndCharacterOfPosition(
              referenced.pos,
            )
            .line +
          1,
          `triple-slash path reference proibida "${referenced.fileName}".`,
        ),
      );
    }

    for (
      const referenced of
      sourceFile
        .typeReferenceDirectives
    ) {
      violations.push(
        violation(
          "PRT007",
          relativeFile,
          sourceFile
            .getLineAndCharacterOfPosition(
              referenced.pos,
            )
            .line +
          1,
          `triple-slash types reference proibida "${referenced.fileName}".`,
        ),
      );
    }

    const identifierUses =
      collectIdentifierUses(
        sourceFile,
      );

    counts.identifiers +=
      identifierUses.length;

    for (
      const use of
      identifierUses
    ) {
      if (
        BANNED_RUNTIME_GLOBALS.has(
          use.name,
        )
      ) {
        violations.push(
          violation(
            "PRT002",
            relativeFile,
            use.line,
            `global técnico proibido "${use.name}".`,
          ),
        );
      }

      if (
        BANNED_WALL_CLOCK_GLOBALS.has(
          use.name,
        )
      ) {
        violations.push(
          violation(
            "PRT003",
            relativeFile,
            use.line,
            `clock/timer global proibido "${use.name}".`,
          ),
        );
      }
    }

    const entropy =
      collectForbiddenEntropy(
        sourceFile,
      );

    for (
      const item of entropy
    ) {
      violations.push(
        violation(
          "PRT004",
          relativeFile,
          item.line,
          `entropia global proibida "${item.name}".`,
        ),
      );
    }

    const technicalIdentifiers =
      collectTechnicalIdentifiers(
        sourceFile,
      );

    counts.technicalIdentifiers +=
      technicalIdentifiers.length;

    for (
      const item of
      technicalIdentifiers
    ) {
      violations.push(
        violation(
          "PRT005",
          relativeFile,
          item.line,
          `símbolo técnico espacial/render/physics proibido "${item.name}".`,
        ),
      );
    }

    const dimensional =
      collectDimensionalDeclarations(
        sourceFile,
      );

    counts.dimensionalDeclarations +=
      dimensional.length;

    for (
      const item of
      dimensional
    ) {
      violations.push(
        violation(
          "PRT006",
          relativeFile,
          item.line,
          `declaração dimension-specific proibida "${item.name}".`,
        ),
      );
    }
  }

  violations.sort(
    compareViolation,
  );

  const byRule = {};

  for (
    const rule of
    Object.keys(
      PORTABILITY_RULES,
    )
  ) {
    byRule[rule] = 0;
  }

  for (
    const item of
    violations
  ) {
    byRule[item.rule] =
      (
        byRule[item.rule] ??
        0
      ) + 1;
  }

  return Object.freeze({
    version:
      PORTABILITY_GATE_VERSION,
    typescriptVersion:
      ts.version,
    projectRoot:
      absoluteProjectRoot,
    domainRoot:
      absoluteDomainRoot,
    counts:
      Object.freeze(counts),
    byRule:
      Object.freeze(byRule),
    violations:
      Object.freeze(
        violations,
      ),
    ok:
      violations.length === 0,
  });
}

export function formatPortabilityAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — PORTABILITY GATE v2",
    "============================================================",
    "",
    `[INFO] Gate version: ${result.version}`,
    `[INFO] TypeScript Compiler API: ${result.typescriptVersion}`,
    `[INFO] Arquivos domain analisados: ${String(result.counts.files)}`,
    `[INFO] Referências de módulo: ${String(result.counts.moduleReferences)}`,
    `[INFO] Identifiers auditados: ${String(result.counts.identifiers)}`,
    "",
    "=== REGRAS ===",
  ];

  for (
    const [
      rule,
      description,
    ] of Object.entries(
      PORTABILITY_RULES,
    )
  ) {
    lines.push(
      `[${rule}] ${description}`,
    );
  }

  lines.push(
    "",
    "=== RESULTADO ===",
  );

  if (result.ok) {
    lines.push(
      "[OK] Violações de portabilidade v2: 0",
      "[OK] src/domain permanece 2D / 2.5D / 3D / headless.",
    );
  } else {
    lines.push(
      `[FAIL] Violações de portabilidade v2: ${String(result.violations.length)}`,
    );

    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[${item.rule}] ${item.file}:${String(item.line)} — ${item.message}`,
      );
    }
  }

  return lines.join(
    "\n",
  );
}
