import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditLayer1PublicApi,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

import {
  auditLayer1Lifecycle,
} from "./layer1-lifecycle-v1.mjs";

export const LAYER1_NETWORKING_AUDIT_VERSION =
  "1.0.1";

export const NETWORKING_BASELINE_ID =
  "layer1-networking-v1-stage83";

export const NETWORKING_BASELINE_FILE =
  "LAYER1_NETWORKING_BASELINE_V1.json";

export const NETWORKING_RUNTIME_FILES =
  Object.freeze([
    "src/engine/net/internal/NetworkPacketValidator.ts",
    "src/engine/net/internal/NetworkTransport.ts",
    "src/engine/net/internal/WebSocketTransport.ts",
    "src/engine/net/internal/SteamP2PTransport.ts",
    "src/engine/net/internal/StateReplicator.ts",
    "src/engine/net/internal/NetworkService.ts",
  ]);

export const NETWORKING_PUBLIC_FILES =
  Object.freeze([
    "src/contracts/net/types.ts",
    "src/tokens/net.ts",
    "src/engine/net/public/index.ts",
  ]);

export const NETWORKING_PLUGIN_FILE =
  "src/plugins/net/plugin.ts";

const FORBIDDEN_IMPORT_PREFIXES =
  Object.freeze([
    "src/domain/",
    "src/services/",
    "src/app/",
  ]);

const FORBIDDEN_SOURCE_PATTERNS =
  Object.freeze([
    "Math.random(",
    "setInterval(",
    "setTimeout(",
  ]);

function abs(
  root,
  relativePath,
) {
  return path.join(
    root,
    ...relativePath.split("/"),
  );
}

function normalizePath(
  value,
) {
  return value
    .split(path.sep)
    .join("/");
}

function normalizeSource(
  source,
) {
  return source
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map(
      (line) =>
        line.replace(/[ \t]+$/gu, ""),
    )
    .join("\n")
    .trim() +
    "\n";
}

export function fingerprintNetworkingSource(
  source,
) {
  return crypto
    .createHash("sha256")
    .update(
      normalizeSource(source),
      "utf8",
    )
    .digest("hex");
}

function readText(
  root,
  relativePath,
) {
  return fs.readFileSync(
    abs(root, relativePath),
    "utf8",
  );
}

function loadBaseline(
  root,
) {
  return JSON.parse(
    readText(
      root,
      NETWORKING_BASELINE_FILE,
    ),
  );
}

function addViolation(
  violations,
  code,
  pathValue,
  message,
) {
  violations.push({
    code,
    path: pathValue,
    message,
  });
}

function verifyFiles(
  root,
  violations,
) {
  for (
    const relativePath of
    [
      ...NETWORKING_RUNTIME_FILES,
      ...NETWORKING_PUBLIC_FILES,
      NETWORKING_PLUGIN_FILE,
    ]
  ) {
    const target =
      abs(root, relativePath);

    if (
      !fs.existsSync(target) ||
      !fs.statSync(target).isFile()
    ) {
      addViolation(
        violations,
        "NET001",
        relativePath,
        "Arquivo obrigatório de networking ausente.",
      );
    }
  }
}

function extractStaticSpecifiers(
  source,
) {
  const specifiers = [];

  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];

  for (const pattern of patterns) {
    let match =
      pattern.exec(source);

    while (match) {
      if (match[1]) {
        specifiers.push(match[1]);
      }

      match =
        pattern.exec(source);
    }
  }

  return specifiers;
}

function resolveRelativeImport(
  root,
  importer,
  specifier,
) {
  if (
    !specifier.startsWith(".")
  ) {
    return specifier;
  }

  const importerDir =
    path.dirname(
      abs(root, importer),
    );

  return normalizePath(
    path.relative(
      root,
      path.resolve(
        importerDir,
        specifier,
      ),
    ),
  );
}

function verifyRuntimeImports(
  root,
  violations,
) {
  for (
    const relativePath of
    NETWORKING_RUNTIME_FILES
  ) {
    const source =
      readText(root, relativePath);

    for (
      const specifier of
      extractStaticSpecifiers(source)
    ) {
      const resolved =
        resolveRelativeImport(
          root,
          relativePath,
          specifier,
        );

      for (
        const forbiddenPrefix of
        FORBIDDEN_IMPORT_PREFIXES
      ) {
        if (
          resolved.startsWith(
            forbiddenPrefix,
          )
        ) {
          addViolation(
            violations,
            "NET002",
            relativePath,
            `Import proibido para ${resolved}.`,
          );
        }
      }

      if (
        resolved.startsWith(
          "src/engine/",
        ) &&
        resolved.includes(
          "/internal",
        ) &&
        !resolved.startsWith(
          "src/engine/net/internal",
        )
      ) {
        addViolation(
          violations,
          "NET003",
          relativePath,
          `Cross-module internal import proibido: ${resolved}.`,
        );
      }
    }

    for (
      const forbiddenPattern of
      FORBIDDEN_SOURCE_PATTERNS
    ) {
      if (
        source.includes(
          forbiddenPattern,
        )
      ) {
        addViolation(
          violations,
          "NET004",
          relativePath,
          `Padrão proibido em networking runtime: ${forbiddenPattern}`,
        );
      }
    }
  }
}

