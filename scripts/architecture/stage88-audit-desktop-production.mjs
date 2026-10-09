#!/usr/bin/env node
import {
  auditLayer1DesktopProduction,
  formatLayer1DesktopProductionAudit,
} from "./lib/layer1-desktop-production-v1.mjs";

const result = auditLayer1DesktopProduction({ projectRoot: process.cwd() });
process.stdout.write(formatLayer1DesktopProductionAudit(result));
if (!result.ok) process.exitCode = 1;
