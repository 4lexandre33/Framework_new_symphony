# State, Persistence and Determinism

## 1. StateStore

`StateStore` is the generic semantic key/value store.

Properties:

- `Map`-backed lookup;
- JSON-like `StateValue`;
- finite numeric values only;
- frozen cloned values at write boundaries;
- deterministic snapshot ordering.

It is not:

- an ECS;
- localStorage;
- a renderer store;
- a Redux replacement for UI state.

## 2. Deterministic time

Gameplay uses:

```text
SimulationTick
DomainDuration
SimulationTimer
```

Rules:

- no `Date.now`;
- no `performance.now`;
- no host timers;
- caller advances gameplay time explicitly.

`ClockPort.nowEpochMs()` exists separately for civil timestamp metadata at
application boundaries.

## 3. Snapshot architecture

Stage 63 introduced:

```text
SnapshotTypeId
SnapshotSlotId
SnapshotValue
SnapshotCodec
DomainSnapshotRegistry
SnapshotBundle
SnapshotCoordinator
RestoredSnapshotSet
```

Capture:

```text
runtime aggregate
      ↓ codec.capture
snapshot state
      ↓ normalization
SnapshotBundle entry
```

Restore:

```text
SnapshotBundle entry
      ↓ codec lookup
schema validation
      ↓
external static context when required
      ↓
new runtime aggregate
```

Restore creates new aggregate instances rather than mutating caller-owned
instances.

## 4. Snapshot value rules

Snapshot values are JSON-safe semantic trees:

- `null`;
- boolean;
- string;
- finite number;
- arrays;
- plain objects.

Not accepted:

- functions;
- symbols;
- `bigint`;
- `Date`;
- `Map`;
- `Set`;
- class instances;
- cyclic object graphs;
- non-finite numbers.

Object keys are canonicalized deterministically.

## 5. Snapshot versioning

There are three distinct version layers.

```text
VersionedSnapshot.schemaVersion
  application/save envelope

SnapshotBundleSnapshot.schemaVersion
  runtime bundle structure

SnapshotBundleEntry.schemaVersion
  aggregate codec version
```

These are intentionally separate.

Stage 63/65 do not implement automatic migration between incompatible versions.

## 6. Standard codecs

The standard snapshot registry contains 19 runtime codecs:

```text
Agent
AbilityAction
StateStore
SimulationTimer
Inventory
CurrencyAccount
ResourcePool
CooldownSet
ModifierSet
StatusEffectSet
FactionMatrix
Reputation
Relationship
ExperiencePool
LevelProgression
UnlockSet
NarrativeState
StoryFlagSet
TagSet
```

Restore contexts:

```text
Inventory
  -> ReadonlyMap<ItemId, Item>

LevelProgression
  -> ProgressionCurve

NarrativeState
  -> QuestDefinition[]
```

Static definition data stays outside mutable runtime snapshots.

## 7. Random codecs

Stage 64 adds two optional codecs:

```text
runtime.deterministic-rng
runtime.random-stream
```

They are additive.

Composition example:

```ts
new DomainSnapshotRegistry([
  ...createStandardRuntimeSnapshotCodecs(),
  ...createRandomRuntimeSnapshotCodecs(),
]);
```

The standard 19-codec registry remains stable.

## 8. Deterministic RNG

Algorithm identifier:

```text
xoshiro128ss-v1
```

State:

```text
4 × uint32 = 128-bit
drawCount
```

Sources of seed:

- explicit uint32;
- deterministic string hash;
- explicit 4-word state;
- deterministic child-seed derivation.

There is no implicit entropy source.

## 9. Random streams

`RandomStreamFactory(rootSeed)` derives a stream seed only from:

```text
root seed + RandomStreamId
```

Therefore:

```text
consume stream.ai
    does not alter
stream.loot
```

Forking a child stream also does not consume the parent.

## 10. Random snapshot continuation

A `RandomStreamSnapshot` preserves:

- stream ID;
- stable seed;
- current RNG state;
- draw count.

After restore, the next sample is exactly the same as it would have been in the
original stream.

This is covered by `XINV009`.

## 11. Replay contract

Deterministic replay requires:

- same code/algorithm versions;
- same static definitions;
- same initial semantic state;
- same RNG seeds;
- same command ordering within each stream;
- same tick/duration inputs.

With those inputs held constant, Layer 2 is expected to reproduce the same
semantic outcome.

This is covered end-to-end by `XINV010`.

## 12. SaveGamePort

Persistence is abstracted as:

```text
SaveGamePort<TState>
```

Canonical Layer 2 specialization:

```text
DomainSaveGamePort
=
SaveGamePort<SnapshotBundleSnapshot>
```

The port does not dictate:

- JSON;
- binary format;
- filesystem;
- SQLite;
- Steam Cloud;
- Tauri command;
- compression;
- encryption.

Concrete persistence belongs outside Layer 2.

## 13. Save/load ownership

Recommended flow:

```text
domain aggregates
      ↓
SnapshotCoordinator.capture()
      ↓
SnapshotBundleSnapshot
      ↓
VersionedSnapshot
      ↓
SaveLoadUseCase
      ↓
DomainSaveGamePort
      ↓
storage adapter
```

Load reverses the boundary and then restores aggregates with the appropriate
static definition contexts.

## 14. Determinism versus security

`DeterministicRng` is for gameplay/replay/tests.

It is **not cryptographic** and must not be used for:

- authentication;
- secrets;
- security tokens;
- cryptographic keys;
- security-sensitive randomness.
