import type {
  DomainDuration,
} from "../time/DomainDuration";

import {
  StatusEffect,
} from "./StatusEffect";

import type {
  StatusEffectSnapshot,
} from "./StatusEffect";

import type {
  StatusEffectId,
} from "./StatusEffectId";

import {
  StatusEffectInstance,
} from "./StatusEffectInstance";

import type {
  StatusEffectInstanceId,
  StatusEffectInstanceSnapshot,
  StatusEffectSourceRef,
} from "./StatusEffectInstance";

export type StatusEffectApplyOutcome =
  | "applied"
  | "stacked"
  | "refreshed"
  | "stacked-and-refreshed"
  | "rejected";

export interface StatusEffectApplyOptions {
  readonly effect:
    StatusEffect;
  readonly instanceId:
    StatusEffectInstanceId;
  readonly source?:
    StatusEffectSourceRef | null;
}

export interface StatusEffectApplyResult {
  readonly outcome:
    StatusEffectApplyOutcome;
  readonly instance:
    StatusEffectInstance;
  readonly addedStacks:
    number;
  readonly durationRefreshed:
    boolean;
}

export interface StatusEffectSetSnapshotEntry {
  readonly effect:
    StatusEffectSnapshot;
  readonly instance:
    StatusEffectInstanceSnapshot;
}

export interface StatusEffectSetSnapshot {
  readonly entries:
    readonly StatusEffectSetSnapshotEntry[];
}

export type StatusEffectSetErrorCode =
  | "definition-mismatch"
  | "duplicate-effect"
  | "invalid-snapshot";

