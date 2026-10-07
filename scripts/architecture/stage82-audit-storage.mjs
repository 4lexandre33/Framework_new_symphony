#!/usr/bin/env node

import path from "node:path";

import {
  auditLayer1Storage,
  formatLayer1StorageAudit,
} from "./lib/layer1-storage-v1.mjs";

function readArgument(
  name,
) {
  const index =
    process.argv.indexOf(
      name,
    );

  if (
    index <
      0
  ) {
    return null;
  }

  const value =
    process.argv[
      index +
      1
    ];

  if (
    value ===
      undefined ||
    value.startsWith(
      "--",
    )
  ) {
    throw new Error(
      `${name} exige valor.`,
    );
  }

  return value;
}

async function main() {
  const projectRoot =
    path.resolve(
      readArgument(
        "--project-root",
      ) ??
      process.cwd(),
    );

  const result =
    await auditLayer1Storage({
      projectRoot,
    });

  if (
    process.argv.includes(
      "--json",
    )
  ) {
    process.stdout.write(
      JSON.stringify(
        result,
        null,
        2,
      ) +
      "\n",
    );
  } else {
    console.log(
      formatLayer1StorageAudit(
        result,
      ),
    );
  }

  if (
    !result.ok
  ) {
    process.exitCode =
      1;
  }
}

try {
  await main();
} catch (
  error
) {
  console.error(
    error instanceof Error
      ? error.stack ??
        error.message
      : String(
          error,
        ),
  );

  process.exitCode =
    1;
}
