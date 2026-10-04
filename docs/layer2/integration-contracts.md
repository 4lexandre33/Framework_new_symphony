# Layer 2 Integration Contracts

## 1. Principle

Cross-domain integration is explicit.

A subsystem does not secretly reach into another subsystem through global
singletons, event buses or engine services.

Current integration ownership lives in:

```text
src/domain/integration/
```

## 2. ConditionStateIntegration

Flow:

```text
StateStore
   ↓
ConditionEvaluator
   ↓
condition result
```

Responsibility:

- resolve a condition against supplied semantic state.

Invariant:

- evaluation must not mutate `StateStore`.

Related cross-domain invariant:

- `XINV003`.

## 3. InteractionConditionIntegration

Flow:

```text
InteractionIntent
       +
Affordance requirements
       +
Condition definitions
       +
StateStore
       ↓
InteractionOutcome
```

Responsibility:

- authorize/reject semantic interaction.

Not responsible for:

- opening a rendered door;
- changing transform;
- playing animation/audio;
- invoking engine/platform side effects.

Related invariant:

- `XINV003`.

## 4. LocationEventIntegration

Flow:

```text
LocationRef
   ↓
DomainEvent(location.entered)
```

Event identity preserves:

- current `LocationId`;
- previous location when supplied;
- caller-provided `SimulationTick`;
- caller-provided sequence;
- current location as semantic event source.

Related invariant:

- `XINV007`.

## 5. StatusEffectTimeIntegration

Flow:

```text
DomainDuration
      ↓
StatusEffectSet.advance()
```

Rules:

- time advancement is deterministic;
- remaining duration does not increase;
- terminal effects remain observable until explicit `pruneTerminal()`.

Related invariant:

- `XINV006`.

## 6. QuestIntegration

Two explicit projections exist.

### Quest → State

```text
QuestState
   ↓
Quest state projection
   ↓
StateStore
```

### Quest → Event

```text
QuestState
   ↓
DomainEvent
```

For the same quest state, projection and event payload current state must be
semantically coherent.

Related invariant:

- `XINV004`.

## 7. RewardGrantIntegration

Flow:

```text
Reward
  ├── CurrencyAccount[]
  └── Inventory + Item definitions
          ↓
       preflight
          ↓
     atomic mutation
```

Rules:

1. validate all targets first;
2. reject missing currency accounts/definitions;
3. reject quantity/capacity/overflow conflicts;
4. only mutate after the complete preflight passes.

Rejected grant:

```text
CurrencyAccount unchanged
Inventory unchanged
```

Accepted grant:

```text
currency delta == Reward declaration
item delta == Reward declaration
```

Related invariants:

- `XINV001`;
- `XINV002`.

## 8. ProgressionUnlockIntegration

Flow:

```text
LevelProgression
       +
ProgressionUnlockPlan
       ↓
UnlockSet
```

Rules:

- unlock is monotonic unless another explicit rule calls `lock`;
- applying the same plan repeatedly is idempotent;
- already-unlocked IDs are not duplicated.

Related invariant:

- `XINV005`.

## 9. Snapshot integration

Snapshots are cross-domain infrastructure inside Layer 2, but remain pure and
in-memory.

Restore contexts reconnect static definitions to runtime snapshots without
duplicating definition data.

Related invariant:

- `XINV008`.

## 10. Random/Economy integration

`LootTable` depends on the structural capability:

```text
nextFloat(): number
```

`DeterministicRng` and `RandomStream` satisfy that contract without Economy
importing the random module.

Named streams isolate random call order between subsystems.

Related invariant:

- `XINV009`.

## 11. Deterministic replay

The strongest current cross-domain property is:

```text
same definitions
+ same semantic commands
+ same seed
+ same command order per stream
        ↓
same domain result
```

The Stage 68 replay scenario covers:

- Loot;
- Reward grant;
- Inventory;
- Currency;
- Progression;
- Unlocks;
- Narrative;
- State;
- SnapshotBundle.

Related invariant:

- `XINV010`.

## 12. Invariant catalog

The executable catalog contains exactly:

```text
XINV001 Reward rejection atomicity
XINV002 Reward exact-delta conservation
XINV003 Interaction authorization side-effect freedom
XINV004 Quest State/Event semantic coherence
XINV005 Progression unlock monotonicity/idempotency
XINV006 StatusEffect time monotonicity + explicit prune
XINV007 Location event identity coherence
XINV008 Snapshot preservation + instance isolation
XINV009 RNG stream isolation + restore continuation
XINV010 Deterministic cross-domain headless replay
```

Governance source:

```text
scripts/architecture/lib/domain-cross-invariants-v1.mjs
```

Coverage command:

```bash
node scripts/architecture/stage68-audit-cross-domain-invariants.mjs
```

## 13. Adding a new integration

A new integration should exist only if:

- at least two domain concepts must be coordinated;
- orchestration is still semantic and headless;
- no renderer/physics/platform service is required;
- mutation ownership is explicit;
- failure behavior is explicit;
- deterministic tests can cover the composition.

If the operation requires filesystem, network, renderer, input or native
platform calls, it belongs above Layer 2.
