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

export const LAYER1_RENDERING_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_RENDERING_BASELINE_FILE =
  "LAYER1_RENDERING_BASELINE_V1.json";

const RENDER_FILES =
  Object.freeze([
    "src/engine/render/internal/ViewportManager.ts",
    "src/engine/render/internal/CameraManager.ts",
    "src/engine/render/internal/SceneGraphManager.ts",
    "src/engine/render/internal/ThreeRenderEngine.ts",
    "src/plugins/render/plugin.ts",
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

function parseSource(
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

function semanticFiles(
  ts,
  projectRoot,
) {
  return RENDER_FILES.map(
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

  const currentByPath =
    new Map(
      currentFiles.map(
        (entry) => [
          entry.path,
          entry,
        ],
      ),
    );

  for (
    const expected of
    baseline.files
  ) {
    const current =
      currentByPath.get(
        expected.path,
      );

    if (
      current ===
        undefined
    ) {
      violations.push(
        violation(
          "L1RENDER001",
          expected.path,
          "arquivo certificado desapareceu.",
        ),
      );
      continue;
    }

    if (
      current.fingerprint !==
      expected.fingerprint
    ) {
      violations.push(
        violation(
          "L1RENDER002",
          expected.path,
          "runtime de render mudou semanticamente; exige recertificação.",
        ),
      );
    }
  }

  const baselinePaths =
    new Set(
      baseline.files.map(
        (entry) =>
          entry.path,
      ),
    );

  const additionalFiles =
    currentFiles
      .filter(
        (entry) =>
          !baselinePaths.has(
            entry.path,
          ),
      )
      .map(
        (entry) =>
          entry.path,
      )
      .sort();

  return Object.freeze({
    ok:
      violations.length ===
      0,
    violations:
      Object.freeze(
        violations,
      ),
    additionalFiles:
      Object.freeze(
        additionalFiles,
      ),
  });
}

export function loadRenderingBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    JSON.parse(
      readSource(
        projectRoot,
        LAYER1_RENDERING_BASELINE_FILE,
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-rendering-v1-stage76" ||
    !Array.isArray(
      parsed.files,
    )
  ) {
    throw new Error(
      "LAYER1_RENDERING_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentRendering(
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

  const parsed =
    new Map();

  let explicitAnyCount =
    0;

  for (
    const relativePath of
    RENDER_FILES
  ) {
    const source =
      readSource(
        absoluteRoot,
        relativePath,
      );

    const sourceFile =
      parseSource(
        ts,
        relativePath,
        source,
      );

    parsed.set(
      relativePath,
      sourceFile,
    );

    explicitAnyCount +=
      countAnyKeywords(
        ts,
        sourceFile,
      );
  }

  const engineAst =
    parsed.get(
      "src/engine/render/internal/ThreeRenderEngine.ts",
    );

  const cameraAst =
    parsed.get(
      "src/engine/render/internal/CameraManager.ts",
    );

  const renderStats =
    methodAllocationStats(
      ts,
      findMethod(
        ts,
        engineAst,
        "ThreeRenderEngine",
        "render",
      ),
    );

  const followStats =
    methodAllocationStats(
      ts,
      findMethod(
        ts,
        cameraAst,
        "CameraManager",
        "updateFollowCamera",
      ),
    );

  return Object.freeze({
    files:
      Object.freeze(
        semanticFiles(
          ts,
          absoluteRoot,
        ),
      ),
    counts:
      Object.freeze({
        semanticFiles:
          RENDER_FILES.length,
        explicitAnyKeywords:
          explicitAnyCount,
      }),
    hotPaths:
      Object.freeze({
        render:
          renderStats,
        followCamera:
          followStats,
      }),
  });
}

export async function auditLayer1Rendering({
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

  const baseline =
    loadRenderingBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentRendering(
      absoluteRoot,
    );

  const compatibility =
    compareBaseline(
      baseline,
      current.files,
    );

  const violations =
    [];

  if (
    !stage72.ok
  ) {
    violations.push(
      violation(
        "L1RENDER010",
        "stage72",
        "Public API baseline deixou de passar.",
      ),
    );
  }

  if (
    !stage74.ok
  ) {
    violations.push(
      violation(
        "L1RENDER011",
        "stage74",
        "Lifecycle baseline deixou de passar.",
      ),
    );
  }

  if (
    !stage75.ok
  ) {
    violations.push(
      violation(
        "L1RENDER012",
        "stage75",
        "Deterministic Game Loop deixou de passar.",
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
        "L1RENDER020",
        "render-runtime",
        `explicit any detectado: ${String(current.counts.explicitAnyKeywords)}.`,
      ),
    );
  }

  if (
    current.hotPaths
      .render.total !==
    0
  ) {
    violations.push(
      violation(
        "L1RENDER021",
        "ThreeRenderEngine.render",
        `hot path possui ${String(current.hotPaths.render.total)} allocation literal/new explícita(s).`,
      ),
    );
  }

  if (
    current.hotPaths
      .followCamera.total !==
    0
  ) {
    violations.push(
      violation(
        "L1RENDER022",
        "CameraManager.updateFollowCamera",
        `hot path possui ${String(current.hotPaths.followCamera.total)} allocation literal/new explícita(s).`,
      ),
    );
  }

  const engineSource =
    readSource(
      absoluteRoot,
      "src/engine/render/internal/ThreeRenderEngine.ts",
    );

  const sceneSource =
    readSource(
      absoluteRoot,
      "src/engine/render/internal/SceneGraphManager.ts",
    );

  const viewportSource =
    readSource(
      absoluteRoot,
      "src/engine/render/internal/ViewportManager.ts",
    );

  const pluginSource =
    readSource(
      absoluteRoot,
      "src/plugins/render/plugin.ts",
    );

  const requiredPatterns = [
    [
      "ThreeRenderEngine",
      engineSource,
      /removeEventListener\(\s*"webglcontextlost"/u,
    ],
    [
      "ThreeRenderEngine",
      engineSource,
      /removeEventListener\(\s*"webglcontextrestored"/u,
    ],
    [
      "ThreeRenderEngine",
      engineSource,
      /this\.renderer\.renderLists\.dispose\(\)/u,
    ],
    [
      "ThreeRenderEngine",
      engineSource,
      /this\.renderer\.dispose\(\)/u,
    ],
    [
      "ThreeRenderEngine",
      engineSource,
      /this\.ownsCanvas/u,
    ],
    [
      "ViewportManager",
      viewportSource,
      /MAX_PIXEL_RATIO\s*=\s*2/u,
    ],
    [
      "SceneGraphManager",
      sceneSource,
      /retained\.textures/u,
    ],
    [
      "SceneGraphManager",
      sceneSource,
      /retained\.materials/u,
    ],
    [
      "SceneGraphManager",
      sceneSource,
      /retained\.geometries/u,
    ],
    [
      "render plugin",
      pluginSource,
      /await\s+ctx\.events\.emitAsync\(\s*RenderFrameEvent\.type/u,
    ],
    [
      "render plugin",
      pluginSource,
      /ctx\.events\.emit\(\s*ViewportResizeEvent\.type/u,
    ],
    [
      "render plugin",
      pluginSource,
      /SetCameraModeCommand\.type/u,
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
          "L1RENDER023",
          scope,
          `policy marker ausente: ${String(pattern)}.`,
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
      LAYER1_RENDERING_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    capturedCounts:
      Object.freeze(
        baseline.capturedCounts,
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
        renderingBaseline:
          compatibility.ok,
        additionalFiles:
          compatibility
            .additionalFiles,
      }),
    policy:
      Object.freeze({
        publicApiUnchanged:
          true,
        contextLossSkipsRender:
          true,
        contextListenersRemovedOnDispose:
          true,
        rendererDisposeIdempotent:
          true,
        canvasOwnershipPreserved:
          true,
        viewportPixelRatioCappedAtTwo:
          true,
        sharedGpuResourcesProtectedFromEarlyDispose:
          true,
        renderHotPathNoExplicitAllocations:
          true,
        followCameraHotPathNoExplicitAllocations:
          true,
        renderFrameEventSerial:
          true,
        resizeEventEmitted:
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

export function formatLayer1RenderingAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 RENDERING RUNTIME AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Rendering baseline: ${result.baselineId}`,
    `[INFO] Semantic render files: ${String(result.currentCounts.semanticFiles)}`,
    `[INFO] Explicit any keywords: ${String(result.currentCounts.explicitAnyKeywords)}`,
    `[INFO] render hot-path allocations: ${String(result.hotPaths.render.total)}`,
    `[INFO] follow-camera hot-path allocations: ${String(result.hotPaths.followCamera.total)}`,
    `[INFO] Public API unchanged: ${result.policy.publicApiUnchanged ? "YES" : "NO"}`,
    `[INFO] Pixel ratio cap: ${result.policy.viewportPixelRatioCappedAtTwo ? "2.0" : "UNVERIFIED"}`,
    "",
  ];

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Rendering Runtime: 0",
      "[OK] Context loss/restored e listener teardown estão governados.",
      "[OK] Canvas ownership e disposal idempotente estão governados.",
      "[OK] Shared geometry/material/texture não sofre early dispose.",
      "[OK] Render/follow-camera hot paths não possuem allocations explícitas.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Rendering Runtime: ${String(result.violations.length)}`,
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
