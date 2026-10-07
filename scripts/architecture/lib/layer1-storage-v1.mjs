import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  auditLayer1PublicApi,
} from "./layer1-public-api-v1.mjs";

import {
  auditLayer1CapabilityGraph,
} from "./layer1-capability-graph-v1.mjs";

export const LAYER1_STORAGE_AUDIT_VERSION =
  "1.0.0";

export const LAYER1_STORAGE_BASELINE_FILE =
  "LAYER1_STORAGE_BASELINE_V1.json";

export const STORAGE_RUNTIME_FILES =
  Object.freeze([
    "src/engine/storage/internal/StorageErrors.ts",
    "src/engine/storage/internal/KeyValueStorageBackend.ts",
    "src/engine/storage/internal/SaveRecordCodec.ts",
    "src/engine/storage/internal/KeyValueSaveDriver.ts",
    "src/engine/storage/internal/LocalDatabaseDriver.ts",
    "src/engine/storage/internal/SteamCloudDriver.ts",
    "src/engine/storage/internal/CloudDatabaseDriver.ts",
    "src/engine/storage/internal/StorageService.ts",
    "src/engine/storage/internal/DomainSaveGamePortAdapter.ts",
    "src/plugins/storage/plugin.ts",
  ]);

export const STORAGE_PUBLIC_FILES =
  Object.freeze([
    "src/contracts/storage/types.ts",
    "src/tokens/storage.ts",
    "src/engine/storage/public/index.ts",
  ]);

export const STORAGE_DOMAIN_PORT_FILES =
  Object.freeze([
    "src/domain/ports/SaveGamePort.ts",
    "src/domain/ports/DomainSaveGamePort.ts",
  ]);

export const WORLD_STATE_SERIALIZER_FILE =
  "src/engine/world/internal/WorldStateSerializer.ts";

function abs(
  projectRoot,
  relativePath,
) {
  return path.join(
    projectRoot,
    ...relativePath.split(
      "/",
    ),
  );
}

function normalizeSource(
  source,
) {
  return source
    .replace(
      /\r\n?/gu,
      "\n",
    )
    .split(
      "\n",
    )
    .map(
      (
        line,
      ) =>
        line.replace(
          /[ \t]+$/gu,
          "",
        ),
    )
    .join(
      "\n",
    )
    .trim() +
    "\n";
}

