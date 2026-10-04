#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  EXPECTED_CROSS_INVARIANTS,
  EXPECTED_DOMAIN_ROOTS,
  EXPECTED_INTEGRATION_NAMES,
  EXPECTED_PERFORMANCE_RULES,
  EXPECTED_PORTABILITY_RULES,
  EXPECTED_STANDARD_SNAPSHOT_AGGREGATES,
  LAYER2_DOCUMENTATION_CATALOG_VERSION,
  LAYER2_DOCUMENTS,
} from "./lib/layer2-documentation-catalog-v1.mjs";

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

function normalize(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function listActualDomainRoots(
  projectRoot,
) {
  const domainRoot =
    path.join(
      projectRoot,
      "src",
      "domain",
    );

  return fs
    .readdirSync(
      domainRoot,
      {
        withFileTypes: true,
      },
    )
    .filter(
      (entry) =>
        entry.isDirectory(),
    )
    .map(
      (entry) =>
        entry.name,
    )
    .sort();
}

function extractMarkdownLinks(
  source,
) {
  const result = [];
  const expression =
    /\[[^\]]+\]\(([^)]+)\)/gu;

  let match;

  while (
    (
      match =
        expression.exec(
          source,
        )
    ) !== null
  ) {
    const href =
      match[1];

    if (
      href !== undefined
    ) {
      result.push(href);
    }
  }

  return result;
}

function isExternalLink(
  href,
) {
  return (
    href.startsWith(
      "http://",
    ) ||
    href.startsWith(
      "https://",
    ) ||
    href.startsWith(
      "mailto:",
    ) ||
    href.startsWith("#")
  );
}

