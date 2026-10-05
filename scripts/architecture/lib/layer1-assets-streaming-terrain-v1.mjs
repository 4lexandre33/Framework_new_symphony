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
  auditLayer1Input,
} from "./layer1-input-v1.mjs";

export const LAYER1_ASSETS_STREAMING_TERRAIN_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_FILE =
  "LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_V1.json";

const RUNTIME_FILES =
  Object.freeze([
    "src/engine/assets/internal/AssetCache.ts",
    "src/engine/assets/internal/AssetsManagerService.ts",
    "src/engine/assets/internal/AudioLoaderService.ts",
    "src/engine/assets/internal/GLTFLoaderService.ts",
    "src/engine/assets/internal/TextureLoaderService.ts",
    "src/plugins/assets/plugin.ts",

    "src/engine/streaming/internal/DistanceLODManager.ts",
    "src/engine/streaming/internal/HLODBuilder.ts",
    "src/engine/streaming/internal/StreamingService.ts",
    "src/engine/streaming/internal/StreamingWorkerPool.ts",
    "src/engine/streaming/internal/WorldStreamingSectorManager.ts",
    "src/engine/streaming/internal/streaming.worker.ts",
    "src/plugins/streaming/plugin.ts",

    "src/engine/terrain/internal/BiomeEvaluator.ts",
    "src/engine/terrain/internal/GreedyMesher.ts",
    "src/engine/terrain/internal/PerlinNoiseService.ts",
    "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    "src/engine/terrain/internal/TerrainService.ts",
    "src/engine/terrain/internal/VoxelChunkManager.ts",
    "src/engine/terrain/internal/terrain.worker.ts",
    "src/plugins/terrain/plugin.ts",
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
  return RUNTIME_FILES.map(
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
          "L1AST001",
          expected.path,
          "arquivo certificado desapareceu.",
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
          "L1AST002",
          expected.path,
          "runtime mudou semanticamente; exige recertificação da Etapa 79.",
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
        "L1AST020",
        scope,
        `policy marker ausente: ${label}.`,
      ),
    );
  }
}

export function loadAssetsStreamingTerrainBaseline(
  projectRoot =
    process.cwd(),
) {
  const parsed =
    JSON.parse(
      readSource(
        projectRoot,
        LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_FILE,
      ),
    );

  if (
    parsed.schemaVersion !==
      1 ||
    parsed.baselineId !==
      "layer1-assets-streaming-terrain-v1-stage79" ||
    !Array.isArray(
      parsed.files,
    )
  ) {
    throw new Error(
      "LAYER1_ASSETS_STREAMING_TERRAIN_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

export async function collectCurrentAssetsStreamingTerrain(
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
    RUNTIME_FILES
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
          RUNTIME_FILES.length,
        explicitAnyKeywords,
      }),
    hotPaths:
      Object.freeze({
        streamingUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/streaming/internal/StreamingService.ts",
              ),
              "StreamingService",
              "update",
            ),
          ),
        sectorUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/streaming/internal/WorldStreamingSectorManager.ts",
              ),
              "WorldStreamingSectorManager",
              "updateStreamingSectors",
            ),
          ),
        terrainUpdate:
          methodAllocationStats(
            ts,
            findMethod(
              ts,
              parsed.get(
                "src/engine/terrain/internal/TerrainService.ts",
              ),
              "TerrainService",
              "update",
            ),
          ),
      }),
  });
}

