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
  /** Relógio (ms) para a nova sonda periódica. Padrão: `Date.now`. */
  readonly now?: () => number;
  /** Intervalo mínimo entre sondas, verificado nas chamadas (sem timers). Padrão 30 s. */
  readonly reprobeIntervalMs?: number;
}

/** Intervalo padrão entre sondas do Steam (verificado nas operações). */
export const STEAM_CLOUD_REPROBE_INTERVAL_MS = 30_000;

/** Chaves do driver `steam_cloud` que podem estar no fallback local. */
const STEAM_SAVE_KEY_PATTERN =
  /^(?:ns:[^:]*:)?steam_cloud_save_/u;

/** Índice do driver: otimização reconstruível (nunca copiado; removido ao importar). */
const STEAM_INDEX_KEY_PATTERN =
  /^(?:ns:[^:]*:)?steam_cloud_save_#index$/u;

function errorDetail(error: unknown): string {
  return typeof error === "string" ? error : String((error as { message?: unknown })?.message ?? error);
}

/** `metadata.timestamp` (ms) de um save gravado pelo driver; null se ilegível. */
function savedTimestampMs(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { metadata?: { timestamp?: unknown } } | null;
    const timestamp = parsed?.metadata?.timestamp;
    return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  } catch {
    return null;
  }
}

/**
 * Backend do driver `steam_cloud` (G131): grava no **Steam Remote Storage**
 * (ISteamRemoteStorage via `steam_cloud_*`) quando o cliente Steam está
 * inicializado; caso contrário, fallback HONESTO para o backend local, com
 * o modo exposto em `getStatus()` (`StorageApi.getSteamCloudStatus`).
 *
 * Sonda e reconciliação:
 * - A sonda (`steam_cloud_status`) é refeita, nas próprias operações (sem
 *   timers), quando passou `reprobeIntervalMs` desde a última ou quando uma
 *   operação remota falhou. Fora do app nativo (`not-native`) não sonda.
 * - Sempre que a sonda encontra o Steam disponível e há saves do driver no
 *   fallback local (gravados enquanto o Steam estava fora), eles são levados
 *   para o Remote Storage ANTES da operação seguir: chave ausente na nuvem é
 *   copiada; presente nos dois, vence a mais nova se os dois horários forem
 *   conhecidos (`metadata.timestamp` do save × horário do arquivo no Steam),
 *   senão vence a nuvem. A cópia local é então apagada (não há saves
 *   divididos nem "ressurreição" de um save apagado na nuvem); o índice da
 *   nuvem é removido para ser reconstruído. Chave que falha fica no local e
 *   é tentada de novo na próxima sonda (`pendingLocalKeys` no status).
 */
