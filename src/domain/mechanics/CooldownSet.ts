import type {
  DomainDuration,
} from "../time/DomainDuration";

import {
  Cooldown,
} from "./Cooldown";

import type {
  CooldownSnapshot,
} from "./Cooldown";

import type {
  CooldownId,
} from "./CooldownId";

export interface CooldownSetSnapshot {
  readonly cooldowns:
    readonly CooldownSnapshot[];
}

export type CooldownSetErrorCode =
  | "duplicate-cooldown"
  | "unknown-cooldown"
  | "invalid-snapshot";

export class CooldownSetError
  extends Error {
  public readonly name =
    "CooldownSetError";

  public constructor(
    public readonly code:
      CooldownSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareCooldownId(
  left: CooldownId,
  right: CooldownId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Coleção determinística de cooldowns.
 *
 * advance() percorre Map diretamente sem snapshots/arrays temporários.
 */
export class CooldownSet {
  private readonly cooldowns =
    new Map<
      CooldownId,
      Cooldown
    >();

  public static fromSnapshot(
    snapshot:
      CooldownSetSnapshot,
  ): CooldownSet {
    const set =
      new CooldownSet();

    for (
      const cooldownSnapshot of
      snapshot.cooldowns
    ) {
      let cooldown:
        Cooldown;

      try {
        cooldown =
          Cooldown.fromSnapshot(
            cooldownSnapshot,
          );
      } catch (error) {
        throw new CooldownSetError(
          "invalid-snapshot",
          `CooldownSetSnapshot inválido: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      try {
        set.add(cooldown);
      } catch (error) {
        throw new CooldownSetError(
          "invalid-snapshot",
          `CooldownSetSnapshot inválido: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    return set;
  }

  public get size():
    number {
    return this.cooldowns.size;
  }

  public get activeCount():
    number {
    let count = 0;

    for (
      const cooldown of
      this.cooldowns.values()
    ) {
      if (
        cooldown.isActive
      ) {
        count += 1;
      }
    }

    return count;
  }

  public has(
    cooldownId:
      CooldownId,
  ): boolean {
    return this.cooldowns.has(
      cooldownId,
    );
  }

  public get(
    cooldownId:
      CooldownId,
  ): Cooldown | undefined {
    return this.cooldowns.get(
      cooldownId,
    );
  }

  public add(
    cooldown: Cooldown,
  ): void {
    if (
      this.cooldowns.has(
        cooldown.id,
      )
    ) {
      throw new CooldownSetError(
        "duplicate-cooldown",
        `CooldownId duplicado: "${cooldown.id}".`,
      );
    }

    this.cooldowns.set(
      cooldown.id,
      cooldown,
    );
  }

  public remove(
    cooldownId:
      CooldownId,
  ): boolean {
    return this.cooldowns.delete(
      cooldownId,
    );
  }

  public isReady(
    cooldownId:
      CooldownId,
  ): boolean {
    return this.require(
      cooldownId,
    ).isReady;
  }

  public start(
    cooldownId:
      CooldownId,
  ): void {
    this.require(
      cooldownId,
    ).start();
  }

  public restart(
    cooldownId:
      CooldownId,
  ): void {
    this.require(
      cooldownId,
    ).restart();
  }

  public clearCooldown(
    cooldownId:
      CooldownId,
  ): void {
    this.require(
      cooldownId,
    ).clear();
  }

  public advance(
    elapsed:
      DomainDuration,
  ): void {
    for (
      const cooldown of
      this.cooldowns.values()
    ) {
      cooldown.advance(
        elapsed,
      );
    }
  }

  public clear(): void {
    this.cooldowns.clear();
  }

  public forEach(
    visitor: (
      cooldown:
        Cooldown,
    ) => void,
  ): void {
    for (
      const cooldown of
      this.cooldowns.values()
    ) {
      visitor(cooldown);
    }
  }

  public toSnapshot():
    CooldownSetSnapshot {
    const ids =
      [...this.cooldowns.keys()]
        .sort(
          compareCooldownId,
        );

    const snapshots =
      ids.map(
        (cooldownId) => {
          const cooldown =
            this.cooldowns.get(
              cooldownId,
            );

          if (
            cooldown ===
            undefined
          ) {
            throw new Error(
              `CooldownSet inconsistente para "${cooldownId}".`,
            );
          }

          return cooldown
            .toSnapshot();
        },
      );

    return Object.freeze({
      cooldowns:
        Object.freeze(
          snapshots,
        ),
    });
  }

  private require(
    cooldownId:
      CooldownId,
  ): Cooldown {
    const cooldown =
      this.cooldowns.get(
        cooldownId,
      );

    if (
      cooldown === undefined
    ) {
      throw new CooldownSetError(
        "unknown-cooldown",
        `Cooldown desconhecido: "${cooldownId}".`,
      );
    }

    return cooldown;
  }
}
