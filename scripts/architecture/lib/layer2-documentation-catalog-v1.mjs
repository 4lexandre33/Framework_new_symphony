export const LAYER2_DOCUMENTATION_CATALOG_VERSION =
  "1.0.0";

export const LAYER2_DOCUMENTS =
  Object.freeze([
    Object.freeze({
      path:
        "docs/layer2/README.md",
      requiredTokens:
        Object.freeze([
          "L2-DIMENSION-AGNOSTIC",
          "src/domain/",
          "Stage 70",
          "Final Layer 2 Gate",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/architecture.md",
      requiredTokens:
        Object.freeze([
          "Dimension independence",
          "SnapshotCoordinator",
          "DeterministicRng",
          "ClockPort",
          "SaveGamePort<TState>",
          "ModdingPort",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/domain-reference.md",
      requiredTokens:
        Object.freeze([]),
    }),
    Object.freeze({
      path:
        "docs/layer2/integration-contracts.md",
      requiredTokens:
        Object.freeze([
          "ConditionStateIntegration",
          "InteractionConditionIntegration",
          "LocationEventIntegration",
          "ProgressionUnlockIntegration",
          "QuestIntegration",
          "RewardGrantIntegration",
          "StatusEffectTimeIntegration",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/state-persistence-determinism.md",
      requiredTokens:
        Object.freeze([
          "xoshiro128ss-v1",
          "SnapshotBundleSnapshot",
          "DomainSaveGamePort",
          "runtime.deterministic-rng",
          "runtime.random-stream",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/performance-portability.md",
      requiredTokens:
        Object.freeze([
          "PRT001",
          "PRT008",
          "PERF001",
          "PERF007",
          "DOMAIN_HOT_PATHS",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/extension-guide.md",
      requiredTokens:
        Object.freeze([
          "New mutable aggregate",
          "New cross-domain integration",
          "New port",
          "New snapshot codec",
          "New hot path",
          "New cross-domain invariant",
        ]),
    }),
    Object.freeze({
      path:
        "docs/layer2/stage-history.md",
      requiredTokens:
        Object.freeze([
          "Stage 44",
          "Stage 45",
          "Stage 46",
          "Stage 47",
          "Stage 48",
          "Stage 49",
          "Stage 50",
          "Stage 51",
          "Stage 52",
          "Stage 53",
          "Stage 54",
          "Stage 55",
          "Stage 56",
          "Stage 57",
          "Stage 58",
          "Stage 59",
          "Stage 60",
          "Stage 61",
          "Stage 62",
          "Stage 63",
          "Stage 64",
          "Stage 65",
          "Stage 66",
          "Stage 67",
          "Stage 68",
          "Stage 69",
          "Stage 70",
        ]),
    }),
  ]);

export const EXPECTED_DOMAIN_ROOTS =
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

export const EXPECTED_INTEGRATION_NAMES =
  Object.freeze([
    "ConditionStateIntegration",
    "InteractionConditionIntegration",
    "LocationEventIntegration",
    "ProgressionUnlockIntegration",
    "QuestIntegration",
    "RewardGrantIntegration",
    "StatusEffectTimeIntegration",
  ]);

export const EXPECTED_CROSS_INVARIANTS =
  Object.freeze([
    "XINV001",
    "XINV002",
    "XINV003",
    "XINV004",
    "XINV005",
    "XINV006",
    "XINV007",
    "XINV008",
    "XINV009",
    "XINV010",
  ]);

export const EXPECTED_PORTABILITY_RULES =
  Object.freeze([
    "PRT001",
    "PRT002",
    "PRT003",
    "PRT004",
    "PRT005",
    "PRT006",
    "PRT007",
    "PRT008",
  ]);

export const EXPECTED_PERFORMANCE_RULES =
  Object.freeze([
    "PERF001",
    "PERF002",
    "PERF003",
    "PERF004",
    "PERF005",
    "PERF006",
    "PERF007",
  ]);

export const EXPECTED_STANDARD_SNAPSHOT_AGGREGATES =
  Object.freeze([
    "Agent",
    "AbilityAction",
    "StateStore",
    "SimulationTimer",
    "Inventory",
    "CurrencyAccount",
    "ResourcePool",
    "CooldownSet",
    "ModifierSet",
    "StatusEffectSet",
    "FactionMatrix",
    "Reputation",
    "Relationship",
    "ExperiencePool",
    "LevelProgression",
    "UnlockSet",
    "NarrativeState",
    "StoryFlagSet",
    "TagSet",
  ]);
