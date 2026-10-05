import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import {
  auditLayer1Baseline,
} from "./layer1-baseline-v1.mjs";

import {
  auditLayer1PublicApi,
  fingerprintTypeScriptSource,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

export const LAYER1_LIFECYCLE_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_LIFECYCLE_BASELINE_FILE =
  "LAYER1_LIFECYCLE_BASELINE_V1.json";

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
      return require(
        "typescript",
      );
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
      "Não foi possível carregar TypeScript.",
      ...errors,
    ].join(
      "\n",
    ),
  );
}

function readSource(
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

  if (
    !fs.existsSync(
      target,
    ) ||
    !fs.statSync(
      target,
    ).isFile()
  ) {
    throw new Error(
      `arquivo ausente: ${relativePath}`,
    );
  }

  return fs.readFileSync(
    target,
    "utf8",
  );
}

function countLifecycleCall(
  ts,
  sourceFile,
  method,
) {
  let count =
    0;

  function visit(
    node,
  ) {
    if (
      ts.isCallExpression(
        node,
      ) &&
      ts.isPropertyAccessExpression(
        node.expression,
      ) &&
      node.expression.name.text ===
        method
    ) {
      const owner =
        node.expression
          .expression;

      if (
        ts.isPropertyAccessExpression(
          owner,
        ) &&
        owner.name.text ===
          "lifecycle"
      ) {
        count +=
          1;
      }
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  visit(
    sourceFile,
  );

  return count;
}

function hasLifecycleHook(
  ts,
  sourceFile,
  hookName,
) {
  let found =
    false;

  function visit(
    node,
  ) {
    if (
      found
    ) {
      return;
    }

    if (
      (
        ts.isMethodDeclaration(
          node,
        ) ||
        ts.isPropertyAssignment(
          node,
        )
      ) &&
      node.name !==
        undefined
    ) {
      const name =
        ts.isIdentifier(
          node.name,
        ) ||
        ts.isStringLiteralLike(
          node.name,
        )
          ? node.name.text
          : null;

      if (
        name ===
        hookName
      ) {
        let parent =
          node.parent;

        while (
          parent !==
            undefined &&
          !ts.isObjectLiteralExpression(
            parent,
          )
        ) {
          parent =
            parent.parent;
        }

        if (
          parent !==
          undefined
        ) {
          const property =
            parent.parent;

          if (
            ts.isPropertyAssignment(
              property,
            ) &&
            (
              (
                ts.isIdentifier(
                  property.name,
                ) ||
                ts.isStringLiteralLike(
                  property.name,
                )
              ) &&
              property.name.text ===
                "lifecycleHooks"
            )
          ) {
            found =
              true;
            return;
          }
        }
      }
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

function inspectPluginLifecycle(
  ts,
  projectRoot,
  plugin,
) {
  const source =
    readSource(
      projectRoot,
      plugin.path,
    );

  const sourceFile =
    ts.createSourceFile(
      plugin.path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

  return Object.freeze({
    id:
      plugin.id,
    path:
      plugin.path,
    readyCalls:
      countLifecycleCall(
        ts,
        sourceFile,
        "ready",
      ),
    onDisposeCalls:
      countLifecycleCall(
        ts,
        sourceFile,
        "onDispose",
      ),
    hasOnBootHook:
      hasLifecycleHook(
        ts,
        sourceFile,
        "onBoot",
      ),
    hasOnStopHook:
      hasLifecycleHook(
        ts,
        sourceFile,
        "onStop",
      ),
  });
}

function loadJson(
  projectRoot,
  relativePath,
) {
  return JSON.parse(
    readSource(
      projectRoot,
      relativePath,
    ),
  );
}

function runDependencyChecker(
  projectRoot,
) {
  const result =
    spawnSync(
      process.execPath,
      [
        path.join(
          projectRoot,
          "scripts",
          "architecture",
          "check-dependencies.mjs",
        ),
        "--json",
      ],
      {
        cwd:
          projectRoot,
        encoding:
          "utf8",
        windowsHide:
          true,
        maxBuffer:
          128 * 1024 * 1024,
      },
    );

  if (
    result.error
  ) {
    throw result.error;
  }

  const stdout =
    String(
      result.stdout ??
        "",
    );

  if (
    stdout.trim().length ===
    0
  ) {
    throw new Error(
      "check-dependencies não produziu JSON.",
    );
  }

  return {
    status:
      result.status ??
      1,
    graph:
      JSON.parse(
        stdout,
      ),
    stderr:
      String(
        result.stderr ??
          "",
      ),
  };
}

export function compareLifecycleBaselineCompatibility(
  baseline,
  current,
) {
  const violations = [];

  const currentPlugins =
    new Map(
      current.plugins.map(
        (entry) => [
          entry.id,
          entry,
        ],
      ),
    );

  const baselineIds =
    new Set();

  for (
    const expected of
    baseline.plugins
  ) {
    baselineIds.add(
      expected.id,
    );

    const actual =
      currentPlugins.get(
        expected.id,
      );

    if (
      actual ===
      undefined
    ) {
      violations.push(
        violation(
          "L1LIFE001",
          expected.id,
          "plugin lifecycle da baseline desapareceu.",
        ),
      );

      continue;
    }

    if (
      JSON.stringify(
        actual,
      ) !==
      JSON.stringify(
        expected,
      )
    ) {
      violations.push(
        violation(
          "L1LIFE002",
          expected.id,
          "assinatura lifecycle do plugin mudou; exige recertificação.",
        ),
      );
    }
  }

  const additionalPluginIds =
    current.plugins
      .filter(
        (entry) =>
          !baselineIds.has(
            entry.id,
          ),
      )
      .map(
        (entry) =>
          entry.id,
      )
      .sort();

  const currentCore =
    new Map(
      current.coreRuntimeFiles
        .map(
          (entry) => [
            entry.path,
            entry.fingerprint,
          ],
        ),
    );

  for (
    const expected of
    baseline.coreRuntimeFiles
  ) {
    const actual =
      currentCore.get(
        expected.path,
      );

    if (
      actual ===
      undefined
    ) {
      violations.push(
        violation(
          "L1LIFE003",
          expected.path,
          "arquivo runtime lifecycle da baseline desapareceu.",
        ),
      );
    } else if (
      actual !==
      expected.fingerprint
    ) {
      violations.push(
        violation(
          "L1LIFE004",
          expected.path,
          "runtime lifecycle mudou semanticamente; exige recertificação.",
        ),
      );
    }
  }

  return Object.freeze({
    ok:
      violations.length ===
      0,
    additionalPluginIds:
      Object.freeze(
        additionalPluginIds,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function loadLifecycleBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    loadJson(
      projectRoot,
      LAYER1_LIFECYCLE_BASELINE_FILE,
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-lifecycle-v1-stage74" ||
    !Array.isArray(
      parsed.plugins,
    ) ||
    !Array.isArray(
      parsed.coreRuntimeFiles,
    )
  ) {
    throw new Error(
      "LAYER1_LIFECYCLE_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentLifecycle(
  projectRoot =
    process.cwd(),
) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const ts =
    loadTypeScript(
      absoluteRoot,
    );

  const dependency =
    runDependencyChecker(
      absoluteRoot,
    );

  if (
    dependency.status !==
      0 ||
    dependency.graph
      .violations
      .length >
      0
  ) {
    throw new Error(
      `dependency graph inválido: ${String(dependency.graph.violations.length)} violação(ões).`,
    );
  }

  const plugins =
    dependency.graph
      .composition
      .activePlugins
      .map(
        (plugin) =>
          inspectPluginLifecycle(
            ts,
            absoluteRoot,
            plugin,
          ),
      );

  const corePaths = [
    "src/core/runtime/boot.ts",
    "src/core/runtime/stop.ts",
    "src/core/runtime/dispose.ts",
    "src/core/runtime/install.ts",
    "src/core/runtime/replace.ts",
    "src/core/runtime/register.ts",
  ];

  const coreRuntimeFiles =
    corePaths.map(
      (relativePath) => ({
        path:
          relativePath,
        fingerprint:
          fingerprintTypeScriptSource(
            ts,
            readSource(
              absoluteRoot,
              relativePath,
            ),
          ),
      }),
    );

  return Object.freeze({
    plugins:
      Object.freeze(
        plugins,
      ),
    coreRuntimeFiles:
      Object.freeze(
        coreRuntimeFiles,
      ),
    counts:
      Object.freeze({
        activePlugins:
          plugins.length,
        readyCalls:
          plugins.reduce(
            (
              total,
              entry,
            ) =>
              total +
              entry.readyCalls,
            0,
          ),
        pluginsWithDispose:
          plugins.filter(
            (entry) =>
              entry.onDisposeCalls >
              0,
          ).length,
        pluginsWithOnBoot:
          plugins.filter(
            (entry) =>
              entry.hasOnBootHook,
          ).length,
        pluginsWithOnStop:
          plugins.filter(
            (entry) =>
              entry.hasOnStopHook,
          ).length,
        coreRuntimeFiles:
          coreRuntimeFiles.length,
      }),
  });
}

export async function auditLayer1Lifecycle({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const stage71 =
    await auditLayer1Baseline({
      projectRoot:
        absoluteRoot,
    });

  const stage72 =
    await auditLayer1PublicApi({
      projectRoot:
        absoluteRoot,
    });

  const stage73 =
    await auditLayer1CapabilityGraph({
      projectRoot:
        absoluteRoot,
    });

  const baseline =
    loadLifecycleBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentLifecycle(
      absoluteRoot,
    );

  const compatibility =
    compareLifecycleBaselineCompatibility(
      baseline,
      current,
    );

  const violations = [];

  if (
    !stage71.ok
  ) {
    violations.push(
      violation(
        "L1LIFE010",
        "stage71",
        `${String(stage71.violations.length)} violação(ões) na Stage 71.`,
      ),
    );
  }

  if (
    !stage72.ok
  ) {
    violations.push(
      violation(
        "L1LIFE011",
        "stage72",
        `${String(stage72.violations.length)} violação(ões) na Stage 72.`,
      ),
    );
  }

  if (
    !stage73.ok
  ) {
    violations.push(
      violation(
        "L1LIFE012",
        "stage73",
        `${String(stage73.violations.length)} violação(ões) na Stage 73.`,
      ),
    );
  }

  violations.push(
    ...compatibility
      .violations,
  );

  for (
    const plugin of
    current.plugins
  ) {
    if (
      plugin.readyCalls !==
      1
    ) {
      violations.push(
        violation(
          "L1LIFE020",
          plugin.id,
          `plugin ativo deve sinalizar lifecycle.ready() exatamente uma vez; encontrado ${String(plugin.readyCalls)}.`,
        ),
      );
    }
  }

  const bootSource =
    readSource(
      absoluteRoot,
      "src/core/runtime/boot.ts",
    );

  const stopSource =
    readSource(
      absoluteRoot,
      "src/core/runtime/stop.ts",
    );

  const requiredBootPatterns = [
    {
      label:
        "rollbackFailedBoot",
      pattern:
        /\brollbackFailedBoot\b/u,
    },
    {
      label:
        "quarantineFailedEntries",
      pattern:
        /\bquarantineFailedEntries\b/u,
    },
    {
      label:
        "runOnStopHookForStarted",
      pattern:
        /\brunOnStopHookForStarted\b/u,
    },
    {
      label:
        'state.status = "failed"',
      pattern:
        /state\.status\s*=\s*"failed"/u,
    },
    {
      label:
        'state.phase = "stopped"',
      pattern:
        /state\.phase\s*=\s*"stopped"/u,
    },
  ];

  for (
    const requirement of
    requiredBootPatterns
  ) {
    if (
      !requirement.pattern.test(
        bootSource,
      )
    ) {
      violations.push(
        violation(
          "L1LIFE021",
          "src/core/runtime/boot.ts",
          `marker lifecycle ausente: ${requirement.label}`,
        ),
      );
    }
  }

  const requiredStopPatterns = [
    {
      label:
        "rollbackFailedBoot",
      pattern:
        /\brollbackFailedBoot\b/u,
    },
    {
      label:
        "runOnStopHookForStarted",
      pattern:
        /\brunOnStopHookForStarted\b/u,
    },
    {
      label:
        'entry?.state !== "started"',
      pattern:
        /entry\?\.state\s*!==\s*"started"/u,
    },
    {
      label:
        'state.phase = "stopping"',
      pattern:
        /state\.phase\s*=\s*"stopping"/u,
    },
    {
      label:
        'state.phase = "stopped"',
      pattern:
        /state\.phase\s*=\s*"stopped"/u,
    },
  ];

  for (
    const requirement of
    requiredStopPatterns
  ) {
    if (
      !requirement.pattern.test(
        stopSource,
      )
    ) {
      violations.push(
        violation(
          "L1LIFE022",
          "src/core/runtime/stop.ts",
          `marker shutdown ausente: ${requirement.label}`,
        ),
      );
    }
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

  return Object.freeze({
    version:
      LAYER1_LIFECYCLE_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    capturedCounts:
      Object.freeze(
        baseline.capturedCounts,
      ),
    currentCounts:
      current.counts,
    compatibility:
      Object.freeze({
        stage71:
          stage71.ok,
        stage72:
          stage72.ok,
        stage73:
          stage73.ok,
        lifecycleBaseline:
          compatibility.ok,
        additionalPluginIds:
          compatibility
            .additionalPluginIds,
      }),
    policy:
      Object.freeze({
        bootFailureRollbackAutomatic:
          true,
        inverseShutdown:
          true,
        onStopOnlyForStarted:
          true,
        disposeIdempotent:
          true,
        stopIdempotent:
          true,
        tolerantFailuresQuarantined:
          true,
        kernelInstanceSingleUse:
          true,
        controlledRestartUsesFreshKernel:
          true,
        additionalRegisteredPluginsAllowed:
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

export function formatLayer1LifecycleAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 LIFECYCLE / BOOT / SHUTDOWN AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Lifecycle baseline: ${result.baselineId}`,
    `[INFO] Active plugins: ${String(result.currentCounts.activePlugins)}`,
    `[INFO] lifecycle.ready() calls: ${String(result.currentCounts.readyCalls)}`,
    `[INFO] Plugins com onDispose: ${String(result.currentCounts.pluginsWithDispose)}`,
    `[INFO] Plugins com lifecycleHooks.onBoot: ${String(result.currentCounts.pluginsWithOnBoot)}`,
    `[INFO] Plugins com lifecycleHooks.onStop: ${String(result.currentCounts.pluginsWithOnStop)}`,
    `[INFO] Core lifecycle runtime files: ${String(result.currentCounts.coreRuntimeFiles)}`,
    `[INFO] Kernel instance single-use: ${result.policy.kernelInstanceSingleUse ? "YES" : "NO"}`,
    `[INFO] Controlled restart uses fresh Kernel: ${result.policy.controlledRestartUsesFreshKernel ? "YES" : "NO"}`,
    `[INFO] New registered plugins allowed: ${result.policy.additionalRegisteredPluginsAllowed ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.compatibility
      .additionalPluginIds
      .length >
    0
  ) {
    lines.push(
      `[INFO] Additional plugins: ${result.compatibility.additionalPluginIds.join(", ")}`,
      "",
    );
  }

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Lifecycle / Boot / Shutdown: 0",
      "[OK] Boot failure rollback automático está governado.",
      "[OK] Shutdown inverso e hooks/disposers idempotentes permanecem governados.",
      "[OK] Tolerant failures são quarentenadas em vez de permanecer parcialmente vivas.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Lifecycle / Boot / Shutdown: ${String(result.violations.length)}`,
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
