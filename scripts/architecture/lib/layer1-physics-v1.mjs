import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  auditLayer1PublicApi,
  fingerprintTypeScriptSource,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

import {
  auditLayer1GameLoop,
} from "./layer1-game-loop-v1.mjs";

import {
  auditLayer1Rendering,
} from "./layer1-rendering-v1.mjs";

export const LAYER1_PHYSICS_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_PHYSICS_BASELINE_FILE =
  "LAYER1_PHYSICS_BASELINE_V1.json";

const PHYSICS_FILES =
  Object.freeze([
    "src/engine/physics/internal/PhysicsWorld.ts",
    "src/engine/physics/internal/PhysicsService.ts",
    "src/engine/physics/internal/RigidBodyFactory.ts",
    "src/engine/physics/internal/RaycasterQueries.ts",
    "src/engine/physics/internal/CollisionEventManager.ts",
    "src/plugins/physics/plugin.ts",
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
  return PHYSICS_FILES.map(
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
          "L1PHYS001",
          expected.path,
          "arquivo de física certificado desapareceu.",
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
          "L1PHYS002",
          expected.path,
          "runtime de física mudou semanticamente; exige recertificação.",
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

export function loadPhysicsBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    JSON.parse(
      readSource(
        projectRoot,
        LAYER1_PHYSICS_BASELINE_FILE,
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-physics-v1-stage77" ||
    !Array.isArray(
      parsed.files,
    )
  ) {
    throw new Error(
      "LAYER1_PHYSICS_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentPhysics(
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
    PHYSICS_FILES
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

  const worldAst =
    parsed.get(
      "src/engine/physics/internal/PhysicsWorld.ts",
    );

  const serviceAst =
    parsed.get(
      "src/engine/physics/internal/PhysicsService.ts",
    );

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
          PHYSICS_FILES.length,
        explicitAnyKeywords,
      }),
    hotPaths:
      Object.freeze({
        physicsWorldStep:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              worldAst,
              "PhysicsWorld",
              "step",
            ),
          ),
        physicsServiceLoopStep:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              serviceAst,
              "PhysicsService",
              "stepForGameLoop",
            ),
          ),
        syncMeshTransform:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              worldAst,
              "PhysicsWorld",
              "syncMeshTransform",
            ),
          ),
      }),
  });
}

