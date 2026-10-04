import {
  createStateKey,
} from "./StateKey";

import type {
  StateKey,
} from "./StateKey";

import type {
  StateSnapshot,
} from "./StateSnapshot";

import {
  cloneStateValue,
  stateValueEquals,
} from "./StateValue";

import type {
  StateValue,
} from "./StateValue";

export type StateStoreErrorCode =
  | "duplicate-snapshot-key";

export class StateStoreError
  extends Error {
  public readonly name =
    "StateStoreError";

  public constructor(
    public readonly code:
      StateStoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareStateKey(
  left: StateKey,
  right: StateKey,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Store puro de facts/estado compartilhado de gameplay.
 *
 * - Map<StateKey, StateValue> para lookup O(1) médio;
 * - valores são copiados/congelados em set()/restore;
 * - read() retorna referências readonly já congeladas;
 * - snapshots são materializados e ordenados somente sob demanda;
 * - nenhum I/O, localStorage, database, engine ou event bus.
 */
export class StateStore {
  private readonly values =
    new Map<
      StateKey,
      StateValue
    >();

  public static fromSnapshot(
    snapshot:
      StateSnapshot,
  ): StateStore {
    const store =
      new StateStore();

    const seen =
      new Set<StateKey>();

    for (
      const entry of
      snapshot.entries
    ) {
      const key =
        createStateKey(
          entry.key,
        );

      if (seen.has(key)) {
        throw new StateStoreError(
          "duplicate-snapshot-key",
          `StateSnapshot contém chave duplicada: "${key}".`,
        );
      }

      seen.add(key);

      store.values.set(
        key,
        cloneStateValue(
          entry.value,
        ),
      );
    }

    return store;
  }

  public get size():
    number {
    return this.values.size;
  }

  public get isEmpty():
    boolean {
    return (
      this.values.size === 0
    );
  }

  public has<
    TValue extends StateValue,
  >(
    key:
      StateKey<TValue>,
  ): boolean {
    return this.values.has(
      key as StateKey,
    );
  }

  public read<
    TValue extends StateValue,
  >(
    key:
      StateKey<TValue>,
  ): TValue | undefined {
    return this.values.get(
      key as StateKey,
    ) as
      | TValue
      | undefined;
  }

  public set<
    TValue extends StateValue,
  >(
    key:
      StateKey<TValue>,
    value:
      TValue,
  ): TValue {
    const cloned =
      cloneStateValue(
        value,
      ) as TValue;

    this.values.set(
      key as StateKey,
      cloned,
    );

    return cloned;
  }

  public delete<
    TValue extends StateValue,
  >(
    key:
      StateKey<TValue>,
  ): boolean {
    return this.values.delete(
      key as StateKey,
    );
  }

  public clear(): void {
    this.values.clear();
  }

  public compare<
    TValue extends StateValue,
  >(
    key:
      StateKey<TValue>,
    expected:
      TValue,
  ): boolean {
    const current =
      this.values.get(
        key as StateKey,
      );

    if (
      current === undefined
    ) {
      return false;
    }

    const normalizedExpected =
      cloneStateValue(
        expected,
      );

    return stateValueEquals(
      current,
      normalizedExpected,
    );
  }

  /**
   * Itera sem materializar array intermediário.
   */
  public forEach(
    visitor: (
      key: StateKey,
      value: StateValue,
    ) => void,
  ): void {
    for (
      const [
        key,
        value,
      ] of this.values
    ) {
      visitor(
        key,
        value,
      );
    }
  }

  /**
   * Snapshot determinístico sob demanda.
   *
   * Entries são ordenadas por key e os valores retornados já são readonly /
   * frozen. Nenhuma serialização concreta é feita aqui.
   */
  public toSnapshot():
    StateSnapshot {
    const keys =
      [...this.values.keys()]
        .sort(
          compareStateKey,
        );

    const entries =
      keys.map(
        (key) => {
          const value =
            this.values.get(
              key,
            );

          if (
            value === undefined
          ) {
            throw new Error(
              `StateStore inconsistente para key "${key}".`,
            );
          }

          return Object.freeze({
            key,
            value,
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
