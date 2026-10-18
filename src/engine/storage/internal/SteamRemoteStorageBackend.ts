import {
  invoke,
} from "@tauri-apps/api/core";

import type {
  SteamCloudStorageStatus,
} from "../../../contracts/storage/types";

import type {
  AnyKeyValueStorageBackend,
  AsyncKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  StorageInfrastructureError,
  normalizeStorageError,
  type StorageInfrastructureOperation,
} from "./StorageErrors";

import {
  isTauriRuntime,
} from "./TauriFileStorageBackend";

interface SteamCloudStatusDto {
  readonly accountEnabled: boolean;
  readonly appEnabled: boolean;
}

interface SteamCloudFileDto {
  readonly name: string;
  readonly size: number;
  readonly timestamp: number;
  readonly persisted: boolean;
}

/** Ponte para os comandos `steam_cloud_*` (src-tauri/src/steam.rs), injetável. */
export interface SteamRemoteStorageBridge {
  status(): Promise<SteamCloudStatusDto>;
  listFiles(): Promise<SteamCloudFileDto[]>;
  writeFile(fileName: string, data: number[]): Promise<boolean>;
  readFile(fileName: string): Promise<number[] | null>;
  deleteFile(fileName: string): Promise<boolean>;
}

export const tauriSteamRemoteStorageBridge: SteamRemoteStorageBridge = {
  status: () =>
    invoke<SteamCloudStatusDto>("steam_cloud_status"),
  listFiles: () =>
    invoke<SteamCloudFileDto[]>("steam_cloud_list_files"),
  writeFile: (fileName, data) =>
    invoke<boolean>("steam_cloud_write_file", { fileName, data }),
  readFile: (fileName) =>
    invoke<number[] | null>("steam_cloud_read_file", { fileName }),
  deleteFile: (fileName) =>
    invoke<boolean>("steam_cloud_delete_file", { fileName }),
};

const FILE_PREFIX = "kv_";
const FILE_SUFFIX = ".sav";
/** Limite do Rust (`MAX_CLOUD_FILE_NAME_LEN`). */
const MAX_FILE_NAME_LENGTH = 240;

/**
 * Chave → nome de arquivo do Steam Cloud. Injetiva e só com `[a-z0-9_.%^~-]`
 * (o Steam trata nomes sem diferenciar maiúsculas): `A-Z` → `^a`, outros
 * bytes → `~hh`.
 */
export function encodeSteamCloudFileName(key: string): string | null {
  const bytes = new TextEncoder().encode(key);

  if (bytes.length === 0) {
    return null;
  }

  let out = FILE_PREFIX;

  for (const byte of bytes) {
    const isLower = byte >= 0x61 && byte <= 0x7a;
    const isDigit = byte >= 0x30 && byte <= 0x39;

    if (isLower || isDigit || byte === 0x5f || byte === 0x2d || byte === 0x2e || byte === 0x25) {
      out += String.fromCharCode(byte);
    } else if (byte >= 0x41 && byte <= 0x5a) {
      out += `^${String.fromCharCode(byte + 32)}`;
    } else {
      out += `~${byte.toString(16).padStart(2, "0")}`;
    }
  }

  out += FILE_SUFFIX;
  return out.length <= MAX_FILE_NAME_LENGTH ? out : null;
}