export class StatusEffectSetError
  extends Error {
  public readonly name =
    "StatusEffectSetError";

  public constructor(
    public readonly code:
      StatusEffectSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function sameDefinition(
  left: StatusEffect,
  right: StatusEffect,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.duration ===
      right.duration &&
    left.maxStacks ===
      right.maxStacks &&
    left.stackingPolicy ===
      right.stackingPolicy
  );
}

function compareStatusEffectId(
  left: StatusEffectId,
  right: StatusEffectId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Coleção runtime de status effects.
 *
 * Um StatusEffectId ocupa no máximo um slot; stacks pertencem à instância.
 * Expired/removed permanecem observáveis até pruneTerminal() ou reaplicação.
 */
export class StatusEffectSet {
  private readonly effects =
    new Map<
      StatusEffectId,
      StatusEffectInstance
    >();

  public static fromSnapshot(
    snapshot:
      StatusEffectSetSnapshot,
  ): StatusEffectSet {
    const set =
      new StatusEffectSet();

    for (
      const entry of
      snapshot.entries
    ) {
      let effect:
        StatusEffect;

      try {
        effect =
          StatusEffect
            .fromSnapshot(
              entry.effect,
            );
      } catch (error) {
        throw new StatusEffectSetError(
          "invalid-snapshot",
          `StatusEffect definition inválida: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      if (
        set.effects.has(
          effect.id,
        )
      ) {
        throw new StatusEffectSetError(
          "duplicate-effect",
          `StatusEffectId duplicado no snapshot: "${effect.id}".`,
        );
      }

      let instance:
        StatusEffectInstance;

      try {
        instance =
          StatusEffectInstance
            .fromSnapshot(
              effect,
              entry.instance,
            );
      } catch (error) {
        throw new StatusEffectSetError(
          "invalid-snapshot",
          `StatusEffectInstance inválida para "${effect.id}": ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      set.effects.set(
        effect.id,
        instance,
      );
    }

    return set;
  }

  public get size():
    number {
    return this.effects.size;
  }

  public get activeCount():
    number {
    let count = 0;

    for (
      const instance of
      this.effects.values()
    ) {
      if (
        instance.isActive
      ) {
        count += 1;
      }
    }

    return count;
  }

  public has(
    effectId:
      StatusEffectId,
  ): boolean {
    return this.effects.has(
      effectId,
    );
  }

  public hasActive(
    effectId:
      StatusEffectId,
  ): boolean {
    return (
      this.effects.get(
        effectId,
      )?.isActive ===
      true
    );
  }

  public get(
    effectId:
      StatusEffectId,
  ):
    | StatusEffectInstance
    | undefined {
    return this.effects.get(
      effectId,
    );
  }

  public apply(
    options:
      StatusEffectApplyOptions,
  ): StatusEffectApplyResult {
    const existing =
      this.effects.get(
        options.effect.id,
      );

    if (
      existing !==
        undefined &&
      !sameDefinition(
        existing.effect,
        options.effect,
      )
    ) {
      throw new StatusEffectSetError(
        "definition-mismatch",
        `StatusEffectId "${options.effect.id}" recebeu definição conflitante.`,
      );
    }

    if (
      existing ===
        undefined ||
      existing.isTerminal
    ) {
      const instance =
        new StatusEffectInstance({
          id:
            options.instanceId,
          effect:
            options.effect,
          source:
            options.source ??
            null,
        });

      this.effects.set(
        options.effect.id,
        instance,
      );

      return Object.freeze({
        outcome: "applied",
        instance,
        addedStacks: 1,
        durationRefreshed:
          false,
      });
    }

    const source =
      options.source ??
      null;

    switch (
      options.effect
        .stackingPolicy
    ) {
      case "reject":
        return Object.freeze({
          outcome:
            "rejected",
          instance:
            existing,
          addedStacks: 0,
          durationRefreshed:
            false,
        });

      case "stack": {
        const addedStacks =
          existing.addStacks(
            1,
          );

        if (
          addedStacks > 0
        ) {
          existing.updateSource(
            source,
          );
        }

        return Object.freeze({
          outcome:
            addedStacks > 0
              ? "stacked"
              : "rejected",
          instance:
            existing,
          addedStacks,
          durationRefreshed:
            false,
        });
      }

      case "refresh": {
        existing.updateSource(
          source,
        );

        const refreshed =
          existing
            .refreshDuration();

        return Object.freeze({
          outcome:
            "refreshed",
          instance:
            existing,
          addedStacks: 0,
          durationRefreshed:
            refreshed,
        });
      }

      case "stack-and-refresh": {
        const addedStacks =
          existing.addStacks(
            1,
          );

        existing.updateSource(
          source,
        );

        const refreshed =
          existing
            .refreshDuration();

        return Object.freeze({
          outcome:
            addedStacks > 0
              ? "stacked-and-refreshed"
              : "refreshed",
          instance:
            existing,
          addedStacks,
          durationRefreshed:
            refreshed,
        });
      }
    }
  }

  public advance(
    elapsed:
      DomainDuration,
  ): void {
    for (
      const instance of
      this.effects.values()
    ) {
      instance.advance(
        elapsed,
      );
    }
  }

  public remove(
    effectId:
      StatusEffectId,
  ): boolean {
    return (
      this.effects.get(
        effectId,
      )?.remove() ??
      false
    );
  }

  public pruneTerminal():
    number {
    let removed = 0;

    for (
      const [
        effectId,
        instance,
      ] of this.effects
    ) {
      if (
        instance.isTerminal
      ) {
        this.effects.delete(
          effectId,
        );
        removed += 1;
      }
    }

    return removed;
  }

  public clear(): void {
    this.effects.clear();
  }

  public forEach(
    visitor: (
      instance:
        StatusEffectInstance,
    ) => void,
  ): void {
    for (
      const instance of
      this.effects.values()
    ) {
      visitor(instance);
    }
  }

  public toSnapshot():
    StatusEffectSetSnapshot {
    const ids =
      [...this.effects.keys()]
        .sort(
          compareStatusEffectId,
        );

    const entries =
      ids.map(
        (effectId) => {
          const instance =
            this.effects.get(
              effectId,
            );

          if (
            instance ===
            undefined
          ) {
            throw new Error(
              `StatusEffectSet inconsistente para "${effectId}".`,
            );
          }

          return Object.freeze({
            effect:
              instance.effect
                .toSnapshot(),
            instance:
              instance
                .toSnapshot(),
          });
        },
      );

    return Object.freeze({
      entries:
        Object.freeze(
          entries,
        ),
    });
  }
}
