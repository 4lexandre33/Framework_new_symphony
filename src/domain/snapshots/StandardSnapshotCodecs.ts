import {
  Agent,
} from "../entities";

import type {
  AgentSnapshot,
} from "../entities";

import {
  CurrencyAccount,
  Inventory,
} from "../economy";

import type {
  CurrencyAccountSnapshot,
  InventorySnapshot,
  Item,
  ItemId,
} from "../economy";

import {
  AbilityAction,
  CooldownSet,
  ModifierSet,
  ResourcePool,
  StatusEffectSet,
} from "../mechanics";

import type {
  AbilityActionSnapshot,
  CooldownSetSnapshot,
  ModifierSetSnapshot,
  ResourcePoolSnapshot,
  StatusEffectSetSnapshot,
} from "../mechanics";

import {
  NarrativeState,
  StoryFlagSet,
} from "../narrative";

import type {
  NarrativeStateSnapshot,
  QuestDefinition,
  StoryFlagSetSnapshot,
} from "../narrative";

import {
  ExperiencePool,
  LevelProgression,
  UnlockSet,
} from "../progression";

import type {
  ExperiencePoolSnapshot,
  LevelProgressionSnapshot,
  ProgressionCurve,
  UnlockSetSnapshot,
} from "../progression";

import {
  FactionMatrix,
  Relationship,
  Reputation,
} from "../relations";

import type {
  FactionMatrixSnapshot,
  RelationshipSnapshot,
  ReputationSnapshot,
} from "../relations";

import {
  StateStore,
} from "../state";

import type {
  StateSnapshot,
} from "../state";

import {
  TagSet,
} from "../tags";

import type {
  TagSetSnapshot,
} from "../tags";

import {
  SimulationTimer,
} from "../time";

import type {
  TimerSnapshot,
} from "../time";

import {
  defineSnapshotCodec,
  toRuntimeSnapshotCodec,
} from "./SnapshotCodec";

import type {
  RuntimeSnapshotCodec,
  SnapshotCodec,
} from "./SnapshotCodec";

import {
  DomainSnapshotRegistry,
} from "./DomainSnapshotRegistry";

import {
  createSnapshotTypeId,
} from "./SnapshotIds";

export type StandardSnapshotCodecErrorCode =
  | "invalid-snapshot"
  | "missing-context"
  | "missing-definition"
  | "definition-mismatch"
  | "derived-value-mismatch";

export class StandardSnapshotCodecError
  extends Error {
  public readonly name =
    "StandardSnapshotCodecError";

  public constructor(
    public readonly code:
      StandardSnapshotCodecErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function invalidSnapshot(
  label: string,
  error: unknown,
): never {
  if (
    error instanceof
    StandardSnapshotCodecError
  ) {
    throw error;
  }

  throw new StandardSnapshotCodecError(
    "invalid-snapshot",
    `${label} snapshot inválido: ${
      error instanceof Error
        ? error.message
        : String(error)
    }`,
  );
}

function requireObjectContext<
  TContext extends object,
>(
  context: unknown,
  label: string,
): TContext {
  if (
    typeof context !==
      "object" ||
    context === null
  ) {
    throw new StandardSnapshotCodecError(
      "missing-context",
      `${label} exige context de restore.`,
    );
  }

  return context as TContext;
}

export interface InventorySnapshotContext {
  readonly itemDefinitions:
    ReadonlyMap<
      ItemId,
      Item
    >;
}

export interface LevelProgressionSnapshotContext {
  readonly curve:
    ProgressionCurve;
}

export interface NarrativeStateSnapshotContext {
  readonly questDefinitions:
    readonly QuestDefinition[];
}

export const AGENT_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.agent",
  );

export const ABILITY_ACTION_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.ability-action",
  );

export const STATE_STORE_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.state-store",
  );

export const SIMULATION_TIMER_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.simulation-timer",
  );

export const INVENTORY_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.inventory",
  );

export const CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.currency-account",
  );

export const RESOURCE_POOL_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.resource-pool",
  );

export const COOLDOWN_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.cooldown-set",
  );

