import fs from "node:fs";
import path from "node:path";

export const LAYER1_FAILURE_RECOVERY_AUDIT_VERSION = "1.0.0";

const SIGNALS = Object.freeze([
  {
    id: "kernel.strict-rollback",
    file: "src/core/runtime/boot.ts",
    patterns: [/rollbackFailedBoot\(/u, /state\.status\s*=\s*"failed"/u, /state\.phase\s*=\s*"stopped"/u, /throw error/u],
  },
  {
    id: "kernel.tolerant-quarantine",
    file: "src/core/runtime/boot.ts",
    patterns: [/quarantineFailedEntries\(/u, /rebindConsumers:\s*true/u, /disposePlugin\(/u],
  },
  {
    id: "kernel.dispose-abort-and-cleanup",
    file: "src/core/runtime/dispose.ts",
    patterns: [/abortControllers\.get\(id\)\?\.abort\(\)/u, /runDisposers\(/u, /runScope\(/u, /stopTimers\(/u, /detachSubsystems\(/u],
  },
  {
    id: "async.timeout-finally",
    file: "src/core/internal/ttl.ts",
    patterns: [/Promise\.race/u, /finally/u, /clearTimeout\(timer\)/u],
  },
  {
    id: "render.context-recovery",
    file: "src/engine/render/internal/ThreeRenderEngine.ts",
    patterns: [/webglcontextlost/u, /event\.preventDefault\(\)/u, /contextLost\s*=\s*true/u, /webglcontextrestored/u, /renderer\.resetState\(\)/u],
  },
  {
    id: "input.focus-recovery",
    file: "src/engine/input/internal/KeyboardMouseDriver.ts",
    patterns: [/"blur"/u, /"visibilitychange"/u, /releaseAllContinuousState\(\)/u, /pointerLockElement/u],
  },
  {
    id: "assets.late-completion",
    file: "src/engine/assets/internal/AssetsManagerService.ts",
    patterns: [/inFlight/u, /finally/u, /inFlight\.delete/u, /disposeUncachedResult/u, /foi descartado durante o carregamento/u],
  },
  {
    id: "terrain.worker-fallback",
    file: "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    patterns: [/handleWorkerError/u, /finishJobWithFallback/u, /"messageerror"/u, /terminate\(\)/u, /pendingJobs\.clear\(\)/u],
  },
  {
    id: "network.stale-generation",
    file: "src/engine/net/internal/WebSocketTransport.ts",
    patterns: [/connectionGeneration/u, /generation !==\s*this\.connectionGeneration/u, /pendingConnectResolve/u, /detachSocketHandlers/u, /settle\(false\)/u],
  },
  {
    id: "storage.fail-closed",
    file: "src/engine/storage/internal/SaveRecordCodec.ts",
    patterns: [/StorageInfrastructureError/u, /"corrupted"/u, /verifyChecksum\(/u, /metadata\.slotName !==/u],
  },
]);

function abs(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function violation(code, scope, message) {
  return Object.freeze({ code, scope, message });
}

export function auditLayer1FailureRecovery({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const checks = [];
  const violations = [];

  const previous = abs(root, "ETAPA86_AUTOMATED_PASS.json");
  if (!fs.existsSync(previous)) {
    violations.push(violation("REC_PREVIOUS_STAGE", "ETAPA86_AUTOMATED_PASS.json", "Stage 86 PASS ausente"));
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(previous, "utf8"));
      if (parsed.stage !== 86 || parsed.status !== "PASS" || parsed.violations !== 0) {
        violations.push(violation("REC_PREVIOUS_STAGE", "ETAPA86_AUTOMATED_PASS.json", "Stage 86 não está certificada como PASS/0 violations"));
      }
    } catch (error) {
      violations.push(violation("REC_PREVIOUS_STAGE", "ETAPA86_AUTOMATED_PASS.json", `JSON inválido: ${String(error)}`));
    }
  }

  for (const spec of SIGNALS) {
    const full = abs(root, spec.file);
    if (!fs.existsSync(full)) {
      checks.push({ id: spec.id, file: spec.file, ok: false, missingPatterns: ["<file missing>"] });
      violations.push(violation("REC_FILE_MISSING", spec.file, "arquivo obrigatório ausente"));
      continue;
    }

    const source = fs.readFileSync(full, "utf8");
    const missingPatterns = spec.patterns.filter((pattern) => !pattern.test(source)).map(String);
    const ok = missingPatterns.length === 0;
    checks.push({ id: spec.id, file: spec.file, ok, missingPatterns });

    if (!ok) {
      violations.push(violation("REC_SIGNAL_MISSING", spec.file, `${spec.id}: ${missingPatterns.join(", ")}`));
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    stage: 87,
    auditVersion: LAYER1_FAILURE_RECOVERY_AUDIT_VERSION,
    ok: violations.length === 0,
    checks: Object.freeze(checks),
    violations: Object.freeze(violations),
  });
}

export function formatLayer1FailureRecoveryAudit(result) {
  const lines = [
    "============================================================",
    "STAGE 87 — FAILURE RECOVERY & RESILIENCE AUDIT",
    "============================================================",
    `[INFO] Audit version: ${result.auditVersion}`,
    `[INFO] Semantic checks: ${String(result.checks.length)}`,
  ];

  for (const check of result.checks) {
    lines.push(`[${check.ok ? "OK" : "FAIL"}] ${check.id} — ${check.file}`);
  }

  if (result.ok) {
    lines.push("[OK] Failure recovery/resilience audit: 0 violations");
  } else {
    lines.push(`[FAIL] Violations: ${String(result.violations.length)}`);
    for (const item of result.violations) {
      lines.push(`[${item.code}] ${item.scope} — ${item.message}`);
    }
  }

  lines.push("============================================================", "");
  return lines.join("\n");
}
