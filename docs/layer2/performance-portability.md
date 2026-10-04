# Performance and Portability

## 1. Portability Gate v2

Command:

```bash
node scripts/architecture/stage66-audit-domain-portability-v2.mjs
```

Machine-readable:

```bash
node scripts/architecture/stage66-audit-domain-portability-v2.mjs --json
```

The gate recursively audits every `src/domain/**/*.ts` source.

### PRT001 — module boundary

Imports/exports/import-types/dynamic imports must remain inside `src/domain`.

### PRT002 — technical runtime globals

Node/DOM/browser/platform globals are prohibited in domain implementation.

Examples:

- `window`;
- `document`;
- `navigator`;
- storage/browser network APIs;
- Canvas/WebGL/WebGPU globals;
- Node `process`/`Buffer`;
- Steamworks globals.

### PRT003 — wall-clock and host timers

Prohibited:

- `Date`;
- `performance`;
- `setTimeout`;
- `setInterval`;
- `requestAnimationFrame`.

Deterministic `SimulationTick`/`DomainDuration` are allowed.

### PRT004 — external entropy

Prohibited:

- `Math.random`;
- `crypto.getRandomValues`;
- `crypto.randomUUID`.

`DeterministicRng` is allowed.

### PRT005 — technical spatial/render/physics symbols

Examples prohibited in Layer 2:

- `Vector2`;
- `Vector3`;
- `Matrix4`;
- `Quaternion`;
- `Object3D`;
- `Mesh`;
- `Sprite`;
- `Camera`;
- concrete colliders/rigid bodies.

### PRT006 — dimension-specific model declarations

Domain declarations ending in `2D` or `3D` are prohibited.

Examples:

```text
Agent2D
Agent3D
Inventory3D
Combat2D
```

### PRT007 — module escapes

Prohibited:

- CommonJS `require`;
- triple-slash external references.

### PRT008 — parse integrity

Audited TypeScript sources must parse successfully.

## 2. Performance Audit

Command:

```bash
node scripts/architecture/stage67-audit-domain-performance.mjs
```

Machine-readable:

```bash
node scripts/architecture/stage67-audit-domain-performance.mjs --json
```

The policy is versioned in:

```text
scripts/architecture/lib/domain-performance-policy-v1.mjs
```

## 3. PERF001 — target existence

Every declared hot-path class/method must exist.

Refactoring a hot method cannot silently remove it from performance governance.

## 4. PERF002 — normal-path allocations

Audited hot paths cannot introduce normal-path:

- `new`;
- array literals;
- object literals;
- closures;
- spread.

Allocations exclusively used to throw domain errors are not treated as
throughput-path allocation.

## 5. PERF003 — materialization

Hot paths cannot hide collection/snapshot materialization such as:

- `map`;
- `filter`;
- `reduce`;
- `sort`;
- `slice`;
- `Array.from`;
- `Object.keys/values/entries`;
- `toSnapshot`;
- `toArray`;
- JSON serialization.

## 6. PERF004 — loop-depth budget

Hot methods declare maximum loop nesting.

Current policy distinguishes:

- scalar lookup: usually depth 0;
- direct scan/binary-search/rejection-sampling: depth 1.

Accidental nested loops fail the audit.

## 7. PERF005 — synchronous hot paths

No:

- `async`;
- `await`;
- `yield`.

Infrastructure async operations do not belong in domain hot loops.

## 8. PERF006 — explicit lifecycle release

Runtime collections keep semantic release APIs.

Current lifecycle coverage includes:

```text
StateStore        delete / clear
TagSet            delete / clear
Inventory         remove / clear
ModifierSet       remove / clear
CooldownSet       remove / clear
StatusEffectSet   remove / pruneTerminal / clear
StoryFlagSet      clear
UnlockSet         lock / clear
```

The goal is to avoid indefinite logical retention of references.

## 9. PERF007 — parse integrity

Performance-audited source files must parse correctly.

## 10. Current hot-path ownership

The v1 policy covers hot operations in:

- `StateStore`;
- `TagSet`;
- `Inventory`;
- `ResourcePool`;
- `ModifierSet`;
- `CooldownSet`;
- `StatusEffectSet`;
- `FactionMatrix`;
- `ProgressionCurve`;
- `DeterministicRng`.

## 11. Discrete allocation is valid

Not every allocation is a bug.

Operations expected to allocate include:

- snapshot capture;
- restore;
- constructing aggregates;
- definition validation;
- tag set algebra;
- immutable snapshot/materialized views;
- save/load orchestration.

The critical distinction is whether the API is intended to run inside a hot
gameplay loop.

## 12. Status effect lifecycle

Terminal effects remain in `StatusEffectSet` until:

```text
pruneTerminal()
```

This is intentional:

```text
advance
  -> state becomes terminal
  -> callers may observe terminal state
  -> explicit prune releases entries
```

## 13. Cooldown lifecycle

Completed cooldowns may remain registered so the same semantic cooldown ID can
be restarted/reused.

Owners release them explicitly with:

- `remove`;
- `clear`.

## 14. Stress tests

Stage 67 includes broad headless stress budgets for catastrophic regression
detection.

They are not hardware microbenchmarks.

The primary performance contract is the AST policy; timing thresholds catch
only severe order-of-magnitude regressions.

## 15. Adding a hot path

If a new method is expected to run at high frequency:

1. avoid transient object/array creation;
2. precompute sorted/materialized data on mutation when appropriate;
3. use Map/Set lookup when identity lookup is dominant;
4. keep lifecycle ownership explicit;
5. add the method to `DOMAIN_HOT_PATHS`;
6. choose a justified loop-depth budget;
7. add behavioral/performance tests;
8. run Stage 66 and 67 gates.

Do not weaken the policy simply to make a regression pass.
