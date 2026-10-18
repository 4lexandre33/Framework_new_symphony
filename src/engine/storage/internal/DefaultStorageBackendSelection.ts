import type {
  StorageBackendKind,
} from "../../../contracts/storage/types";

import {
  IndexedDbStorageBackend,
  isGlobalIndexedDbAvailable,
} from "./IndexedDbStorageBackend";

import {
  GlobalLocalStorageBackend,
  MemoryKeyValueStorageBackend,
  isGlobalLocalStorageAvailable,
  type AnyKeyValueStorageBackend,
  type AsyncKeyValueStorageBackend,
  type KeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  FALLBACK_PENDING_MARKER_KEY,
  FallbackImportStorageBackend,
  LEGACY_IMPORT_MARKER_KEY,
  LegacyImportStorageBackend,
} from "./LegacyImportStorageBackend";

import {
  TauriFileStorageBackend,
  isTauriRuntime,
  type TauriFileStorageBridge,
} from "./TauriFileStorageBackend";

export interface ResolvedBackendInfo {
  readonly kind: StorageBackendKind;
  readonly persistent: boolean;
}

export interface DefaultBackendSelection extends ResolvedBackendInfo {
  readonly backend: AnyKeyValueStorageBackend;
  /**
   * Quando há sonda assíncrona (IndexedDB/arquivo), resolve com o backend
   * REALMENTE usado depois da 1ª operação (pode cair para localStorage ou
   * memória). Sem sonda, já resolvido.
   */
  readonly resolved: Promise<ResolvedBackendInfo>;
}

interface Candidate extends ResolvedBackendInfo {
  create(): AsyncKeyValueStorageBackend;
  /** Tentativas da sonda (falha transitória, ex.: IPC do Tauri). Padrão 1. */
  readonly probeAttempts?: number;
  /**
   * Escolhido depois que um candidato ANTERIOR falhou: grava
   * `FALLBACK_PENDING_MARKER_KEY` para o preferido importar estes saves
   * quando voltar a funcionar.
   */
  readonly markWhenFallback?: boolean;
}

/** Espera entre tentativas da sonda (padrão 250 ms; testes usam 0). */
export const DEFAULT_PROBE_RETRY_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/** Envolve um backend síncrono na interface assíncrona. */
class SyncAsAsyncBackend implements AsyncKeyValueStorageBackend {
  public constructor(private readonly inner: KeyValueStorageBackend) {}

  public async getItem(key: string): Promise<string | null> {
    return this.inner.getItem(key);
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.inner.setItem(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.inner.removeItem(key);
  }

  public async keys(): Promise<string[]> {
    const keys: string[] = [];
    const length = this.inner.length;

    for (let index = 0; index < length; index += 1) {
      const key = this.inner.key(index);

      if (key !== null) {
        keys.push(key);
      }
    }

    return keys;
  }

  public dispose(): void {
    this.inner.dispose?.();
  }
}

/**
 * Tenta os candidatos em ordem na PRIMEIRA operação (sonda: uma leitura).
 * O primeiro que responde vence e fica fixo; se todos falham (ex.: IndexedDB
 * em origem opaca lança SecurityError), cai no último recurso síncrono.
 */
export class AutoSelectedStorageBackend implements AsyncKeyValueStorageBackend {
  private selecting: Promise<AsyncKeyValueStorageBackend> | null = null;
  private selected: AsyncKeyValueStorageBackend | null = null;
  private info: ResolvedBackendInfo;
  private readonly resolvedPromise: Promise<ResolvedBackendInfo>;
  private resolveInfo!: (info: ResolvedBackendInfo) => void;

  public constructor(
    private readonly candidates: readonly Candidate[],
    private readonly lastResort: () => Candidate,
    private readonly probeRetryDelayMs = DEFAULT_PROBE_RETRY_DELAY_MS,
  ) {
    const first = candidates[0] ?? lastResort();
    this.info = { kind: first.kind, persistent: first.persistent };
    this.resolvedPromise = new Promise<ResolvedBackendInfo>((resolve) => {
      this.resolveInfo = resolve;
    });
  }

  public get resolved(): Promise<ResolvedBackendInfo> {
    return this.resolvedPromise;
  }

  /** Preferido antes da sonda; o real depois. */
  public get current(): ResolvedBackendInfo {
    return this.info;
  }

  private select(): Promise<AsyncKeyValueStorageBackend> {
    if (this.selected !== null) {
      return Promise.resolve(this.selected);
    }

    if (this.selecting === null) {
      this.selecting = (async () => {
        let earlierFailed = false;

        for (const candidate of this.candidates) {
          const attempts = Math.max(1, Math.trunc(candidate.probeAttempts ?? 1));

          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            let backend: AsyncKeyValueStorageBackend | null = null;

            try {
              backend = candidate.create();
              await backend.getItem(LEGACY_IMPORT_MARKER_KEY);

              if (earlierFailed && candidate.markWhenFallback === true) {
                try {
                  await backend.setItem(
                    FALLBACK_PENDING_MARKER_KEY,
                    JSON.stringify({ since: Date.now() }),
                  );
                } catch {
                  // sem marcador os saves ficam aqui; nada se perde
                }
              }

              return this.commit(candidate, backend);
            } catch (error) {
              backend?.dispose?.();

              if (attempt < attempts) {
                // Falha transitória (ex.: IPC ainda subindo): tenta de novo.
                await delay(this.probeRetryDelayMs);
                continue;
              }

              console.warn(`[Storage] Backend '${candidate.kind}' indisponível; tentando o próximo.`, error);
            }
          }

          earlierFailed = true;
        }

        const fallback = this.lastResort();
        return this.commit(fallback, fallback.create());
      })();
    }

