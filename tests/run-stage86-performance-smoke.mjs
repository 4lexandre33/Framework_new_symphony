#!/usr/bin/env node
import fs from "node:fs";
import { auditLayer1PerformanceLifecycle } from "../scripts/architecture/lib/layer1-performance-lifecycle-v1.mjs";
const result = auditLayer1PerformanceLifecycle({ projectRoot: process.cwd() });
if (!result.ok) {
  for (const v of result.violations) console.error(`[${v.code}] ${v.scope}: ${v.message}`);
  process.exit(1);
}
const scene = fs.readFileSync("src/engine/render/internal/SceneGraphManager.ts", "utf8");
if (!scene.includes("disposeResourceSets") || !scene.includes("meshRegistry.clear()")) process.exit(1);
console.log(`[OK] Stage86 performance/resource smoke: ${String(result.checks.length)} checks`);
