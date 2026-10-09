#!/usr/bin/env node
import { auditLayer1PerformanceLifecycle, formatLayer1PerformanceLifecycleAudit } from "./lib/layer1-performance-lifecycle-v1.mjs";
const result = auditLayer1PerformanceLifecycle({ projectRoot: process.cwd() });
process.stdout.write(formatLayer1PerformanceLifecycleAudit(result));
if (!result.ok) process.exitCode = 1;
