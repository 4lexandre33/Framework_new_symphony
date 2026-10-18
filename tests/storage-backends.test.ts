// @vitest-environment node
// G102: backends IndexedDB e arquivo (Tauri), importação do localStorage legado
// e seleção automática com fallback. IndexedDB real é verificado em
// tests/browser/storage-gaps.mjs (Chromium); aqui um fake mínimo em memória.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginContext } from "@core";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import { IndexedDbStorageBackend, type IndexedDbFactoryLike } from "../src/engine/storage/internal/IndexedDbStorageBackend";
import { MemoryKeyValueStorageBackend } from "../src/engine/storage/internal/KeyValueStorageBackend";
import { LEGACY_IMPORT_MARKER_KEY, LegacyImportStorageBackend } from "../src/engine/storage/internal/LegacyImportStorageBackend";
import { TauriFileStorageBackend, type TauriFileStorageBridge } from "../src/engine/storage/internal/TauriFileStorageBackend";
import { selectDefaultKeyValueBackend } from "../src/engine/storage/internal/DefaultStorageBackendSelection";

const ctx = { events: { emit: (): void => undefined } } as unknown as PluginContext;

/* ───────────── fake IndexedDB (apenas o que o backend usa) ───────────── */

type Handler = (() => void) | null;

class FakeRequest<T> {
  public result!: T;
  public error: Error | null = null;
  public onsuccess: Handler = null;
  public onerror: Handler = null;
  public onupgradeneeded: Handler = null;
  public onblocked: Handler = null;
}

class FakeTransaction {
  public oncomplete: Handler = null;
  public onerror: Handler = null;
  public onabort: Handler = null;
  public error: Error | null = null;
  private pending = 0;

  public constructor(private readonly data: Map<string, unknown>, private readonly failWith: Error | null) {}

  private request<T>(compute: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.failWith) {
        request.error = this.failWith;
        this.error = this.failWith;
        request.onerror?.();
        this.onabort?.();
        return;
      }
      request.result = compute();
      request.onsuccess?.();
      this.pending -= 1;
      if (this.pending === 0) queueMicrotask(() => this.oncomplete?.());
    });
    return request;
  }

  public objectStore(): unknown {
    return {
      get: (key: string) => this.request(() => this.data.get(key)),
      put: (value: unknown, key: string) => this.request(() => void this.data.set(key, value)),
      delete: (key: string) => this.request(() => void this.data.delete(key)),
      getAllKeys: () => this.request(() => [...this.data.keys()].sort()),
    };
  }
}

class FakeIndexedDb implements IndexedDbFactoryLike {
  public readonly stores = new Map<string, Map<string, unknown>>();
  public opens = 0;
  public closes = 0;
  public failWrites: Error | null = null;
  public openError: Error | null = null;

