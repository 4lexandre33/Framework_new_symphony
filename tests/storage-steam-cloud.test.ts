// @vitest-environment node
// G131: driver steam_cloud usa o Steam Remote Storage (comandos steam_cloud_*)
// com fallback honesto quando o Steam não está disponível.
import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import { MemoryKeyValueStorageBackend } from "../src/engine/storage/internal/KeyValueStorageBackend";
import { SteamCloudDriver } from "../src/engine/storage/internal/SteamCloudDriver";
import {
  decodeSteamCloudFileName,
  encodeSteamCloudFileName,
  type SteamRemoteStorageBridge,
} from "../src/engine/storage/internal/SteamRemoteStorageBackend";

const ctx = { events: { emit: (): void => undefined } } as unknown as PluginContext;

/** Simula o ISteamRemoteStorage exposto pelos comandos nativos. */
class FakeSteamCloud implements SteamRemoteStorageBridge {
  public readonly files = new Map<string, Uint8Array>();
  public online = true;
  public accountEnabled = true;
  public refuseWrites = false;
  public statusCalls = 0;
  /** Horário (s) por arquivo; ausente = 0 (desconhecido). */
  public readonly timestamps = new Map<string, number>();
  public failReads = false;

  public async status(): Promise<{ accountEnabled: boolean; appEnabled: boolean }> {
    this.statusCalls += 1;
    if (!this.online) throw "Steam indisponível nesta sessão";
    return { accountEnabled: this.accountEnabled, appEnabled: true };
  }

  public async listFiles(): Promise<Array<{ name: string; size: number; timestamp: number; persisted: boolean }>> {
    if (!this.online) throw "Steam indisponível nesta sessão";
    return [...this.files].map(([name, data]) => ({ name, size: data.length, timestamp: this.timestamps.get(name) ?? 0, persisted: true }));
  }

  public async writeFile(fileName: string, data: number[]): Promise<boolean> {
    if (this.refuseWrites) return false;
    // O validador nativo recusa separadores/`..`; o nome codificado nunca os tem.
    expect(fileName).toMatch(/^[a-z0-9_.%^~-]+$/u);
    this.files.set(fileName, Uint8Array.from(data));
    return true;
  }

  public async readFile(fileName: string): Promise<number[] | null> {
    if (this.failReads || !this.online) throw "falha de leitura";
    const data = this.files.get(fileName);
    return data ? Array.from(data) : null;
  }

  public async deleteFile(fileName: string): Promise<boolean> {
    return this.files.delete(fileName);
  }
}