export function decodeSteamCloudFileName(name: string): string | null {
  if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) {
    return null;
  }

  const body = name.slice(FILE_PREFIX.length, name.length - FILE_SUFFIX.length);
  const bytes: number[] = [];

  for (let index = 0; index < body.length; ) {
    const char = body.charCodeAt(index);

    if (char === 0x5e) {
      const next = body.charCodeAt(index + 1);

      if (!(next >= 0x61 && next <= 0x7a)) {
        return null;
      }

      bytes.push(next - 32);
      index += 2;
    } else if (char === 0x7e) {
      const hex = body.slice(index + 1, index + 3);

      if (!/^[0-9a-f]{2}$/u.test(hex)) {
        return null;
      }

      bytes.push(Number.parseInt(hex, 16));
      index += 3;
    } else if (char < 0x80) {
      bytes.push(char);
      index += 1;
    } else {
      return null;
    }
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export interface SteamRemoteStorageBackendOptions {
  /** Backend local usado quando o Steam não está disponível. */
  readonly fallback: AnyKeyValueStorageBackend;
  /** Padrão: comandos Tauri (só no app nativo). */
  readonly bridge?: SteamRemoteStorageBridge;
  /** Padrão: `isTauriRuntime()`; false = nem tenta o Steam. */
  readonly nativeAvailable?: boolean;
}

/**
 * Backend do driver `steam_cloud` (G131): grava no **Steam Remote Storage**
 * (ISteamRemoteStorage via `steam_cloud_*`) quando o cliente Steam está
 * inicializado; caso contrário, fallback HONESTO para o backend local, com
 * o modo exposto em `getStatus()` (`StorageApi.getSteamCloudStatus`).
 *
 * O modo é decidido UMA vez (na primeira operação) e mantido na sessão, para
 * não misturar arquivos entre nuvem e disco local.
 */
export class SteamRemoteStorageBackend
  implements AsyncKeyValueStorageBackend {
  private readonly fallback: AnyKeyValueStorageBackend;
  private readonly bridge: SteamRemoteStorageBridge;
  private readonly nativeAvailable: boolean;
  private probing: Promise<SteamCloudStorageStatus> | null = null;
  private status: SteamCloudStorageStatus = {
    mode: "unknown",
    synced: false,
  };

  public constructor(
    options: SteamRemoteStorageBackendOptions,
  ) {
    this.fallback = options.fallback;
    this.bridge = options.bridge ?? tauriSteamRemoteStorageBridge;
    this.nativeAvailable = options.nativeAvailable ?? isTauriRuntime();
  }

  /** Estado atual (sonda o Steam se ainda não sondou). */
  public getStatus(): Promise<SteamCloudStorageStatus> {
    return this.probe();
  }

  /** Último estado conhecido, sem sondar. */
  public peekStatus(): SteamCloudStorageStatus {
    return this.status;
  }

  private probe(): Promise<SteamCloudStorageStatus> {
    if (this.probing !== null) {
      return this.probing;
    }

    this.probing = (async (): Promise<SteamCloudStorageStatus> => {
      if (!this.nativeAvailable) {
        this.status = {
          mode: "local-fallback",
          synced: false,
          reason: "not-native",
        };
        return this.status;
      }

      try {
        const dto = await this.bridge.status();

        this.status = {
          mode: "remote-storage",
          // Com a nuvem desligada (conta ou app) o Steam grava só no disco
          // local e sincroniza quando for religada.
          synced: dto.accountEnabled === true && dto.appEnabled === true,
          accountEnabled: dto.accountEnabled === true,
          appEnabled: dto.appEnabled === true,
        };
      } catch (error) {
        this.status = {
          mode: "local-fallback",
          synced: false,
          reason: "steam-unavailable",
          detail: typeof error === "string" ? error : String((error as { message?: unknown })?.message ?? error),
        };
      }

      return this.status;
    })();

    return this.probing;
  }

  private async remote(): Promise<boolean> {
    return (await this.probe()).mode === "remote-storage";
  }

  private fileName(
    key: string,
    operation: StorageInfrastructureOperation,
  ): string {
    const name = encodeSteamCloudFileName(key);

    if (name === null) {
      const error = new StorageInfrastructureError(
        "operation-failed",
        operation,
        "Chave longa demais para um arquivo do Steam Cloud.",
        false,
      );
      error.reason = "invalid-input";
      throw error;
    }

    return name;
  }

  public async getItem(key: string): Promise<string | null> {
    if (!(await this.remote())) {
      return await this.fallback.getItem(key);
    }

    const name = this.fileName(key, "load");

    try {
      const data = await this.bridge.readFile(name);
      return data === null || data === undefined
        ? null
        : new TextDecoder().decode(Uint8Array.from(data));
    } catch (error) {
      throw normalizeStorageError(error, "load", `Falha ao ler '${name}' do Steam Cloud.`);
    }
  }

  public async setItem(key: string, value: string): Promise<void> {
    if (!(await this.remote())) {
      await this.fallback.setItem(key, value);
      return;
    }

    const name = this.fileName(key, "save");
    let written: boolean;

    try {
      written = await this.bridge.writeFile(name, Array.from(new TextEncoder().encode(value)));
    } catch (error) {
      throw normalizeStorageError(error, "save", `Falha ao gravar '${name}' no Steam Cloud.`);
    }

    if (written !== true) {
      // FileWrite falha quando a cota do Steam Cloud acaba.
      throw new StorageInfrastructureError(
        "quota-exceeded",
        "save",
        `Steam Cloud recusou '${name}' (cota?).`,
        true,
      );
    }
  }

  public async removeItem(key: string): Promise<void> {
    if (!(await this.remote())) {
      await this.fallback.removeItem(key);
      return;
    }

    const name = this.fileName(key, "delete");

    try {
      await this.bridge.deleteFile(name);
    } catch (error) {
      throw normalizeStorageError(error, "delete", `Falha ao remover '${name}' do Steam Cloud.`);
    }
  }

  public async keys(): Promise<string[]> {
    if (!(await this.remote())) {
      const fallback = this.fallback as Partial<AsyncKeyValueStorageBackend> & {
        readonly length?: number;
        key?(index: number): string | null;
      };

      if (typeof fallback.keys === "function") {
        return await fallback.keys();
      }

      const keys: string[] = [];
      const length = fallback.length ?? 0;

      for (let index = 0; index < length; index += 1) {
        const key = fallback.key?.(index) ?? null;

        if (key !== null) {
          keys.push(key);
        }
      }

      return keys;
    }

    try {
      const files = await this.bridge.listFiles();
      const keys: string[] = [];

      for (const file of files) {
        const key = decodeSteamCloudFileName(file.name);

        if (key !== null) {
          keys.push(key);
        }
      }

      return keys;
    } catch (error) {
      throw normalizeStorageError(error, "list", "Falha ao listar o Steam Cloud.");
    }
  }
}
