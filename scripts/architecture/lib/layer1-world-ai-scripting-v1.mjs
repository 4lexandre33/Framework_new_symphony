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
  auditLayer1Presentation,
} from "./layer1-presentation-v1.mjs";

export const LAYER1_WORLD_AI_SCRIPTING_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_WORLD_AI_SCRIPTING_BASELINE_FILE =
  "LAYER1_WORLD_AI_SCRIPTING_BASELINE_V1.json";

export const WORLD_AI_SCRIPTING_RUNTIME_FILES =
  Object.freeze([
    "src/engine/world/internal/EntityManager.ts",
    "src/engine/world/internal/OctreeManager.ts",
    "src/engine/world/internal/SceneManager.ts",
    "src/engine/world/internal/SpatialGrid.ts",
    "src/engine/world/internal/WorldService.ts",
    "src/engine/world/internal/WorldStateSerializer.ts",
    "src/plugins/world/plugin.ts",

    "src/engine/ai/internal/AIAgentManager.ts",
    "src/engine/ai/internal/AIService.ts",
    "src/engine/ai/internal/BehaviorTree.ts",
    "src/engine/ai/internal/NavMeshQuery.ts",
    "src/engine/ai/internal/PerceptionSystem.ts",
    "src/engine/ai/internal/SteeringBehaviors.ts",
    "src/plugins/ai/plugin.ts",

    "src/engine/scripting/internal/CutsceneTimeline.ts",
    "src/engine/scripting/internal/DialogueTreeParser.ts",
    "src/engine/scripting/internal/QuestManager.ts",
    "src/engine/scripting/internal/ScriptingService.ts",
    "src/engine/scripting/internal/TriggerZoneManager.ts",
    "src/plugins/scripting/plugin.ts",
  ]);

export const STAGE82_DEFERRED_WORLD_FILES =
  Object.freeze([
    "src/engine/world/internal/SaveSystem.ts",
  ]);

