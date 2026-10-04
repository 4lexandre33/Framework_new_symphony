import fs from "node:fs";
import path from "node:path";

import {
  auditDomainPortability,
} from "./domain-portability-v2.mjs";

import {
  auditDomainPerformance,
} from "./domain-performance-v1.mjs";

import {
  CROSS_DOMAIN_INVARIANTS,
} from "./domain-cross-invariants-v1.mjs";

import {
  EXPECTED_CROSS_INVARIANTS,
  EXPECTED_DOMAIN_ROOTS,
  EXPECTED_INTEGRATION_NAMES,
  EXPECTED_PERFORMANCE_RULES,
  EXPECTED_PORTABILITY_RULES,
  EXPECTED_STANDARD_SNAPSHOT_AGGREGATES,
  LAYER2_DOCUMENTS,
} from "./layer2-documentation-catalog-v1.mjs";

export const LAYER2_FINAL_GATE_VERSION =
  "1.0.0";

export const LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS =
  Object.freeze([
    "definitions",
    "economy",
    "entities",
    "evaluation",
    "events",
    "integration",
    "interaction",
    "location",
    "mechanics",
    "narrative",
    "ports",
    "progression",
    "random",
    "relations",
    "snapshots",
    "state",
    "tags",
    "time",
  ]);

export const LAYER2_FINAL_STAGE_CHECKPOINTS =
  Object.freeze([
    Object.freeze({
      stage: "44",
      files: Object.freeze([
        "src/domain/entities/DomainId.ts",
        "src/domain/entities/Agent.ts",
        "src/domain/economy/Inventory.ts",
        "src/domain/mechanics/AbilityAction.ts",
        "src/domain/mechanics/SkillTreeGraph.ts",
        "src/domain/narrative/DialogueGraph.ts",
        "src/domain/narrative/QuestGoal.ts",
        "src/services/usecases/SaveLoadUseCase.ts",
        "src/services/usecases/ModdingAppService.ts",
        "src/app/flows/GameFlowFSM.ts",
      ]),
    }),
    Object.freeze({
      stage: "45",
      files: Object.freeze([
        "src/domain/location/LocationGraph.ts",
      ]),
    }),
    Object.freeze({
      stage: "46",
      files: Object.freeze([
        "src/domain/entities/WorldObjectRef.ts",
      ]),
    }),
    Object.freeze({
      stage: "47",
      files: Object.freeze([
        "src/domain/state/StateStore.ts",
      ]),
    }),
    Object.freeze({
      stage: "48",
      files: Object.freeze([
        "src/domain/time/SimulationTimer.ts",
      ]),
    }),
    Object.freeze({
      stage: "49",
      files: Object.freeze([
        "src/domain/events/DomainEvent.ts",
      ]),
    }),
    Object.freeze({
      stage: "50",
      files: Object.freeze([
        "src/domain/evaluation/ConditionEvaluator.ts",
      ]),
    }),
    Object.freeze({
      stage: "51",
      files: Object.freeze([
        "src/domain/mechanics/StatusEffectSet.ts",
      ]),
    }),
    Object.freeze({
      stage: "52",
      files: Object.freeze([
        "src/domain/mechanics/ModifierSet.ts",
      ]),
    }),
    Object.freeze({
      stage: "53",
      files: Object.freeze([
        "src/domain/mechanics/ResourcePool.ts",
        "src/domain/mechanics/CooldownSet.ts",
      ]),
    }),
    Object.freeze({
      stage: "54",
      files: Object.freeze([
        "src/domain/interaction/Affordance.ts",
      ]),
    }),
    Object.freeze({
      stage: "55",
      files: Object.freeze([
        "src/domain/relations/FactionMatrix.ts",
      ]),
    }),
    Object.freeze({
      stage: "56",
      files: Object.freeze([
        "src/domain/economy/CurrencyAccount.ts",
        "src/domain/economy/LootTable.ts",
      ]),
    }),
    Object.freeze({
      stage: "57",
      files: Object.freeze([
        "src/domain/progression/ProgressionCurve.ts",
        "src/domain/progression/UnlockSet.ts",
      ]),
    }),
    Object.freeze({
      stage: "58",
      files: Object.freeze([
        "src/domain/narrative/QuestDefinition.ts",
        "src/domain/narrative/NarrativeState.ts",
      ]),
    }),
    Object.freeze({
      stage: "59",
      files: Object.freeze([
        "src/domain/mechanics/DamageRule.ts",
        "src/domain/mechanics/RequirementRule.ts",
      ]),
    }),
    Object.freeze({
      stage: "60",
      files: Object.freeze([
        "src/domain/definitions/GameDefinitions.ts",
      ]),
    }),
    Object.freeze({
      stage: "61",
      files: Object.freeze([
        "src/domain/tags/DomainTag.ts",
        "src/domain/tags/TagSet.ts",
      ]),
    }),
    Object.freeze({
      stage: "62",
      files: Object.freeze([
        "src/domain/integration/ConditionStateIntegration.ts",
        "src/domain/integration/InteractionConditionIntegration.ts",
        "src/domain/integration/LocationEventIntegration.ts",
        "src/domain/integration/ProgressionUnlockIntegration.ts",
        "src/domain/integration/QuestIntegration.ts",
        "src/domain/integration/RewardGrantIntegration.ts",
        "src/domain/integration/StatusEffectTimeIntegration.ts",
      ]),
    }),
    Object.freeze({
      stage: "63",
      files: Object.freeze([
        "src/domain/snapshots/SnapshotCoordinator.ts",
        "src/domain/snapshots/StandardSnapshotCodecs.ts",
      ]),
    }),
    Object.freeze({
      stage: "64",
      files: Object.freeze([
        "src/domain/random/DeterministicRng.ts",
        "src/domain/random/RandomStream.ts",
      ]),
    }),
    Object.freeze({
      stage: "65",
      files: Object.freeze([
        "src/domain/ports/DomainSaveGamePort.ts",
      ]),
    }),
    Object.freeze({
      stage: "66",
      files: Object.freeze([
        "scripts/architecture/lib/domain-portability-v2.mjs",
        "scripts/architecture/stage66-audit-domain-portability-v2.mjs",
        "ETAPA66_MANIFEST.json",
      ]),
    }),
    Object.freeze({
      stage: "67",
      files: Object.freeze([
        "scripts/architecture/lib/domain-performance-policy-v1.mjs",
        "scripts/architecture/lib/domain-performance-v1.mjs",
        "ETAPA67_MANIFEST.json",
      ]),
    }),
    Object.freeze({
      stage: "68",
      files: Object.freeze([
        "scripts/architecture/lib/domain-cross-invariants-v1.mjs",
        "scripts/architecture/stage68-audit-cross-domain-invariants.mjs",
        "ETAPA68_MANIFEST.json",
      ]),
    }),
    Object.freeze({
      stage: "69",
      files: Object.freeze([
        "scripts/architecture/lib/layer2-documentation-catalog-v1.mjs",
        "scripts/architecture/stage69-audit-documentation.mjs",
        "docs/layer2/README.md",
        "ETAPA69_MANIFEST.json",
      ]),
    }),
  ]);

