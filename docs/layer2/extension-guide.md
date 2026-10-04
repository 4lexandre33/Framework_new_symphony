# Layer 2 Extension Guide

## 1. Decide whether the concept belongs in Layer 2

A concept belongs in Layer 2 when it is primarily:

- game semantics;
- deterministic state;
- pure rule evaluation;
- logical identity;
- reusable gameplay definition;
- semantic integration between domain concepts.

It normally does **not** belong in Layer 2 when it is primarily:

- rendering;
- physics implementation;
- input device handling;
- asset loading;
- audio playback;
- filesystem/database/network;
- Tauri/Steamworks;
- UI widgets;
- OS integration.

## 2. New identity/value type

Prefer semantic branded identity over untyped strings when identity is part of
the public contract.

Follow existing `DomainId<TKind>` patterns.

Do not use engine object identity as domain identity.

## 3. New mutable aggregate

For mutable runtime state:

1. define constructor invariants;
2. keep mutation methods explicit;
3. expose deterministic read APIs;
4. provide lifecycle release where references can accumulate;
5. define snapshot representation;
6. add or compose a snapshot codec when persistence is required;
7. keep static definitions outside mutable snapshot state.

Ask whether repeated reads allocate. If yes, decide whether materialization can
be cached/rebuilt only on mutation.

## 4. New static definition

Static configuration should prefer immutable definition structures.

If multiple definition kinds must coexist, use the definition registry model
instead of a global mutable singleton.

Validation must be deterministic and pure.

## 5. New cross-domain integration

Place semantic cross-domain composition in:

```text
src/domain/integration
```

only when it can remain independent of infrastructure.

Document:

- inputs;
- mutations;
- rejection/failure behavior;
- atomicity;
- deterministic ordering;
- related invariant.

If the operation requires a renderer, physics query, input service, network or
filesystem, move orchestration above Layer 2.

## 6. New port

Do not create a port just because an API exists.

Create a domain port only when:

- Layer 2/application-facing domain workflow genuinely depends on something
  external;
- the dependency must be inverted;
- the contract can avoid leaking technical implementation types.

Existing examples:

- civil time → `ClockPort`;
- persistence → `SaveGamePort`;
- mod management → `ModdingPort`.

Non-examples:

- deterministic RNG;
- event value creation;
- tags;
- snapshots;
- renderer;
- physics;
- input.

## 7. New random behavior

Use explicit deterministic RNG.

Preferred pattern:

```text
root seed
  ↓
RandomStreamFactory
  ↓
named stream per subsystem
```

Do not use:

- `Math.random`;
- crypto entropy;
- wall clock;
- random IDs generated implicitly in domain logic.

If random state must survive save/restore, include the RNG/stream codec in the
snapshot registry.

## 8. New timed behavior

Use:

- `SimulationTick`;
- `DomainDuration`;
- `SimulationTimer`;
- explicit advancement.

Do not use host timers or wall clock for gameplay progression.

## 9. New semantic event

Create event data with:

- explicit event ID;
- explicit type ID;
- explicit sequence;
- explicit tick where applicable;
- explicit semantic source;
- serializable payload.

Do not publish the event from Layer 2 through a technical event bus.

## 10. New condition

Conditions should remain declarative and evaluated against supplied semantic
state/context.

Do not read renderer/world/platform state from a condition.

## 11. New snapshot codec

A codec needs:

- stable `SnapshotTypeId`;
- explicit schema version;
- serializable state;
- deterministic capture;
- restore validation;
- external static restore context when definitions are required.

Do not silently migrate unsupported schemas.

## 12. New hot path

If an API is expected to execute frequently:

- add it to the Stage 67 policy;
- avoid normal-path allocations;
- avoid hidden sort/materialization;
- bound loop nesting;
- stay synchronous;
- document lifecycle behavior.

## 13. New cross-domain invariant

Add a catalog entry when correctness depends on the relationship between
multiple domain modules.

A valid invariant should be observable and testable.

Examples:

```text
rejected mutation changes nothing
same semantic projection is used in State and Event
replaying same seed/commands gives same result
restore preserves state but not object identity
```

Every Stage 68 catalog entry needs exactly one `@invariant XINVnnn` marker in
its declared test file.

## 14. Dimension independence checklist

Before committing a Layer 2 change verify:

- no `Vector2`/`Vector3`;
- no Mesh/Sprite/Object3D;
- no Camera/Scene;
- no colliders/rigid bodies;
- no WebGL/DOM;
- no engine import;
- no renderer-specific naming like `Agent3D`;
- same test can execute headless.

## 15. Validation checklist

At minimum:

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

If a gate fails, fix the architecture or implementation. Do not remove the
check merely to obtain a green build.