export const MODIFIER_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.modifier-set",
  );

export const STATUS_EFFECT_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.status-effect-set",
  );

export const FACTION_MATRIX_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.faction-matrix",
  );

export const REPUTATION_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.reputation",
  );

export const RELATIONSHIP_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.relationship",
  );

export const EXPERIENCE_POOL_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.experience-pool",
  );

export const LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.level-progression",
  );

export const UNLOCK_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.unlock-set",
  );

export const NARRATIVE_STATE_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.narrative-state",
  );

export const STORY_FLAG_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.story-flags",
  );

export const TAG_SET_SNAPSHOT_TYPE_ID =
  createSnapshotTypeId(
    "runtime.tags",
  );

export const AGENT_SNAPSHOT_CODEC:
  SnapshotCodec<
    Agent,
    AgentSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      AGENT_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is Agent {
      return value instanceof Agent;
    },

    capture(
      aggregate: Agent,
    ): AgentSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state: AgentSnapshot,
    ): Agent {
      try {
        const agent =
          new Agent({
            id: state.id,
            displayName:
              state.displayName,
            health:
              state.health,
            maxHealth:
              state.maxHealth,
            level:
              state.level,
            experience:
              state.experience,
          });

        if (
          agent.alive !==
          state.alive
        ) {
          throw new StandardSnapshotCodecError(
            "derived-value-mismatch",
            "AgentSnapshot.alive não corresponde a health.",
          );
        }

        return agent;
      } catch (error) {
        return invalidSnapshot(
          "Agent",
          error,
        );
      }
    },
  });

export const ABILITY_ACTION_SNAPSHOT_CODEC:
  SnapshotCodec<
    AbilityAction,
    AbilityActionSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      ABILITY_ACTION_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is AbilityAction {
      return (
        value instanceof
        AbilityAction
      );
    },

    capture(
      aggregate:
        AbilityAction,
    ): AbilityActionSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        AbilityActionSnapshot,
    ): AbilityAction {
      try {
        const action =
          new AbilityAction({
            id: state.id,
            abilityId:
              state.abilityId,
            sourceAgentId:
              state.sourceAgentId,
            target:
              state.target,
          });

        switch (state.status) {
          case "pending": {
            if (
              state.cancelReason !==
              null
            ) {
              throw new StandardSnapshotCodecError(
                "derived-value-mismatch",
                "AbilityAction pending não pode possuir cancelReason.",
              );
            }

            return action;
          }

          case "committed": {
            if (
              state.cancelReason !==
              null
            ) {
              throw new StandardSnapshotCodecError(
                "derived-value-mismatch",
                "AbilityAction committed não pode possuir cancelReason.",
              );
            }

            action.commit();
            return action;
          }

          case "resolved": {
            if (
              state.cancelReason !==
              null
            ) {
              throw new StandardSnapshotCodecError(
                "derived-value-mismatch",
                "AbilityAction resolved não pode possuir cancelReason.",
              );
            }

            action.commit();
            action.resolve();
            return action;
          }

          case "cancelled": {
            if (
              state.cancelReason ===
              null
            ) {
              throw new StandardSnapshotCodecError(
                "derived-value-mismatch",
                "AbilityAction cancelled exige cancelReason.",
              );
            }

            action.cancel(
              state.cancelReason,
            );

            return action;
          }
        }
      } catch (error) {
        return invalidSnapshot(
          "AbilityAction",
          error,
        );
      }
    },
  });

export const STATE_STORE_SNAPSHOT_CODEC:
  SnapshotCodec<
    StateStore,
    StateSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      STATE_STORE_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is StateStore {
      return (
        value instanceof
        StateStore
      );
    },

    capture(
      aggregate:
        StateStore,
    ): StateSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        StateSnapshot,
    ): StateStore {
      try {
        return StateStore
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "StateStore",
          error,
        );
      }
    },
  });