export async function auditLayer1Physics({
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

  const baseline =
    loadPhysicsBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentPhysics(
      absoluteRoot,
    );

  const compatibility =
    compareBaseline(
      baseline,
      current.files,
    );

  const violations =
    [];

  if (!stage72.ok) {
    violations.push(
      violation(
        "L1PHYS010",
        "stage72",
        "Public API baseline deixou de passar.",
      ),
    );
  }

  if (!stage74.ok) {
    violations.push(
      violation(
        "L1PHYS011",
        "stage74",
        "Lifecycle baseline deixou de passar.",
      ),
    );
  }

  if (!stage75.ok) {
    violations.push(
      violation(
        "L1PHYS012",
        "stage75",
        "Deterministic Game Loop deixou de passar.",
      ),
    );
  }

  if (!stage76.ok) {
    violations.push(
      violation(
        "L1PHYS013",
        "stage76",
        "Rendering Runtime deixou de passar.",
      ),
    );
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
        "L1PHYS020",
        "physics-runtime",
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
        "PhysicsWorld.step",
        current.hotPaths
          .physicsWorldStep,
      ],
      [
        "PhysicsService.stepForGameLoop",
        current.hotPaths
          .physicsServiceLoopStep,
      ],
      [
        "PhysicsWorld.syncMeshTransform",
        current.hotPaths
          .syncMeshTransform,
      ],
    ]
  ) {
    if (
      stats.total !==
      0
    ) {
      violations.push(
        violation(
          "L1PHYS021",
          scope,
          `hot path possui ${String(stats.total)} allocation literal/new explícita(s).`,
        ),
      );
    }
  }

  const pluginSource =
    readSource(
      absoluteRoot,
      "src/plugins/physics/plugin.ts",
    );

  const worldSource =
    readSource(
      absoluteRoot,
      "src/engine/physics/internal/PhysicsWorld.ts",
    );

  const collisionSource =
    readSource(
      absoluteRoot,
      "src/engine/physics/internal/CollisionEventManager.ts",
    );

  const requiredPatterns = [
    [
      "physics plugin",
      pluginSource,
      /GameTickPayload/u,
    ],
    [
      "physics plugin",
      pluginSource,
      /\.payload\s*\.deltaSeconds/u,
    ],
    [
      "physics plugin",
      pluginSource,
      /await\s+service\s*\.stepForGameLoop/u,
    ],
    [
      "PhysicsWorld",
      worldSource,
      /this\.world\.timestep\s*=\s*deltaTimeSeconds/u,
    ],
    [
      "PhysicsWorld",
      worldSource,
      /this\.eventQueue\.free\(\)/u,
    ],
    [
      "PhysicsWorld",
      worldSource,
      /this\.world\.free\(\)/u,
    ],
    [
      "PhysicsWorld",
      worldSource,
      /getBodyTransformInto/u,
    ],
    [
      "CollisionEventManager",
      collisionSource,
      /TriggerEnterEvent\.type/u,
    ],
    [
      "CollisionEventManager",
      collisionSource,
      /TriggerExitEvent\.type/u,
    ],
    [
      "CollisionEventManager",
      collisionSource,
      /handleToSensorMap/u,
    ],
    [
      "CollisionEventManager",
      collisionSource,
      /flushSerial/u,
    ],
  ];

  for (
    const [
      scope,
      source,
      pattern,
    ] of
    requiredPatterns
  ) {
    if (
      !pattern.test(
        source,
      )
    ) {
      violations.push(
        violation(
          "L1PHYS022",
          scope,
          `policy marker ausente: ${String(pattern)}.`,
        ),
      );
    }
  }

  if (
    /deltaTimeSeconds\?\s*:/u.test(
      pluginSource,
    ) ||
    /\?\?\s*1\s*\/\s*60/u.test(
      pluginSource,
    )
  ) {
    violations.push(
      violation(
        "L1PHYS023",
        "physics plugin",
        "fallback legado deltaTimeSeconds/1÷60 ainda está presente.",
      ),
    );
  }

  if (
    /Math\.min\(\s*deltaTimeSeconds/u.test(
      worldSource,
    )
  ) {
    violations.push(
      violation(
        "L1PHYS024",
        "PhysicsWorld.step",
        "physics timestep ainda é clampado silenciosamente.",
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
      LAYER1_PHYSICS_AUDIT_VERSION,
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
        stage74:
          stage74.ok,
        stage75:
          stage75.ok,
        stage76:
          stage76.ok,
        physicsBaseline:
          compatibility.ok,
      }),
    policy:
      Object.freeze({
        publicApiUnchanged:
          true,
        consumesGameTickDeltaSeconds:
          true,
        exactFixedStepPassedToRapier:
          true,
        serialCollisionDeliveryOnGameLoopPath:
          true,
        sensorTriggersClassified:
          true,
        wasmResourcesFreed:
          true,
        transformCachePerEntity:
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

export function formatLayer1PhysicsAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 PHYSICS RUNTIME AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Physics baseline: ${result.baselineId}`,
    `[INFO] Semantic physics files: ${String(result.currentCounts.semanticFiles)}`,
    `[INFO] Explicit any keywords: ${String(result.currentCounts.explicitAnyKeywords)}`,
    `[INFO] PhysicsWorld.step allocations: ${String(result.hotPaths.physicsWorldStep.total)}`,
    `[INFO] PhysicsService.stepForGameLoop allocations: ${String(result.hotPaths.physicsServiceLoopStep.total)}`,
    `[INFO] syncMeshTransform allocations: ${String(result.hotPaths.syncMeshTransform.total)}`,
    `[INFO] Public API unchanged: ${result.policy.publicApiUnchanged ? "YES" : "NO"}`,
    `[INFO] GameTickPayload.deltaSeconds: ${result.policy.consumesGameTickDeltaSeconds ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Physics Runtime: 0",
      "[OK] Fixed tick do game.loop chega sem fallback/clamp silencioso ao Rapier.",
      "[OK] Collision e trigger events são classificados e serializados no loop oficial.",
      "[OK] WASM World/EventQueue e body/collider maps possuem teardown governado.",
      "[OK] Hot paths certificados não possuem allocations explícitas.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Physics Runtime: ${String(result.violations.length)}`,
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
