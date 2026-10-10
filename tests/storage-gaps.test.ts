// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import {
  MemoryKeyValueStorageBackend,
  type AsyncKeyValueStorageBackend,
  type KeyValueStorageBackend,
} from "../src/engine/storage/internal/KeyValueStorageBackend";
import { LocalDatabaseDriver } from "../src/engine/storage/internal/LocalDatabaseDriver";
import { calculateSaveChecksum } from "../src/engine/storage/internal/SaveRecordCodec";
import type { ProfileHttpTransport } from "../src/engine/storage/internal/RemoteProfileBackend";

interface Emitted {
  type: string;
  payload: any;
}

function ctxWith(emitted: Emitted[]): PluginContext {
  return {
    events: {
      emit: (type: string, payload: unknown): void => {
        emitted.push({ type, payload });
      },
    },
  } as unknown as PluginContext;
}

/** Backend em memória que conta leituras e pode simular cota. */
class SpyBackend extends MemoryKeyValueStorageBackend {
  public reads = 0;
  public quotaBytes = Number.POSITIVE_INFINITY;

  public override getItem(key: string): string | null {
    this.reads += 1;
    return super.getItem(key);
  }

  public override setItem(key: string, value: string): void {
    let total = value.length;
    for (let i = 0; i < this.length; i += 1) {
      const k = this.key(i);
      if (k !== null && k !== key) total += super.getItem(k)?.length ?? 0;
    }
    if (total > this.quotaBytes) {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    super.setItem(key, value);
  }
}

function service(backend?: KeyValueStorageBackend | AsyncKeyValueStorageBackend, extra: Record<string, unknown> = {}): { service: StorageService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  let now = 1000;
  const svc = new StorageService(ctxWith(emitted), {
    ...(backend ? { backend } : {}),
    now: () => (now += 1),
    ...extra,
  });
  return { service: svc, emitted };
}

function corruptPrimary(backend: MemoryKeyValueStorageBackend, key: string): void {
  const parsed = JSON.parse(backend.getItem(key) ?? "{}") as { payload: string };
  parsed.payload = "{\"coins\":999999}";
  backend.setItem(key, JSON.stringify(parsed));
}

describe("storage gaps (G12, G100–G103)", () => {
  it("G12: sem Web Storage (node/vitest) usa memória automaticamente e informa; backend injetável", async () => {
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
    const { service: svc } = service();
    expect(svc.getBackendInfo()).toEqual({ kind: "memory", persistent: false, namespace: null });
    await svc.saveGame("slot", { hp: 3 });
    expect(await svc.loadGame("slot")).toEqual({ hp: 3 });

    const injected = new MemoryKeyValueStorageBackend();
    const custom = service(injected).service;
    expect(custom.getBackendInfo().kind).toBe("custom");
    await custom.saveGame("x", { a: 1 });
    expect(injected.length).toBeGreaterThan(0);
  });

  it("G100: sem backend remoto não há sucesso falso; backend HTTP plugável", async () => {
    const { service: svc, emitted } = service(new MemoryKeyValueStorageBackend());
    const profile = { playerId: "p1", displayName: "P", rankScore: 1, inventoryData: {}, lastSyncedTimestamp: 1 };
    expect(svc.isOnlineProfileSupported()).toBe(false);
    expect(await svc.syncOnlineProfile(profile)).toBe(false);
    expect(emitted.find((e) => e.type === "game.storage.profile-synced")?.payload).toMatchObject({ success: false, error: "unsupported" });
    expect(await svc.fetchOnlineProfile("p1")).toBeNull();
    expect(svc.getLastOnlineProfileError()).toBe("unsupported");

    const server = new Map<string, string>();
    const calls: string[] = [];
    const transport: ProfileHttpTransport = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      const id = decodeURIComponent(url.split("/").pop() ?? "");
      if (init.method === "PUT") {
        server.set(id, init.body ?? "");
        return { ok: true, status: 204, json: async () => null };
      }
      const body = server.get(id);
      return body === undefined
        ? { ok: false, status: 404, json: async () => null }
        : { ok: true, status: 200, json: async () => JSON.parse(body) };
    };
    const remote = service(new MemoryKeyValueStorageBackend(), { profileTransport: transport }).service;
    remote.configureOnlineProfile({ endpoint: "https://api.example/profiles/" });
    expect(remote.isOnlineProfileSupported()).toBe(true);
    expect(await remote.syncOnlineProfile({ ...profile, playerId: "a b" })).toBe(true);
    expect(await remote.fetchOnlineProfile("a b")).toMatchObject({ playerId: "a b" });
    expect(await remote.fetchOnlineProfile("nobody")).toBeNull();
    expect(calls[0]).toBe("PUT https://api.example/profiles/a%20b");

    const failing = service(new MemoryKeyValueStorageBackend(), {
      profileTransport: (async () => ({ ok: false, status: 500, json: async () => null })) as ProfileHttpTransport,
    }).service;
    failing.configureOnlineProfile({ endpoint: "https://api.example/p" });
    expect(await failing.syncOnlineProfile(profile)).toBe(false);
    expect(failing.getLastOnlineProfileError()).toContain("500");
  });

  it("G101: principal corrompido recupera do backup (evento) e loadGameDetailed não rejeita", async () => {
    const backend = new MemoryKeyValueStorageBackend();
    const { service: svc, emitted } = service(backend);
    svc.configureSaves({ backupCount: 2 });
    await svc.saveGame("main", { coins: 1 });
    await svc.saveGame("main", { coins: 2 });
    await svc.saveGame("main", { coins: 3 });
    corruptPrimary(backend, "local_db_save_main");

    const detailed = await svc.loadGameDetailed<{ coins: number }>("main");
    expect(detailed).toMatchObject({ status: "recovered", data: { coins: 2 }, backupIndex: 1 });
    expect(emitted.some((e) => e.type === "game.storage.save-recovered")).toBe(true);
    // o principal foi restaurado a partir do backup
    expect(await svc.loadGame("main")).toEqual({ coins: 2 });

    // tudo corrompido: detailed devolve "corrupted"; loadGame rejeita
    corruptPrimary(backend, "local_db_save_main");
    corruptPrimary(backend, "local_db_save_#bak1:main");
    corruptPrimary(backend, "local_db_save_#bak2:main");
    expect((await svc.loadGameDetailed("main")).status).toBe("corrupted");
    await expect(svc.loadGame("main")).rejects.toMatchObject({ code: "corrupted" });
    expect((await svc.loadGameDetailed("missing")).status).toBe("missing");
  });

  it("G101: HMAC com chave detecta adulteração que recalcula o checksum; requireSignature", async () => {
    const backend = new MemoryKeyValueStorageBackend();
    const { service: svc } = service(backend);
    svc.configureSaves({ integrityKey: "segredo", backupCount: 0 });
    const meta = await svc.saveGame("s", { gold: 10 });
    expect(meta.signed).toBe(true);
    expect(await svc.loadGame("s")).toEqual({ gold: 10 });

    // Trapaceiro edita o payload E recalcula o FNV: o HMAC pega.
    const raw = JSON.parse(backend.getItem("local_db_save_s") ?? "{}") as { payload: string; metadata: { checksum: string } };
    raw.payload = "{\"gold\":99999}";
    raw.metadata.checksum = calculateSaveChecksum(raw.payload);
    backend.setItem("local_db_save_s", JSON.stringify(raw));
    await expect(svc.loadGame("s")).rejects.toMatchObject({ code: "corrupted" });

    // Save antigo sem assinatura: aceito por padrão; rejeitado com requireSignature.
    const plain = service(backend).service;
    await plain.saveGame("old", { v: 1 });
    expect(await svc.loadGame("old")).toEqual({ v: 1 });
    svc.configureSaves({ requireSignature: true });
    expect((await svc.loadGameDetailed("old")).status).toBe("corrupted");
  });

  it("G102: namespace por jogo, nomes seguros sem colisão, índice de metadados, cota", async () => {
    const backend = new SpyBackend();
    const a = service(backend).service;
    const b = service(backend).service;
    a.configureSaves({ namespace: "jogo-a" });
    b.configureSaves({ namespace: "jogo-b" });
    await a.saveGame("slot1", { who: "a" });
    await b.saveGame("slot1", { who: "b" });
    expect(await a.loadGame("slot1")).toEqual({ who: "a" });
    expect(await b.loadGame("slot1")).toEqual({ who: "b" });
    expect((await a.listSaves()).map((m) => m.slotName)).toEqual(["slot1"]);

    // "a b" vs "a%20b" e nomes com controle/acentos/longos
    await a.saveGame("a b", { n: 1 });
    await a.saveGame("a%20b", { n: 2 });
    await a.saveGame("tab\there", { n: 3 });
    await a.saveGame("x".repeat(200), { n: 4 });
    expect(await a.loadGame("a b")).toEqual({ n: 1 });
    expect(await a.loadGame("a%20b")).toEqual({ n: 2 });
    expect(await a.deleteSave("a%20b")).toBe(true);
    expect(await a.loadGame("a b")).toEqual({ n: 1 });
    await expect(a.saveGame("   ", { n: 0 })).rejects.toMatchObject({ code: "operation-failed", reason: "invalid-slot" });

    // listSaves lê o índice, não cada save
    await a.listSaves();
    backend.reads = 0;
    const list = await a.listSaves();
    expect(list.map((m) => m.slotName).sort()).toEqual(["a b", "slot1", "tab\there", "x".repeat(200)].sort());
    expect(backend.reads).toBe(1);

    // cota: sem espaço para backup, o save libera os backups do slot e grava
    const tight = new SpyBackend();
    const { service: svc, emitted } = service(tight);
    svc.configureSaves({ backupCount: 1 });
    await svc.saveGame("big", { blob: "x".repeat(400) });
    tight.quotaBytes = tight.getItem("local_db_save_big")!.length + 700;
    await svc.saveGame("big", { blob: "y".repeat(400) });
    expect(await svc.loadGame("big")).toEqual({ blob: "y".repeat(400) });
    // sem espaço nenhum: rejeita quota-exceeded e emite save-completed com falha
    tight.quotaBytes = 10;
    await expect(svc.saveGame("other", { blob: "z".repeat(400) })).rejects.toMatchObject({ code: "quota-exceeded" });
    expect(emitted.filter((e) => e.type === "game.storage.save-completed").pop()?.payload).toMatchObject({ success: false, errorCode: "quota-exceeded" });
  });

  it("G102: backend assíncrono (não bloqueante) funciona", async () => {
    const map = new Map<string, string>();
    const asyncBackend: AsyncKeyValueStorageBackend = {
      getItem: async (k) => map.get(k) ?? null,
      setItem: async (k, v) => { await Promise.resolve(); map.set(k, v); },
      removeItem: async (k) => { map.delete(k); },
      keys: async () => Array.from(map.keys()),
    };
    const { service: svc } = service(asyncBackend);
    await Promise.all([svc.saveGame("s", { i: 1 }), svc.saveGame("s", { i: 2 }), svc.saveGame("t", { i: 3 })]);
    expect(await svc.loadGame("s")).toEqual({ i: 2 }); // ordem preservada por slot
    expect((await svc.listSaves()).map((m) => m.slotName).sort()).toEqual(["s", "t"]);
    expect(await svc.deleteSave("s")).toBe(true);
    expect(Array.from(map.keys()).some((k) => k.includes("bak") && k.endsWith(":s"))).toBe(false);
  });

  it("G103: metadados sem exigir campos em data; schemaVersion e migrações", async () => {
    const backend = new MemoryKeyValueStorageBackend();
    const { service: svc } = service(backend);
    svc.configureSaves({ gameVersion: "2.3.0" });
    const meta = await svc.saveGame("m", { level: 2 }, undefined, { playTimeSeconds: 125, label: "Capítulo 2" });
    expect(meta).toMatchObject({ playTimeSeconds: 125, gameVersion: "2.3.0", label: "Capítulo 2" });
    expect(await svc.loadGame("m")).toEqual({ level: 2 }); // data intacta

    // Save v1 -> jogo agora no schema 3 com migrações 1->2->3
    const v1 = service(backend).service;
    v1.configureSaves({ schemaVersion: 1 });
    await v1.saveGame("old", { hp: 10 });
    svc.configureSaves({ schemaVersion: 3 });
    svc.registerMigration(1, (d) => ({ ...d, mana: 5 }));
    svc.registerMigration(2, (d) => ({ health: d.hp, mana: d.mana }));
    const detailed = await svc.loadGameDetailed("old");
    expect(detailed).toMatchObject({ status: "ok", data: { health: 10, mana: 5 }, migratedFrom: [1, 2] });
    // saves sem versão: considerados atuais (sem migração a partir de 0)
    expect(await svc.loadGame("m")).toEqual({ level: 2 });

    // schema do futuro / migração ausente: rejeita com motivo claro
    const future = service(backend).service;
    future.configureSaves({ schemaVersion: 9 });
    await future.saveGame("future", { a: 1 });
    await expect(svc.loadGame("future")).rejects.toMatchObject({ reason: "unsupported-schema" });
    const gap = service(backend).service;
    gap.configureSaves({ schemaVersion: 4 });
    gap.registerMigration(3, (d) => d);
    await expect(gap.loadGame("old")).rejects.toMatchObject({ reason: "migration-failed" });
  });

  it("compat: driver direto continua estrito sem backend (sem fallback silencioso)", async () => {
    await expect(new LocalDatabaseDriver().loadGame("x")).rejects.toMatchObject({ code: "unavailable" });
  });
});
