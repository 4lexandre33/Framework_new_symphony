import {
  StorageInfrastructureError,
  normalizeStorageError,
} from "./StorageErrors";

export interface KeyValueStorageBackend {
  readonly length: number;

  getItem(
    key: string,
  ): string | null;

  setItem(
    key: string,
    value: string,
  ): void;

  removeItem(
    key: string,
  ): void;

  key(
    index: number,
  ): string | null;

  dispose?(): void;
}

/**
 * Backend assíncrono (IndexedDB, arquivo via Tauri, Steam Remote Storage...).
 * O driver aguarda cada operação, então não bloqueia a thread principal
 * esperando I/O.
 */
export interface AsyncKeyValueStorageBackend {
  getItem(
    key: string,
  ): Promise<string | null>;

  setItem(
    key: string,
    value: string,
  ): Promise<void>;

  removeItem(
    key: string,
  ): Promise<void>;

  /** Todas as chaves (o driver filtra pelo prefixo). */
  keys(): Promise<string[]>;

  dispose?(): void;
}

export type AnyKeyValueStorageBackend =
  | KeyValueStorageBackend
  | AsyncKeyValueStorageBackend;

/**
 * true se o Web Storage global existe e aceita leitura (modo privado e
 * políticas de cookies podem lançar SecurityError só de acessar).
 */
export function isGlobalLocalStorageAvailable(): boolean {
  try {
    const candidate =
      (
        globalThis as unknown as {
          readonly localStorage?:
            KeyValueStorageBackend | null;
        }
      ).localStorage;

    if (
      candidate ===
        undefined ||
      candidate ===
        null
    ) {
      return false;
    }

    void candidate.length;
    return true;
  } catch {
    return false;
  }
}

function resolveGlobalLocalStorage(
  operation:
    "save"
    | "load"
    | "list"
    | "delete",
):
  KeyValueStorageBackend {
  const candidate =
    (
      globalThis as unknown as {
        readonly localStorage?:
          KeyValueStorageBackend;
      }
    ).localStorage;

  if (
    candidate ===
      undefined ||
    candidate ===
      null
  ) {
    throw new StorageInfrastructureError(
      "unavailable",
      operation,
      "Backend local de persistência indisponível neste runtime.",
      true,
    );
  }

  return candidate;
}

/**
 * Adapter tardio para o Web Storage já usado pelo projeto.
 *
 * A resolução acontece a cada operação, permitindo testes headless injetarem
 * um backend depois da construção. A Etapa 85 poderá substituir este adapter
 * por filesystem/SQL/Tauri sem alterar StorageService nem os contracts públicos.
 */
export class GlobalLocalStorageBackend
  implements KeyValueStorageBackend {
  public get length():
    number {
    return resolveGlobalLocalStorage(
      "list",
    ).length;
  }

  public getItem(
    key: string,
  ): string | null {
    try {
      return resolveGlobalLocalStorage(
        "load",
      )
        .getItem(
          key,
        );
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "load",
        `Falha ao ler a chave local '${key}'.`,
      );
    }
  }

  public setItem(
    key: string,
    value: string,
  ): void {
    try {
      resolveGlobalLocalStorage(
        "save",
      )
        .setItem(
          key,
          value,
        );
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "save",
        `Falha ao gravar a chave local '${key}'.`,
      );
    }
  }

  public removeItem(
    key: string,
  ): void {
    try {
      resolveGlobalLocalStorage(
        "delete",
      )
        .removeItem(
          key,
        );
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "delete",
        `Falha ao remover a chave local '${key}'.`,
      );
    }
  }

  public key(
    index: number,
  ): string | null {
    try {
      return resolveGlobalLocalStorage(
        "list",
      )
        .key(
          index,
        );
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "list",
        "Falha ao enumerar o backend local.",
      );
    }
  }
}

/**
 * Backend determinístico para testes e adapters futuros.
 * Não é usado como fallback silencioso em produção.
 */
export class MemoryKeyValueStorageBackend
  implements KeyValueStorageBackend {
  private readonly entries =
    new Map<
      string,
      string
    >();

  public get length():
    number {
    return this.entries
      .size;
  }

  public getItem(
    key: string,
  ): string | null {
    return this.entries
      .get(
        key,
      ) ??
      null;
  }

  public setItem(
    key: string,
    value: string,
  ): void {
    this.entries.set(
      key,
      value,
    );
  }

  public removeItem(
    key: string,
  ): void {
    this.entries.delete(
      key,
    );
  }

  public key(
    index: number,
  ): string | null {
    if (
      !Number.isSafeInteger(
        index,
      ) ||
      index < 0
    ) {
      return null;
    }

    let current =
      0;

    for (
      const key of
      this.entries.keys()
    ) {
      if (
        current ===
          index
      ) {
        return key;
      }

      current +=
        1;
    }

    return null;
  }

  public clear():
    void {
    this.entries.clear();
  }

  public dispose():
    void {
    this.clear();
  }
}
