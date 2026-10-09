#!/usr/bin/env node
import {
  auditLayer1FailureRecovery,
  formatLayer1FailureRecoveryAudit,
} from "./lib/layer1-failure-recovery-v1.mjs";

const result = auditLayer1FailureRecovery({ projectRoot: process.cwd() });
process.stdout.write(formatLayer1FailureRecoveryAudit(result));
if (!result.ok) process.exitCode = 1;
