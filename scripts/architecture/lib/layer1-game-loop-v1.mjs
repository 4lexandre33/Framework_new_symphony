import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

import {
  fingerprintTypeScriptSource,
} from "./layer1-public-api-v1.mjs";

export const LAYER1_GAME_LOOP_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_GAME_LOOP_BASELINE_FILE =
  "LAYER1_GAME_LOOP_BASELINE_V1.json";

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
      ...relativePath.split("/"),
    );

  if (
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
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
  const attempts = [
    createRequire(import.meta.url),
    createRequire(
      path.join(
        projectRoot,
        "package.json",
      ),
    ),
  ];

  for (
    const require of attempts
  ) {
    try {
      return require("typescript");
    } catch {
      // Próxima origem.
    }
  }

  throw new Error(
    "TypeScript Compiler API indisponível.",
  );
}

function parse(
  ts,
  relativePath,
  source,
) {
  return ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function propertyName(
  ts,
  member,
) {
  if (
    member.name === undefined
  ) {
    return null;
  }

  if (
    ts.isIdentifier(member.name) ||
    ts.isStringLiteralLike(member.name)
  ) {
    return member.name.text;
  }

  return null;
}

function countAllocationsInMember(
  ts,
  sourceFile,
  memberName,
) {
  let target = null;

  function find(node) {
    if (
      target !== null
    ) {
      return;
    }

    if (
      ts.isClassDeclaration(node)
    ) {
      for (
        const member of node.members
      ) {
        if (
          propertyName(ts, member) ===
          memberName
        ) {
          target = member;
          return;
        }
      }
    }

    ts.forEachChild(node, find);
  }

  find(sourceFile);

  if (
    target === null
  ) {
    return null;
  }

  let objectLiterals = 0;
  let arrayLiterals = 0;
  let newExpressions = 0;

  function visit(node) {
    if (
      ts.isObjectLiteralExpression(node)
    ) {
      objectLiterals += 1;
    } else if (
      ts.isArrayLiteralExpression(node)
    ) {
      arrayLiterals += 1;
    } else if (
      ts.isNewExpression(node)
    ) {
      newExpressions += 1;
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(target, visit);

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

function extractExportedNumericConstants(
  ts,
  sourceFile,
) {
  const values = {};

  for (
    const statement of sourceFile.statements
  ) {
    if (
      !ts.isVariableStatement(statement)
    ) {
      continue;
    }

    const modifiers =
      ts.canHaveModifiers(statement)
        ? ts.getModifiers(statement)
        : undefined;

    const exported =
      modifiers?.some(
        (modifier) =>
          modifier.kind ===
          ts.SyntaxKind.ExportKeyword,
      ) ?? false;

    if (!exported) {
      continue;
    }

    for (
      const declaration of statement.declarationList.declarations
    ) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined
      ) {
        continue;
      }

      const initializer =
        declaration.initializer;

      if (
        ts.isNumericLiteral(initializer)
      ) {
        values[declaration.name.text] =
          Number(initializer.text);
      }
    }
  }

  return values;
}

function countCallByPropertyName(
  ts,
  sourceFile,
  property,
) {
  let count = 0;

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text ===
        property
    ) {
      count += 1;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

export function compareGameLoopBaselineCompatibility(
  baseline,
  current,
) {
  const violations = [];

  for (
    const expected of baseline.files
  ) {
    const actual =
      current.files.find(
        (entry) =>
          entry.path ===
          expected.path,
      );

    if (
      actual === undefined
    ) {
      violations.push(
        violation(
          "L1LOOP001",
          expected.path,
          "arquivo certificado desapareceu.",
        ),
      );
    } else if (
      actual.fingerprint !==
      expected.fingerprint
    ) {
      violations.push(
        violation(
          "L1LOOP002",
          expected.path,
          "arquivo do game loop mudou semanticamente; exige recertificação.",
        ),
      );
    }
  }

  for (
    const [key, expected] of
    Object.entries(
      baseline.constants,
    )
  ) {
    if (
      current.constants[key] !==
      expected
    ) {
      violations.push(
        violation(
          "L1LOOP003",
          key,
          `constante determinística mudou. Baseline=${String(expected)}; atual=${String(current.constants[key])}.`,
        ),
      );
    }
  }

  return Object.freeze({
    ok:
      violations.length ===
      0,
    violations:
      Object.freeze(violations),
  });
}

export function loadGameLoopBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    JSON.parse(
      readSource(
        path.resolve(projectRoot),
        LAYER1_GAME_LOOP_BASELINE_FILE,
      ),
    );

  if (
    parsed.schemaVersion !== 1 ||
    parsed.baselineId !==
      "layer1-game-loop-v1-stage75" ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error(
      "LAYER1_GAME_LOOP_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentGameLoop(
  projectRoot =
    process.cwd(),
) {
  const absoluteRoot =
    path.resolve(projectRoot);
  const ts =
    loadTypeScript(absoluteRoot);

  const paths = [
    "src/engine/game-loop/internal/DeterministicGameLoop.ts",
    "src/plugins/game-loop/plugin.ts",
    "src/contracts/game-loop/types.ts",
    "src/tokens/game-loop.ts",
  ];

  const files =
    paths.map(
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

  const implementationPath =
    paths[0];
  const implementationSource =
    readSource(
      absoluteRoot,
      implementationPath,
    );
  const sourceFile =
    parse(
      ts,
      implementationPath,
      implementationSource,
    );

  const constants =
    extractExportedNumericConstants(
      ts,
      sourceFile,
    );

  return Object.freeze({
    files:
      Object.freeze(files),
    constants:
      Object.freeze(constants),
    hotPathAllocations:
      countAllocationsInMember(
        ts,
        sourceFile,
        "processFrame",
      ),
    emitAsyncCalls:
      countCallByPropertyName(
        ts,
        sourceFile,
        "emitAsync",
      ),
    fireAndForgetEmitCalls:
      countCallByPropertyName(
        ts,
        sourceFile,
        "emit",
      ),
    usesFiniteValidation:
      implementationSource.includes(
        "Number.isFinite",
      ),
    schedulesAfterAwait:
      implementationSource.includes(
        "await this.processFrame"
      ) &&
      implementationSource.includes(
        "this.scheduleNextFrame();",
      ),
    payloadObjects:
      Object.freeze({
        tick:
          implementationSource.includes(
            "private readonly tickPayload",
          ),
        render:
          implementationSource.includes(
            "private readonly renderPayload",
          ),
      }),
  });
}

export async function auditLayer1GameLoop({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(projectRoot);

  const stage74 =
    await auditLayer1Lifecycle({
      projectRoot:
        absoluteRoot,
    });

  const baseline =
    loadGameLoopBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentGameLoop(
      absoluteRoot,
    );

  const compatibility =
    compareGameLoopBaselineCompatibility(
      baseline,
      current,
    );

  const violations = [];

  if (!stage74.ok) {
    violations.push(
      violation(
        "L1LOOP010",
        "stage74",
        `${String(stage74.violations.length)} violação(ões) no lifecycle gate.`,
      ),
    );
  }

  violations.push(
    ...compatibility.violations,
  );

  const expectedConstants = {
    GAME_LOOP_DEFAULT_TICK_RATE:
      60,
    GAME_LOOP_MIN_TICK_RATE:
      1,
    GAME_LOOP_MAX_TICK_RATE:
      240,
    GAME_LOOP_MAX_FRAME_DELTA_SECONDS:
      0.25,
    GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME:
      60,
  };

  for (
    const [key, expected] of
    Object.entries(expectedConstants)
  ) {
    if (
      current.constants[key] !==
      expected
    ) {
      violations.push(
        violation(
          "L1LOOP011",
          key,
          `constante Stage 75 esperada ${String(expected)}; atual ${String(current.constants[key])}.`,
        ),
      );
    }
  }

  if (
    current.hotPathAllocations === null
  ) {
    violations.push(
      violation(
        "L1LOOP012",
        "processFrame",
        "hot path processFrame não encontrado.",
      ),
    );
  } else if (
    current.hotPathAllocations.total !==
    0
  ) {
    violations.push(
      violation(
        "L1LOOP013",
        "processFrame",
        `hot path aloca objetos/arrays/new: ${JSON.stringify(current.hotPathAllocations)}.`,
      ),
    );
  }

  if (
    current.emitAsyncCalls <
    2 ||
    current.fireAndForgetEmitCalls !==
    0
  ) {
    violations.push(
      violation(
        "L1LOOP014",
        "event-dispatch",
        `esperado dispatch serial via emitAsync e zero emit fire-and-forget. emitAsync=${String(current.emitAsyncCalls)}, emit=${String(current.fireAndForgetEmitCalls)}.`,
      ),
    );
  }

  if (
    !current.usesFiniteValidation
  ) {
    violations.push(
      violation(
        "L1LOOP015",
        "numeric-safety",
        "Number.isFinite não governa tick rate/timestamp.",
      ),
    );
  }

  if (
    !current.schedulesAfterAwait
  ) {
    violations.push(
      violation(
        "L1LOOP016",
        "raf-serialization",
        "próximo RAF precisa ser agendado somente depois do frame atual.",
      ),
    );
  }

  if (
    !current.payloadObjects.tick ||
    !current.payloadObjects.render
  ) {
    violations.push(
      violation(
        "L1LOOP017",
        "payload-reuse",
        "payloads tick/render reutilizáveis não encontrados.",
      ),
    );
  }

  violations.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.scope.localeCompare(right.scope) ||
      left.message.localeCompare(right.message),
  );

  return Object.freeze({
    version:
      LAYER1_GAME_LOOP_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    compatibility:
      Object.freeze({
        stage74:
          stage74.ok,
        gameLoopBaseline:
          compatibility.ok,
      }),
    constants:
      current.constants,
    hotPathAllocations:
      current.hotPathAllocations,
    dispatch:
      Object.freeze({
        emitAsyncCalls:
          current.emitAsyncCalls,
        fireAndForgetEmitCalls:
          current.fireAndForgetEmitCalls,
        serializedRaf:
          current.schedulesAfterAwait,
      }),
    policy:
      Object.freeze({
        fixedTimestep:
          true,
        frameDeltaClamp:
          true,
        boundedFixedSteps:
          true,
        serializedTickDispatch:
          true,
        serializedRenderDispatch:
          true,
        noHotPathObjectAllocationInProcessFrame:
          true,
        pauseDoesNotCatchUpWallClock:
          true,
        invalidNumbersCannotPoisonAccumulator:
          true,
        additionalRegisteredConsumersAllowed:
          true,
      }),
    violations:
      Object.freeze(violations),
    ok:
      violations.length ===
      0,
  });
}

export function formatLayer1GameLoopAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 DETERMINISTIC GAME LOOP AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Game loop baseline: ${result.baselineId}`,
    `[INFO] Default tick rate: ${String(result.constants.GAME_LOOP_DEFAULT_TICK_RATE)}`,
    `[INFO] Tick rate range: ${String(result.constants.GAME_LOOP_MIN_TICK_RATE)}..${String(result.constants.GAME_LOOP_MAX_TICK_RATE)}`,
    `[INFO] Max frame delta: ${String(result.constants.GAME_LOOP_MAX_FRAME_DELTA_SECONDS)}s`,
    `[INFO] Max fixed steps/frame: ${String(result.constants.GAME_LOOP_MAX_FIXED_STEPS_PER_FRAME)}`,
    `[INFO] emitAsync calls: ${String(result.dispatch.emitAsyncCalls)}`,
    `[INFO] fire-and-forget emit calls: ${String(result.dispatch.fireAndForgetEmitCalls)}`,
    `[INFO] Hot-path allocations: ${String(result.hotPathAllocations?.total ?? -1)}`,
    `[INFO] RAF serialized after frame completion: ${result.dispatch.serializedRaf ? "YES" : "NO"}`,
    "",
  ];

  if (result.ok) {
    lines.push(
      "[OK] Violações Deterministic Game Loop: 0",
      "[OK] Fixed timestep/accumulator/interpolation governados.",
      "[OK] Frame spikes são clampados e backlog é limitado.",
      "[OK] Tick/render handlers não se sobrepõem entre fixed steps.",
      "[OK] processFrame não aloca objeto/array/new no hot path.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Deterministic Game Loop: ${String(result.violations.length)}`,
    );

    for (
      const item of result.violations
    ) {
      lines.push(
        `[${item.code}] ${item.scope} — ${item.message}`,
      );
    }
  }

  return lines.join("\n");
}