export const SIMULATION_TIMER_SNAPSHOT_CODEC:
  SnapshotCodec<
    SimulationTimer,
    TimerSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      SIMULATION_TIMER_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is SimulationTimer {
      return (
        value instanceof
        SimulationTimer
      );
    },

    capture(
      aggregate:
        SimulationTimer,
    ): TimerSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        TimerSnapshot,
    ): SimulationTimer {
      try {
        return SimulationTimer
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "SimulationTimer",
          error,
        );
      }
    },
  });

export const INVENTORY_SNAPSHOT_CODEC:
  SnapshotCodec<
    Inventory,
    InventorySnapshot,
    InventorySnapshotContext
  > =
  defineSnapshotCodec({
    typeId:
      INVENTORY_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is Inventory {
      return (
        value instanceof
        Inventory
      );
    },

    capture(
      aggregate:
        Inventory,
    ): InventorySnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        InventorySnapshot,
      rawContext:
        InventorySnapshotContext,
    ): Inventory {
      try {
        const context =
          requireObjectContext<
            InventorySnapshotContext
          >(
            rawContext,
            "Inventory",
          );

        if (
          !(context.itemDefinitions
            instanceof Map)
        ) {
          throw new StandardSnapshotCodecError(
            "missing-context",
            "Inventory context exige itemDefinitions como Map/ReadonlyMap runtime.",
          );
        }

        const inventory =
          new Inventory({
            maxSlots:
              state.maxSlots,
          });

        const seen =
          new Set<ItemId>();

        for (
          const entry of
          state.entries
        ) {
          if (
            seen.has(
              entry.itemId,
            )
          ) {
            throw new StandardSnapshotCodecError(
              "invalid-snapshot",
              `InventorySnapshot contém ItemId duplicado: "${entry.itemId}".`,
            );
          }

          seen.add(
            entry.itemId,
          );

          const item =
            context
              .itemDefinitions
              .get(
                entry.itemId,
              );

          if (
            item === undefined
          ) {
            throw new StandardSnapshotCodecError(
              "missing-definition",
              `Item definition ausente para "${entry.itemId}".`,
            );
          }

          if (
            item.id !==
            entry.itemId
          ) {
            throw new StandardSnapshotCodecError(
              "definition-mismatch",
              `Item map key "${entry.itemId}" aponta para Item "${item.id}".`,
            );
          }

          inventory.add(
            item,
            entry.quantity,
          );
        }

        if (
          inventory
            .occupiedSlots !==
            state.occupiedSlots ||
          inventory
            .totalUnits !==
            state.totalUnits
        ) {
          throw new StandardSnapshotCodecError(
            "derived-value-mismatch",
            "InventorySnapshot occupiedSlots/totalUnits não correspondem às entries.",
          );
        }

        return inventory;
      } catch (error) {
        return invalidSnapshot(
          "Inventory",
          error,
        );
      }
    },
  });

export const CURRENCY_ACCOUNT_SNAPSHOT_CODEC:
  SnapshotCodec<
    CurrencyAccount,
    CurrencyAccountSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is CurrencyAccount {
      return (
        value instanceof
        CurrencyAccount
      );
    },

    capture(
      aggregate:
        CurrencyAccount,
    ): CurrencyAccountSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        CurrencyAccountSnapshot,
    ): CurrencyAccount {
      try {
        return CurrencyAccount
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "CurrencyAccount",
          error,
        );
      }
    },
  });

export const RESOURCE_POOL_SNAPSHOT_CODEC:
  SnapshotCodec<
    ResourcePool,
    ResourcePoolSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      RESOURCE_POOL_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is ResourcePool {
      return (
        value instanceof
        ResourcePool
      );
    },

    capture(
      aggregate:
        ResourcePool,
    ): ResourcePoolSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        ResourcePoolSnapshot,
    ): ResourcePool {
      try {
        return ResourcePool
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "ResourcePool",
          error,
        );
      }
    },
  });

export const COOLDOWN_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    CooldownSet,
    CooldownSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      COOLDOWN_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is CooldownSet {
      return (
        value instanceof
        CooldownSet
      );
    },

    capture(
      aggregate:
        CooldownSet,
    ): CooldownSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        CooldownSetSnapshot,
    ): CooldownSet {
      try {
        return CooldownSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "CooldownSet",
          error,
        );
      }
    },
  });

