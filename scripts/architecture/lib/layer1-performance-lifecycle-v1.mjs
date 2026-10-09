import fs from "node:fs";
import path from "node:path";

export const LAYER1_PERFORMANCE_RESOURCE_AUDIT_VERSION = "1.0.0";

const CHECKS = Object.freeze([
  {
    id: "render.dispose",
    file: "src/engine/render/internal/ThreeRenderEngine.ts",
    patterns: [/public dispose\(\): void/u, /viewportManager\.dispose\(\)/u, /sceneGraphManager\.dispose\(\)/u, /renderLists\.dispose\(\)/u, /renderer\.dispose\(\)/u],
  },
  {
    id: "render.resource-ownership",
    file: "src/engine/render/internal/SceneGraphManager.ts",
    patterns: [/meshRegistry/u, /textures/u, /materials/u, /geometries/u, /disposeResourceSets/u, /disposed/u],
  },
  {
    id: "viewport.listener-release",
    file: "src/engine/render/internal/ViewportManager.ts",
    patterns: [/addEventListener\(/u, /removeEventListener\(/u, /dispose\(\)/u],
  },
  {
    id: "input.listener-release",
    file: "src/engine/input/internal/KeyboardMouseDriver.ts",
    patterns: [/removeEventListener\(/u, /releaseAllContinuousState/u, /clearAllState/u],
  },
  {
    id: "assets.lifecycle",
    file: "src/engine/assets/internal/AssetsManagerService.ts",
    patterns: [/inFlight/u, /dispose/u],
  },
  {
    id: "terrain.worker-lifecycle",
    file: "src/engine/terrain/internal/ProceduralWorkerPool.ts",
    patterns: [/Worker/u, /terminate\(/u, /dispose/u],
  },
  {
    id: "network.socket-lifecycle",
    file: "src/engine/net/internal/WebSocketTransport.ts",
    patterns: [/WebSocket/u, /close/u, /connected/u],
  },
  {
    id: "physics.lifecycle",
    file: "src/engine/physics/internal/PhysicsWorld.ts",
    patterns: [/dispose/u, /world/u, /eventQueue/u],
  },
  {
    id: "kernel.inverse-shutdown",
    file: "src/core/runtime/stop.ts",
    patterns: [/reverseShutdownOrder/u, /disposeAll/u, /capabilityWatchers\.clear\(\)/u, /emitQueue\.stop\(\)/u],
  },
]);

function abs(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function read(root, relativePath) {
  return fs.readFileSync(abs(root, relativePath), "utf8");
}

function violation(code, scope, message) {
  return Object.freeze({ code, scope, message });
}

function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const c = source[i];
    if (c === "{") depth += 1;
    if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

export function auditLayer1PerformanceLifecycle({ projectRoot = process.cwd() } = {}) {
  const root = path.resolve(projectRoot);
  const violations = [];
  const checks = [];

  const stage85Pass = abs(root, "ETAPA85_AUTOMATED_PASS.json");
  if (!fs.existsSync(stage85Pass)) {
    violations.push(violation("PERF_PREVIOUS_STAGE", "ETAPA85_AUTOMATED_PASS.json", "Stage 85 PASS ausente"));
  }

  for (const spec of CHECKS) {
    const full = abs(root, spec.file);
    if (!fs.existsSync(full)) {
      checks.push({ id: spec.id, file: spec.file, ok: false, missingPatterns: ["<file missing>"] });
      violations.push(violation("PERF_FILE_MISSING", spec.file, "arquivo runtime obrigatório ausente"));
      continue;
    }
    const source = fs.readFileSync(full, "utf8");
    const missingPatterns = spec.patterns.filter((p) => !p.test(source)).map(String);
    const ok = missingPatterns.length === 0;
    checks.push({ id: spec.id, file: spec.file, ok, missingPatterns });
    if (!ok) violations.push(violation("PERF_SIGNAL_MISSING", spec.file, `${spec.id}: ${missingPatterns.join(", ")}`));
  }

  const renderPath = "src/engine/render/internal/ThreeRenderEngine.ts";
  if (fs.existsSync(abs(root, renderPath))) {
    const renderMethod = extractMethod(read(root, renderPath), "public render(");
    const forbidden = renderMethod === null
      ? ["<render method missing>"]
      : [/(^|[^A-Za-z])new\s+/u, /\.map\(/u, /\.filter\(/u, /\.reduce\(/u, /\[\s*\]/u]
          .filter((pattern) => pattern.test(renderMethod))
          .map(String);
    const ok = forbidden.length === 0;
    checks.push({ id: "hotpath.render.no-transient-materialization", file: renderPath, ok, missingPatterns: forbidden });
    if (!ok) violations.push(violation("PERF_HOTPATH_ALLOCATION", renderPath, `tokens proibidos no render: ${forbidden.join(", ")}`));
  }

  return Object.freeze({
    schemaVersion: 1,
    stage: 86,
    auditVersion: LAYER1_PERFORMANCE_RESOURCE_AUDIT_VERSION,
    ok: violations.length === 0,
    checks: Object.freeze(checks),
    violations: Object.freeze(violations),
  });
}

export function formatLayer1PerformanceLifecycleAudit(result) {
  const lines = [
    "============================================================",
    "STAGE 86 — PERFORMANCE & RESOURCE LIFECYCLE AUDIT",
    "============================================================",
    `[INFO] Audit version: ${result.auditVersion}`,
    `[INFO] Semantic checks: ${String(result.checks.length)}`,
  ];
  for (const check of result.checks) lines.push(`[${check.ok ? "OK" : "FAIL"}] ${check.id} — ${check.file}`);
  if (result.ok) lines.push("[OK] Performance/resource lifecycle audit: 0 violations");
  else {
    lines.push(`[FAIL] Violations: ${String(result.violations.length)}`);
    for (const item of result.violations) lines.push(`[${item.code}] ${item.scope} — ${item.message}`);
  }
  lines.push("============================================================", "");
  return lines.join("\n");
}
