#!/usr/bin/env node
import {
  auditLayer1Documentation,
  formatLayer1DocumentationAudit,
} from "./lib/layer1-documentation-v1.mjs";

const result = await auditLayer1Documentation({ projectRoot: process.cwd() });
process.stdout.write(formatLayer1DocumentationAudit(result));
if (!result.ok) process.exitCode = 1;
