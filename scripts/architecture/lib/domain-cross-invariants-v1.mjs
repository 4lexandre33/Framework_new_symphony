export const CROSS_DOMAIN_INVARIANT_CATALOG_VERSION =
  "1.0.0";

export const CROSS_DOMAIN_INVARIANTS =
  Object.freeze([
    Object.freeze({
      id: "XINV001",
      title:
        "Reward rejection is atomic",
      domains:
        Object.freeze([
          "economy",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV002",
      title:
        "Reward success conserves exact declared deltas",
      domains:
        Object.freeze([
          "economy",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV003",
      title:
        "Interaction authorization is side-effect free",
      domains:
        Object.freeze([
          "interaction",
          "evaluation",
          "state",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV004",
      title:
        "Quest projection and quest event share one semantic state",
      domains:
        Object.freeze([
          "narrative",
          "state",
          "events",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV005",
      title:
        "Progression unlock application is monotonic and idempotent",
      domains:
        Object.freeze([
          "progression",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV006",
      title:
        "Status effect time advancement is monotonic with explicit terminal pruning",
      domains:
        Object.freeze([
          "mechanics",
          "time",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV007",
      title:
        "Location entered event identity matches semantic location",
      domains:
        Object.freeze([
          "location",
          "events",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants.test.ts",
    }),
    Object.freeze({
      id: "XINV008",
      title:
        "Snapshot restore preserves state while isolating aggregate instances",
      domains:
        Object.freeze([
          "snapshots",
          "state",
          "economy",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants-replay.test.ts",
    }),
    Object.freeze({
      id: "XINV009",
      title:
        "Named RNG streams isolate loot and preserve continuation after restore",
      domains:
        Object.freeze([
          "random",
          "economy",
          "snapshots",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants-replay.test.ts",
    }),
    Object.freeze({
      id: "XINV010",
      title:
        "Same deterministic inputs reproduce the same cross-domain headless outcome",
      domains:
        Object.freeze([
          "economy",
          "random",
          "progression",
          "narrative",
          "state",
          "snapshots",
          "integration",
        ]),
      testFile:
        "tests/domain-cross-domain-invariants-replay.test.ts",
    }),
  ]);

export function getCrossDomainInvariantIds() {
  return Object.freeze(
    CROSS_DOMAIN_INVARIANTS.map(
      (entry) =>
        entry.id,
    ),
  );
}