describe("G131 Steam Remote Storage", () => {
  it("nomes de arquivo: injetivos, seguros e sem colisão de maiúsculas", () => {
    for (const key of ["steam_cloud_save_slot", "ns:Jogo%20X:steam_cloud_save_A#bak1:B", "ção ../\\"]) {
      const name = encodeSteamCloudFileName(key)!;
      expect(name).toMatch(/^kv_[a-z0-9_.%^~-]+\.sav$/u);
      expect(decodeSteamCloudFileName(name)).toBe(key);
    }
    expect(encodeSteamCloudFileName("A")!.toLowerCase()).not.toBe(encodeSteamCloudFileName("a")!.toLowerCase());
    expect(encodeSteamCloudFileName("#".repeat(100))).toBeNull();
    expect(decodeSteamCloudFileName("outro_arquivo.bin")).toBeNull();
  });

  it("com Steam: saves (backups + índice) vão para o Remote Storage, não para o disco local", async () => {
    const cloud = new FakeSteamCloud();
    const local = new MemoryKeyValueStorageBackend();
    const driver = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true });
    driver.configure({ ...(await import("../src/engine/storage/internal/KeyValueSaveDriver")).DEFAULT_SAVE_DRIVER_CONFIG, backupCount: 1 });

    await driver.saveGame("Slot 1", { gold: 1 });
    await driver.saveGame("Slot 1", { gold: 2 });
    expect(await driver.loadGame("Slot 1")).toEqual({ gold: 2 });
    expect((await driver.listSaves()).map((m) => m.slotName)).toEqual(["Slot 1"]);
    expect(local.length).toBe(0);
    expect(cloud.files.size).toBeGreaterThanOrEqual(3); // principal + backup + índice
    expect(await driver.getStatus()).toMatchObject({ mode: "remote-storage", synced: true, accountEnabled: true, appEnabled: true, importedFromLocal: 0, pendingLocalKeys: 0 });

    expect(await driver.deleteSave("Slot 1")).toBe(true);
    expect(await driver.loadGame("Slot 1")).toBeNull();
    expect(cloud.statusCalls).toBe(1); // modo decidido uma vez
  });

  it("nuvem desligada na conta: grava no Remote Storage mas synced=false", async () => {
    const cloud = new FakeSteamCloud();
    cloud.accountEnabled = false;
    const driver = new SteamCloudDriver({ localFallback: new MemoryKeyValueStorageBackend(), steamBridge: cloud, nativeAvailable: true });
    await driver.saveGame("s", { a: 1 });
    expect(await driver.getStatus()).toMatchObject({ mode: "remote-storage", synced: false, accountEnabled: false });
  });

  it("FileWrite recusado vira quota-exceeded", async () => {
    const cloud = new FakeSteamCloud();
    cloud.refuseWrites = true;
    const driver = new SteamCloudDriver({ localFallback: new MemoryKeyValueStorageBackend(), steamBridge: cloud, nativeAvailable: true });
    await expect(driver.saveGame("s", { a: 1 })).rejects.toMatchObject({ code: "quota-exceeded" });
  });

  it("sem Steam (cliente fechado / build sem feature): fallback local explícito", async () => {
    const cloud = new FakeSteamCloud();
    cloud.online = false;
    const local = new MemoryKeyValueStorageBackend();
    const driver = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true });
    await driver.saveGame("s", { a: 1 });
    expect(await driver.loadGame("s")).toEqual({ a: 1 });
    expect(cloud.files.size).toBe(0);
    expect(local.length).toBeGreaterThan(0);
    expect(await driver.getStatus()).toMatchObject({ mode: "local-fallback", synced: false, reason: "steam-unavailable", detail: "Steam indisponível nesta sessão" });
  });

  it("StorageService: navegador/node → local-fallback (not-native); backend injetado → custom-backend", async () => {
    const auto = new StorageService(ctx);
    await auto.saveGame("x", { v: 1 }, "steam_cloud");
    expect(await auto.loadGame("x", "steam_cloud")).toEqual({ v: 1 });
    expect(await auto.getSteamCloudStatus()).toMatchObject({ mode: "local-fallback", reason: "not-native" });

    const injected = new StorageService(ctx, { backend: new MemoryKeyValueStorageBackend() });
    expect(await injected.getSteamCloudStatus()).toMatchObject({ mode: "local-fallback", reason: "custom-backend" });
  });

  it("Steam volta durante a sessão: nova sonda nas chamadas e saves do fallback local sobem para a nuvem", async () => {
    let clock = 1_000_000;
    const cloud = new FakeSteamCloud();
    cloud.online = false;
    const local = new MemoryKeyValueStorageBackend();
    const driver = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true, now: () => clock });
    await driver.saveGame("offline", { gold: 5 });
    expect(await driver.getStatus()).toMatchObject({ mode: "local-fallback", reason: "steam-unavailable" });
    expect(local.length).toBeGreaterThan(0);

    cloud.online = true;
    clock += 10_000; // antes do intervalo: continua local (sem sondar)
    expect(await driver.loadGame("offline")).toEqual({ gold: 5 });
    expect(cloud.statusCalls).toBe(1);

    clock += 30_000; // passou o intervalo: a próxima operação sonda e importa
    expect(await driver.loadGame("offline")).toEqual({ gold: 5 });
    expect(cloud.statusCalls).toBe(2);
    expect(local.length).toBe(0); // nada dividido entre local e nuvem
    expect([...cloud.files.keys()].some((name) => name.includes("offline"))).toBe(true);
    expect((await driver.listSaves()).map((m) => m.slotName)).toEqual(["offline"]);
    expect(await driver.getStatus()).toMatchObject({ mode: "remote-storage", importedFromLocal: 1, pendingLocalKeys: 0, checkedAt: clock });
  });

  it("conflito local × nuvem: vence o mais novo com horários conhecidos; sem horário vence a nuvem", async () => {
    let clock = 5_000_000;
    const cloud = new FakeSteamCloud();
    const writer = new SteamCloudDriver({ localFallback: new MemoryKeyValueStorageBackend(), steamBridge: cloud, nativeAvailable: true, now: () => clock });
    await writer.saveGame("a", { v: "nuvem-a" });
    await writer.saveGame("b", { v: "nuvem-b" });
    await writer.saveGame("c", { v: "nuvem-c" });
    const nameOf = (slot: string) => [...cloud.files.keys()].find((n) => n.endsWith(`save_${slot}.sav`))!;
    cloud.timestamps.set(nameOf("a"), 1_000); // nuvem velha (s) → local mais novo vence
    cloud.timestamps.set(nameOf("b"), 9_000_000); // nuvem mais nova → nuvem vence
    // c: sem horário na nuvem → nuvem vence

    // Sessão anterior sem Steam gravou a, b e c no disco local (clock 5_000_000 ms).
    const local = new MemoryKeyValueStorageBackend();
    cloud.online = false;
    const offline = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true, now: () => clock });
    await offline.saveGame("a", { v: "local-a" });
    await offline.saveGame("b", { v: "local-b" });
    await offline.saveGame("c", { v: "local-c" });

    cloud.online = true;
    const next = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true, now: () => clock });
    expect(await next.loadGame("a")).toEqual({ v: "local-a" });
    expect(await next.loadGame("b")).toEqual({ v: "nuvem-b" });
    expect(await next.loadGame("c")).toEqual({ v: "nuvem-c" });
    expect(local.length).toBe(0);
    expect(await next.getStatus()).toMatchObject({ importedFromLocal: 1, pendingLocalKeys: 0 });
  });

  it("falha remota força nova sonda; Steam caído passa para o fallback local", async () => {
    const cloud = new FakeSteamCloud();
    const local = new MemoryKeyValueStorageBackend();
    const driver = new SteamCloudDriver({ localFallback: local, steamBridge: cloud, nativeAvailable: true });
    await driver.saveGame("s", { a: 1 });
    cloud.online = false;
    await expect(driver.loadGame("s")).rejects.toBeDefined();
    expect(cloud.statusCalls).toBe(1);
    await driver.saveGame("t", { b: 2 }); // sonda de novo (falha anterior) → local
    expect(cloud.statusCalls).toBe(2);
    expect(await driver.getStatus()).toMatchObject({ mode: "local-fallback", reason: "steam-unavailable" });
    expect(local.length).toBeGreaterThan(0);
  });
});