export const MODIFIER_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    ModifierSet,
    ModifierSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      MODIFIER_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is ModifierSet {
      return (
        value instanceof
        ModifierSet
      );
    },

    capture(
      aggregate:
        ModifierSet,
    ): ModifierSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        ModifierSetSnapshot,
    ): ModifierSet {
      try {
        return ModifierSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "ModifierSet",
          error,
        );
      }
    },
  });

export const STATUS_EFFECT_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    StatusEffectSet,
    StatusEffectSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      STATUS_EFFECT_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is StatusEffectSet {
      return (
        value instanceof
        StatusEffectSet
      );
    },

    capture(
      aggregate:
        StatusEffectSet,
    ): StatusEffectSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        StatusEffectSetSnapshot,
    ): StatusEffectSet {
      try {
        return StatusEffectSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "StatusEffectSet",
          error,
        );
      }
    },
  });

export const FACTION_MATRIX_SNAPSHOT_CODEC:
  SnapshotCodec<
    FactionMatrix,
    FactionMatrixSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      FACTION_MATRIX_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is FactionMatrix {
      return (
        value instanceof
        FactionMatrix
      );
    },

    capture(
      aggregate:
        FactionMatrix,
    ): FactionMatrixSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        FactionMatrixSnapshot,
    ): FactionMatrix {
      try {
        return FactionMatrix
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "FactionMatrix",
          error,
        );
      }
    },
  });

export const REPUTATION_SNAPSHOT_CODEC:
  SnapshotCodec<
    Reputation,
    ReputationSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      REPUTATION_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is Reputation {
      return (
        value instanceof
        Reputation
      );
    },

    capture(
      aggregate:
        Reputation,
    ): ReputationSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        ReputationSnapshot,
    ): Reputation {
      try {
        return Reputation
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "Reputation",
          error,
        );
      }
    },
  });

export const RELATIONSHIP_SNAPSHOT_CODEC:
  SnapshotCodec<
    Relationship,
    RelationshipSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      RELATIONSHIP_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is Relationship {
      return (
        value instanceof
        Relationship
      );
    },

    capture(
      aggregate:
        Relationship,
    ): RelationshipSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        RelationshipSnapshot,
    ): Relationship {
      try {
        return Relationship
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "Relationship",
          error,
        );
      }
    },
  });

export const EXPERIENCE_POOL_SNAPSHOT_CODEC:
  SnapshotCodec<
    ExperiencePool,
    ExperiencePoolSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      EXPERIENCE_POOL_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is ExperiencePool {
      return (
        value instanceof
        ExperiencePool
      );
    },

    capture(
      aggregate:
        ExperiencePool,
    ): ExperiencePoolSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        ExperiencePoolSnapshot,
    ): ExperiencePool {
      try {
        return ExperiencePool
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "ExperiencePool",
          error,
        );
      }
    },
  });

export const LEVEL_PROGRESSION_SNAPSHOT_CODEC:
  SnapshotCodec<
    LevelProgression,
    LevelProgressionSnapshot,
    LevelProgressionSnapshotContext
  > =
  defineSnapshotCodec({
    typeId:
      LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is LevelProgression {
      return (
        value instanceof
        LevelProgression
      );
    },

    capture(
      aggregate:
        LevelProgression,
    ): LevelProgressionSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        LevelProgressionSnapshot,
      rawContext:
        LevelProgressionSnapshotContext,
    ): LevelProgression {
      try {
        const context =
          requireObjectContext<
            LevelProgressionSnapshotContext
          >(
            rawContext,
            "LevelProgression",
          );

        if (
          typeof context.curve !==
            "object" ||
          context.curve === null
        ) {
          throw new StandardSnapshotCodecError(
            "missing-context",
            "LevelProgression context exige ProgressionCurve.",
          );
        }

        return LevelProgression
          .fromSnapshot(
            context.curve,
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "LevelProgression",
          error,
        );
      }
    },
  });

