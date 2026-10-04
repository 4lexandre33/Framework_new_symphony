# Layer 2 Domain Reference

This file documents every current direct root under `src/domain`.

## `src/domain/entities`

Owns foundational semantic identity and entity-level primitives.

Key concepts:

- `DomainId`;
- `VersionedSnapshot`;
- `Agent`;
- `WorldObjectId`;
- `WorldObjectRef`;
- `ObjectStateRef`;
- `ObjectProp`.

`Agent` contains logical gameplay state only. World-object references do not
carry renderer/physics objects.

## `src/domain/location`

Owns semantic space.

Key concepts:

- `LocationId`;
- `LocationRef`;
- `LocationZone`;
- `LocationRelation`;
- `LocationGraph`.

No coordinates, vectors, transforms, navmesh or physics world are required.

## `src/domain/state`

Owns generic deterministic semantic state.

Key concepts:

- `StateKey`;
- `StateValue`;
- `StateSnapshot`;
- `StateStore`.

`StateValue` is JSON-like and finite. `StateStore` uses keyed lookup and
deterministic snapshot ordering.

## `src/domain/time`

Owns deterministic gameplay time.

Key concepts:

- `SimulationTick`;
- `DomainDuration`;
- `SimulationTimer`;
- `TimerSnapshot`.

This module does not read host wall-clock time.

## `src/domain/events`

Owns domain-event data.

Key concepts:

- `DomainEventId`;
- `DomainEventTypeId`;
- `DomainEventMetadata`;
- `DomainEvent`;
- `DomainEventBatch`.

It does not own event delivery/pub-sub infrastructure.

## `src/domain/evaluation`

Owns pure conditions/results.

Key concepts:

- `DomainResult`;
- `ConditionId`;
- `ComparisonOperator`;
- `ConditionExpression`;
- `ConditionEvaluator`.

Evaluation reads supplied semantic state and returns a result without implicit
mutation.

## `src/domain/mechanics`

Owns reusable gameplay mechanics and rule evaluation.

Key concepts include:

- `AbilityAction`;
- `SkillTreeGraph`;
- `StatusEffect`;
- `StatusEffectInstance`;
- `StatusEffectSet`;
- `Modifier`;
- `ModifierSet`;
- `ResourcePool`;
- `Cooldown`;
- `CooldownSet`;
- `DamageRule`;
- `HealingRule`;
- `MovementRule`;
- `TraversalRule`;
- `RequirementRule`;
- `GameplayRuleOutcome`.

Movement/traversal are semantic permissions/intents, not renderer or physics
execution.

## `src/domain/interaction`

Owns semantic interaction authorization.

Key concepts:

- `InteractionId`;
- `InteractionIntent`;
- `InteractionRequirement`;
- `InteractionOutcome`;
- `Affordance`.

Accepted interaction does not automatically execute technical side effects.

## `src/domain/relations`

Owns social/faction relationships.

Key concepts:

- `FactionId`;
- `FactionRelation`;
- `FactionMatrix`;
- `Reputation`;
- `Relationship`.

Relations can be directional. No UI coloring or technical team representation
is embedded.

## `src/domain/economy`

Owns inventory and economic declarations/state.

Key concepts:

- `Item`;
- `Inventory`;
- `CurrencyId`;
- `CurrencyAccount`;
- `Cost`;
- `Reward`;
- `RewardPolicy`;
- `LootEntry`;
- `LootTable`;
- `CraftingRecipe`.

`Reward` and crafting data are declarative. Cross-domain mutation is explicit.

## `src/domain/progression`

Owns experience/level/unlock state.

Key concepts:

- `ProgressionCurve`;
- `ExperiencePool`;
- `LevelProgression`;
- `UnlockSet`;
- `ProgressionSnapshot`.

Level is derived from total XP plus a static curve.

## `src/domain/narrative`

Owns dialogue, quests and story state.

Key concepts:

- `DialogueGraph`;
- `QuestGoal`;
- `QuestId`;
- `QuestDefinition`;
- `QuestState`;
- `NarrativeState`;
- `StoryFlagSet`.

Quest definitions remain separate from runtime quest state.

## `src/domain/definitions`

Owns immutable multi-kind static definition registries.

Key concepts:

- `DefinitionKindId`;
- `DefinitionId`;
- `DefinitionRef`;
- `DefinitionValidator`;
- `DefinitionSet`;
- `GameDefinitions`.

Definition validation is pure and deterministic. The registry does not execute
gameplay.

## `src/domain/tags`

Owns canonical semantic tags.

Key concepts:

- `DomainTag`;
- `TagSet`.

Tags are normalized, deduplicated and deterministically ordered.

## `src/domain/integration`

Owns explicit cross-domain semantic composition.

Current implementation files:

- `ConditionStateIntegration`;
- `InteractionConditionIntegration`;
- `LocationEventIntegration`;
- `ProgressionUnlockIntegration`;
- `QuestIntegration`;
- `RewardGrantIntegration`;
- `StatusEffectTimeIntegration`.

See [Integration contracts](./integration-contracts.md).

## `src/domain/snapshots`

Owns in-memory versioned snapshot capture/restore.

Key concepts:

- `SnapshotTypeId`;
- `SnapshotSlotId`;
- `SnapshotValue`;
- `SnapshotCodec`;
- `DomainSnapshotRegistry`;
- `SnapshotBundle`;
- `SnapshotCoordinator`;
- standard runtime snapshot codecs.

See
[State, persistence and determinism](./state-persistence-determinism.md).

## `src/domain/random`

Owns deterministic gameplay random generation.

Key concepts:

- `RandomSeed`;
- `DeterministicRng`;
- `RandomStream`;
- `RandomStreamFactory`;
- RNG snapshot codecs.

Algorithm identifier:

```text
xoshiro128ss-v1
```

See
[State, persistence and determinism](./state-persistence-determinism.md).

## `src/domain/ports`

Owns abstractions for actual external dependencies.

Approved ports:

- `ClockPort`;
- `SaveGamePort<TState>`;
- `DomainSaveGamePort`;
- `ModdingPort`.

Ports do not expose Tauri, Steamworks, filesystem, renderer or physics types.

## Public ownership rules

Domain roots expose their supported public API through local `index.ts` files
where present.

Consumers should import semantic types/functions from the owning domain root
rather than reaching into unrelated technical layers.

Cross-domain integrations should be placed in `src/domain/integration` when
they coordinate multiple domain concepts and remain pure/headless.

## Snapshot responsibility matrix

| Mutable aggregate | Snapshot strategy |
|---|---|
| Agent | standard codec |
| AbilityAction | standard codec |
| StateStore | standard codec |
| SimulationTimer | standard codec |
| Inventory | standard codec + Item definition context |
| CurrencyAccount | standard codec |
| ResourcePool | standard codec |
| CooldownSet | standard codec |
| ModifierSet | standard codec |
| StatusEffectSet | standard codec |
| FactionMatrix | standard codec |
| Reputation | standard codec |
| Relationship | standard codec |
| ExperiencePool | standard codec |
| LevelProgression | standard codec + ProgressionCurve context |
| UnlockSet | standard codec |
| NarrativeState | standard codec + QuestDefinition context |
| StoryFlagSet | standard codec |
| TagSet | standard codec |
| DeterministicRng | additive random codec |
| RandomStream | additive random codec |

The standard registry contains the first 19 codecs. RNG codecs are composed
explicitly when deterministic stream state also needs persistence.
