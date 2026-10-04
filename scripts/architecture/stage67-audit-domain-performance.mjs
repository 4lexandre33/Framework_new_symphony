#!/usr/bin/env node

import path from "node:path";

import {
  auditDomainPerformance,
  formatDomainPerformanceAudit,
} from "./lib/domain-performance-v1.mjs";

function readArgument(
  name,
) {
  const index =
    process.argv.indexOf(
      name,
    );

  if (
    index < 0
  ) {
    return null;
  }

  const value =
    process.argv[
      index + 1
    ];

  if (
    value === undefined ||
    value.startsWith("--")
  ) {
    throw new Error(
      `${name} exige valor.`,
    );
  }

  return value;
}

function main() {
  const projectRoot =
    path.resolve(
      readArgument(
        "--project-root",
      ) ??
      process.cwd(),
    );

  const json =
    process.argv.includes(
      "--json",
    );

  const result =
    auditDomainPerformance({
      projectRoot,
    });

  if (json) {
    process.stdout.write(
      JSON.stringify(
        result,
        null,
        2,
      ) + "\n",
    );
  } else {
    console.log(
      formatDomainPerformanceAudit(
        result,
      ),
    );
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(error),
  );

  process.exitCode = 1;
}