function requireSnippet(
  root,
  relativePath,
  snippet,
  violations,
) {
  const source =
    readText(root, relativePath);

  if (!source.includes(snippet)) {
    addViolation(
      violations,
      "NET005",
      relativePath,
      `Invariante ausente: ${snippet}`,
    );
  }
}

function verifySemantics(
  root,
  violations,
) {
  requireSnippet(
    root,
    "src/engine/net/internal/NetworkPacketValidator.ts",
    "MAX_NETWORK_PACKET_BYTES",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/WebSocketTransport.ts",
    "NETWORK_BACKPRESSURE_HIGH_WATER_BYTES",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/WebSocketTransport.ts",
    "this.socket.send(data);",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/SteamP2PTransport.ts",
    "STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/SteamP2PTransport.ts",
    "pendingSendBytes",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/StateReplicator.ts",
    "isNewerSequence",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/StateReplicator.ts",
    "entityIds.sort();",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/NetworkService.ts",
    "pollInFlight",
    violations,
  );

  requireSnippet(
    root,
    "src/engine/net/internal/NetworkService.ts",
    "this.stateReplicator.clear();",
    violations,
  );
}

function countMatches(
  source,
  pattern,
) {
  return Array.from(
    source.matchAll(pattern),
  ).length;
}

function verifyPluginLifecycleSignature(
  root,
  expected,
  violations,
) {
  const source =
    readText(
      root,
      NETWORKING_PLUGIN_FILE,
    );

  const actual = {
    readyCalls:
      countMatches(
        source,
        /\.ready\s*\(/gu,
      ),
    onDisposeCalls:
      countMatches(
        source,
        /\.onDispose\s*\(/gu,
      ),
    onBootHooks:
      countMatches(
        source,
        /\bonBoot\s*\(/gu,
      ),
    onStopHooks:
      countMatches(
        source,
        /\bonStop\s*\(/gu,
      ),
  };

  for (
    const [key, value] of
    Object.entries(expected)
  ) {
    if (
      actual[key] !==
      value
    ) {
      addViolation(
        violations,
        "NET006",
        NETWORKING_PLUGIN_FILE,
        `Lifecycle ${key} esperado=${String(value)} atual=${String(actual[key])}.`,
      );
    }
  }

  return actual;
}

function verifyBaseline(
  root,
  baseline,
  violations,
) {
  if (
    baseline.baselineId !==
    NETWORKING_BASELINE_ID
  ) {
    addViolation(
      violations,
      "NET007",
      NETWORKING_BASELINE_FILE,
      `baselineId inválido: ${String(baseline.baselineId)}.`,
    );

    return;
  }

  const expected =
    baseline.semanticFingerprints ??
    {};

  const expectedPaths =
    Object.keys(expected).sort();

  const runtimePaths =
    [...NETWORKING_RUNTIME_FILES].sort();

  if (
    JSON.stringify(expectedPaths) !==
    JSON.stringify(runtimePaths)
  ) {
    addViolation(
      violations,
      "NET008",
      NETWORKING_BASELINE_FILE,
      "Baseline não cobre exatamente os runtimes certificados da Etapa 83.",
    );

    return;
  }

  for (
    const relativePath of
    NETWORKING_RUNTIME_FILES
  ) {
    const actual =
      fingerprintNetworkingSource(
        readText(root, relativePath),
      );

    if (
      actual !==
      expected[relativePath]
    ) {
      addViolation(
        violations,
        "NET009",
        relativePath,
        "Fingerprint semântico difere da baseline da Etapa 83.",
      );
    }
  }
}

export async function auditLayer1Networking({
  projectRoot =
    process.cwd(),
} = {}) {
  const root =
    path.resolve(projectRoot);

  const violations = [];

  verifyFiles(
    root,
    violations,
  );

  const baseline =
    loadBaseline(root);

  if (
    violations.length ===
    0
  ) {
    verifyRuntimeImports(
      root,
      violations,
    );

    verifySemantics(
      root,
      violations,
    );

    verifyBaseline(
      root,
      baseline,
      violations,
    );
  }

  const pluginLifecycle =
    violations.some(
      (item) =>
        item.path ===
        NETWORKING_PLUGIN_FILE &&
        item.code ===
        "NET001",
    )
      ? {
          readyCalls: 0,
          onDisposeCalls: 0,
          onBootHooks: 0,
          onStopHooks: 0,
        }
      : verifyPluginLifecycleSignature(
          root,
          baseline.pluginLifecycleSignature ??
            {},
          violations,
        );

  const publicApi =
    await auditLayer1PublicApi({
      projectRoot: root,
    });

  if (!publicApi.ok) {
    addViolation(
      violations,
      "NET010",
      "LAYER1_PUBLIC_API_BASELINE_V1.json",
      "Public API baseline canônica da Etapa 72 não permanece verde.",
    );
  }

  const capabilityGraph =
    await auditLayer1CapabilityGraph({
      projectRoot: root,
    });

  if (!capabilityGraph.ok) {
    addViolation(
      violations,
      "NET011",
      "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
      "Capability graph canônico da Etapa 73 não permanece verde.",
    );
  }

  const lifecycle =
    await auditLayer1Lifecycle({
      projectRoot: root,
    });

  if (!lifecycle.ok) {
    addViolation(
      violations,
      "NET012",
      "LAYER1_LIFECYCLE_BASELINE_V1.json",
      "Lifecycle baseline canônica da Etapa 74 não permanece verde.",
    );
  }

  return {
    version:
      LAYER1_NETWORKING_AUDIT_VERSION,

    stage: 83,

    baselineId:
      NETWORKING_BASELINE_ID,

    ok:
      violations.length ===
      0,

    violations,

    counts: {
      runtimeFiles:
        NETWORKING_RUNTIME_FILES.length,
      publicFiles:
        NETWORKING_PUBLIC_FILES.length,
      pluginFiles: 1,
      publicApiViolations:
        publicApi.violations
          ?.length ??
        0,
      capabilityGraphViolations:
        capabilityGraph.violations
          ?.length ??
        0,
      lifecycleViolations:
        lifecycle.violations
          ?.length ??
        0,
    },

    pluginLifecycle,

    compatibility: {
      publicApiStage72:
        publicApi.ok,
      capabilityGraphStage73:
        capabilityGraph.ok,
      lifecycleStage74:
        lifecycle.ok,
    },

    policy: {
      packetValidation: true,
      boundedPacketSize: true,
      boundedSteamPoll: true,
      transportBackpressure: true,
      disconnectClearsReplication: true,
      reconnectSupported: true,
      publicApiFrozenByStage72:
        publicApi.ok,
      capabilityGraphFrozenByStage73:
        capabilityGraph.ok,
      lifecycleFrozenByStage74:
        lifecycle.ok,
      domainRuleOwnership:
        "forbidden-in-network-runtime",
    },
  };
}

export function formatLayer1NetworkingAudit(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — LAYER 1 NETWORKING RUNTIME AUDIT V1",
    "============================================================",
    `status: ${result.ok ? "PASS" : "FAIL"}`,
    `runtime files: ${String(result.counts.runtimeFiles)}`,
    `public files: ${String(result.counts.publicFiles)}`,
    `plugin files: ${String(result.counts.pluginFiles)}`,
    `public api violations: ${String(result.counts.publicApiViolations)}`,
    `capability graph violations: ${String(result.counts.capabilityGraphViolations)}`,
    `lifecycle violations: ${String(result.counts.lifecycleViolations)}`,
    `plugin lifecycle: ready=${String(result.pluginLifecycle.readyCalls)} dispose=${String(result.pluginLifecycle.onDisposeCalls)} onBoot=${String(result.pluginLifecycle.onBootHooks)} onStop=${String(result.pluginLifecycle.onStopHooks)}`,
  ];

  if (
    result.violations.length >
    0
  ) {
    lines.push(
      "",
      "VIOLAÇÕES:",
    );

    for (
      const violation of
      result.violations
    ) {
      lines.push(
        `- [${violation.code}] ${violation.path}: ${violation.message}`,
      );
    }
  } else {
    lines.push(
      "",
      "[OK] Public API validada pela baseline canônica da Etapa 72.",
      "[OK] Capability graph validado pela baseline canônica da Etapa 73.",
      "[OK] Lifecycle validado pela baseline canônica da Etapa 74.",
      "[OK] Runtime game.net certificado sem ownership de regras de Domain.",
    );
  }

  return lines.join("\n");
}