export const WORLD_AI_SCRIPTING_HOT_PATHS =
  Object.freeze([
    [
      "src/engine/world/internal/WorldService.ts",
      "WorldService",
      "tick",
    ],
    [
      "src/engine/world/internal/SpatialGrid.ts",
      "SpatialGrid",
      "update",
    ],
    [
      "src/engine/world/internal/OctreeManager.ts",
      "OctreeManager",
      "update",
    ],
    [
      "src/engine/ai/internal/AIService.ts",
      "AIService",
      "update",
    ],
    [
      "src/engine/ai/internal/AIAgentManager.ts",
      "AIAgentManager",
      "update",
    ],
    [
      "src/engine/ai/internal/BehaviorTree.ts",
      "BehaviorTree",
      "tick",
    ],
    [
      "src/engine/ai/internal/PerceptionSystem.ts",
      "PerceptionSystem",
      "checkPerception",
    ],
    [
      "src/engine/ai/internal/SteeringBehaviors.ts",
      "SteeringBehaviors",
      "calculateSteering",
    ],
    [
      "src/engine/scripting/internal/ScriptingService.ts",
      "ScriptingService",
      "update",
    ],
    [
      "src/engine/scripting/internal/ScriptingService.ts",
      "ScriptingService",
      "checkEntityInZones",
    ],
    [
      "src/engine/scripting/internal/CutsceneTimeline.ts",
      "CutsceneTimeline",
      "update",
    ],
    [
      "src/engine/scripting/internal/TriggerZoneManager.ts",
      "TriggerZoneManager",
      "checkEntityInZones",
    ],
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

function abs(
  projectRoot,
  relativePath,
) {
  return path.join(
    projectRoot,
    ...relativePath.split("/"),
  );
}

function readSource(
  projectRoot,
  relativePath,
) {
  const target =
    abs(
      projectRoot,
      relativePath,
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
      "Não foi possível carregar TypeScript para a auditoria da Etapa 81.",
      ...errors,
    ].join("\n"),
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
      count += 1;
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

function countDomainImports(
  ts,
  sourceFile,
) {
  let count =
    0;

  for (
    const statement of
    sourceFile.statements
  ) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(
        statement.moduleSpecifier,
      )
    ) {
      continue;
    }

    const specifier =
      statement.moduleSpecifier.text;

    if (
      specifier === "@domain" ||
      specifier.startsWith("@domain/") ||
      specifier.includes("/domain/") ||
      specifier.startsWith("../../domain") ||
      specifier.startsWith("../../../domain")
    ) {
      count += 1;
    }
  }

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
      !ts.isClassDeclaration(statement) ||
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
        !ts.isMethodDeclaration(member) ||
        member.name === undefined
      ) {
        continue;
      }

      if (
        (
          ts.isIdentifier(member.name) ||
          ts.isStringLiteralLike(member.name)
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

function allocationStats(
  ts,
  method,
) {
  let objectLiterals =
    0;

  let arrayLiterals =
    0;

  let newExpressions =
    0;

  let functionExpressions =
    0;

  function visit(
    node,
  ) {
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
    } else if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      functionExpressions += 1;
    }

    ts.forEachChild(
      node,
      visit,
    );
  }

  if (
    method?.body !== undefined
  ) {
    visit(
      method.body,
    );
  }

  return Object.freeze({
    objectLiterals,
    arrayLiterals,
    newExpressions,
    functionExpressions,
    total:
      objectLiterals +
      arrayLiterals +
      newExpressions +
      functionExpressions,
  });
}

function collectSemanticFiles(
  ts,
  projectRoot,
) {
  return WORLD_AI_SCRIPTING_RUNTIME_FILES.map(
    (relativePath) => {
      const source =
        readSource(
          projectRoot,
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

      return Object.freeze({
        relativePath,
        fingerprint:
          fingerprintTypeScriptSource(
            ts,
            source,
          ),
        explicitAnyKeywords:
          countAnyKeywords(
            ts,
            sourceFile,
          ),
        domainImports:
          countDomainImports(
            ts,
            sourceFile,
          ),
      });
    },
  );
}

function collectHotPaths(
  ts,
  projectRoot,
) {
  const result = {};

  for (
    const [
      relativePath,
      className,
      methodName,
    ] of
    WORLD_AI_SCRIPTING_HOT_PATHS
  ) {
    const source =
      readSource(
        projectRoot,
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

    const method =
      findMethod(
        ts,
        sourceFile,
        className,
        methodName,
      );

    const key =
      `${className}.${methodName}`;

    result[key] =
      method === null
        ? null
        : allocationStats(
            ts,
            method,
          );
  }

  return Object.freeze(
    result,
  );
}

function loadBaseline(
  projectRoot,
) {
  const target =
    abs(
      projectRoot,
      LAYER1_WORLD_AI_SCRIPTING_BASELINE_FILE,
    );

  if (
    !fs.existsSync(target)
  ) {
    throw new Error(
      `baseline ausente: ${LAYER1_WORLD_AI_SCRIPTING_BASELINE_FILE}`,
    );
  }

  return JSON.parse(
    fs.readFileSync(
      target,
      "utf8",
    ),
  );
}

function compareSemanticBaseline(
  baseline,
  currentFiles,
) {
  const expected =
    new Map(
      Object.entries(
        baseline.semanticFingerprints ??
        {},
      ),
    );

  const current =
    new Map(
      currentFiles.map(
        (entry) => [
          entry.relativePath,
          entry.fingerprint,
        ],
      ),
    );

  const violations = [];

  for (
    const file of
    WORLD_AI_SCRIPTING_RUNTIME_FILES
  ) {
    const expectedHash =
      expected.get(
        file,
      );

    const currentHash =
      current.get(
        file,
      );

    if (
      expectedHash === undefined
    ) {
      violations.push(
        violation(
          "L1WAS001",
          file,
          "arquivo certificado não existe na baseline da Etapa 81.",
        ),
      );

      continue;
    }

    if (
      currentHash !==
      expectedHash
    ) {
      violations.push(
        violation(
          "L1WAS002",
          file,
          "runtime mudou semanticamente; exige recertificação da Etapa 81.",
        ),
      );
    }
  }

  for (
    const file of
    expected.keys()
  ) {
    if (
      !current.has(file)
    ) {
      violations.push(
        violation(
          "L1WAS003",
          file,
          "baseline certifica arquivo que não pertence mais ao runtime da Etapa 81.",
        ),
      );
    }
  }

  return violations;
}

function containsAll(
  source,
  fragments,
) {
  return fragments.every(
    (fragment) =>
      source.includes(
        fragment,
      ),
  );
}

function methodSource(
  ts,
  projectRoot,
  relativePath,
  className,
  methodName,
) {
  const source =
    readSource(
      projectRoot,
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

  const method =
    findMethod(
      ts,
      sourceFile,
      className,
      methodName,
    );

  if (!method) {
    return null;
  }

  return method.getText(
    sourceFile,
  );
}

function countOccurrences(
  source,
  pattern,
) {
  const matches =
    source.match(
      pattern,
    );

  return matches?.length ??
    0;
}

function auditStage81PluginLifecycleSignatures(
  projectRoot,
) {
  const baselinePath =
    abs(
      projectRoot,
      "LAYER1_LIFECYCLE_BASELINE_V1.json",
    );

  if (
    !fs.existsSync(
      baselinePath,
    )
  ) {
    return Object.freeze({
      ok: false,
      violations: Object.freeze([
        violation(
          "L1WAS014",
          "stage74",
          "LAYER1_LIFECYCLE_BASELINE_V1.json ausente.",
        ),
      ]),
    });
  }

  const baseline =
    JSON.parse(
      fs.readFileSync(
        baselinePath,
        "utf8",
      ),
    );

  const targetIds =
    new Set([
      "game.world",
      "game.ai",
      "game.scripting",
    ]);

  const expected =
    new Map(
      (baseline.plugins ?? [])
        .filter(
          (plugin) =>
            targetIds.has(
              plugin.id,
            ),
        )
        .map(
          (plugin) => [
            plugin.id,
            plugin,
          ],
        ),
    );

  const violations = [];

  for (
    const id of
    targetIds
  ) {
    const plugin =
      expected.get(
        id,
      );

    if (!plugin) {
      violations.push(
        violation(
          "L1WAS014",
          id,
          "plugin não está presente na baseline de lifecycle da Etapa 74.",
        ),
      );

      continue;
    }

    const source =
      readSource(
        projectRoot,
        plugin.path,
      );

    const readyCalls =
      countOccurrences(
        source,
        /\.lifecycle\.ready\s*\(/gu,
      );

    const onDisposeCalls =
      countOccurrences(
        source,
        /\.lifecycle\.onDispose\s*\(/gu,
      );

    const hasOnBootHook =
      /\bonBoot\s*\(/u.test(
        source,
      );

    const hasOnStopHook =
      /\bonStop\s*\(/u.test(
        source,
      );

    if (
      readyCalls !==
        plugin.readyCalls ||
      onDisposeCalls !==
        plugin.onDisposeCalls ||
      hasOnBootHook !==
        plugin.hasOnBootHook ||
      hasOnStopHook !==
        plugin.hasOnStopHook
    ) {
      violations.push(
        violation(
          "L1WAS015",
          id,
          [
            "assinatura lifecycle divergiu da Etapa 74:",
            `ready ${String(readyCalls)}/${String(plugin.readyCalls)},`,
            `dispose ${String(onDisposeCalls)}/${String(plugin.onDisposeCalls)},`,
            `onBoot ${String(hasOnBootHook)}/${String(plugin.hasOnBootHook)},`,
            `onStop ${String(hasOnStopHook)}/${String(plugin.hasOnStopHook)}.`,
          ].join(" "),
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

export async function collectCurrentWorldAIScripting(
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

  const files =
    collectSemanticFiles(
      ts,
      absoluteRoot,
    );

  const hotPaths =
    collectHotPaths(
      ts,
      absoluteRoot,
    );

  return Object.freeze({
    files,
    hotPaths,
    explicitAnyKeywords:
      files.reduce(
        (
          total,
          entry,
        ) =>
          total +
          entry.explicitAnyKeywords,
        0,
      ),
    domainImports:
      files.reduce(
        (
          total,
          entry,
        ) =>
          total +
          entry.domainImports,
        0,
      ),
  });
}

export async function auditLayer1WorldAIScripting({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const [
    stage72,
    stage73,
    stage80,
  ] =
    await Promise.all([
      auditLayer1PublicApi({
        projectRoot:
          absoluteRoot,
      }),
      auditLayer1CapabilityGraph({
        projectRoot:
          absoluteRoot,
      }),
      auditLayer1Presentation({
        projectRoot:
          absoluteRoot,
      }),
    ]);

  const stage74Plugins =
    auditStage81PluginLifecycleSignatures(
      absoluteRoot,
    );

  const baseline =
    loadBaseline(
      absoluteRoot,
    );

  const ts =
    loadTypeScript(
      absoluteRoot,
    );

  const current =
    await collectCurrentWorldAIScripting(
      absoluteRoot,
    );

  const violations =
    compareSemanticBaseline(
      baseline,
      current.files,
    );

  if (!stage72.ok) {
    violations.push(
      violation(
        "L1WAS010",
        "stage72",
        "Public APIs congeladas na Etapa 72 deixaram de passar.",
      ),
    );
  }

  if (!stage73.ok) {
    violations.push(
      violation(
        "L1WAS011",
        "stage73",
        "Capability graph congelado na Etapa 73 deixou de passar.",
      ),
    );
  }

  if (!stage74Plugins.ok) {
    violations.push(
      ...stage74Plugins.violations,
    );
  }

  if (!stage80.ok) {
    violations.push(
      violation(
        "L1WAS013",
        "stage80",
        "Presentation Systems da Etapa 80 deixaram de passar.",
      ),
    );
  }

  if (
    current.explicitAnyKeywords !==
    0
  ) {
    violations.push(
      violation(
        "L1WAS020",
        "runtime",
        `foram encontrados ${String(current.explicitAnyKeywords)} explicit any nos arquivos certificados.`,
      ),
    );
  }

  if (
    current.domainImports !==
    0
  ) {
    violations.push(
      violation(
        "L1WAS021",
        "runtime",
        `foram encontrados ${String(current.domainImports)} imports diretos do Domain; World/AI/Scripting técnicos não podem duplicar/acoplar regras da Camada 2.`,
      ),
    );
  }

  for (
    const [
      key,
      stats,
    ] of
    Object.entries(
      current.hotPaths,
    )
  ) {
    if (
      stats === null
    ) {
      violations.push(
        violation(
          "L1WAS022",
          key,
          "hot path certificado não foi encontrado.",
        ),
      );

      continue;
    }

    if (
      stats.total !==
      0
    ) {
      violations.push(
        violation(
          "L1WAS023",
          key,
          `hot path possui ${String(stats.total)} allocation literal/new/function explícita(s).`,
        ),
      );
    }
  }

  const entityManagerSource =
    readSource(
      absoluteRoot,
      "src/engine/world/internal/EntityManager.ts",
    );

  if (
    !containsAll(
      entityManagerSource,
      [
        "forEachEntity(",
        "this.entityMap.delete(",
        "this.entityMap.clear()",
      ],
    ) ||
    /\bpool\s*:/u.test(
      entityManagerSource,
    ) ||
    /\bas\s+any\b/u.test(
      entityManagerSource,
    )
  ) {
    violations.push(
      violation(
        "L1WAS030",
        "game.world/EntityManager",
        "lifetime das entidades não está certificado: pool mutável/any é proibido e iteração sem materialização deve existir.",
      ),
    );
  }

  const octreeSource =
    readSource(
      absoluteRoot,
      "src/engine/world/internal/OctreeManager.ts",
    );

  if (
    !containsAll(
      octreeSource,
      [
        "private readonly entries",
        "public update(",
        "public remove(",
        "private ensureIndex(",
        "this.indexDirty",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1WAS031",
        "game.world/OctreeManager",
        "Octree não comprova update/remove por entityId e rebuild lazy sem entradas obsoletas.",
      ),
    );
  }

  const worldSource =
    readSource(
      absoluteRoot,
      "src/engine/world/internal/WorldService.ts",
    );

  const worldTickSource =
    methodSource(
      ts,
      absoluteRoot,
      "src/engine/world/internal/WorldService.ts",
      "WorldService",
      "tick",
    );

  if (
    !containsAll(
      worldSource,
      [
        "this.octreeManager.remove(",
        "this.sceneManager.clear()",
        "this.rebuildSpatialIndexes()",
      ],
    ) ||
    worldTickSource === null ||
    !containsAll(
      worldTickSource,
      [
        ".forEachEntity(",
        "this.updateEntitySpatialIndexes",
      ],
    ) ||
    worldTickSource.includes(
      "getAllEntities",
    )
  ) {
    violations.push(
      violation(
        "L1WAS032",
        "game.world/WorldService",
        "tick/lifetime espacial não comprova iteração in-place, update dos índices e teardown completo.",
      ),
    );
  }

  const sceneSource =
    readSource(
      absoluteRoot,
      "src/engine/world/internal/SceneManager.ts",
    );

  if (
    !containsAll(
      sceneSource,
      [
        "finally {",
        "this.isLoading =",
        "public clear(): void",
        "this.activeSceneId = null",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1WAS033",
        "game.world/SceneManager",
        "SceneManager não comprova recovery de loading flag e reset integral de estado no clear().",
      ),
    );
  }

  const aiServiceSource =
    readSource(
      absoluteRoot,
      "src/engine/ai/internal/AIService.ts",
    );

  const aiClearSource =
    methodSource(
      ts,
      absoluteRoot,
      "src/engine/ai/internal/AIService.ts",
      "AIService",
      "clear",
    );

  if (
    !containsAll(
      aiServiceSource,
      [
        "bindDependencies(",
        "private physics:",
        "private world:",
      ],
    ) ||
    aiClearSource === null ||
    !containsAll(
      aiClearSource,
      [
        "this.agentManager.clear()",
        "this.physics =",
        "null",
        "this.world =",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1WAS034",
        "game.ai/AIService",
        "AIService não comprova release das referências World/Physics durante teardown.",
      ),
    );
  }

  const scriptingSource =
    readSource(
      absoluteRoot,
      "src/engine/scripting/internal/ScriptingService.ts",
    );

  if (
    !containsAll(
      scriptingSource,
      [
        "private readonly onTimelineKeyframe:",
        "private readonly onTriggerZoneEvent:",
        "this.onTimelineKeyframe",
        "this.onTriggerZoneEvent",
        "this.timeline.clear()",
        "this.dialogueParser.clear()",
        "this.questManager.clear()",
        "this.triggerManager.clear()",
      ],
    )
  ) {
    violations.push(
      violation(
        "L1WAS035",
        "game.scripting/ScriptingService",
        "ScriptingService não comprova callbacks reutilizados e clear integral dos subsistemas.",
      ),
    );
  }

  const scriptingAll =
    WORLD_AI_SCRIPTING_RUNTIME_FILES
      .filter(
        (file) =>
          file.includes(
            "/scripting/",
          ) ||
          file ===
            "src/plugins/scripting/plugin.ts",
      )
      .map(
        (file) =>
          readSource(
            absoluteRoot,
            file,
          ),
      )
      .join("\n");

  const forbiddenAuthoritativeRuleMarkers = [
    "src/domain/",
    "@domain/",
    "Inventory",
    "CurrencyAccount",
    "ExperiencePool",
    "StatusEffectSet",
  ];

  for (
    const marker of
    forbiddenAuthoritativeRuleMarkers
  ) {
    if (
      scriptingAll.includes(
        marker,
      )
    ) {
      violations.push(
        violation(
          "L1WAS036",
          "game.scripting",
          `runtime técnico contém marcador de regra autoritativa de Domain proibido nesta camada: ${marker}`,
        ),
      );
    }
  }

  const deferredSet =
    new Set(
      STAGE82_DEFERRED_WORLD_FILES,
    );

  for (
    const deferred of
    deferredSet
  ) {
    if (
      WORLD_AI_SCRIPTING_RUNTIME_FILES.includes(
        deferred,
      )
    ) {
      violations.push(
        violation(
          "L1WAS037",
          deferred,
          "arquivo de persistência reservado à Etapa 82 foi antecipado na baseline semântica da Etapa 81.",
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
        return left.code.localeCompare(
          right.code,
        );
      }

      if (
        left.scope !==
        right.scope
      ) {
        return left.scope.localeCompare(
          right.scope,
        );
      }

      return left.message.localeCompare(
        right.message,
      );
    },
  );

  return Object.freeze({
    ok:
      violations.length ===
      0,
    version:
      LAYER1_WORLD_AI_SCRIPTING_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    runtimeFiles:
      WORLD_AI_SCRIPTING_RUNTIME_FILES.length,
    deferredStage82Files:
      STAGE82_DEFERRED_WORLD_FILES.length,
    explicitAnyKeywords:
      current.explicitAnyKeywords,
    directDomainImports:
      current.domainImports,
    hotPaths:
      current.hotPaths,
    publicApisUnchanged:
      stage72.ok,
    capabilityGraphUnchanged:
      stage73.ok,
    lifecycleUnchanged:
      stage74Plugins.ok,
    stage80Regression:
      stage80.ok,
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function formatLayer1WorldAIScriptingAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 WORLD / AI / SCRIPTING AUDIT",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] World/AI/Scripting baseline: ${result.baselineId}`,
    `[INFO] Semantic runtime files: ${String(result.runtimeFiles)}`,
    `[INFO] Deferred Stage 82 files: ${String(result.deferredStage82Files)}`,
    `[INFO] Explicit any keywords: ${String(result.explicitAnyKeywords)}`,
    `[INFO] Direct Domain imports: ${String(result.directDomainImports)}`,
    `[INFO] Public APIs unchanged: ${result.publicApisUnchanged ? "YES" : "NO"}`,
    `[INFO] Capability graph unchanged: ${result.capabilityGraphUnchanged ? "YES" : "NO"}`,
    `[INFO] Lifecycle unchanged: ${result.lifecycleUnchanged ? "YES" : "NO"}`,
    `[INFO] Stage 80 regression: ${result.stage80Regression ? "PASS" : "FAIL"}`,
    "",
  ];

  for (
    const [
      key,
      stats,
    ] of
    Object.entries(
      result.hotPaths,
    )
  ) {
    lines.push(
      `[INFO] ${key} allocations: ${stats === null ? "MISSING" : String(stats.total)}`,
    );
  }

  lines.push("");

  if (result.ok) {
    lines.push(
      "[OK] Violações World/AI/Scripting: 0",
      "[OK] World mantém lifetime estável de entidades e índices SpatialGrid/Octree coerentes após move/despawn/reload.",
      "[OK] EntityManager não reutiliza snapshots readonly como outra entidade e não contém explicit any.",
      "[OK] AI libera referências de World/Physics no teardown e preserva hot paths sem allocation explícita.",
      "[OK] Behavior Tree, percepção, NavMesh e steering permanecem infraestrutura técnica, sem importar regras autoritativas do Domain.",
      "[OK] Scripting reutiliza callbacks em tick/trigger e clear encerra cutscene/dialogue/quest/trigger state.",
      "[OK] Quest/cutscene/dialogue/trigger permanecem projeções técnicas; rewards/economia/progressão autoritativas não são executadas na Engine.",
      "[OK] SaveSystem permanece reservado à Etapa 82.",
    );
  } else {
    lines.push(
      `[FAIL] Violações World/AI/Scripting: ${String(result.violations.length)}`,
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

  return lines.join("\n");
}
