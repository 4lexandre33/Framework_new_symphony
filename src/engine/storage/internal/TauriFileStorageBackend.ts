import {
  invoke,
} from "@tauri-apps/api/core";

import type {
  AsyncKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  StorageInfrastructureError,
  type StorageInfrastructureErrorCode,
  type StorageInfrastructureOperation,
} from "./StorageErrors";

/** Erro serializado pelos comandos `storage_file_*` (src-tauri/src/storage.rs). */
interface NativeStorageFileError {
  readonly code: string;
  readonly message: string;
}

/** Ponte nativa injetável (testes); o padrão usa `invoke` do Tauri. */
export interface TauriFileStorageBridge {
  read(namespace: string, key: string): Promise<string | null>;
  write(namespace: string, key: string, value: string): Promise<boolean>;
  remove(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<string[]>;
}

export interface TauriFileStorageBackendOptions {
  /** Subpasta em `<app_data_dir>/storage/` (`[A-Za-z0-9_-]{1,64}`). */
  readonly namespace?: string;
  readonly bridge?: TauriFileStorageBridge;
}

const NAMESPACE_PATTERN =
  /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Igual ao `MAX_KEY_BYTES` do Rust. Qualquer chave que o `StorageService`
 * monta (slot de até 256 caracteres → `encodeURIComponent` + prefixos) cabe;
 * chaves cujo nome de arquivo passaria de 240 bytes viram `h_<sha256>.kv` no
 * Rust, com a chave original no cabeçalho do arquivo (list() devolve a exata).
 */
const MAX_KEY_BYTES =
  8 * 1024;

export const DEFAULT_TAURI_FILE_NAMESPACE =
  "saves";

export function isTauriRuntime(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ === "object"
  );
}

export const tauriFileStorageBridge: TauriFileStorageBridge = {
  read: (namespace, key) =>
    invoke<string | null>("storage_file_read", { namespace, key }),
  write: (namespace, key, value) =>
    invoke<boolean>("storage_file_write", { namespace, key, value }),
  remove: (namespace, key) =>
    invoke<boolean>("storage_file_delete", { namespace, key }),
  list: (namespace) =>
    invoke<string[]>("storage_file_list", { namespace }),
};

function mapNativeError(
  error: unknown,
  operation: StorageInfrastructureOperation,
  message: string,
): StorageInfrastructureError {
  if (error instanceof StorageInfrastructureError) {
    return error;
  }

  let code: StorageInfrastructureErrorCode = "operation-failed";
  let detail = "";

  if (typeof error === "object" && error !== null && "code" in error) {
    const native = error as NativeStorageFileError;
    detail = typeof native.message === "string" ? native.message : "";

    if (native.code === "quota-exceeded") {
      code = "quota-exceeded";
    } else if (native.code === "unavailable") {
      code = "unavailable";
    }
  } else if (typeof error === "string") {
    detail = error;
  }

  const result = new StorageInfrastructureError(
    code,
    operation,
    detail.length > 0 ? `${message} (${detail})` : message,
    code !== "unavailable",
    error,
  );

  if (typeof error === "object" && error !== null && (error as NativeStorageFileError).code === "invalid-input") {
    result.reason = "invalid-input";
  }

  return result;
}

/**
 * Backend em arquivos do app nativo (G102): um arquivo por chave em
 * `<app_data_dir>/storage/<namespace>/`, gravado atomicamente pelo Rust
 * (temporário + fsync + rename). Sem a cota de ~5 MB do Web Storage e com o
 * I/O fora da thread principal.
 */
export class TauriFileStorageBackend
  implements AsyncKeyValueStorageBackend {
  private readonly namespace: string;
  private readonly bridge: TauriFileStorageBridge;
  private readonly encoder = new TextEncoder();

  public constructor(
    options: TauriFileStorageBackendOptions = {},
  ) {
    const namespace = options.namespace ?? DEFAULT_TAURI_FILE_NAMESPACE;

    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new StorageInfrastructureError(
        "operation-failed",
        "save",
        "TauriFileStorageBackend: namespace inválido (use [A-Za-z0-9_-], 1..64).",
        false,
      );
    }

    this.namespace = namespace;
    this.bridge = options.bridge ?? tauriFileStorageBridge;
  }

  private assertKey(
    key: string,
    operation: StorageInfrastructureOperation,
  ): void {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.includes("\0") ||
      this.encoder.encode(key).length > MAX_KEY_BYTES
    ) {
      const error = new StorageInfrastructureError(
        "operation-failed",
        operation,
        "Chave inválida para o backend de arquivos (1..8192 bytes, sem NUL).",
        false,
      );
      error.reason = "invalid-input";
      throw error;
    }
  }

  public async getItem(
    key: string,
  ): Promise<string | null> {
    this.assertKey(key, "load");

    try {
      const value = await this.bridge.read(this.namespace, key);
      return typeof value === "string" ? value : null;
    } catch (error) {
      throw mapNativeError(error, "load", `Falha ao ler o arquivo da chave '${key}'.`);
    }
  }

  public async setItem(
    key: string,
    value: string,
  ): Promise<void> {
    this.assertKey(key, "save");

    try {
      await this.bridge.write(this.namespace, key, value);
    } catch (error) {
      throw mapNativeError(error, "save", `Falha ao gravar o arquivo da chave '${key}'.`);
    }
  }

  public async removeItem(
    key: string,
  ): Promise<void> {
    this.assertKey(key, "delete");

    try {
      await this.bridge.remove(this.namespace, key);
    } catch (error) {
      throw mapNativeError(error, "delete", `Falha ao remover o arquivo da chave '${key}'.`);
    }
  }

  public async keys(): Promise<string[]> {
    try {
      const keys = await this.bridge.list(this.namespace);
      return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
    } catch (error) {
      throw mapNativeError(error, "list", "Falha ao listar os arquivos de storage.");
    }
  }
}
