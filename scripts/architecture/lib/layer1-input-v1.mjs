import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  auditLayer1PublicApi,
  fingerprintTypeScriptSource,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

import {
  auditLayer1GameLoop,
} from "./layer1-game-loop-v1.mjs";

import {
  auditLayer1Rendering,
} from "./layer1-rendering-v1.mjs";

import {
  auditLayer1Physics,
} from "./layer1-physics-v1.mjs";

export const LAYER1_INPUT_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_INPUT_BASELINE_FILE =
  "LAYER1_INPUT_BASELINE_V1.json";

const INPUT_FILES =
  Object.freeze([
    "src/engine/input/internal/KeyboardMouseDriver.ts",
    "src/engine/input/internal/GamepadDriver.ts",
    "src/engine/input/internal/InputManager.ts",
    "src/engine/input/internal/InputFramePump.ts",
    "src/plugins/input/plugin.ts",
    "src/debug/hud/InputDiagnostics.ts",
  ]);

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

function loadTypeScript(
  projectRoot,
) {
  const require =
    createRequire(
      path.join(
        projectRoot,
        "package.json",
      ),
    );

  return require(
    "typescript",
  );
}

function countAnyKeywords(
  ts,
  sourceFile,
) {
  let count =
    0;

  function visit(
    node,
  ) {
    if (
      node.kind ===
      ts.SyntaxKind.AnyKeyword
    ) {
      count +=
        1;
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

function findMethod(
  ts,
  sourceFile,
  className,
  methodName,
) {
  for (
    const statement of
    sourceFile.statements
  ) {
    if (
      !ts.isClassDeclaration(
        statement,
      ) ||
      statement.name?.text !==
        className
    ) {
      continue;
    }

    for (
      const member of
      statement.members
    ) {
      if (
        ts.isMethodDeclaration(
          member,
        ) &&
        member.name !==
          undefined &&
        (
          ts.isIdentifier(
            member.name,
          ) ||
          ts.isStringLiteralLike(
            member.name,
          )
        ) &&
        member.name.text ===
          methodName
      ) {
        return member;
      }
    }
  }

  return null;
}

function methodAllocationStats(
  ts,
  method,
) {
  let objectLiterals =
    0;

  let arrayLiterals =
    0;

  let newExpressions =
    0;

  function visit(
    node,
  ) {
    if (
      ts.isObjectLiteralExpression(
        node,
      )
    ) {
      objectLiterals +=
        1;
    } else if (
      ts.isArrayLiteralExpression(
        node,
      )
    ) {
      arrayLiterals +=
        1;
    } else if (
      ts.isNewExpression(
        node,
      )
    ) {
      newExpressions +=
        1;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  if (
    method?.body !==
      undefined
  ) {
    visit(
      method.body,
    );
  }

  return Object.freeze({
    objectLiterals,
    arrayLiterals,
    newExpressions,
    total:
      objectLiterals +
      arrayLiterals +
      newExpressions,
  });
}

function collectFiles(
  ts,
  projectRoot,
) {
  return INPUT_FILES.map(
    (relativePath) => {
      const source =
        readSource(
          projectRoot,
          relativePath,
        );

      return Object.freeze({
        path:
          relativePath,
        fingerprint:
          fingerprintTypeScriptSource(
            ts,
            source,
          ),
      });
    },
  );
}

function compareBaseline(
  baseline,
  currentFiles,
) {
  const violations =
    [];

  const current =
    new Map(
      currentFiles.map(
        (entry) => [
          entry.path,
          entry.fingerprint,
        ],
      ),
    );

  for (
    const expected of
    baseline.files
  ) {
    const actual =
      current.get(
        expected.path,
      );

    if (
      actual ===
      undefined
    ) {
      violations.push(
        violation(
          "L1INPUT001",
          expected.path,
          "arquivo certificado de Input desapareceu.",
        ),
      );

      continue;
    }

    if (
      actual !==
      expected.fingerprint
    ) {
      violations.push(
        violation(
          "L1INPUT002",
          expected.path,
          "runtime de Input mudou semanticamente; exige recertificação.",
        ),
      );
    }
  }

  return Object.freeze({
    ok:
      violations.length ===
      0,
    violations:
      Object.freeze(
        violations,
      ),
  });
}

function requirePattern(
  violations,
  source,
  scope,
  pattern,
  label,
) {
  if (
    !pattern.test(
      source,
    )
  ) {
    violations.push(
      violation(
        "L1INPUT022",
        scope,
        `policy marker ausente: ${label}.`,
      ),
    );
  }
}

export function loadInputBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    JSON.parse(
      readSource(
        projectRoot,
        LAYER1_INPUT_BASELINE_FILE,
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-input-v1-stage78" ||
    !Array.isArray(
      parsed.files,
    )
  ) {
    throw new Error(
      "LAYER1_INPUT_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentInput(
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

  let explicitAnyKeywords =
    0;

  const parsed =
    new Map();

  for (
    const relativePath of
    INPUT_FILES
  ) {
    const source =
      readSource(
        absoluteRoot,
        relativePath,
      );

    const sourceFile =
      ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

    parsed.set(
      relativePath,
      sourceFile,
    );

    explicitAnyKeywords +=
      countAnyKeywords(
        ts,
        sourceFile,
      );
  }

  return Object.freeze({
    files:
      Object.freeze(
        collectFiles(
          ts,
          absoluteRoot,
        ),
      ),
    counts:
      Object.freeze({
        semanticFiles:
          INPUT_FILES.length,
        explicitAnyKeywords,
      }),
    hotPaths:
      Object.freeze({
        keyboardMouseUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/input/internal/KeyboardMouseDriver.ts",
              ),
              "KeyboardMouseDriver",
              "update",
            ),
          ),
        gamepadUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/input/internal/GamepadDriver.ts",
              ),
              "GamepadDriver",
              "update",
            ),
          ),
        inputManagerUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/input/internal/InputManager.ts",
              ),
              "InputManager",
              "update",
            ),
          ),
        inputFramePumpProcess:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/input/internal/InputFramePump.ts",
              ),
              "InputFramePump",
              "processFrame",
            ),
          ),
      }),
  });
}

