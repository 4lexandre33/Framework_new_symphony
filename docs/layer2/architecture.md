# Layer 2 Architecture

## 1. Boundary

Layer 2 is the semantic center of the game.

```text
┌─────────────────────────────────────────────┐
│              app / services                 │
│     orchestration, workflows, side effects  │
└──────────────────────┬──────────────────────┘
                       │ uses
                       ▼
┌─────────────────────────────────────────────┐
│                src/domain                   │
│ semantic model, rules, deterministic state  │
└──────────────────────┬──────────────────────┘
                       │ represented/executed by
                       ▼
┌─────────────────────────────────────────────┐
│         engine / plugins / platform         │
│ render, physics, input, storage, Steam/Tauri│
└─────────────────────────────────────────────┘
```

The dependency arrow from `src/domain` to the lower technical box does **not**
exist in code. Technical layers adapt to the domain, not the reverse.

## 2. Dimension independence

A domain `Agent` is logical identity and gameplay state. It does not own:

- `Vector2` or `Vector3`;
- scene transforms;
- `Object3D`;
- `Sprite`;
- `Mesh`;
- camera references;
- rigid bodies/colliders;
- render materials.

A renderer/world adapter can associate an `AgentId` with a technical spatial
representation outside Layer 2.

This means the same `Agent`, `Inventory`, `QuestState`, `Reward`,
`StatusEffectSet`, `NarrativeState` and `StateStore` work unchanged for:

```text
2D          logical model + 2D adapter
2.5D        logical model + hybrid adapter
3D          logical model + 3D adapter
headless    logical model + no renderer
```

## 3. Identity model

Stable semantic identity is based on branded `DomainId<TKind>` values.

Examples include:

- `AgentId`;
- `WorldObjectId`;
- `LocationId`;
- `ConditionId`;
- `StatusEffectId`;
- `ModifierId`;
- `CurrencyId`;
- `QuestId`;
- `UnlockId`;
- `DefinitionId`;
- `SnapshotTypeId`;
- `RandomStreamId`.

IDs identify domain concepts; they are not pointers to renderer objects or
platform resources.

## 4. Mutable state versus definitions

Layer 2 separates immutable/static definitions from mutable runtime state.

Examples:

```text
static definition                mutable runtime
-----------------------------    -----------------------------
Item                             Inventory quantities
QuestDefinition                  QuestState / NarrativeState
ProgressionCurve                 ExperiencePool/LevelProgression
StatusEffect                     StatusEffectInstance/Set
DefinitionSet                    application-owned runtime usage
```

Snapshot restore receives static definitions as external restore context when
necessary. Static definitions are not duplicated blindly into runtime save
state.

## 5. Semantic location

`src/domain/location` models logical location relationships rather than metric
coordinates.

It can express:

- location identity;
- zones;
- semantic relations;
- graph connectivity.

Pathfinding meshes, navmeshes, transforms and physics queries remain outside
Layer 2.

## 6. State and evaluation

`StateStore` owns JSON-like semantic values by `StateKey`.

`ConditionEvaluator` consumes condition expressions and state values.

The direction is:

```text
StateStore
   ↓ read
ConditionEvaluator
   ↓ result
Interaction authorization / game rules
```

Evaluation does not mutate state.

## 7. Domain time

Gameplay timing uses:

- `SimulationTick`;
- `DomainDuration`;
- `SimulationTimer`.

This is separate from `ClockPort`.

```text
SimulationTick / DomainDuration
  deterministic gameplay time

ClockPort.nowEpochMs()
  external civil timestamp metadata
```

Gameplay cooldowns and status effects do not depend on wall-clock time.

## 8. Domain events

`DomainEvent` is serializable data.

Layer 2 creates event values but does not require an event bus.

Event delivery belongs above the domain.

This prevents hidden infrastructure side effects and keeps headless evaluation
possible.

## 9. Mechanics

`src/domain/mechanics` contains rule/state concepts such as:

- `AbilityAction`;
- `SkillTreeGraph`;
- `StatusEffectSet`;
- `ModifierSet`;
- `ResourcePool`;
- `CooldownSet`;
- damage/healing rules;
- movement/traversal semantics;
- requirement rules.

Movement rules are semantic. They do not perform pathfinding or mutate a scene
transform.

## 10. Interaction

`Affordance` describes what semantic interactions a target offers and which
requirements must be satisfied.

An accepted interaction outcome means authorization. It does not implicitly:

- move an entity;
- open a rendered door;
- play audio;
- trigger animation;
- invoke a Tauri command.

Those actions are orchestrated by upper layers.

## 11. Relations

Relations are directional unless the owning rule explicitly writes both
directions.

The domain provides:

- `FactionMatrix`;
- `FactionRelation`;
- `Reputation`;
- `Relationship`.

No renderer/team-color/UI concept is embedded.

## 12. Economy

Economy contains:

- currency accounts;
- costs;
- rewards;
- loot tables;
- crafting recipes;
- inventory/items.

`LootTable` consumes a minimal structural random source (`nextFloat`) and does
not import the random module directly.

`Reward` is declarative. Mutation of Inventory/Currency occurs through explicit
integration.

## 13. Progression

Progression contains:

- `ProgressionCurve`;
- `ExperiencePool`;
- `LevelProgression`;
- `UnlockSet`;
- progression snapshots.

Level is derived from total experience and the supplied curve.

Unlock integration is explicit and idempotent.

## 14. Narrative

Narrative contains:

- `DialogueGraph`;
- `QuestGoal`;
- `QuestDefinition`;
- `QuestState`;
- `NarrativeState`;
- `StoryFlagSet`.

Quest definitions are static. Quest/Narrative state is mutable runtime state.

Quest → State/Event projection lives in `src/domain/integration`.

## 15. Definitions and tags

Definitions provide immutable registries by semantic kind/id.

Tags provide canonical semantic classification.

Neither system executes gameplay by itself.

A definition registry is composition-time data; a tag is not a renderer layer,
ECS component or engine handle.

## 16. Integration layer

`src/domain/integration` is still inside Layer 2.

It exists to connect already-defined semantic concepts without introducing
technical infrastructure.

Integration functions must remain:

- deterministic;
- headless;
- explicit about mutation;
- testable without renderer/physics/platform;
- compatible with Layer 2 portability/performance rules.

## 17. Snapshots

Snapshots standardize capture/restore of mutable runtime state.

The `SnapshotCoordinator` operates in memory.

It does not perform filesystem/network/Steam Cloud I/O.

The coordinator works through codecs registered in an immutable
`DomainSnapshotRegistry`.

## 18. Random

`DeterministicRng` uses explicit seed/state.

Named `RandomStream`s isolate subsystems.

The random module does not use:

- `Math.random`;
- crypto entropy;
- wall clock;
- platform entropy.

## 19. Ports

Ports exist only for real external dependencies:

- `ClockPort`;
- `SaveGamePort<TState>`;
- `DomainSaveGamePort`;
- `ModdingPort`.

No `RendererPort`, `PhysicsPort`, `InputPort`, `RandomPort` or `EventBusPort`
exists in Layer 2.

See [Extension guide](./extension-guide.md) before introducing another port.

## 20. Executable architecture

The architecture is not documentation-only.

It is enforced by:

- architecture boundaries/dependency graph;
- Portability Gate v2;
- Performance Audit;
- Cross-domain invariant catalog;
- TypeScript strict compilation;
- Vitest;
- production build.

See [Performance and portability](./performance-portability.md).