    return this.selecting;
  }

  private commit(candidate: Candidate, backend: AsyncKeyValueStorageBackend): AsyncKeyValueStorageBackend {
    this.selected = backend;
    this.info = { kind: candidate.kind, persistent: candidate.persistent };

    if (!candidate.persistent) {
      console.warn(
        "[Storage] Armazenamento persistente indisponível neste runtime: saves ficam SÓ em memória (somem ao fechar). Veja StorageApi.getBackendInfo().",
      );
    }

    this.resolveInfo(this.info);
    return backend;
  }

  public async getItem(key: string): Promise<string | null> {
    return await (await this.select()).getItem(key);
  }

  public async setItem(key: string, value: string): Promise<void> {
    await (await this.select()).setItem(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    await (await this.select()).removeItem(key);
  }

  public async keys(): Promise<string[]> {
    return await (await this.select()).keys();
  }

  public dispose(): void {
    this.selected?.dispose?.();
  }
}

function legacySource(): KeyValueStorageBackend | null {
  return isGlobalLocalStorageAvailable() ? new GlobalLocalStorageBackend() : null;
}

function localStorageOrMemory(): Candidate {
  if (isGlobalLocalStorageAvailable()) {
    return {
      kind: "local-storage",
      persistent: true,
      create: () => new SyncAsAsyncBackend(new GlobalLocalStorageBackend()),
    };
  }

  return {
    kind: "memory",
    persistent: false,
    create: () => new SyncAsAsyncBackend(new MemoryKeyValueStorageBackend()),
  };
}

export interface DefaultBackendEnvironment {
  readonly tauri?: boolean;
  readonly indexedDb?: boolean;
  readonly localStorage?: boolean;
  /** Ponte nativa dos arquivos (testes). */
  readonly tauriBridge?: TauriFileStorageBridge;
  /** Espera entre as 2 tentativas da sonda do Tauri (testes usam 0). */
  readonly probeRetryDelayMs?: number;
}

/**
 * Seleção automática do backend dos saves (G12/G102):
 *
 * 1. app Tauri → arquivos em `<app_data_dir>/storage/saves/` (Rust, atômico);
 * 2. navegador com IndexedDB → IndexedDB (assíncrono, cota grande);
 * 3. Web Storage (`localStorage`);
 * 4. memória (node/vitest/headless), sinalizado como NÃO persistente.
 *
 * 1 e 2 importam na 1ª operação os saves que versões anteriores deixaram no
 * `localStorage` (sem apagá-los) e caem para 3/4 se a sonda falhar.
 *
 * No Tauri a sonda dos arquivos é tentada 2 vezes (falha transitória do IPC)
 * antes de cair para o IndexedDB. Se cair, o IndexedDB recebe um marcador e,
 * no próximo boot em que os arquivos funcionarem, os saves gravados nele são
 * importados para os arquivos (veja `FallbackImportStorageBackend`).
 */
export function selectDefaultKeyValueBackend(
  environment: DefaultBackendEnvironment = {},
): DefaultBackendSelection {
  const tauri = environment.tauri ?? isTauriRuntime();
  const indexedDb = environment.indexedDb ?? isGlobalIndexedDbAvailable();
  const local = environment.localStorage ?? isGlobalLocalStorageAvailable();

  const candidates: Candidate[] = [];

  if (tauri) {
    const bridge = environment.tauriBridge;
    candidates.push({
      kind: "tauri-file",
      persistent: true,
      probeAttempts: 2,
      create: () => {
        const files = new LegacyImportStorageBackend(
          new TauriFileStorageBackend(bridge !== undefined ? { bridge } : {}),
          legacySource(),
        );
        return indexedDb
          ? new FallbackImportStorageBackend(files, () => new IndexedDbStorageBackend())
          : files;
      },
    });
  }

  if (indexedDb) {
    candidates.push({
      kind: "indexeddb",
      persistent: true,
      markWhenFallback: tauri,
      create: () => new LegacyImportStorageBackend(new IndexedDbStorageBackend(), legacySource()),
    });
  }

  if (candidates.length > 0) {
    const backend = new AutoSelectedStorageBackend(
      candidates,
      localStorageOrMemory,
      environment.probeRetryDelayMs ?? DEFAULT_PROBE_RETRY_DELAY_MS,
    );
    const first = backend.current;

    return {
      backend,
      kind: first.kind,
      persistent: first.persistent,
      resolved: backend.resolved,
    };
  }

  if (local) {
    const info: ResolvedBackendInfo = { kind: "local-storage", persistent: true };
    return { backend: new GlobalLocalStorageBackend(), ...info, resolved: Promise.resolve(info) };
  }

  const info: ResolvedBackendInfo = { kind: "memory", persistent: false };
  return { backend: new MemoryKeyValueStorageBackend(), ...info, resolved: Promise.resolve(info) };
}
