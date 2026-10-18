import type {
  AsyncKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  StorageInfrastructureError,
  normalizeStorageError,
  type StorageInfrastructureOperation,
} from "./StorageErrors";

/** Subconjunto do `IDBFactory` usado (permite fake em teste). */
export interface IndexedDbFactoryLike {
  open(
    name: string,
    version?: number,
  ): IDBOpenDBRequest;
}

export interface IndexedDbStorageBackendOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  /** Padrão: `globalThis.indexedDB`. */
  readonly factory?: IndexedDbFactoryLike;
}

export const DEFAULT_INDEXED_DB_NAME =
  "engine-storage";

export const DEFAULT_INDEXED_DB_STORE =
  "kv";

/** true se `globalThis.indexedDB` existe e expõe `open`. */
export function isGlobalIndexedDbAvailable(): boolean {
  try {
    const factory =
      (globalThis as { readonly indexedDB?: IndexedDbFactoryLike | null })
        .indexedDB;

    return (
      factory !== undefined &&
      factory !== null &&
      typeof factory.open === "function"
    );
  } catch {
    return false;
  }
}

function requestToPromise<T>(
  request: IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

/**
 * Backend IndexedDB (G102): assíncrono, cota grande (centenas de MB/GB,
 * conforme o navegador), sem bloquear a thread principal em I/O.
 *
 * Uma conexão por backend, aberta sob demanda e reaberta se o navegador a
 * fechar (`versionchange`/`close`). Valores são strings (o driver já
 * serializa/assina o registro); a chave é a chave lógica do driver.
 */
export class IndexedDbStorageBackend
  implements AsyncKeyValueStorageBackend {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly explicitFactory: IndexedDbFactoryLike | undefined;
  private connection: Promise<IDBDatabase> | null = null;
  private disposed = false;

  public constructor(
    options: IndexedDbStorageBackendOptions = {},
  ) {
    this.databaseName =
      options.databaseName ?? DEFAULT_INDEXED_DB_NAME;

    this.storeName =
      options.storeName ?? DEFAULT_INDEXED_DB_STORE;

    this.explicitFactory =
      options.factory;
  }

  private resolveFactory(
    operation: StorageInfrastructureOperation,
  ): IndexedDbFactoryLike {
    const factory =
      this.explicitFactory ??
      (globalThis as { readonly indexedDB?: IndexedDbFactoryLike | null })
        .indexedDB;

    if (factory === undefined || factory === null) {
      throw new StorageInfrastructureError(
        "unavailable",
        operation,
        "IndexedDB indisponível neste runtime.",
        false,
      );
    }

    return factory;
  }

  private open(
    operation: StorageInfrastructureOperation,
  ): Promise<IDBDatabase> {
    if (this.disposed) {
      return Promise.reject(
        new StorageInfrastructureError(
          "unavailable",
          operation,
          "Backend IndexedDB já foi descartado.",
          false,
        ),
      );
    }

    if (this.connection !== null) {
      return this.connection;
    }

    let factory: IndexedDbFactoryLike;

    try {
      factory = this.resolveFactory(operation);
    } catch (error) {
      return Promise.reject(error);
    }

    const storeName = this.storeName;

    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;

      try {
        request = factory.open(this.databaseName, 1);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        // Outra aba atualizou o schema ou o navegador fechou a conexão:
        // larga esta e reabre na próxima operação.
        db.onversionchange = () => {
          db.close();
          this.connection = null;
        };

        db.onclose = () => {
          this.connection = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB open failed"));
      };

      request.onblocked = () => {
        // Mantém a espera: outra aba ainda segura a versão antiga.
      };
    });

    this.connection = pending;

    pending.catch(() => {
      if (this.connection === pending) {
        this.connection = null;
      }
    });

    return pending;
  }

  private async run<T>(
    operation: StorageInfrastructureOperation,
    mode: IDBTransactionMode,
    message: string,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    try {
      const db = await this.open(operation);
      const transaction = db.transaction(this.storeName, mode);
      const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve();
        };

        transaction.onerror = () => {
          reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        };

        transaction.onabort = () => {
          reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        };
      });

      // Evita rejeição não tratada quando o request falha antes.
      done.catch(() => undefined);

      const result = await requestToPromise(
        body(transaction.objectStore(this.storeName)),
      );

      // Escrita só conta como feita quando a transação faz commit.
      await done;
      return result;
    } catch (error) {
      throw normalizeStorageError(error, operation, message);
    }
  }

  public async getItem(
    key: string,
  ): Promise<string | null> {
    const value = await this.run<unknown>(
      "load",
      "readonly",
      `Falha ao ler a chave IndexedDB '${key}'.`,
      (store) => store.get(key),
    );

    return typeof value === "string" ? value : null;
  }

  public async setItem(
    key: string,
    value: string,
  ): Promise<void> {
    await this.run(
      "save",
      "readwrite",
      `Falha ao gravar a chave IndexedDB '${key}'.`,
      (store) => store.put(value, key),
    );
  }

  public async removeItem(
    key: string,
  ): Promise<void> {
    await this.run(
      "delete",
      "readwrite",
      `Falha ao remover a chave IndexedDB '${key}'.`,
      (store) => store.delete(key),
    );
  }

  public async keys(): Promise<string[]> {
    const keys = await this.run<IDBValidKey[]>(
      "list",
      "readonly",
      "Falha ao enumerar o IndexedDB.",
      (store) => store.getAllKeys(),
    );

    const result: string[] = [];

    for (const key of keys) {
      if (typeof key === "string") {
        result.push(key);
      }
    }

    return result;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const connection = this.connection;
    this.connection = null;

    void connection
      ?.then((db) => {
        db.close();
      })
      .catch(() => undefined);
  }
}
