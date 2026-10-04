# Projeto1 — Layer 2 Domain

**Status:** documented through Stage 69  
**Architecture baseline:** v20  
**Scope:** `src/domain/**`  
**Target:** reusable in 2D, 2.5D, 3D and headless execution

## 1. Purpose

Layer 2 contains the game-semantic model that must remain independent from the
technical execution stack.

It defines:

- logical identities and entities;
- semantic locations and world-object references;
- mutable semantic state;
- deterministic simulation time;
- domain events;
- conditions/evaluation;
- gameplay mechanics;
- interaction authorization;
- factions, reputation and relationships;
- economy;
- progression;
- narrative;
- static definitions and tags;
- cross-domain integration functions;
- snapshots/restore;
- deterministic random streams;
- infrastructure-facing ports.

It does **not** decide how those concepts are rendered, simulated by a concrete
physics engine, read from desktop input, persisted by a filesystem, or exposed
through Tauri/Steamworks.

## 2. Hard invariant

The Layer 2 invariant is:

```text
L2-DIMENSION-AGNOSTIC

src/domain/**
  ZERO Three.js
  ZERO Babylon.js
  ZERO Rapier
  ZERO WebGL
  ZERO DOM
  ZERO Tauri
  ZERO Steamworks
  ZERO src/engine/**
  ZERO src/services/**
  ZERO src/app/**
  ZERO src/plugins/**

same semantic model
  -> 2D
  -> 2.5D
  -> 3D
  -> headless
```

Spatial presentation/execution data such as `Vector3`, `Mesh`, `Sprite`,
`Camera`, colliders or rigid bodies belongs outside Layer 2.

## 3. Source layout

Current domain roots:

```text
src/domain/
├── definitions/
├── economy/
├── entities/
├── evaluation/
├── events/
├── integration/
├── interaction/
├── location/
├── mechanics/
├── narrative/
├── ports/
├── progression/
├── random/
├── relations/
├── snapshots/
├── state/
├── tags/
└── time/
```

See [Domain reference](./domain-reference.md) for responsibilities and ownership.

## 4. Architectural direction

The main dependency direction is:

```text
semantic primitives
        ↓
domain aggregates/rules
        ↓
pure cross-domain integration
        ↓
application/services outside Layer 2
        ↓
engine/plugins/platform adapters
```

Layer 2 may depend on other Layer 2 modules through relative imports, but it
cannot reach upward into application, services, engine, plugins or platform
packages.

The executable enforcement is documented in
[Performance and portability](./performance-portability.md).

## 5. State, persistence and determinism

Layer 2 separates four concepts:

```text
semantic mutable state
        ↓
snapshot representation
        ↓
snapshot bundle
        ↓
SaveGamePort boundary
        ↓
concrete persistence outside Layer 2
```

Deterministic random state is explicit and serializable. Wall-clock time is not
used for gameplay progression.

See
[State, persistence and determinism](./state-persistence-determinism.md).

## 6. Cross-domain composition

Cross-domain behavior is implemented as explicit pure/domain-level integration,
not hidden inside infrastructure callbacks.

Current integrations connect:

- Location → DomainEvent;
- State → Conditions;
- Conditions → Interaction authorization;
- DomainDuration → StatusEffectSet;
- QuestState → StateStore;
- QuestState → DomainEvent;
- Reward → CurrencyAccount + Inventory;
- LevelProgression → UnlockSet.

See [Integration contracts](./integration-contracts.md).

## 7. Performance model

Layer 2 distinguishes:

**hot paths**
- frequent scalar reads/evaluation/advance operations;
- expected to avoid normal-path temporary allocations and materialization.

**discrete operations**
- snapshots;
- restore;
- construction;
- definition validation;
- set algebra;
- save/load;
- explicit lifecycle cleanup.

Discrete operations may allocate because they are not intended as per-frame
hot paths.

See [Performance and portability](./performance-portability.md).

## 8. Extension rule

Before adding a new domain type, answer:

1. Is it semantic game state/rule, or is it technical execution?
2. Does it require renderer/physics/input/platform knowledge?
3. Is it mutable runtime state that needs snapshot support?
4. Is it a hot-path operation that belongs in the performance policy?
5. Does it create a new cross-domain invariant?
6. Does it represent a real external dependency requiring a port?

Use [Extension guide](./extension-guide.md).

## 9. Validation

Layer 2 is currently protected by:

```bash
node scripts/architecture/stage66-audit-domain-portability-v2.mjs
node scripts/architecture/stage67-audit-domain-performance.mjs
node scripts/architecture/stage68-audit-cross-domain-invariants.mjs
node scripts/architecture/stage69-audit-documentation.mjs
npm run arch:check
npx tsc --noEmit
npx vitest run
npm run build
```

Stage 69 documentation does not replace executable tests or architectural
guardrails. Code and executable gates remain authoritative.

## 10. Authority

When documentation conflicts with implementation, use this order:

1. current domain code and public APIs;
2. executable architecture/portability/performance/invariant gates;
3. current Layer 2 documentation;
4. historical stage documents.

Historical stage artifacts explain how the system evolved; they are not a
license to bypass the current contracts.

## 11. Stage status

Layer 2 work documented here spans Stages 44 through 69.

Stage 70 is the **Final Layer 2 Gate** and is intentionally not implemented by
this documentation stage.

See [Stage history](./stage-history.md).