export const UNLOCK_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    UnlockSet,
    UnlockSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      UNLOCK_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is UnlockSet {
      return (
        value instanceof
        UnlockSet
      );
    },

    capture(
      aggregate:
        UnlockSet,
    ): UnlockSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        UnlockSetSnapshot,
    ): UnlockSet {
      try {
        return UnlockSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "UnlockSet",
          error,
        );
      }
    },
  });

export const NARRATIVE_STATE_SNAPSHOT_CODEC:
  SnapshotCodec<
    NarrativeState,
    NarrativeStateSnapshot,
    NarrativeStateSnapshotContext
  > =
  defineSnapshotCodec({
    typeId:
      NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is NarrativeState {
      return (
        value instanceof
        NarrativeState
      );
    },

    capture(
      aggregate:
        NarrativeState,
    ): NarrativeStateSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        NarrativeStateSnapshot,
      rawContext:
        NarrativeStateSnapshotContext,
    ): NarrativeState {
      try {
        const context =
          requireObjectContext<
            NarrativeStateSnapshotContext
          >(
            rawContext,
            "NarrativeState",
          );

        if (
          !Array.isArray(
            context.questDefinitions,
          )
        ) {
          throw new StandardSnapshotCodecError(
            "missing-context",
            "NarrativeState context exige questDefinitions.",
          );
        }

        return NarrativeState
          .fromSnapshot(
            context.questDefinitions,
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "NarrativeState",
          error,
        );
      }
    },
  });

export const STORY_FLAG_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    StoryFlagSet,
    StoryFlagSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      STORY_FLAG_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is StoryFlagSet {
      return (
        value instanceof
        StoryFlagSet
      );
    },

    capture(
      aggregate:
        StoryFlagSet,
    ): StoryFlagSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        StoryFlagSetSnapshot,
    ): StoryFlagSet {
      try {
        return StoryFlagSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "StoryFlagSet",
          error,
        );
      }
    },
  });

export const TAG_SET_SNAPSHOT_CODEC:
  SnapshotCodec<
    TagSet,
    TagSetSnapshot
  > =
  defineSnapshotCodec({
    typeId:
      TAG_SET_SNAPSHOT_TYPE_ID,
    schemaVersion: 1,

    isAggregate(
      value: unknown,
    ): value is TagSet {
      return (
        value instanceof
        TagSet
      );
    },

    capture(
      aggregate:
        TagSet,
    ): TagSetSnapshot {
      return aggregate.toSnapshot();
    },

    restore(
      state:
        TagSetSnapshot,
    ): TagSet {
      try {
        return TagSet
          .fromSnapshot(
            state,
          );
      } catch (error) {
        return invalidSnapshot(
          "TagSet",
          error,
        );
      }
    },
  });

export const STANDARD_SNAPSHOT_CODEC_COUNT =
  19 as const;

export function createStandardRuntimeSnapshotCodecs():
  readonly RuntimeSnapshotCodec[] {
  return Object.freeze([
    toRuntimeSnapshotCodec(
      AGENT_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      ABILITY_ACTION_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      STATE_STORE_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      SIMULATION_TIMER_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      INVENTORY_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      CURRENCY_ACCOUNT_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      RESOURCE_POOL_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      COOLDOWN_SET_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      MODIFIER_SET_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      STATUS_EFFECT_SET_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      FACTION_MATRIX_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      REPUTATION_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      RELATIONSHIP_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      EXPERIENCE_POOL_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      LEVEL_PROGRESSION_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      UNLOCK_SET_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      NARRATIVE_STATE_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      STORY_FLAG_SET_SNAPSHOT_CODEC,
    ),
    toRuntimeSnapshotCodec(
      TAG_SET_SNAPSHOT_CODEC,
    ),
  ]);
}

export function createStandardSnapshotRegistry():
  DomainSnapshotRegistry {
  const codecs =
    createStandardRuntimeSnapshotCodecs();

  if (
    codecs.length !==
    STANDARD_SNAPSHOT_CODEC_COUNT
  ) {
    throw new Error(
      "STANDARD_SNAPSHOT_CODEC_COUNT inconsistente.",
    );
  }

  return new DomainSnapshotRegistry(
    codecs,
  );
}