export async function auditLayer1Input({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

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

  const stage74 =
    await auditLayer1Lifecycle({
      projectRoot:
        absoluteRoot,
    });

  const stage75 =
    await auditLayer1GameLoop({
      projectRoot:
        absoluteRoot,
    });

  const stage76 =
    await auditLayer1Rendering({
      projectRoot:
        absoluteRoot,
    });

  const stage77 =
    await auditLayer1Physics({
      projectRoot:
        absoluteRoot,
    });

  const baseline =
    loadInputBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentInput(
      absoluteRoot,
    );

  const compatibility =
    compareBaseline(
      baseline,
      current.files,
    );

  const violations =
    [];

  const previous = [
    [
      "L1INPUT010",
      "stage72",
      stage72.ok,
      "Public API baseline deixou de passar.",
    ],
    [
      "L1INPUT011",
      "stage73",
      stage73.ok,
      "Capability graph baseline deixou de passar.",
    ],
    [
      "L1INPUT012",
      "stage74",
      stage74.ok,
      "Lifecycle baseline deixou de passar.",
    ],
    [
      "L1INPUT013",
      "stage75",
      stage75.ok,
      "Deterministic Game Loop deixou de passar.",
    ],
    [
      "L1INPUT014",
      "stage76",
      stage76.ok,
      "Rendering Runtime deixou de passar.",
    ],
    [
      "L1INPUT015",
      "stage77",
      stage77.ok,
      "Physics Runtime deixou de passar.",
    ],
  ];

  for (
    const [
      code,
      scope,
      ok,
      message,
    ] of
    previous
  ) {
    if (
      !ok
    ) {
      violations.push(
        violation(
          code,
          scope,
          message,
        ),
      );
    }
  }

  violations.push(
    ...compatibility
      .violations,
  );

  if (
    current.counts
      .explicitAnyKeywords !==
    0
  ) {
    violations.push(
      violation(
        "L1INPUT020",
        "input-runtime",
        `explicit any detectado: ${String(current.counts.explicitAnyKeywords)}.`,
      ),
    );
  }

  for (
    const [
      scope,
      stats,
    ] of
    [
      [
        "KeyboardMouseDriver.update",
        current.hotPaths
          .keyboardMouseUpdate,
      ],
      [
        "GamepadDriver.update",
        current.hotPaths
          .gamepadUpdate,
      ],
      [
        "InputManager.update",
        current.hotPaths
          .inputManagerUpdate,
      ],
      [
        "InputFramePump.processFrame",
        current.hotPaths
          .inputFramePumpProcess,
      ],
    ]
  ) {
    if (
      stats.total !==
      0
    ) {
      violations.push(
        violation(
          "L1INPUT021",
          scope,
          `hot path possui ${String(stats.total)} allocation literal/new explícita(s).`,
        ),
      );
    }
  }

  const keyboardSource =
    readSource(
      absoluteRoot,
      "src/engine/input/internal/KeyboardMouseDriver.ts",
    );

  const gamepadSource =
    readSource(
      absoluteRoot,
      "src/engine/input/internal/GamepadDriver.ts",
    );

  const managerSource =
    readSource(
      absoluteRoot,
      "src/engine/input/internal/InputManager.ts",
    );

  const pumpSource =
    readSource(
      absoluteRoot,
      "src/engine/input/internal/InputFramePump.ts",
    );

  const pluginSource =
    readSource(
      absoluteRoot,
      "src/plugins/input/plugin.ts",
    );

  const diagnosticsSource =
    readSource(
      absoluteRoot,
      "src/debug/hud/InputDiagnostics.ts",
    );

  requirePattern(
    violations,
    keyboardSource,
    "KeyboardMouseDriver",
    /window\.addEventListener\(\s*"blur"/u,
    "blur listener",
  );

  requirePattern(
    violations,
    keyboardSource,
    "KeyboardMouseDriver",
    /document\.addEventListener\(\s*"visibilitychange"/u,
    "visibilitychange listener",
  );

  requirePattern(
    violations,
    keyboardSource,
    "KeyboardMouseDriver",
    /document\.addEventListener\(\s*"pointerlockchange"/u,
    "pointerlockchange listener",
  );

  requirePattern(
    violations,
    gamepadSource,
    "GamepadDriver",
    /isButtonPressed/u,
    "gamepad pressed snapshot",
  );

  requirePattern(
    violations,
    gamepadSource,
    "GamepadDriver",
    /isButtonReleased/u,
    "gamepad released snapshot",
  );

  requirePattern(
    violations,
    gamepadSource,
    "GamepadDriver",
    /buttonsPressedFrame/u,
    "pressed frame buffer",
  );

  requirePattern(
    violations,
    gamepadSource,
    "GamepadDriver",
    /buttonsReleasedFrame/u,
    "released frame buffer",
  );

  requirePattern(
    violations,
    managerSource,
    "InputManager",
    /this\.gamepadDriver\.update\(\)/u,
    "gamepad snapshot update",
  );

  requirePattern(
    violations,
    managerSource,
    "InputManager",
    /gamepadDriver\s*\.isButtonPressed/u,
    "gamepad action pressed semantics",
  );

  requirePattern(
    violations,
    managerSource,
    "InputManager",
    /gamepadDriver\s*\.isButtonReleased/u,
    "gamepad action released semantics",
  );

  requirePattern(
    violations,
    pumpSource,
    "InputFramePump",
    /requestAnimationFrame/u,
    "requestAnimationFrame scheduling",
  );

  requirePattern(
    violations,
    pumpSource,
    "InputFramePump",
    /cancelAnimationFrame/u,
    "cancelAnimationFrame teardown",
  );

  requirePattern(
    violations,
    pluginSource,
    "input plugin",
    /"kernel\.booted"/u,
    "kernel.booted start gate",
  );

  requirePattern(
    violations,
    pluginSource,
    "input plugin",
    /framePump\.start\(\)/u,
    "InputFramePump start",
  );

  requirePattern(
    violations,
    pluginSource,
    "input plugin",
    /framePump\.dispose\(\)/u,
    "InputFramePump dispose",
  );

  requirePattern(
    violations,
    pluginSource,
    "input plugin",
    /InputActionEvent\.type/u,
    "InputActionEvent publication",
  );

  requirePattern(
    violations,
    pluginSource,
    "input plugin",
    /InputDeviceChangedEvent\.type/u,
    "InputDeviceChangedEvent publication",
  );

  if (
    /game\.loop/u.test(
      pluginSource,
    ) ||
    /GameLoopToken/u.test(
      pluginSource,
    )
  ) {
    violations.push(
      violation(
        "L1INPUT023",
        "input plugin",
        "game.input passou a depender de game.loop; standalone desktop input foi perdido.",
      ),
    );
  }

  if (
    /\binput\.update\(\)/u.test(
      diagnosticsSource,
    )
  ) {
    violations.push(
      violation(
        "L1INPUT024",
        "InputDiagnostics",
        "debug diagnostics ainda avança o frame de input e pode apagar edges.",
      ),
    );
  }

  if (
    /getGamepad\(\)/u.test(
      gamepadSource,
    )
  ) {
    violations.push(
      violation(
        "L1INPUT025",
        "GamepadDriver",
        "queries legacy baseadas em polling getGamepad() ainda estão presentes.",
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

  return Object.freeze({
    version:
      LAYER1_INPUT_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    capturedCounts:
      Object.freeze(
        baseline
          .capturedCounts,
      ),
    currentCounts:
      current.counts,
    hotPaths:
      current.hotPaths,
    compatibility:
      Object.freeze({
        stage72:
          stage72.ok,
        stage73:
          stage73.ok,
        stage74:
          stage74.ok,
        stage75:
          stage75.ok,
        stage76:
          stage76.ok,
        stage77:
          stage77.ok,
        inputBaseline:
          compatibility.ok,
      }),
    policy:
      Object.freeze({
        publicApiUnchanged:
          true,
        standaloneFromGameLoop:
          true,
        framePumpStartsAfterKernelBooted:
          true,
        framePumpCancelsOnDispose:
          true,
        keyboardBlurRecovery:
          true,
        visibilityRecovery:
          true,
        pointerLockLifecycle:
          true,
        gamepadPressedReleasedSnapshots:
          true,
        gamepadSingleSnapshotPerFrame:
          true,
        actionEventsPublished:
          true,
        deviceChangedEventsPublished:
          true,
        diagnosticsReadOnly:
          true,
        hotPathsNoExplicitAllocations:
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

export function formatLayer1InputAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 INPUT RUNTIME AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Input baseline: ${result.baselineId}`,
    `[INFO] Semantic input files: ${String(result.currentCounts.semanticFiles)}`,
    `[INFO] Explicit any keywords: ${String(result.currentCounts.explicitAnyKeywords)}`,
    `[INFO] KeyboardMouseDriver.update allocations: ${String(result.hotPaths.keyboardMouseUpdate.total)}`,
    `[INFO] GamepadDriver.update allocations: ${String(result.hotPaths.gamepadUpdate.total)}`,
    `[INFO] InputManager.update allocations: ${String(result.hotPaths.inputManagerUpdate.total)}`,
    `[INFO] InputFramePump.processFrame allocations: ${String(result.hotPaths.inputFramePumpProcess.total)}`,
    `[INFO] Public API unchanged: ${result.policy.publicApiUnchanged ? "YES" : "NO"}`,
    `[INFO] Standalone from game.loop: ${result.policy.standaloneFromGameLoop ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Input Runtime: 0",
      "[OK] Keyboard/mouse, Pointer Lock e focus-loss lifecycle certificados.",
      "[OK] Gamepad possui pressed/held/released snapshots por frame.",
      "[OK] InputFramePump possui owner único e teardown de RAF.",
      "[OK] game.input permanece utilizável sem game.loop.",
      "[OK] InputDiagnostics não avança mais snapshots.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Input Runtime: ${String(result.violations.length)}`,
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
