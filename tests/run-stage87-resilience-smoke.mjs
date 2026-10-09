#!/usr/bin/env node
import fs from "node:fs";
import { auditLayer1FailureRecovery } from "../scripts/architecture/lib/layer1-failure-recovery-v1.mjs";

const result = auditLayer1FailureRecovery({ projectRoot: process.cwd() });
if (!result.ok) {
  for (const item of result.violations) {
    console.error(`[${item.code}] ${item.scope}: ${item.message}`);
  }
  process.exit(1);
}

const boot = fs.readFileSync("src/core/runtime/boot.ts", "utf8");
const render = fs.readFileSync("src/engine/render/internal/ThreeRenderEngine.ts", "utf8");
const workers = fs.readFileSync("src/engine/terrain/internal/ProceduralWorkerPool.ts", "utf8");

if (!boot.includes("rollbackFailedBoot") || !render.includes("renderer.resetState()") || !workers.includes("finishJobWithFallback")) {
  process.exit(1);
}

console.log(`[OK] Stage87 resilience smoke: ${String(result.checks.length)} semantic checks`);