export function auditLayer2Documentation({
  projectRoot =
    ROOT,
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const violations = [];
  const loaded =
    new Map();

  for (
    const document of
    LAYER2_DOCUMENTS
  ) {
    const target =
      path.join(
        absoluteRoot,
        ...document.path
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
        code:
          "DOC001",
        path:
          document.path,
        message:
          "documento obrigatório ausente.",
      });

      continue;
    }

    const source =
      fs.readFileSync(
        target,
        "utf8",
      );

    loaded.set(
      document.path,
      source,
    );

    for (
      const token of
      document.requiredTokens
    ) {
      if (
        !source.includes(
          token,
        )
      ) {
        violations.push({
          code:
            "DOC002",
          path:
            document.path,
          message:
            `token obrigatório ausente: "${token}".`,
        });
      }
    }

    for (
      const href of
      extractMarkdownLinks(
        source,
      )
    ) {
      if (
        isExternalLink(
          href,
        )
      ) {
        continue;
      }

      const withoutAnchor =
        href.split("#")[0];

      if (
        withoutAnchor ===
        undefined ||
        withoutAnchor.length ===
        0
      ) {
        continue;
      }

      const resolved =
        path.resolve(
          path.dirname(
            target,
          ),
          withoutAnchor,
        );

      if (
        !fs.existsSync(
          resolved,
        )
      ) {
        violations.push({
          code:
            "DOC003",
          path:
            document.path,
          message:
            `link relativo quebrado: "${href}".`,
        });
      }
    }
  }

  const actualRoots =
    listActualDomainRoots(
      absoluteRoot,
    );

  if (
    JSON.stringify(
      actualRoots,
    ) !==
    JSON.stringify(
      EXPECTED_DOMAIN_ROOTS,
    )
  ) {
    violations.push({
      code:
        "DOC004",
      path:
        "src/domain",
      message:
        `roots atuais divergem do catálogo. Atual: ${actualRoots.join(", ")}.`,
    });
  }

  const domainReference =
    loaded.get(
      "docs/layer2/domain-reference.md",
    ) ??
    "";

  for (
    const rootName of
    EXPECTED_DOMAIN_ROOTS
  ) {
    const token =
      `src/domain/${rootName}`;

    if (
      !domainReference.includes(
        token,
      )
    ) {
      violations.push({
        code:
          "DOC005",
        path:
          "docs/layer2/domain-reference.md",
        message:
          `root não documentado: ${token}.`,
      });
    }
  }

  const integrationDoc =
    loaded.get(
      "docs/layer2/integration-contracts.md",
    ) ??
    "";

  for (
    const integrationName of
    EXPECTED_INTEGRATION_NAMES
  ) {
    if (
      !integrationDoc.includes(
        integrationName,
      )
    ) {
      violations.push({
        code:
          "DOC006",
        path:
          "docs/layer2/integration-contracts.md",
        message:
          `integração não documentada: ${integrationName}.`,
      });
    }
  }

  for (
    const invariantId of
    EXPECTED_CROSS_INVARIANTS
  ) {
    if (
      !integrationDoc.includes(
        invariantId,
      )
    ) {
      violations.push({
        code:
          "DOC007",
        path:
          "docs/layer2/integration-contracts.md",
        message:
          `invariant não documentado: ${invariantId}.`,
      });
    }
  }

  const performanceDoc =
    loaded.get(
      "docs/layer2/performance-portability.md",
    ) ??
    "";

  for (
    const ruleId of
    EXPECTED_PORTABILITY_RULES
  ) {
    if (
      !performanceDoc.includes(
        ruleId,
      )
    ) {
      violations.push({
        code:
          "DOC008",
        path:
          "docs/layer2/performance-portability.md",
        message:
          `regra de portabilidade ausente: ${ruleId}.`,
      });
    }
  }

  for (
    const ruleId of
    EXPECTED_PERFORMANCE_RULES
  ) {
    if (
      !performanceDoc.includes(
        ruleId,
      )
    ) {
      violations.push({
        code:
          "DOC009",
        path:
          "docs/layer2/performance-portability.md",
        message:
          `regra de performance ausente: ${ruleId}.`,
      });
    }
  }

  const persistenceDoc =
    loaded.get(
      "docs/layer2/state-persistence-determinism.md",
    ) ??
    "";

  for (
    const aggregateName of
    EXPECTED_STANDARD_SNAPSHOT_AGGREGATES
  ) {
    if (
      !persistenceDoc.includes(
        aggregateName,
      )
    ) {
      violations.push({
        code:
          "DOC010",
        path:
          "docs/layer2/state-persistence-determinism.md",
        message:
          `codec padrão não documentado: ${aggregateName}.`,
      });
    }
  }

  return Object.freeze({
    version:
      LAYER2_DOCUMENTATION_CATALOG_VERSION,
    documentCount:
      LAYER2_DOCUMENTS.length,
    domainRootCount:
      actualRoots.length,
    expectedDomainRootCount:
      EXPECTED_DOMAIN_ROOTS.length,
    invariantCount:
      EXPECTED_CROSS_INVARIANTS.length,
    standardSnapshotCodecCount:
      EXPECTED_STANDARD_SNAPSHOT_AGGREGATES.length,
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
    auditLayer2Documentation({
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
      "  PROJETO1 — LAYER 2 DOCUMENTATION AUDIT",
    );
    console.log(
      "============================================================",
    );
    console.log(
      `[INFO] Catalog version: ${result.version}`,
    );
    console.log(
      `[INFO] Documentos governados: ${String(result.documentCount)}`,
    );
    console.log(
      `[INFO] Domain roots documentados: ${String(result.domainRootCount)}/${String(result.expectedDomainRootCount)}`,
    );
    console.log(
      `[INFO] Cross-domain invariants documentados: ${String(result.invariantCount)}`,
    );
    console.log(
      `[INFO] Standard snapshot codecs documentados: ${String(result.standardSnapshotCodecCount)}`,
    );

    if (result.ok) {
      console.log(
        "[OK] Violações de documentação: 0",
      );
      console.log(
        "[OK] Layer 2 documentation coverage completa.",
      );
    } else {
      console.log(
        `[FAIL] Violações de documentação: ${String(result.violations.length)}`,
      );

      for (
        const item of
        result.violations
      ) {
        console.log(
          `[${item.code}] ${normalize(item.path)} — ${item.message}`,
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