export function fingerprintStorageSource(
  source,
) {
  return crypto
    .createHash(
      "sha256",
    )
    .update(
      normalizeSource(
        source,
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}

function read(
  projectRoot,
  relativePath,
) {
  return fs.readFileSync(
    abs(
      projectRoot,
      relativePath,
    ),
    "utf8",
  );
}

function loadBaseline(
  projectRoot,
) {
  return JSON.parse(
    read(
      projectRoot,
      LAYER1_STORAGE_BASELINE_FILE,
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
    path:
      pathValue,
    message,
  });
}

function verifyFiles(
  projectRoot,
  violations,
) {
  for (
    const relativePath of
    [
      ...STORAGE_RUNTIME_FILES,
      ...STORAGE_PUBLIC_FILES,
      ...STORAGE_DOMAIN_PORT_FILES,
      WORLD_STATE_SERIALIZER_FILE,
    ]
  ) {
    const target =
      abs(
        projectRoot,
        relativePath,
      );

    if (
      !fs.existsSync(
        target,
      ) ||
      !fs.statSync(
        target,
      ).isFile()
    ) {
      addViolation(
        violations,
        "STO001",
        relativePath,
        "Arquivo obrigatório de storage ausente.",
      );
    }
  }
}

function verifyRuntimePolicy(
  projectRoot,
  violations,
) {
  for (
    const relativePath of
    STORAGE_RUNTIME_FILES
  ) {
    const source =
      read(
        projectRoot,
        relativePath,
      );

    if (
      relativePath !==
        "src/engine/storage/internal/KeyValueStorageBackend.ts" &&
      /\blocalStorage\b/u.test(
        source,
      )
    ) {
      addViolation(
        violations,
        "STO002",
        relativePath,
        "Acesso direto a localStorage deve ficar isolado no backend key-value.",
      );
    }

    if (
      /\bfetch\s*\(/u.test(
        source,
      ) ||
      /@tauri-apps/u.test(
        source,
      ) ||
      /from\s+["'][^"']*steamworks/iu.test(
        source,
      )
    ) {
      addViolation(
        violations,
        "STO003",
        relativePath,
        "Etapa 82 não pode antecipar HTTP concreto, Tauri ou Steamworks.",
      );
    }

    if (
      /engine\/world\/internal/u.test(
        source,
      ) ||
      /world\/internal/u.test(
        source,
      )
    ) {
      addViolation(
        violations,
        "STO004",
        relativePath,
        "game.storage não pode atravessar o internal de game.world.",
      );
    }
  }

  const adapterPath =
    "src/engine/storage/internal/DomainSaveGamePortAdapter.ts";

  const adapter =
    read(
      projectRoot,
      adapterPath,
    );

  const domainImports =
    [
      ...adapter.matchAll(
        /import[\s\S]*?from\s+["']([^"']*domain\/[^"']+)["'];/gu,
      ),
    ];

  for (
    const match of
    domainImports
  ) {
    if (
      !match[
        0
      ].startsWith(
        "import type",
      )
    ) {
      addViolation(
        violations,
        "STO005",
        adapterPath,
        `Dependência runtime indevida para Domain: ${match[1]}`,
      );
    }
  }

  const otherRuntimeFiles =
    STORAGE_RUNTIME_FILES.filter(
      (
        value,
      ) =>
        value !==
        adapterPath,
    );

  for (
    const relativePath of
    otherRuntimeFiles
  ) {
    const source =
      read(
        projectRoot,
        relativePath,
      );

    if (
      /["'][^"']*domain\/[^"']*["']/u.test(
        source,
      )
    ) {
      addViolation(
        violations,
        "STO006",
        relativePath,
        "Somente o adapter explícito pode depender de tipos do Domain.",
      );
    }
  }
}

function verifyBaseline(
  projectRoot,
  violations,
) {
  const baseline =
    loadBaseline(
      projectRoot,
    );

  const expected =
    baseline
      .semanticFingerprints ??
    {};

  const expectedPaths =
    Object.keys(
      expected,
    ).sort();

  const actualPaths =
    [
      ...STORAGE_RUNTIME_FILES,
    ].sort();

  if (
    JSON.stringify(
      expectedPaths,
    ) !==
    JSON.stringify(
      actualPaths,
    )
  ) {
    addViolation(
      violations,
      "STO007",
      LAYER1_STORAGE_BASELINE_FILE,
      "Baseline não cobre exatamente os runtimes certificados.",
    );

    return;
  }

  for (
    const relativePath of
    STORAGE_RUNTIME_FILES
  ) {
    const actual =
      fingerprintStorageSource(
        read(
          projectRoot,
          relativePath,
        ),
      );

    if (
      actual !==
        expected[
          relativePath
        ]
    ) {
      addViolation(
        violations,
        "STO008",
        relativePath,
        "Fingerprint semântico difere da baseline da Etapa 82.",
      );
    }
  }
}

export async function auditLayer1Storage({
  projectRoot =
    process.cwd(),
} = {}) {
  const root =
    path.resolve(
      projectRoot,
    );

  const violations =
    [];

  verifyFiles(
    root,
    violations,
  );

  if (
    violations.length ===
      0
  ) {
    verifyRuntimePolicy(
      root,
      violations,
    );

    verifyBaseline(
      root,
      violations,
    );
  }

  const publicApi =
    await auditLayer1PublicApi({
      projectRoot:
        root,
    });

  if (
    !publicApi.ok
  ) {
    addViolation(
      violations,
      "STO009",
      "LAYER1_PUBLIC_API_BASELINE_V1.json",
      "Public API baseline da Etapa 72 não permanece verde.",
    );
  }

  const capabilityGraph =
    await auditLayer1CapabilityGraph({
      projectRoot:
        root,
    });

  if (
    !capabilityGraph.ok
  ) {
    addViolation(
      violations,
      "STO010",
      "LAYER1_CAPABILITY_GRAPH_BASELINE_V1.json",
      "Capability graph da Etapa 73 não permanece verde.",
    );
  }

  return {
    version:
      LAYER1_STORAGE_AUDIT_VERSION,

    ok:
      violations.length ===
      0,

    violations,

    counts: {
      runtimeFiles:
        STORAGE_RUNTIME_FILES.length,

      publicFiles:
        STORAGE_PUBLIC_FILES.length,

      domainPortFiles:
        STORAGE_DOMAIN_PORT_FILES.length,

      publicApiViolations:
        publicApi.violations
          ?.length ??
        0,

      capabilityGraphViolations:
        capabilityGraph
          .violations
          ?.length ??
        0,
    },

    policy: {
      publicApiUnchanged:
        publicApi.ok,

      capabilityGraphUnchanged:
        capabilityGraph.ok,

      localStorageIsolated:
        !violations.some(
          (
            item,
          ) =>
            item.code ===
            "STO002",
        ),

      concreteRemoteBackendsDeferred:
        !violations.some(
          (
            item,
          ) =>
            item.code ===
            "STO003",
        ),

      noWorldInternalCrossImport:
        !violations.some(
          (
            item,
          ) =>
            item.code ===
            "STO004",
        ),

      domainDependencyTypeOnly:
        !violations.some(
          (
            item,
          ) =>
            item.code ===
              "STO005" ||
            item.code ===
              "STO006",
        ),
    },
  };
}

export function formatLayer1StorageAudit(
  result,
) {
  const lines =
    [
      "============================================================",
      "  PROJETO1 — LAYER 1 STORAGE AUDIT V1",
      "============================================================",
      `status: ${result.ok ? "PASS" : "FAIL"}`,
      `runtime files: ${String(result.counts.runtimeFiles)}`,
      `public files: ${String(result.counts.publicFiles)}`,
      `domain port files: ${String(result.counts.domainPortFiles)}`,
      `public api violations: ${String(result.counts.publicApiViolations)}`,
      `capability graph violations: ${String(result.counts.capabilityGraphViolations)}`,
    ];

  if (
    result.violations
      .length >
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
  }

  return lines.join(
    "\n",
  );
}
