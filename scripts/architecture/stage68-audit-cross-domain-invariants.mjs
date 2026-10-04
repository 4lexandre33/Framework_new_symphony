#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  CROSS_DOMAIN_INVARIANT_CATALOG_VERSION,
  CROSS_DOMAIN_INVARIANTS,
} from "./lib/domain-cross-invariants-v1.mjs";

const ROOT =
  process.cwd();

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

function countMarker(
  source,
  invariantId,
) {
  const marker =
    `@invariant ${invariantId}`;

  let count = 0;
  let cursor = 0;

  while (true) {
    const found =
      source.indexOf(
        marker,
        cursor,
      );

    if (
      found < 0
    ) {
      break;
    }

    count += 1;
    cursor =
      found +
      marker.length;
  }

  return count;
}

export function auditCrossDomainInvariantCoverage({
  projectRoot =
    ROOT,
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const violations = [];
  const seenIds =
    new Set();

  for (
    const invariant of
    CROSS_DOMAIN_INVARIANTS
  ) {
    if (
      seenIds.has(
        invariant.id,
      )
    ) {
      violations.push({
        invariantId:
          invariant.id,
        code:
          "duplicate-catalog-id",
        message:
          `InvariantId duplicado no catálogo: ${invariant.id}`,
      });

      continue;
    }

    seenIds.add(
      invariant.id,
    );

    const target =
      path.join(
        absoluteRoot,
        ...invariant.testFile
          .split("/"),
      );

    if (
      !fs.existsSync(
        target,
      ) ||
      !fs.statSync(
        target,
      ).isFile()
    ) {
      violations.push({
        invariantId:
          invariant.id,
        code:
          "missing-test-file",
        message:
          `Arquivo de teste ausente: ${invariant.testFile}`,
      });

      continue;
    }

    const source =
      fs.readFileSync(
        target,
        "utf8",
      );

    const count =
      countMarker(
        source,
        invariant.id,
      );

    if (
      count !== 1
    ) {
      violations.push({
        invariantId:
          invariant.id,
        code:
          count === 0
            ? "missing-marker"
            : "duplicate-marker",
        message:
          `${invariant.testFile} deve conter exatamente um marcador "@invariant ${invariant.id}", encontrado: ${String(count)}.`,
      });
    }
  }

  return Object.freeze({
    version:
      CROSS_DOMAIN_INVARIANT_CATALOG_VERSION,
    invariantCount:
      CROSS_DOMAIN_INVARIANTS.length,
    coveredInvariantCount:
      CROSS_DOMAIN_INVARIANTS.length -
      violations.length,
    violations:
      Object.freeze(
        violations,
      ),
    ok:
      violations.length === 0,
  });
}

function main() {
  const projectRoot =
    path.resolve(
      readArgument(
        "--project-root",
      ) ??
      ROOT,
    );

  const json =
    process.argv.includes(
      "--json",
    );

  const result =
    auditCrossDomainInvariantCoverage({
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
      "============================================================",
    );
    console.log(
      "  PROJETO1 — CROSS-DOMAIN INVARIANT COVERAGE",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[INFO] Catalog version: ${result.version}`,
    );
    console.log(
      `[INFO] Invariantes catalogados: ${String(result.invariantCount)}`,
    );
    console.log(
      `[INFO] Invariantes cobertos: ${String(result.coveredInvariantCount)}`,
    );

    if (result.ok) {
      console.log(
        "[OK] Cobertura de invariantes: completa.",
      );
    } else {
      for (
        const item of
        result.violations
      ) {
        console.log(
          `[FAIL] ${item.invariantId} ${item.code}: ${item.message}`,
        );
      }
    }
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
