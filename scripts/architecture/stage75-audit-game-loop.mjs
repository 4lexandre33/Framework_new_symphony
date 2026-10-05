#!/usr/bin/env node

import path from "node:path";

import {
  auditLayer1GameLoop,
  formatLayer1GameLoopAudit,
} from "./lib/layer1-game-loop-v1.mjs";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} exige valor.`);
  }
  return value;
}

try {
  const projectRoot = path.resolve(arg("--project-root") ?? process.cwd());
  const result = await auditLayer1GameLoop({ projectRoot });

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(formatLayer1GameLoopAudit(result));
  }

  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
