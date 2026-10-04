import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  DOMAIN_DISALLOWED_HOT_CALL_NAMES,
  DOMAIN_DISALLOWED_HOT_STATIC_CALLS,
  DOMAIN_HOT_PATHS,
  DOMAIN_LIFECYCLE_POLICIES,
  DOMAIN_PERFORMANCE_POLICY_VERSION,
} from "./domain-performance-policy-v1.mjs";

export const DOMAIN_PERFORMANCE_AUDIT_VERSION =
  "1.0.0";

export const DOMAIN_PERFORMANCE_RULES =
  Object.freeze({
    PERF001:
      "every declared hot-path target must exist",
    PERF002:
      "hot paths cannot allocate objects/arrays/closures/spreads on normal execution paths",
    PERF003:
      "hot paths cannot call collection/snapshot materialization APIs",
    PERF004:
      "hot-path loop nesting cannot exceed its declared budget",
    PERF005:
      "hot paths must stay synchronous and cannot await/yield",
    PERF006:
      "mutable runtime collections must expose explicit lifecycle release APIs",
    PERF007:
      "audited TypeScript sources must parse without diagnostics",
  });

function normalizeSlashes(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function compareViolation(
  left,
  right,
) {
  if (
    left.file !==
    right.file
  ) {
    return left.file <
      right.file
      ? -1
      : 1;
  }

  if (
    left.line !==
    right.line
  ) {
    return (
      left.line -
      right.line
    );
  }

  if (
    left.rule !==
    right.rule
  ) {
    return left.rule <
      right.rule
      ? -1
      : 1;
  }

  return left.message
    .localeCompare(
      right.message,
    );
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

function lineOf(
  sourceFile,
  node,
) {
  return (
    sourceFile
      .getLineAndCharacterOfPosition(
        node.getStart(
          sourceFile,
        ),
      )
      .line +
    1
  );
}

function findClass(
  sourceFile,
  className,
) {
  for (
    const statement of
    sourceFile.statements
  ) {
    if (
      ts.isClassDeclaration(
        statement,
      ) &&
      statement.name?.text ===
        className
    ) {
      return statement;
    }
  }

  return null;
}

function memberName(
  member,
) {
  if (
    member.name !==
      undefined &&
    (
      ts.isIdentifier(
        member.name,
      ) ||
      ts.isStringLiteralLike(
        member.name,
      )
    )
  ) {
    return member.name.text;
  }

  return null;
}

function classMethods(
  classDeclaration,
) {
  const methods =
    new Map();

  for (
    const member of
    classDeclaration.members
  ) {
    if (
      ts.isMethodDeclaration(
        member,
      )
    ) {
      const name =
        memberName(
          member,
        );

      if (
        name !== null
      ) {
        methods.set(
          name,
          member,
        );
      }
    }
  }

  return methods;
}

function isInsideThrow(
  node,
  boundary,
) {
  let current =
    node.parent;

  while (
    current !==
      undefined &&
    current !==
      boundary
  ) {
    if (
      ts.isThrowStatement(
        current,
      )
    ) {
      return true;
    }

    current =
      current.parent;
  }

  return false;
}

function allocationKind(
  node,
) {
  if (
    ts.isNewExpression(
      node,
    )
  ) {
    return "new-expression";
  }

  if (
    ts.isArrayLiteralExpression(
      node,
    )
  ) {
    return "array-literal";
  }

  if (
    ts.isObjectLiteralExpression(
      node,
    )
  ) {
    return "object-literal";
  }

  if (
    ts.isArrowFunction(
      node,
    ) ||
    ts.isFunctionExpression(
      node,
    )
  ) {
    return "closure";
  }

  if (
    ts.isSpreadElement(
      node,
    ) ||
    ts.isSpreadAssignment(
      node,
    )
  ) {
    return "spread";
  }

  return null;
}

function staticCallName(
  expression,
) {
  if (
    !ts.isPropertyAccessExpression(
      expression,
    )
  ) {
    return null;
  }

  if (
    !ts.isIdentifier(
      expression.expression,
    )
  ) {
    return null;
  }

  return (
    `${expression.expression.text}.${expression.name.text}`
  );
}

function calledMethodName(
  expression,
) {
  if (
    ts.isPropertyAccessExpression(
      expression,
    )
  ) {
    return expression.name.text;
  }

  if (
    ts.isIdentifier(
      expression,
    )
  ) {
    return expression.text;
  }

  return null;
}

function isLoopNode(
  node,
) {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function analyzeHotMethod({
  sourceFile,
  relativeFile,
  className,
  methodName,
  method,
  maxLoopDepth,
}) {
  const violations = [];

  if (
    method.modifiers?.some(
      (modifier) =>
        modifier.kind ===
        ts.SyntaxKind.AsyncKeyword,
    ) === true
  ) {
    violations.push(
      violation(
        "PERF005",
        relativeFile,
        lineOf(
          sourceFile,
          method,
        ),
        `${className}.${methodName} não pode ser async.`,
      ),
    );
  }

  let currentLoopDepth = 0;
  let observedMaxLoopDepth = 0;

  function visit(node) {
    const entersLoop =
      isLoopNode(node);

    if (entersLoop) {
      currentLoopDepth += 1;

      if (
        currentLoopDepth >
        observedMaxLoopDepth
      ) {
        observedMaxLoopDepth =
          currentLoopDepth;
      }
    }

    if (
      !isInsideThrow(
        node,
        method,
      )
    ) {
      const kind =
        allocationKind(
          node,
        );

      if (
        kind !== null
      ) {
        violations.push(
          violation(
            "PERF002",
            relativeFile,
            lineOf(
              sourceFile,
              node,
            ),
            `${className}.${methodName} contém ${kind} no caminho normal.`,
          ),
        );
      }

      if (
        ts.isCallExpression(
          node,
        )
      ) {
        const staticName =
          staticCallName(
            node.expression,
          );

        const methodCallName =
          calledMethodName(
            node.expression,
          );

        if (
          (
            staticName !== null &&
            DOMAIN_DISALLOWED_HOT_STATIC_CALLS.has(
              staticName,
            )
          ) ||
          (
            methodCallName !== null &&
            DOMAIN_DISALLOWED_HOT_CALL_NAMES.has(
              methodCallName,
            )
          )
        ) {
          violations.push(
            violation(
              "PERF003",
              relativeFile,
              lineOf(
                sourceFile,
                node,
              ),
              `${className}.${methodName} chama materialização proibida "${staticName ?? methodCallName}".`,
            ),
          );
        }
      }

      if (
        ts.isAwaitExpression(
          node,
        ) ||
        ts.isYieldExpression(
          node,
        )
      ) {
        violations.push(
          violation(
            "PERF005",
            relativeFile,
            lineOf(
              sourceFile,
              node,
            ),
            `${className}.${methodName} contém await/yield.`,
          ),
        );
      }
    }

    ts.forEachChild(
      node,
      visit,
    );

    if (entersLoop) {
      currentLoopDepth -= 1;
    }
  }

  if (
    method.body !==
      undefined
  ) {
    visit(
      method.body,
    );
  }

  if (
    observedMaxLoopDepth >
    maxLoopDepth
  ) {
    violations.push(
      violation(
        "PERF004",
        relativeFile,
        lineOf(
          sourceFile,
          method,
        ),
        `${className}.${methodName} possui loop depth ${String(observedMaxLoopDepth)} > budget ${String(maxLoopDepth)}.`,
      ),
    );
  }

  return {
    violations,
    observedMaxLoopDepth,
  };
}

function loadSource({
  projectRoot,
  relativeFile,
  sourceCache,
  violations,
}) {
  let source =
    sourceCache.get(
      relativeFile,
    );

  if (
    source !== undefined
  ) {
    return source;
  }

  const absolute =
    path.join(
      projectRoot,
      ...relativeFile.split(
        "/",
      ),
    );

  if (
    !fs.existsSync(
      absolute,
    ) ||
    !fs.statSync(
      absolute,
    ).isFile()
  ) {
    return null;
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const sourceFile =
    ts.createSourceFile(
      absolute,
      text,
      ts.ScriptTarget.ES2020,
      true,
      ts.ScriptKind.TS,
    );

  source = {
    absolute,
    sourceFile,
  };

  sourceCache.set(
    relativeFile,
    source,
  );

  for (
    const diagnostic of
    sourceFile.parseDiagnostics
  ) {
    const line =
      sourceFile
        .getLineAndCharacterOfPosition(
          diagnostic.start ?? 0,
        )
        .line +
      1;

    violations.push(
      violation(
        "PERF007",
        relativeFile,
        line,
        ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n",
        ),
      ),
    );
  }

  return source;
}

export function auditDomainPerformance({
  projectRoot =
    process.cwd(),

  hotPaths =
    DOMAIN_HOT_PATHS,

  lifecyclePolicies =
    DOMAIN_LIFECYCLE_POLICIES,
} = {}) {
  const absoluteProjectRoot =
    path.resolve(
      projectRoot,
    );

  const violations = [];
  const sourceCache =
    new Map();

  let auditedHotMethods = 0;
  let lifecycleMethodsChecked = 0;
  let maxObservedLoopDepth = 0;

  for (
    const policy of
    hotPaths
  ) {
    const relativeFile =
      normalizeSlashes(
        policy.file,
      );

    const source =
      loadSource({
        projectRoot:
          absoluteProjectRoot,
        relativeFile,
        sourceCache,
        violations,
      });

    if (
      source === null
    ) {
      violations.push(
        violation(
          "PERF001",
          relativeFile,
          1,
          "arquivo de hot path não existe.",
        ),
      );

      continue;
    }

    const classDeclaration =
      findClass(
        source.sourceFile,
        policy.className,
      );

    if (
      classDeclaration === null
    ) {
      violations.push(
        violation(
          "PERF001",
          relativeFile,
          1,
          `classe "${policy.className}" não encontrada.`,
        ),
      );

      continue;
    }

    const methods =
      classMethods(
        classDeclaration,
      );

    for (
      const methodName of
      policy.methods
    ) {
      const method =
        methods.get(
          methodName,
        );

      if (
        method === undefined
      ) {
        violations.push(
          violation(
            "PERF001",
            relativeFile,
            lineOf(
              source.sourceFile,
              classDeclaration,
            ),
            `hot path "${policy.className}.${methodName}" não encontrado.`,
          ),
        );

        continue;
      }

      auditedHotMethods +=
        1;

      const result =
        analyzeHotMethod({
          sourceFile:
            source.sourceFile,
          relativeFile,
          className:
            policy.className,
          methodName,
          method,
          maxLoopDepth:
            policy.maxLoopDepth,
        });

      if (
        result.observedMaxLoopDepth >
        maxObservedLoopDepth
      ) {
        maxObservedLoopDepth =
          result.observedMaxLoopDepth;
      }

      violations.push(
        ...result.violations,
      );
    }
  }

  for (
    const policy of
    lifecyclePolicies
  ) {
    const relativeFile =
      normalizeSlashes(
        policy.file,
      );

    const source =
      loadSource({
        projectRoot:
          absoluteProjectRoot,
        relativeFile,
        sourceCache,
        violations,
      });

    if (
      source === null
    ) {
      violations.push(
        violation(
          "PERF006",
          relativeFile,
          1,
          "arquivo de lifecycle não existe.",
        ),
      );

      continue;
    }

    const classDeclaration =
      findClass(
        source.sourceFile,
        policy.className,
      );

    if (
      classDeclaration === null
    ) {
      violations.push(
        violation(
          "PERF006",
          relativeFile,
          1,
          `classe lifecycle "${policy.className}" não encontrada.`,
        ),
      );

      continue;
    }

    const methods =
      classMethods(
        classDeclaration,
      );

    for (
      const methodName of
      policy.requiredMethods
    ) {
      lifecycleMethodsChecked +=
        1;

      if (
        !methods.has(
          methodName,
        )
      ) {
        violations.push(
          violation(
            "PERF006",
            relativeFile,
            lineOf(
              source.sourceFile,
              classDeclaration,
            ),
            `lifecycle method obrigatório "${policy.className}.${methodName}" ausente.`,
          ),
        );
      }
    }
  }

  violations.sort(
    compareViolation,
  );

  const byRule = {};

  for (
    const rule of
    Object.keys(
      DOMAIN_PERFORMANCE_RULES,
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
      DOMAIN_PERFORMANCE_AUDIT_VERSION,

    policyVersion:
      DOMAIN_PERFORMANCE_POLICY_VERSION,

    typescriptVersion:
      ts.version,

    projectRoot:
      absoluteProjectRoot,

    counts:
      Object.freeze({
        sourceFiles:
          sourceCache.size,
        hotMethods:
          auditedHotMethods,
        lifecycleMethods:
          lifecycleMethodsChecked,
        maxObservedLoopDepth,
      }),

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

export function formatDomainPerformanceAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — DOMAIN PERFORMANCE AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Policy version: ${result.policyVersion}`,
    `[INFO] TypeScript Compiler API: ${result.typescriptVersion}`,
    `[INFO] Source files auditados: ${String(result.counts.sourceFiles)}`,
    `[INFO] Hot methods auditados: ${String(result.counts.hotMethods)}`,
    `[INFO] Lifecycle methods fiscalizados: ${String(result.counts.lifecycleMethods)}`,
    `[INFO] Maior loop depth observado: ${String(result.counts.maxObservedLoopDepth)}`,
    "",
    "=== REGRAS ===",
  ];

  for (
    const [
      rule,
      description,
    ] of Object.entries(
      DOMAIN_PERFORMANCE_RULES,
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
      "[OK] Violações de performance estrutural: 0",
      "[OK] Hot paths permanecem sem materialização/alocação normal proibida.",
      "[OK] Lifecycles mutáveis possuem APIs explícitas de release.",
    );
  } else {
    lines.push(
      `[FAIL] Violações de performance estrutural: ${String(result.violations.length)}`,
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