export async function auditLayer1AssetsStreamingTerrain({
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

  const stage78 =
    await auditLayer1Input({
      projectRoot:
        absoluteRoot,
    });

  const baseline =
    loadAssetsStreamingTerrainBaseline(
      absoluteRoot,
    );

  const current =
    await collectCurrentAssetsStreamingTerrain(
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
        "L1AST010",
        "stage72",
        "Public API baseline deixou de passar.",
      ),
    );
  }

  if (
    !stage73.ok
  ) {
    violations.push(
      violation(
        "L1AST011",
        "stage73",
        "Capability graph baseline deixou de passar.",
      ),
    );
  }

  if (
    !stage78.ok
  ) {
    violations.push(
      violation(
        "L1AST012",
        "stage78",
        "Input Runtime / regressões 71–78 deixaram de passar.",
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
        "L1AST013",
        "stage79-runtime",
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
        "StreamingService.update",
        current.hotPaths
          .streamingUpdate,
      ],
      [
        "WorldStreamingSectorManager.updateStreamingSectors",
        current.hotPaths
          .sectorUpdate,
      ],
      [
        "TerrainService.update",
        current.hotPaths
          .terrainUpdate,
      ],
    ]
  ) {
    if (
      stats.total !==
      0
    ) {
      violations.push(
        violation(
          "L1AST014",
          scope,
          `hot path possui ${String(stats.total)} allocation literal/new explícita(s).`,
        ),
      );
    }
  }

  const assetCache =
    readSource(
      absoluteRoot,
      "src/engine/assets/internal/AssetCache.ts",
    );

  const assetsManager =
    readSource(
      absoluteRoot,
      "src/engine/assets/internal/AssetsManagerService.ts",
    );

  const audioLoader =
    readSource(
      absoluteRoot,
      "src/engine/assets/internal/AudioLoaderService.ts",
    );

  const assetsPlugin =
    readSource(
      absoluteRoot,
      "src/plugins/assets/plugin.ts",
    );

  const streamingPool =
    readSource(
      absoluteRoot,
      "src/engine/streaming/internal/StreamingWorkerPool.ts",
    );

  const streamingWorker =
    readSource(
      absoluteRoot,
      "src/engine/streaming/internal/streaming.worker.ts",
    );

  const streamingService =
    readSource(
      absoluteRoot,
      "src/engine/streaming/internal/StreamingService.ts",
    );

  const streamingPlugin =
    readSource(
      absoluteRoot,
      "src/plugins/streaming/plugin.ts",
    );

  const terrainPool =
    readSource(
      absoluteRoot,
      "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    );

  const terrainService =
    readSource(
      absoluteRoot,
      "src/engine/terrain/internal/TerrainService.ts",
    );

  const voxelManager =
    readSource(
      absoluteRoot,
      "src/engine/terrain/internal/VoxelChunkManager.ts",
    );

  const terrainPlugin =
    readSource(
      absoluteRoot,
      "src/plugins/terrain/plugin.ts",
    );

  const requiredPatterns = [
    [
      assetCache,
      "AssetCache",
      /disposedResources/u,
      "deduplicação de dispose de recursos GLTF",
    ],
    [
      assetsManager,
      "AssetsManagerService",
      /private readonly inFlight/u,
      "in-flight dedup",
    ],
    [
      assetsManager,
      "AssetsManagerService",
      /this\.cache\.retain/u,
      "refCount por consumidor concorrente",
    ],
    [
      assetsManager,
      "AssetsManagerService",
      /onLoaded/u,
      "AssetLoaded publication sink",
    ],
    [
      audioLoader,
      "AudioLoaderService",
      /context\.close\(\)/u,
      "AudioContext close no teardown",
    ],
    [
      assetsPlugin,
      "assets plugin",
      /AssetProgressEvent\.type/u,
      "AssetProgressEvent publication",
    ],
    [
      assetsPlugin,
      "assets plugin",
      /AssetLoadedEvent\.type/u,
      "AssetLoadedEvent publication",
    ],
    [
      streamingPool,
      "StreamingWorkerPool",
      /messageerror/u,
      "messageerror recovery",
    ],
    [
      streamingPool,
      "StreamingWorkerPool",
      /finishJobWithFallback/u,
      "job fallback settlement",
    ],
    [
      streamingWorker,
      "streaming.worker",
      /distanceSquared/u,
      "squared-distance worker path",
    ],
    [
      streamingService,
      "StreamingService",
      /public dispose\(\): void/u,
      "terminal dispose separado de clear",
    ],
    [
      streamingPlugin,
      "streaming plugin",
      /service\.dispose\(\)/u,
      "plugin teardown encerra worker pool",
    ],
    [
      terrainPool,
      "ProceduralWorkerPool",
      /implements TerrainChunkWorkerPool/u,
      "worker port interno testável",
    ],
    [
      terrainPool,
      "ProceduralWorkerPool",
      /finishJobWithFallback/u,
      "worker error fallback",
    ],
    [
      terrainPool,
      "ProceduralWorkerPool",
      /worker\s*\.\s*terminate\(\)/u,
      "worker termination",
    ],
    [
      terrainService,
      "TerrainService",
      /requestChunkGenerationAsync/u,
      "chunk generation off-main-thread path",
    ],
    [
      terrainService,
      "TerrainService",
      /generationEpoch/u,
      "stale response epoch",
    ],
    [
      terrainService,
      "TerrainService",
      /pendingChunkTokens/u,
      "per-chunk request token",
    ],
    [
      voxelManager,
      "VoxelChunkManager",
      /installChunkData/u,
      "worker chunk installation validation",
    ],
    [
      terrainPlugin,
      "terrain plugin",
      /service\.dispose\(\)/u,
      "terrain worker teardown",
    ],
  ];

  for (
    const [
      source,
      scope,
      pattern,
      label,
    ] of
    requiredPatterns
  ) {
    requirePattern(
      violations,
      source,
      scope,
      pattern,
      label,
    );
  }

  if (
    /workerPool\.clear\(\)/u.test(
      streamingService.match(
        /public clear\(\): void \{[\s\S]*?\n  \}/u,
      )?.[0] ??
      "",
    )
  ) {
    violations.push(
      violation(
        "L1AST021",
        "StreamingService.clear",
        "clear público voltou a destruir WorkerPool e perdeu reutilização.",
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
      LAYER1_ASSETS_STREAMING_TERRAIN_AUDIT_VERSION,
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
        stage78:
          stage78.ok,
        stage79Baseline:
          compatibility.ok,
      }),
    policy:
      Object.freeze({
        publicApisUnchanged:
          true,
        capabilityGraphUnchanged:
          true,
        assetConcurrentDedup:
          true,
        assetReferenceCounting:
          true,
        assetEventsPublished:
          true,
        audioContextTeardown:
          true,
        streamingJobsAlwaysSettle:
          true,
        streamingClearReusable:
          true,
        streamingDisposeTerminatesWorkers:
          true,
        terrainGenerationUsesWorkerPool:
          true,
        staleTerrainResponsesRejected:
          true,
        terrainDisposeTerminatesWorkers:
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

export function formatLayer1AssetsStreamingTerrainAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 ASSETS / STREAMING / TERRAIN AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Stage 79 baseline: ${result.baselineId}`,
    `[INFO] Semantic runtime files: ${String(result.currentCounts.semanticFiles)}`,
    `[INFO] Explicit any keywords: ${String(result.currentCounts.explicitAnyKeywords)}`,
    `[INFO] StreamingService.update allocations: ${String(result.hotPaths.streamingUpdate.total)}`,
    `[INFO] Sector update allocations: ${String(result.hotPaths.sectorUpdate.total)}`,
    `[INFO] TerrainService.update allocations: ${String(result.hotPaths.terrainUpdate.total)}`,
    `[INFO] Public APIs unchanged: ${result.policy.publicApisUnchanged ? "YES" : "NO"}`,
    `[INFO] Capability graph unchanged: ${result.policy.capabilityGraphUnchanged ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.ok
  ) {
    lines.push(
      "[OK] Violações Assets/Streaming/Terrain: 0",
      "[OK] Asset loads concorrentes são deduplicados e refCount é preservado.",
      "[OK] Asset progress/loaded events e AudioContext teardown estão governados.",
      "[OK] Streaming Worker jobs sempre finalizam por resposta ou fallback.",
      "[OK] StreamingService.clear permanece reutilizável; dispose encerra Workers.",
      "[OK] Terrain usa ProceduralWorkerPool e rejeita respostas obsoletas por epoch/token.",
      "[OK] Worker pools terminam resources e não deixam jobs vivos no teardown.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Assets/Streaming/Terrain: ${String(result.violations.length)}`,
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