export class SteamRemoteStorageBackend
  implements AsyncKeyValueStorageBackend {
  private readonly fallback: AnyKeyValueStorageBackend;
  private readonly bridge: SteamRemoteStorageBridge;
  private readonly nativeAvailable: boolean;
  private readonly now: () => number;
  private readonly reprobeIntervalMs: number;
  private probing: Promise<SteamCloudStorageStatus> | null = null;
  private probedAt: number | null = null;
  private stale = false;
  private importedFromLocal = 0;
  private pendingLocalKeys = 0;
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
    this.now = options.now ?? Date.now;
    this.reprobeIntervalMs =
      Number.isFinite(options.reprobeIntervalMs) && (options.reprobeIntervalMs as number) >= 0
        ? (options.reprobeIntervalMs as number)
        : STEAM_CLOUD_REPROBE_INTERVAL_MS;
  }

  /** Estado atual (sonda o Steam se ainda não sondou ou se a sonda venceu). */
  public getStatus(): Promise<SteamCloudStorageStatus> {
    return this.probe();
  }

  /** Último estado conhecido, sem sondar. */
  public peekStatus(): SteamCloudStorageStatus {
    return this.status;
  }

  private needsProbe(): boolean {
    if (this.probedAt === null) return true;
    if (!this.nativeAvailable) return false;
    return this.stale || this.now() - this.probedAt >= this.reprobeIntervalMs;
  }

  private probe(): Promise<SteamCloudStorageStatus> {
    if (this.probing !== null) {
      return this.probing;
    }

    if (!this.needsProbe()) {
      return Promise.resolve(this.status);
    }

    const run = (async (): Promise<SteamCloudStorageStatus> => {
      this.stale = false;

      if (!this.nativeAvailable) {
        this.probedAt = this.now();
        this.status = {
          mode: "local-fallback",
          synced: false,
          reason: "not-native",
          checkedAt: this.probedAt,
        };
        return this.status;
      }

      let next: SteamCloudStorageStatus;

      try {
        const dto = await this.bridge.status();

        next = {
          mode: "remote-storage",
          // Com a nuvem desligada (conta ou app) o Steam grava só no disco
          // local e sincroniza quando for religada.
          synced: dto.accountEnabled === true && dto.appEnabled === true,
          accountEnabled: dto.accountEnabled === true,
          appEnabled: dto.appEnabled === true,
        };
      } catch (error) {
        next = {
          mode: "local-fallback",
          synced: false,
          reason: "steam-unavailable",
          detail: errorDetail(error),
        };
      }

      if (next.mode === "remote-storage") {
        await this.importLocalFallback();
      }

      this.probedAt = this.now();
      this.status = {
        ...next,
        checkedAt: this.probedAt,
        importedFromLocal: this.importedFromLocal,
        pendingLocalKeys: this.pendingLocalKeys,
      };
      return this.status;
    })();

    this.probing = run;
    void run.finally(() => {
      if (this.probing === run) this.probing = null;
    }).catch(() => undefined);
    return run;
  }

  /** Falha de uma operação remota: a próxima chamada sonda o Steam de novo. */
  private markRemoteFailure(): void {
    this.stale = true;
  }

  private async fallbackKeys(): Promise<string[]> {
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

  /** Leva para a nuvem os saves do driver que ficaram no fallback local. */
  private async importLocalFallback(): Promise<void> {
    let localKeys: string[];

    try {
      localKeys = (await this.fallbackKeys()).filter((key) => STEAM_SAVE_KEY_PATTERN.test(key));
    } catch (error) {
      console.warn("[Storage] Não foi possível listar o fallback local do Steam Cloud:", error);
      return;
    }

    if (localKeys.length === 0) {
      this.pendingLocalKeys = 0;
      return;
    }

    let remoteFiles: Map<string, number>;

    try {
      remoteFiles = new Map((await this.bridge.listFiles()).map((file) => [file.name, file.timestamp]));
    } catch (error) {
      console.warn("[Storage] Steam Cloud indisponível para importar o fallback local:", error);
      this.pendingLocalKeys = localKeys.length;
      return;
    }

    let pending = 0;
    let touched = false;

    for (const key of localKeys) {
      try {
        if (STEAM_INDEX_KEY_PATTERN.test(key)) {
          // Índice local é descartado: o da nuvem é reconstruído pela varredura.
          await this.fallback.removeItem(key);
          continue;
        }

        const name = encodeSteamCloudFileName(key);
        const value = await this.fallback.getItem(key);

        if (name === null || value === null) {
          if (value === null) continue;
          pending += 1;
          continue;
        }

        const remoteSeconds = remoteFiles.get(name);
        let upload = remoteSeconds === undefined;

        if (!upload) {
          const localMs = savedTimestampMs(value);
          // Horário do Steam é em segundos; só sobrescreve se claramente mais novo.
          upload =
            localMs !== null &&
            typeof remoteSeconds === "number" &&
            remoteSeconds > 0 &&
            localMs >= (remoteSeconds + 1) * 1000;
        }

        if (upload) {
          const written = await this.bridge.writeFile(name, Array.from(new TextEncoder().encode(value)));

          if (written !== true) {
            pending += 1;
            continue;
          }

          touched = true;
          this.importedFromLocal += 1;
        }

        await this.fallback.removeItem(key);
      } catch (error) {
        pending += 1;
        console.warn(`[Storage] Save local '${key}' não foi levado ao Steam Cloud (fica no disco local):`, error);
      }
    }

    if (touched) {
      for (const [name] of remoteFiles) {
        const key = decodeSteamCloudFileName(name);

        if (key !== null && STEAM_INDEX_KEY_PATTERN.test(key)) {
          try {
            await this.bridge.deleteFile(name);
          } catch {
            // índice é otimização; o driver tolera índice velho com varredura.
          }
        }
      }
    }

    this.pendingLocalKeys = pending;
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
      this.markRemoteFailure();
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
      this.markRemoteFailure();
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
      this.markRemoteFailure();
      throw normalizeStorageError(error, "delete", `Falha ao remover '${name}' do Steam Cloud.`);
    }
  }

  public async keys(): Promise<string[]> {
    if (!(await this.remote())) {
      return await this.fallbackKeys();
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
      this.markRemoteFailure();
      throw normalizeStorageError(error, "list", "Falha ao listar o Steam Cloud.");
    }
  }
}