function normalizeSlashes(
  value,
) {
  return value.replace(
    /\\/gu,
    "/",
  );
}

function listDirectoryNames(
  directory,
) {
  return fs
    .readdirSync(
      directory,
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

function equalStringArrays(
  left,
  right,
) {
  return (
    left.length ===
      right.length &&
    left.every(
      (value, index) =>
        value ===
        right[index],
    )
  );
}

function countMarker(
  source,
  id,
) {
  const marker =
    `@invariant ${id}`;

  return (
    source
      .split(marker)
      .length -
    1
  );
}

function auditInvariantCoverage(
  projectRoot,
) {
  const violations = [];

  if (
    CROSS_DOMAIN_INVARIANTS.length !==
    EXPECTED_CROSS_INVARIANTS.length
  ) {
    violations.push(
      `catálogo possui ${String(CROSS_DOMAIN_INVARIANTS.length)} invariantes; esperado ${String(EXPECTED_CROSS_INVARIANTS.length)}.`,
    );
  }

  const ids =
    CROSS_DOMAIN_INVARIANTS.map(
      (entry) =>
        entry.id,
    );

  if (
    !equalStringArrays(
      ids,
      EXPECTED_CROSS_INVARIANTS,
    )
  ) {
    violations.push(
      `IDs divergentes: ${ids.join(", ")}.`,
    );
  }

  const uniqueIds =
    new Set(ids);

  if (
    uniqueIds.size !==
    ids.length
  ) {
    violations.push(
      "IDs duplicados no catálogo de invariantes.",
    );
  }

  for (
    const invariant of
    CROSS_DOMAIN_INVARIANTS
  ) {
    const target =
      path.join(
        projectRoot,
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
      violations.push(
        `${invariant.id}: arquivo de teste ausente ${invariant.testFile}.`,
      );

      continue;
    }

    const source =
      fs.readFileSync(
        target,
        "utf8",
      );

    const markerCount =
      countMarker(
        source,
        invariant.id,
      );

    if (
      markerCount !== 1
    ) {
      violations.push(
        `${invariant.id}: marker count ${String(markerCount)} em ${invariant.testFile}.`,
      );
    }
  }

  return Object.freeze({
    ok:
      violations.length === 0,
    violations:
      Object.freeze(
        violations,
      ),
  });
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
      result.push(
        href,
      );
    }
  }

  return result;
}

