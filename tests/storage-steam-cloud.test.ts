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

  public async status(): Promise<{ accountEnabled: boolean; appEnabled: boolean }> {
    this.statusCalls += 1;
    if (!this.online) throw "Steam indisponível nesta sessão";
    return { accountEnabled: this.accountEnabled, appEnabled: true };
  }

  public async listFiles(): Promise<Array<{ name: string; size: number; timestamp: number; persisted: boolean }>> {
    return [...this.files].map(([name, data]) => ({ name, size: data.length, timestamp: 0, persisted: true }));
  }

  public async writeFile(fileName: string, data: number[]): Promise<boolean> {
    if (this.refuseWrites) return false;
    // O validador nativo recusa separadores/`..`; o nome codificado nunca os tem.
    expect(fileName).toMatch(/^[a-z0-9_.%^~-]+$/u);
    this.files.set(fileName, Uint8Array.from(data));
    return true;
  }

  public async readFile(fileName: string): Promise<number[] | null> {
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
    expect(await driver.getStatus()).toEqual({ mode: "remote-storage", synced: true, accountEnabled: true, appEnabled: true });

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
});
