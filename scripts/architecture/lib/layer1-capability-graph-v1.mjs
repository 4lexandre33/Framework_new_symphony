import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  auditLayer1Baseline,
} from "./layer1-baseline-v1.mjs";

import {
  auditLayer1PublicApi,
} from "./layer1-public-api-v1.mjs";

export const LAYER1_CAPABILITY_GRAPH_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_CAPABILITY_GRAPH_BASELINE_FILE =
  "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json";

function stableStringify(
  value,
) {
  if (
    value === null ||
    typeof value !==
      "object"
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return (
      "[" +
      value
        .map(
          stableStringify,
        )
        .join(",") +
      "]"
    );
  }

  const keys =
    Object.keys(
      value,
    )
      .sort();

  return (
    "{" +
    keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key])}`,
      )
      .join(",") +
    "}"
  );
}

function sha256Semantic(
  value,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      stableStringify(
        value,
      ),
      "utf8",
    )
    .digest(
      "hex",
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

function spawnDependencyChecker(
  projectRoot,
) {
  const checker =
    path.join(
      projectRoot,
      "scripts",
      "architecture",
      "check-dependencies.mjs",
    );

  const result =
    spawnSync(
      process.execPath,
      [
        checker,
        "--json",
      ],
      {
        cwd:
          projectRoot,
        encoding:
          "utf8",
        windowsHide:
          true,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
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
      [
        "check-dependencies.mjs não produziu JSON.",
        String(
          result.stderr ??
            "",
        ),
      ].join(
        "\n",
      ),
    );
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        stdout,
      );
  } catch (
    error
  ) {
    throw new Error(
      [
        "Saída JSON inválida de check-dependencies.mjs.",
        error instanceof Error
          ? error.message
          : String(error),
        stdout,
      ].join(
        "\n",
      ),
    );
  }

  return Object.freeze({
    status:
      result.status ??
      1,
    stderr:
      String(
        result.stderr ??
          "",
      ),
    graph:
      parsed,
  });
}

function normalizeProviderRows(
  providers,
) {
  const rows = [];

  for (
    const capability of
    providers
  ) {
    for (
      const provider of
      capability.providers
    ) {
      rows.push({
        capabilityId:
          capability
            .capabilityId,
        pluginId:
          provider.pluginId,
        kind:
          provider.kind,
        version:
          provider.version,
        priority:
          provider.priority,
      });
    }
  }

  rows.sort(
    (
      left,
      right,
    ) =>
      stableStringify(
        left,
      ).localeCompare(
        stableStringify(
          right,
        ),
      ),
  );

  return rows;
}

function normalizeRequirements(
  requirements,
) {
  return [
    ...requirements,
  ]
    .map(
      (entry) => ({
        consumerPluginId:
          entry.consumerPluginId,
        capabilityId:
          entry.capabilityId,
        range:
          entry.range,
        optional:
          entry.optional,
        providerPluginId:
          entry.providerPluginId,
        providerVersion:
          entry.providerVersion,
        providerPriority:
          entry.providerPriority,
      }),
    )
    .sort(
      (
        left,
        right,
      ) =>
        stableStringify(
          left,
        ).localeCompare(
          stableStringify(
            right,
          ),
        ),
    );
}

function normalizeOptionalUnresolved(
  entries,
) {
  return [
    ...entries,
  ]
    .map(
      (entry) => ({
        pluginId:
          entry.pluginId,
        capabilityId:
          entry.capabilityId,
        range:
          entry.range,
      }),
    )
    .sort(
      (
        left,
        right,
      ) =>
        stableStringify(
          left,
        ).localeCompare(
          stableStringify(
            right,
          ),
        ),
    );
}

export function projectCapabilityGraph(
  graph,
) {
  const activePlugins =
    graph.composition
      .activePlugins
      .map(
        (entry) => ({
          id:
            entry.id,
          version:
            entry.version,
          kind:
            entry.kind,
          path:
            entry.path,
          manifestSource:
            entry.manifestSource,
        }),
      );

  const projection = {
    architectureMigrationVersion:
      graph
        .architectureMigrationVersion,
    composition: {
      path:
        graph.composition.path,
      activePlugins,
    },
    bootOrder:
      [
        ...graph
          .bootOrder,
      ],
    providers:
      normalizeProviderRows(
        graph.providers,
      ),
    resolvedRequirements:
      normalizeRequirements(
        graph
          .resolvedRequirements,
      ),
    optionalUnresolved:
      normalizeOptionalUnresolved(
        graph
          .optionalUnresolved,
      ),
    counts: {
      plugins:
        graph.counts.plugins,
      provisions:
        graph.counts.provisions,
      providedCapabilityIds:
        graph.counts
          .providedCapabilityIds,
      requiredCapabilityRequirements:
        graph.counts
          .requiredCapabilityRequirements,
      optionalCapabilityRequirements:
        graph.counts
          .optionalCapabilityRequirements,
      resolvedCapabilityRequirements:
        graph.counts
          .resolvedCapabilityRequirements,
      optionalUnresolved:
        graph.counts
          .optionalUnresolved,
      conflictsDeclared:
        graph.counts
          .conflictsDeclared,
      pluginDependencies:
        graph.counts
          .pluginDependencies,
      requiredPluginDependencies:
        graph.counts
          .requiredPluginDependencies,
      optionalPluginDependencies:
        graph.counts
          .optionalPluginDependencies,
    },
  };

  return Object.freeze({
    ...projection,
    semanticSha256:
      sha256Semantic(
        projection,
      ),
  });
}

function mapBy(
  values,
  keyOf,
) {
  return new Map(
    values.map(
      (value) => [
        keyOf(
          value,
        ),
        value,
      ],
    ),
  );
}

function pluginKey(
  entry,
) {
  return entry.id;
}

function providerKey(
  entry,
) {
  return [
    entry.capabilityId,
    entry.pluginId,
  ].join(
    "|",
  );
}

function requirementKey(
  entry,
) {
  return [
    entry.consumerPluginId,
    entry.capabilityId,
  ].join(
    "|",
  );
}

function isSubsequence(
  expected,
  current,
) {
  let index =
    0;

  for (
    const value of
    current
  ) {
    if (
      value ===
      expected[index]
    ) {
      index +=
        1;

      if (
        index ===
        expected.length
      ) {
        return true;
      }
    }
  }

  return (
    expected.length ===
    0
  );
}

export function compareCapabilityGraphBaselineCompatibility(
  baseline,
  current,
) {
  const violations = [];

  const currentPlugins =
    mapBy(
      current.composition
        .activePlugins,
      pluginKey,
    );

  const baselinePluginIds =
    new Set();

  for (
    const expected of
    baseline.graph
      .composition
      .activePlugins
  ) {
    baselinePluginIds.add(
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
          "L1GRAPH001",
          expected.id,
          "plugin ativo da baseline desapareceu.",
        ),
      );

      continue;
    }

    for (
      const field of
      [
        "version",
        "kind",
        "path",
      ]
    ) {
      if (
        actual[field] !==
        expected[field]
      ) {
        violations.push(
          violation(
            "L1GRAPH002",
            expected.id,
            `${field} mudou sem recertificação. Baseline=${String(expected[field])}; atual=${String(actual[field])}.`,
          ),
        );
      }
    }
  }

  const additionalActivePluginIds =
    current.composition
      .activePlugins
      .filter(
        (entry) =>
          !baselinePluginIds.has(
            entry.id,
          ),
      )
      .map(
        (entry) =>
          entry.id,
      )
      .sort();

  const currentProviders =
    mapBy(
      current.providers,
      providerKey,
    );

  for (
    const expected of
    baseline.graph
      .providers
  ) {
    const key =
      providerKey(
        expected,
      );

    const actual =
      currentProviders.get(
        key,
      );

    if (
      actual ===
      undefined
    ) {
      violations.push(
        violation(
          "L1GRAPH003",
          key,
          "provider certificado pela baseline desapareceu.",
        ),
      );

      continue;
    }

    if (
      stableStringify(
        actual,
      ) !==
      stableStringify(
        expected,
      )
    ) {
      violations.push(
        violation(
          "L1GRAPH004",
          key,
          "provider certificado mudou versão/kind/priority sem recertificação.",
        ),
      );
    }
  }

  const currentRequirements =
    mapBy(
      current
        .resolvedRequirements,
      requirementKey,
    );

  for (
    const expected of
    baseline.graph
      .resolvedRequirements
  ) {
    const key =
      requirementKey(
        expected,
      );

    const actual =
      currentRequirements.get(
        key,
      );

    if (
      actual ===
      undefined
    ) {
      violations.push(
        violation(
          "L1GRAPH005",
          key,
          "requirement resolvido da baseline desapareceu.",
        ),
      );

      continue;
    }

    if (
      stableStringify(
        actual,
      ) !==
      stableStringify(
        expected,
      )
    ) {
      violations.push(
        violation(
          "L1GRAPH006",
          key,
          "requirement mudou range/optional/provider sem recertificação.",
        ),
      );
    }
  }

  if (
    !isSubsequence(
      baseline.graph
        .bootOrder,
      current
        .bootOrder,
    )
  ) {
    violations.push(
      violation(
        "L1GRAPH007",
        "boot-order",
        "ordem relativa dos plugins certificados mudou sem recertificação.",
      ),
    );
  }

  return Object.freeze({
    ok:
      violations.length ===
      0,
    additionalActivePluginIds:
      Object.freeze(
        additionalActivePluginIds,
      ),
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function loadCapabilityGraphBaseline(
  projectRoot =
    process.cwd(),
) {
  const target =
    path.join(
      path.resolve(
        projectRoot,
      ),
      LAYER1_CAPABILITY_GRAPH_BASELINE_FILE,
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
      `Capability graph baseline ausente: ${LAYER1_CAPABILITY_GRAPH_BASELINE_FILE}`,
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
      "layer1-capability-graph-v1-stage73" ||
    parsed.graph ===
      undefined
  ) {
    throw new Error(
      "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json inválido.",
    );
  }

  return parsed;
}

async function loadModuleMap(
  projectRoot,
) {
  return import(
    pathToFileURL(
      path.join(
        projectRoot,
        "scripts",
        "architecture",
        "module-map.mjs",
      ),
    ).href
  );
}

export async function auditLayer1CapabilityGraph({
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

  const baseline =
    loadCapabilityGraphBaseline(
      absoluteRoot,
    );

  const moduleMap =
    await loadModuleMap(
      absoluteRoot,
    );

  const checker =
    spawnDependencyChecker(
      absoluteRoot,
    );

  const graph =
    checker.graph;

  const current =
    projectCapabilityGraph(
      graph,
    );

  const compatibility =
    compareCapabilityGraphBaselineCompatibility(
      baseline,
      current,
    );

  const violations = [];

  if (!stage71.ok) {
    violations.push(
      violation(
        "L1GRAPH010",
        "stage71",
        `${String(stage71.violations.length)} violação(ões) na baseline Layer 1.`,
      ),
    );
  }

  if (!stage72.ok) {
    violations.push(
      violation(
        "L1GRAPH011",
        "stage72",
        `${String(stage72.violations.length)} violação(ões) na Public API baseline.`,
      ),
    );
  }

  if (
    checker.status !==
      0 ||
    graph.violations
      .length >
      0
  ) {
    violations.push(
      violation(
        "L1GRAPH012",
        "dependency-graph",
        `${String(graph.violations.length)} violação(ões) no checker de dependências.`,
      ),
    );
  }

  if (
    graph.readOnly
      .unchanged !==
    true
  ) {
    violations.push(
      violation(
        "L1GRAPH013",
        "dependency-graph",
        "check-dependencies deixou de ser read-only.",
      ),
    );
  }

  if (
    graph.cycles
      .length !==
    0
  ) {
    violations.push(
      violation(
        "L1GRAPH014",
        "dependency-graph",
        `${String(graph.cycles.length)} ciclo(s) detectado(s).`,
      ),
    );
  }

  violations.push(
    ...compatibility
      .violations,
  );

  const providerCapabilityIds =
    new Set(
      current.providers.map(
        (entry) =>
          entry.capabilityId,
      ),
    );

  const activePluginIds =
    new Set(
      current.composition
        .activePlugins
        .map(
          (entry) =>
            entry.id,
        ),
    );

  for (
    const moduleRecord of
    moduleMap
      .CANONICAL_MODULES
  ) {
    if (
      !activePluginIds.has(
        moduleRecord
          .capabilityId,
      )
    ) {
      violations.push(
        violation(
          "L1GRAPH015",
          moduleRecord.key,
          `plugin canônico não ativo pelo capabilityId primário ${moduleRecord.capabilityId}.`,
        ),
      );
    }

    if (
      !providerCapabilityIds.has(
        moduleRecord
          .capabilityId,
      )
    ) {
      violations.push(
        violation(
          "L1GRAPH016",
          moduleRecord.key,
          `primary capability sem provider ativo: ${moduleRecord.capabilityId}.`,
        ),
      );
    }
  }

  const ownedCapabilityIds =
    moduleMap
      .CANONICAL_MODULES
      .flatMap(
        (moduleRecord) =>
          moduleRecord.tokens
            .map(
              (token) =>
                token.capabilityId,
            ),
      );

  const ownedButNotProvided =
    ownedCapabilityIds
      .filter(
        (capabilityId) =>
          !providerCapabilityIds
            .has(
              capabilityId,
            ),
      )
      .sort();

  const expectedDormantSecondary =
    [
      ...baseline
        .dormantOwnedCapabilitiesAtCapture,
    ].sort();

  if (
    stableStringify(
      ownedButNotProvided,
    ) !==
    stableStringify(
      expectedDormantSecondary,
    )
  ) {
    violations.push(
      violation(
        "L1GRAPH017",
        "owned-capabilities",
        `capabilities owned porém não providas divergiram da baseline. Baseline=${expectedDormantSecondary.join(", ")}; atual=${ownedButNotProvided.join(", ")}.`,
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
      LAYER1_CAPABILITY_GRAPH_AUDIT_VERSION,
    baselineId:
      baseline.baselineId,
    capturedCounts:
      Object.freeze(
        baseline
          .capturedCounts,
      ),
    currentCounts:
      Object.freeze({
        activePlugins:
          graph.counts.plugins,
        provisions:
          graph.counts.provisions,
        providedCapabilityIds:
          graph.counts
            .providedCapabilityIds,
        requiredCapabilityRequirements:
          graph.counts
            .requiredCapabilityRequirements,
        optionalCapabilityRequirements:
          graph.counts
            .optionalCapabilityRequirements,
        resolvedCapabilityRequirements:
          graph.counts
            .resolvedCapabilityRequirements,
        conflictsDeclared:
          graph.counts
            .conflictsDeclared,
        pluginDependencies:
          graph.counts
            .pluginDependencies,
        cycles:
          graph.counts.cycles,
        providerAmbiguities:
          graph.counts
            .providerAmbiguities,
      }),
    compatibility:
      Object.freeze({
        stage71:
          stage71.ok,
        stage72:
          stage72.ok,
        graphBaseline:
          compatibility.ok,
        additionalActivePluginIds:
          compatibility
            .additionalActivePluginIds,
      }),
    registry:
      Object.freeze({
        canonicalModules:
          moduleMap
            .CANONICAL_MODULES
            .length,
        bootstrappedTooling:
          moduleMap
            .TOOLING_PLUGINS
            .filter(
              (record) =>
                record.bootstrapped ===
                true,
            )
            .length,
        inactiveExperimental:
          moduleMap
            .EXPERIMENTAL_PLUGINS
            .filter(
              (record) =>
                record.bootstrapped !==
                true,
            )
            .length,
        ownedCapabilities:
          ownedCapabilityIds
            .length,
        dormantOwnedCapabilities:
          Object.freeze(
            ownedButNotProvided,
          ),
      }),
    policy:
      Object.freeze({
        canonicalCountDerivedFromModuleMap:
          true,
        auxiliaryActivationDerivedFromModuleMap:
          true,
        additionalRegisteredPluginsAllowed:
          true,
        baselineGraphChangesRequireRecertification:
          true,
        dependencyCheckerReadOnly:
          graph.readOnly
            .unchanged ===
            true,
      }),
    graphSemanticSha256:
      current
        .semanticSha256,
    violations:
      Object.freeze(
        violations,
      ),
    ok:
      violations.length ===
      0,
  });
}

export function formatLayer1CapabilityGraphAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 PLUGIN MANIFESTS & CAPABILITY GRAPH",
    "============================================================",
    "",
    `[INFO] Audit version: ${result.version}`,
    `[INFO] Graph baseline: ${result.baselineId}`,
    `[INFO] Canonical modules: ${String(result.registry.canonicalModules)}`,
    `[INFO] Active plugins: ${String(result.currentCounts.activePlugins)}`,
    `[INFO] Provisions: ${String(result.currentCounts.provisions)}`,
    `[INFO] Provided capability IDs: ${String(result.currentCounts.providedCapabilityIds)}`,
    `[INFO] Required capability requirements: ${String(result.currentCounts.requiredCapabilityRequirements)}`,
    `[INFO] Optional capability requirements: ${String(result.currentCounts.optionalCapabilityRequirements)}`,
    `[INFO] Resolved capability requirements: ${String(result.currentCounts.resolvedCapabilityRequirements)}`,
    `[INFO] Plugin dependencies: ${String(result.currentCounts.pluginDependencies)}`,
    `[INFO] Cycles: ${String(result.currentCounts.cycles)}`,
    `[INFO] Provider ambiguities: ${String(result.currentCounts.providerAmbiguities)}`,
    `[INFO] Dormant owned capabilities: ${String(result.registry.dormantOwnedCapabilities.length)}`,
    `[INFO] Registry-derived canonical count: ${result.policy.canonicalCountDerivedFromModuleMap ? "YES" : "NO"}`,
    `[INFO] New registered plugins allowed: ${result.policy.additionalRegisteredPluginsAllowed ? "YES" : "NO"}`,
    "",
  ];

  if (
    result.registry
      .dormantOwnedCapabilities
      .length >
    0
  ) {
    lines.push(
      `[INFO] Dormant owned capability IDs: ${result.registry.dormantOwnedCapabilities.join(", ")}`,
      "",
    );
  }

  if (
    result.compatibility
      .additionalActivePluginIds
      .length >
    0
  ) {
    lines.push(
      `[INFO] Additional active plugin IDs: ${result.compatibility.additionalActivePluginIds.join(", ")}`,
      "",
    );
  }

  if (result.ok) {
    lines.push(
      "[OK] Violações Plugin Manifests / Capability Graph: 0",
      "[OK] Semver, provider priority, PluginKind e dependsOn permanecem válidos.",
      "[OK] Zero ciclos e zero provider ambiguity.",
      "[OK] Baseline graph v1 preservada e checker permanece read-only.",
    );
  } else {
    lines.push(
      `[FAIL] Violações Plugin Manifests / Capability Graph: ${String(result.violations.length)}`,
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