  public open(name: string): IDBOpenDBRequest {
    this.opens += 1;
    const request = new FakeRequest<unknown>();
    queueMicrotask(() => {
      if (this.openError) {
        request.error = this.openError;
        request.onerror?.();
        return;
      }
      const isNew = !this.stores.has(name);
      if (isNew) this.stores.set(name, new Map());
      const data = this.stores.get(name)!;
      const names = new Set<string>();
      const db = {
        objectStoreNames: { contains: (store: string) => names.has(store) },
        createObjectStore: (store: string) => names.add(store),
        transaction: (_store: string, mode: string) =>
          new FakeTransaction(data, mode === "readwrite" ? this.failWrites : null),
        close: () => {
          this.closes += 1;
        },
        onversionchange: null,
        onclose: null,
      };
      request.result = db;
      if (isNew) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

/* ───────────── fake da ponte nativa de arquivos ───────────── */

class FakeFileBridge implements TauriFileStorageBridge {
  public readonly files = new Map<string, Map<string, string>>();
  public quota = Number.POSITIVE_INFINITY;
  public calls: string[] = [];

  private ns(namespace: string): Map<string, string> {
    let map = this.files.get(namespace);
    if (!map) this.files.set(namespace, (map = new Map()));
    return map;
  }

  public async read(namespace: string, key: string): Promise<string | null> {
    this.calls.push(`read:${namespace}`);
    return this.ns(namespace).get(key) ?? null;
  }

  public async write(namespace: string, key: string, value: string): Promise<boolean> {
    this.calls.push(`write:${namespace}`);
    if (value.length > this.quota) throw { code: "quota-exceeded", message: "disco cheio" };
    this.ns(namespace).set(key, value);
    return true;
  }

  public async remove(namespace: string, key: string): Promise<boolean> {
    return this.ns(namespace).delete(key);
  }

  public async list(namespace: string): Promise<string[]> {
    return [...this.ns(namespace).keys()];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("G102 IndexedDbStorageBackend", () => {
  it("get/set/remove/keys assíncronos numa conexão reaproveitada", async () => {
    const idb = new FakeIndexedDb();
    const backend = new IndexedDbStorageBackend({ factory: idb });
    expect(await backend.getItem("a")).toBeNull();
    await backend.setItem("a", "1");
    await backend.setItem("b", "2");
    expect(await backend.getItem("a")).toBe("1");
    expect(await backend.keys()).toEqual(["a", "b"]);
    await backend.removeItem("a");
    expect(await backend.keys()).toEqual(["b"]);
    expect(idb.opens).toBe(1);
    backend.dispose();
    await Promise.resolve();
    await Promise.resolve();
    expect(idb.closes).toBe(1);
    await expect(backend.getItem("b")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("QuotaExceededError vira code quota-exceeded (o driver libera backups e tenta de novo)", async () => {
    const idb = new FakeIndexedDb();
    const backend = new IndexedDbStorageBackend({ factory: idb });
    const quota = new Error("cheio");
    quota.name = "QuotaExceededError";
    idb.failWrites = quota;
    await expect(backend.setItem("a", "x")).rejects.toMatchObject({ code: "quota-exceeded" });
  });

  it("saves completos (backup, índice, namespace) passam pelo StorageService", async () => {
    const backend = new IndexedDbStorageBackend({ factory: new FakeIndexedDb() });
    const svc = new StorageService(ctx, { backend });
    svc.configureSaves({ namespace: "jogo", backupCount: 1 });
    await svc.saveGame("s1", { gold: 1 });
    await svc.saveGame("s1", { gold: 2 });
    expect(await svc.loadGame("s1")).toEqual({ gold: 2 });
    expect((await svc.listSaves()).map((m) => m.slotName)).toEqual(["s1"]);
    const keys = await backend.keys();
    expect(keys.every((k) => k.startsWith("ns:jogo:"))).toBe(true);
    expect(keys.some((k) => k.includes("#bak1:"))).toBe(true);
  });
});

describe("G102 TauriFileStorageBackend", () => {
  it("usa o namespace de arquivo e mapeia erros nativos serializados", async () => {
    const bridge = new FakeFileBridge();
    const backend = new TauriFileStorageBackend({ bridge });
    const svc = new StorageService(ctx, { backend });
    await svc.saveGame("slot", { hp: 3 });
    expect(await svc.loadGame("slot")).toEqual({ hp: 3 });
    expect([...bridge.files.get("saves")!.keys()].some((k) => k.startsWith("local_db_save_slot"))).toBe(true);

    bridge.quota = 10;
    await expect(backend.setItem("x", "y".repeat(50))).rejects.toMatchObject({ code: "quota-exceeded" });
  });

  it("valida namespace e chave antes de chamar o nativo", async () => {
    expect(() => new TauriFileStorageBackend({ namespace: "../fora", bridge: new FakeFileBridge() })).toThrow();
    const bridge = new FakeFileBridge();
    const backend = new TauriFileStorageBackend({ bridge });
    await expect(backend.getItem("")).rejects.toMatchObject({ reason: "invalid-input" });
    await expect(backend.setItem("a\0b", "x")).rejects.toMatchObject({ reason: "invalid-input" });
    await expect(backend.setItem("ç".repeat(5000), "x")).rejects.toMatchObject({ reason: "invalid-input" });
    expect(bridge.calls).toEqual([]);
  });

  it("qualquer slot válido (256 caracteres não-ASCII, com backups e namespace) cabe no backend de arquivos", async () => {
    // Ponte que aplica o MESMO limite do Rust (8 KiB por chave).
    class LimitedBridge extends FakeFileBridge {
      public override async write(namespace: string, key: string, value: string): Promise<boolean> {
        if (new TextEncoder().encode(key).length > 8 * 1024) throw { code: "invalid-input", message: "chave" };
        return await super.write(namespace, key, value);
      }
    }
    const bridge = new LimitedBridge();
    const svc = new StorageService(ctx, { backend: new TauriFileStorageBackend({ bridge }) });
    svc.configureSaves({ namespace: "Meu Jogo ☃", backupCount: 3 });
    const slot = "☃".repeat(256);
    await svc.saveGame(slot, { v: 1 });
    await svc.saveGame(slot, { v: 2 });
    expect(await svc.loadGame(slot)).toEqual({ v: 2 });
    expect((await svc.listSaves()).map((meta) => meta.slotName)).toEqual([slot]);
    const longest = Math.max(...[...bridge.files.get("saves")!.keys()].map((k) => new TextEncoder().encode(k).length));
    expect(longest).toBeGreaterThan(240); // o Rust usa o nome por hash nesses casos
  });
});

describe("G102 importação do localStorage legado", () => {
  it("copia só chaves de save ausentes, uma vez, sem apagar a origem", async () => {
    const legacy = new MemoryKeyValueStorageBackend();
    legacy.setItem("local_db_save_a", "A");
    legacy.setItem("ns:j:steam_cloud_save_b", "B");
    legacy.setItem("ns:j:local_db_save_#index", "I");
    legacy.setItem("outra_coisa", "nao");
    legacy.setItem("local_db_save_c", "velho");

    const target = new MemoryKeyValueStorageBackend();
    target.setItem("local_db_save_c", "novo");
    const asyncTarget = {
      getItem: async (k: string) => target.getItem(k),
      setItem: async (k: string, v: string) => target.setItem(k, v),
      removeItem: async (k: string) => target.removeItem(k),
      keys: async () => {
        const keys: string[] = [];
        for (let i = 0; i < target.length; i += 1) keys.push(target.key(i)!);
        return keys;
      },
    };

    const backend = new LegacyImportStorageBackend(asyncTarget, legacy);
    expect((await backend.keys()).sort()).toEqual(["local_db_save_a", "local_db_save_c", "ns:j:local_db_save_#index", "ns:j:steam_cloud_save_b"]);
    expect(await backend.getItem("local_db_save_c")).toBe("novo");
    expect(target.getItem(LEGACY_IMPORT_MARKER_KEY)).not.toBeNull();
    expect(legacy.getItem("local_db_save_a")).toBe("A");

    // Apagar depois da importação não ressuscita o save.
    await backend.removeItem("local_db_save_a");
    const again = new LegacyImportStorageBackend(asyncTarget, legacy);
    expect(await again.getItem("local_db_save_a")).toBeNull();
  });

  it("uma chave que falha não impede as outras e o marcador é gravado listando-a", async () => {
    const legacy = new MemoryKeyValueStorageBackend();
    legacy.setItem("local_db_save_a", "A");
    legacy.setItem("local_db_save_ruim", "X");
    legacy.setItem("local_db_save_b", "B");
    const target = new Map<string, string>();
    const asyncTarget = {
      getItem: async (k: string) => target.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        if (k.endsWith("ruim")) throw new Error("chave inválida para o destino");
        target.set(k, v);
      },
      removeItem: async (k: string) => void target.delete(k),
      keys: async () => [...target.keys()],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const backend = new LegacyImportStorageBackend(asyncTarget, legacy);
    expect((await backend.keys()).sort()).toEqual(["local_db_save_a", "local_db_save_b"]);
    expect(backend.getImportReport()).toEqual({ found: 3, imported: 2, skipped: 0, failedKeys: ["local_db_save_ruim"] });
    expect(JSON.parse(target.get(LEGACY_IMPORT_MARKER_KEY)!)).toMatchObject({ failedKeys: ["local_db_save_ruim"] });
    expect(legacy.getItem("local_db_save_ruim")).toBe("X"); // fica na origem
    warn.mockRestore();
  });
});

describe("G102 seleção automática", () => {
  it("node sem nada: memória síncrona (comportamento antigo)", () => {
    const selection = selectDefaultKeyValueBackend({ tauri: false, indexedDb: false, localStorage: false });
    expect(selection.kind).toBe("memory");
    expect(selection.persistent).toBe(false);
  });

  it("navegador: prefere IndexedDB; sonda falhando cai para localStorage", async () => {
    const idb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", idb);
    const ok = selectDefaultKeyValueBackend({ tauri: false, localStorage: false });
    expect(ok.kind).toBe("indexeddb");
    await ok.backend.setItem("local_db_save_x", "1");
    expect(await ok.resolved).toEqual({ kind: "indexeddb", persistent: true });

    const broken = new FakeIndexedDb();
    const security = new Error("opaque");
    security.name = "SecurityError";
    broken.openError = security;
    vi.stubGlobal("indexedDB", broken);
    const local = new MemoryKeyValueStorageBackend();
    vi.stubGlobal("localStorage", local);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fallback = selectDefaultKeyValueBackend({ tauri: false });
    await fallback.backend.setItem("local_db_save_y", "2");
    expect(await fallback.resolved).toEqual({ kind: "local-storage", persistent: true });
    expect(local.getItem("local_db_save_y")).toBe("2");
    warn.mockRestore();
  });

  it("StorageService reporta o backend resolvido", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb());
    const svc = new StorageService(ctx);
    expect(svc.getBackendInfo().kind).toBe("indexeddb");
    expect(await svc.resolveBackendInfo()).toEqual({ kind: "indexeddb", persistent: true, namespace: null });
    await svc.saveGame("a", { v: 1 });
    expect(await svc.loadGame("a")).toEqual({ v: 1 });
    svc.dispose();
  });

  it("Tauri: prefere arquivo (invoke falha fora do app → cai para IndexedDB)", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const selection = selectDefaultKeyValueBackend({ tauri: true });
    expect(selection.kind).toBe("tauri-file");
    await selection.backend.getItem("k");
    expect((await selection.resolved).kind).toBe("indexeddb");
    warn.mockRestore();
  });

  it("Tauri: falha transitória da sonda é tentada de novo antes de cair para o IndexedDB", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb());
    const bridge = new FakeFileBridge();
    let failures = 1;
    const flaky: TauriFileStorageBridge = {
      read: async (ns, key) => {
        if (failures > 0) {
          failures -= 1;
          throw { code: "unavailable", message: "ipc ainda subindo" };
        }
        return await bridge.read(ns, key);
      },
      write: (ns, key, value) => bridge.write(ns, key, value),
      remove: (ns, key) => bridge.remove(ns, key),
      list: (ns) => bridge.list(ns),
    };
    const selection = selectDefaultKeyValueBackend({ tauri: true, localStorage: false, tauriBridge: flaky, probeRetryDelayMs: 0 });
    await selection.backend.setItem("local_db_save_x", "1");
    expect((await selection.resolved).kind).toBe("tauri-file");
    expect(bridge.files.get("saves")!.get("local_db_save_x")).toBe("1");
  });

  it("Tauri: saves gravados no IndexedDB de fallback são importados para os arquivos quando eles voltam", async () => {
    const idb = new FakeIndexedDb();
    vi.stubGlobal("indexedDB", idb);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bridge = new FakeFileBridge();
    const record = (v: string, timestamp: number) => JSON.stringify({ metadata: { timestamp }, v });

    // Já existia nos arquivos (mais novo que o do fallback, que deve perder).
    await bridge.write("saves", "local_db_save_both_new", record("arquivo", 900));
    await bridge.write("saves", "local_db_save_both_old", record("arquivo", 100));
    await bridge.write("saves", "local_db_save_#index", "{}");

    // Sessão 1: arquivos falham → IndexedDB (com marcador).
    const down: TauriFileStorageBridge = {
      read: async () => {
        throw { code: "unavailable", message: "fora" };
      },
      write: async () => {
        throw { code: "unavailable", message: "fora" };
      },
      remove: async () => false,
      list: async () => [],
    };
    const first = selectDefaultKeyValueBackend({ tauri: true, localStorage: false, tauriBridge: down, probeRetryDelayMs: 0 });
    await first.backend.setItem("local_db_save_only_idb", record("idb", 500));
    await first.backend.setItem("local_db_save_both_new", record("idb", 500));
    await first.backend.setItem("local_db_save_both_old", record("idb", 500));
    expect((await first.resolved).kind).toBe("indexeddb");

    // Sessão 2: arquivos OK → importa e limpa o fallback.
    const second = selectDefaultKeyValueBackend({ tauri: true, localStorage: false, tauriBridge: bridge, probeRetryDelayMs: 0 });
    expect(await second.backend.getItem("local_db_save_only_idb")).toBe(record("idb", 500));
    expect((await second.resolved).kind).toBe("tauri-file");
    const files = bridge.files.get("saves")!;
    expect(files.get("local_db_save_both_new")).toBe(record("arquivo", 900));
    expect(files.get("local_db_save_both_old")).toBe(record("idb", 500));
    expect(files.has("local_db_save_#index")).toBe(false); // reconstruído pela varredura
    const leftovers = [...idb.stores.values()].flatMap((store) => [...store.keys()]);
    expect(leftovers.filter((key) => key.startsWith("local_db_save_") || key.includes("fallback_pending"))).toEqual([]);
    warn.mockRestore();
  });
});