function isExternalOrAnchorLink(
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

function auditDocumentation(
  projectRoot,
) {
  const violations = [];
  const loaded =
    new Map();

  for (
    const document of
    LAYER2_DOCUMENTS
  ) {
    const target =
      path.join(
        projectRoot,
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
      violations.push(
        `documento obrigatório ausente: ${document.path}.`,
      );

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
        violations.push(
          `${document.path}: token ausente "${token}".`,
        );
      }
    }

    for (
      const href of
      extractMarkdownLinks(
        source,
      )
    ) {
      if (
        isExternalOrAnchorLink(
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
        violations.push(
          `${document.path}: link relativo quebrado "${href}".`,
        );
      }
    }
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
    if (
      !domainReference.includes(
        `src/domain/${rootName}`,
      )
    ) {
      violations.push(
        `domain-reference não cobre src/domain/${rootName}.`,
      );
    }
  }

  const integrationDoc =
    loaded.get(
      "docs/layer2/integration-contracts.md",
    ) ??
    "";

  for (
    const integration of
    EXPECTED_INTEGRATION_NAMES
  ) {
    if (
      !integrationDoc.includes(
        integration,
      )
    ) {
      violations.push(
        `integration-contracts não cobre ${integration}.`,
      );
    }
  }

  for (
    const invariant of
    EXPECTED_CROSS_INVARIANTS
  ) {
    if (
      !integrationDoc.includes(
        invariant,
      )
    ) {
      violations.push(
        `integration-contracts não cobre ${invariant}.`,
      );
    }
  }

  const performanceDoc =
    loaded.get(
      "docs/layer2/performance-portability.md",
    ) ??
    "";

  for (
    const rule of
    EXPECTED_PORTABILITY_RULES
  ) {
    if (
      !performanceDoc.includes(
        rule,
      )
    ) {
      violations.push(
        `performance-portability não cobre ${rule}.`,
      );
    }
  }

  for (
    const rule of
    EXPECTED_PERFORMANCE_RULES
  ) {
    if (
      !performanceDoc.includes(
        rule,
      )
    ) {
      violations.push(
        `performance-portability não cobre ${rule}.`,
      );
    }
  }

  const persistenceDoc =
    loaded.get(
      "docs/layer2/state-persistence-determinism.md",
    ) ??
    "";

  for (
    const aggregate of
    EXPECTED_STANDARD_SNAPSHOT_AGGREGATES
  ) {
    if (
      !persistenceDoc.includes(
        aggregate,
      )
    ) {
      violations.push(
        `state-persistence-determinism não cobre ${aggregate}.`,
      );
    }
  }

  return Object.freeze({
    ok:
      violations.length === 0,
    violations:
      Object.freeze(
        violations,
      ),
  });
}

export function auditLayer2FinalGate({
  projectRoot =
    process.cwd(),
} = {}) {
  const absoluteRoot =
    path.resolve(
      projectRoot,
    );

  const violations = [];
  const checkpointResults = [];

  for (
    const checkpoint of
    LAYER2_FINAL_STAGE_CHECKPOINTS
  ) {
    const missing = [];

    for (
      const relativePath of
      checkpoint.files
    ) {
      const target =
        path.join(
          absoluteRoot,
          ...relativePath.split(
            "/",
          ),
        );

      if (
        !fs.existsSync(
          target,
        ) ||
        !fs.statSync(
          target,
        ).isFile()
      ) {
        missing.push(
          relativePath,
        );
      }
    }

    checkpointResults.push(
      Object.freeze({
        stage:
          checkpoint.stage,
        required:
          checkpoint.files.length,
        missing:
          Object.freeze(
            missing,
          ),
        ok:
          missing.length === 0,
      }),
    );

    for (
      const relativePath of
      missing
    ) {
      violations.push(
        Object.freeze({
          code:
            "L2FINAL001",
          scope:
            `stage-${checkpoint.stage}`,
          message:
            `checkpoint obrigatório ausente: ${relativePath}`,
        }),
      );
    }
  }

  const domainRoot =
    path.join(
      absoluteRoot,
      "src",
      "domain",
    );

  let actualRoots = [];

  if (
    !fs.existsSync(
      domainRoot,
    ) ||
    !fs.statSync(
      domainRoot,
    ).isDirectory()
  ) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL002",
        scope:
          "src/domain",
        message:
          "src/domain não existe.",
      }),
    );
  } else {
    actualRoots =
      listDirectoryNames(
        domainRoot,
      );

    if (
      !equalStringArrays(
        actualRoots,
        LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
      )
    ) {
      violations.push(
        Object.freeze({
          code:
            "L2FINAL002",
          scope:
            "src/domain",
          message:
            `roots divergentes. Atual: ${actualRoots.join(", ")}.`,
        }),
      );
    }
  }

  const portability =
    auditDomainPortability({
      projectRoot:
        absoluteRoot,
    });

  if (!portability.ok) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL003",
        scope:
          "portability",
        message:
          `${String(portability.violations.length)} violação(ões) no Portability Gate v2.`,
      }),
    );
  }

  const performance =
    auditDomainPerformance({
      projectRoot:
        absoluteRoot,
    });

  if (!performance.ok) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL004",
        scope:
          "performance",
        message:
          `${String(performance.violations.length)} violação(ões) no Performance Audit.`,
      }),
    );
  }

  const invariants =
    auditInvariantCoverage(
      absoluteRoot,
    );

  if (!invariants.ok) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL005",
        scope:
          "cross-domain-invariants",
        message:
          `${String(invariants.violations.length)} violação(ões) na cobertura de invariantes.`,
      }),
    );
  }

  const documentation =
    auditDocumentation(
      absoluteRoot,
    );

  if (!documentation.ok) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL006",
        scope:
          "documentation",
        message:
          `${String(documentation.violations.length)} violação(ões) na documentação Layer 2.`,
      }),
    );
  }

  const expectedStages =
    Array.from(
      {
        length: 26,
      },
      (
        _,
        index,
      ) =>
        String(
          index + 44,
        ),
    );

  const actualStages =
    checkpointResults.map(
      (entry) =>
        entry.stage,
    );

  if (
    !equalStringArrays(
      actualStages,
      expectedStages,
    )
  ) {
    violations.push(
      Object.freeze({
        code:
          "L2FINAL007",
        scope:
          "stage-catalog",
        message:
          `catálogo deve cobrir exatamente Stages 44–69. Atual: ${actualStages.join(", ")}.`,
      }),
    );
  }

  return Object.freeze({
    version:
      LAYER2_FINAL_GATE_VERSION,

    projectRoot:
      absoluteRoot,

    stageRange:
      Object.freeze({
        first: 44,
        last: 69,
        count: 26,
      }),

    counts:
      Object.freeze({
        checkpoints:
          checkpointResults.length,
        checkpointFiles:
          checkpointResults.reduce(
            (
              total,
              checkpoint,
            ) =>
              total +
              checkpoint.required,
            0,
          ),
        domainRoots:
          actualRoots.length,
        portabilityViolations:
          portability.violations.length,
        performanceViolations:
          performance.violations.length,
        invariantCoverageViolations:
          invariants.violations.length,
        documentationViolations:
          documentation.violations.length,
      }),

    gates:
      Object.freeze({
        checkpoints:
          checkpointResults.every(
            (entry) =>
              entry.ok,
          ),
        portability:
          portability.ok,
        performance:
          performance.ok,
        invariants:
          invariants.ok,
        documentation:
          documentation.ok,
      }),

    checkpointResults:
      Object.freeze(
        checkpointResults,
      ),

    violations:
      Object.freeze(
        violations,
      ),

    ok:
      violations.length === 0,
  });
}

export function formatLayer2FinalGate(
  result,
) {
  const lines = [
    "============================================================",
    "  PROJETO1 — FINAL LAYER 2 AUDIT",
    "============================================================",
    "",
    `[INFO] Gate version: ${result.version}`,
    `[INFO] Stage range auditado: ${String(result.stageRange.first)} → ${String(result.stageRange.last)}`,
    `[INFO] Stage checkpoints: ${String(result.counts.checkpoints)}`,
    `[INFO] Checkpoint files: ${String(result.counts.checkpointFiles)}`,
    `[INFO] Domain roots atuais: ${String(result.counts.domainRoots)}`,
    "",
    "=== GATES ===",
    `[${result.gates.checkpoints ? "OK" : "FAIL"}] Stage 44–69 checkpoints`,
    `[${result.gates.portability ? "OK" : "FAIL"}] Portability Gate v2`,
    `[${result.gates.performance ? "OK" : "FAIL"}] Performance Audit`,
    `[${result.gates.invariants ? "OK" : "FAIL"}] Cross-domain invariants`,
    `[${result.gates.documentation ? "OK" : "FAIL"}] Layer 2 documentation`,
    "",
    "=== RESULTADO ===",
  ];

  if (result.ok) {
    lines.push(
      "[OK] Violações do Final Layer 2 Audit: 0",
      "[OK] Layer 2 pronta para certificação final.",
    );
  } else {
    lines.push(
      `[FAIL] Violações do Final Layer 2 Audit: ${String(result.violations.length)}`,
    );

    for (
      const item of
      result.violations
    ) {
      lines.push(
        `[${item.code}] ${normalizeSlashes(item.scope)} — ${item.message}`,
      );
    }
  }

  return lines.join(
    "\n",
  );
}
