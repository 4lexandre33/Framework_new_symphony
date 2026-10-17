// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { PluginContext } from "@core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("sem tauri");
  }),
  convertFileSrc: (filePath: string) => `asset://localhost/${encodeURIComponent(filePath)}`,
}));

import { ModdingService, type EnabledModsStore } from "../src/engine/modding/internal/ModdingService";
import { TauriModdingDriver, type NativeInstalledMod } from "../src/engine/modding/internal/TauriModdingDriver";
import { normalizeVirtualPath, validateModManifest } from "../src/engine/modding/internal/ModManifestValidator";
import {
  ScriptSandbox,
  SANDBOX_BLOCKED_GLOBALS,
  buildSandboxSource,
  type SandboxWorkerLike,
} from "../src/engine/modding/internal/ScriptSandbox";
import { MODDING_API_VERSION, type WorkshopItemState } from "../src/contracts/modding/types";

type Emitted = Array<{ type: string; payload: unknown }>;

function ctxWith(emitted: Emitted): PluginContext {
  return {
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) },
  } as unknown as PluginContext;
}

function manifest(modId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { modId, name: modId, version: "1.0.0", author: "", description: "", minEngineVersion: "", ...extra };
}

function memoryStore(initial: string[] = []): EnabledModsStore & { saved: string[][] } {
  let current = [...initial];
  const saved: string[][] = [];
  return {
    saved,
    async load() {
      return current;
    },
    async save(ids) {
      current = [...ids];
      saved.push([...ids]);
    },
  };
}

class FakeDriver extends TauriModdingDriver {
  public installedMods: NativeInstalledMod[] = [];
  public files = new Map<string, Uint8Array>();
  public states: WorkshopItemState[] = [];
  public downloadStarted = true;

  public override get available(): boolean {
    return true;
  }
  public override async listInstalledMods(): Promise<ReadonlyArray<NativeInstalledMod>> {
    return this.installedMods;
  }
  public override async readModFile(modId: string, relativePath: string): Promise<Uint8Array | null> {
    return this.files.get(`${modId}/${relativePath}`) ?? null;
  }
  public override async downloadWorkshopItem(): Promise<boolean> {
    return this.downloadStarted;
  }
  public override async getWorkshopItemState(itemId: string): Promise<WorkshopItemState | null> {
    const next = this.states.length > 1 ? this.states.shift() : this.states[0];
    return next ? { ...next, itemId } : null;
  }
}

/** Worker falso: executa a fonte gerada num contexto vm com `self` simulado. */
class VmWorker implements SandboxWorkerLike {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public terminated = false;
  public readonly self: Record<string, unknown>;

  public constructor(source: string, run = true) {
    // Cadeia sem Object.prototype do realm de teste (o prelúdio redefine a cadeia inteira).
    const proto = Object.assign(Object.create(null) as object, {
      fetch: () => "net",
      importScripts: () => "code",
      WebSocket: class {},
    });
    const self = Object.create(proto) as Record<string, unknown>;
    self.postMessage = (message: unknown) => {
      queueMicrotask(() => this.onmessage?.({ data: message } as MessageEvent<unknown>));
    };
    self.self = self;
    this.self = self;
    if (run) {
      // Como num Worker real, o global É o `self`.
      vm.runInContext(source, vm.createContext(self));
    }
  }
  public postMessage(message: unknown): void {
    const handler = this.self.onmessage as ((event: { data: unknown }) => void) | undefined;
    handler?.({ data: message });
  }
  public terminate(): void {
    this.terminated = true;
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("modding gaps", () => {
  it("G118: validação TS idêntica ao Rust (mesmo fixture)", () => {
    const fixturePath = path.resolve(__dirname, "../src-tauri/fixtures/mod-manifests.json");
    const cases = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Array<{ name: string; valid: boolean; manifest: unknown }>;
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const entry of cases) {
      expect({ name: entry.name, valid: validateModManifest(entry.manifest).manifest !== null }).toEqual({
        name: entry.name,
        valid: entry.valid,
      });
    }
  });

  it("G118: caminhos virtuais normalizados e minEngineVersion vs MODDING_API_VERSION", async () => {
    expect(normalizeVirtualPath("/textures\\\\hero.png")).toBe("textures/hero.png");
    expect(normalizeVirtualPath("./textures//hero.png")).toBe("textures/hero.png");
    expect(normalizeVirtualPath("../x")).toBeNull();

    const service = new ModdingService(ctxWith([]), { tauriDriver: new FakeDriver(), enabledStore: memoryStore() });
    service.registerAssetOverride({ virtualPath: "/textures/hero.png", realPath: "hd.png", modId: "game", priority: 1 });
    expect(service.getAssetOverride("textures\\hero.png")).toBe("hd.png");
    expect(() => service.registerAssetOverride({ virtualPath: "../a", realPath: "b", modId: "x", priority: 0 })).toThrow();

    expect(MODDING_API_VERSION).toBe("1.0.0");
    service.installMod(manifest("ok", { minEngineVersion: "1.0.0" }));
    service.installMod(manifest("future", { minEngineVersion: "2.0.0" }));
    service.installMod(manifest("any"));
    expect(await service.enableMod("ok")).toBe(true);
    expect(await service.enableMod("future")).toBe(false);
    expect(await service.enableMod("any")).toBe(true);
  });

  it("G118: clear() não inutiliza o módulo e mods ativos persistem/reativam", async () => {
    const store = memoryStore();
    const emitted: Emitted = [];
    const service = new ModdingService(ctxWith(emitted), { tauriDriver: new FakeDriver(), enabledStore: store });
    service.installMod(manifest("skin", { overrides: [{ virtualPath: "hero.png", realPath: "hero_hd.png", modId: "skin", priority: 1 }] }), {
      baseUrl: "/mods/skin/",
    });
    expect(await service.enableMod("skin")).toBe(true);
    expect(store.saved.at(-1)).toEqual(["skin"]);
    expect(service.getAssetOverride("hero.png")).toBe("http://localhost/mods/skin/hero_hd.png");

    service.clear();
    expect(service.getLoadedMods()).toEqual([]);
    expect(service.getAssetOverride("hero.png")).toBeNull();
    expect(emitted.some((e) => e.type === "game.modding.mod-unloaded")).toBe(true);
    expect(await service.enableMod("skin")).toBe(true); // ainda utilizável
    expect(service.getAssetOverride("hero.png")).not.toBeNull();

    service.disableMod("skin");
    expect(store.saved.at(-1)).toEqual([]);

    // reativação no boot a partir do persistido
    const driver = new FakeDriver();
    driver.installedMods = [
      { manifest: manifest("persisted"), rootPath: "/data/mods/persisted", folderName: "persisted", source: "local", workshopItemId: null, error: null },
    ];
    const rebooted = new ModdingService(ctxWith([]), { tauriDriver: driver, enabledStore: memoryStore(["persisted", "gone"]) });
    await rebooted.initialize();
    expect(rebooted.getLoadedMods().map((m) => m.modId)).toEqual(["persisted"]);
  });

  it("G14: mods fornecidos pelo jogo funcionam offline", async () => {
    const service = new ModdingService(ctxWith([]), { tauriDriver: new TauriModdingDriver(), enabledStore: memoryStore() });
    await service.initialize();
    const info = service.installMod(manifest("bundled"));
    expect(info).toMatchObject({ modId: "bundled", source: "game", error: null });
    expect(service.installMod(manifest("bundled")).error).toMatch(/já instalado/);
    expect(service.installMod({ modId: "../x" }).error).toBeTruthy();
    expect(await service.enableMod("bundled")).toBe(true);
    await expect(service.publishWorkshopMod("bundled", "T", "")).rejects.toThrow(/Tauri/);
    expect(await service.downloadWorkshopMod("123")).toBe(false);
    expect(await service.getWorkshopItemState("123")).toBeNull();
  });

  it("G116: entryScript roda no sandbox com allow-list de capacidades", async () => {
    const emitted: Emitted = [];
    const workers: VmWorker[] = [];
    const service = new ModdingService(ctxWith(emitted), {
      tauriDriver: new FakeDriver(),
      enabledStore: memoryStore(),
      workerFactory: (source) => {
        const worker = new VmWorker(source);
        workers.push(worker);
        return worker;
      },
    });

    const script = `
      mod.log("oi", typeof fetch, typeof importScripts, typeof WebSocket);
      mod.send("hello", { n: 1 });
      mod.registerAssetOverride("ui/logo.png", "logo.png", 5);
      mod.on("ping", (payload) => mod.send("pong", payload));
    `;
    service.installMod(manifest("scripted", { entryScript: "main.js" }), { scriptSource: script, baseUrl: "/m/" });
    expect(await service.enableMod("scripted")).toBe(true);
    await flush();

    const message = emitted.find((e) => e.type === "game.modding.script-message")?.payload as { modId: string; type: string; data: unknown };
    expect(message).toEqual({ modId: "scripted", type: "hello", data: { n: 1 } });
    // sem capacidade "assets": override pedido pelo script é ignorado
    expect(service.getAssetOverride("ui/logo.png")).toBeNull();

    expect(service.postToModScript("scripted", "ping", { x: 2 })).toBe(true);
    await flush();
    expect(emitted.some((e) => e.type === "game.modding.script-message" && (e.payload as { type: string }).type === "pong")).toBe(true);

    service.disableMod("scripted");
    expect(workers[0]?.terminated).toBe(true);

    service.setScriptCapabilities("scripted", ["log", "messages", "assets"]);
    expect(await service.enableMod("scripted")).toBe(true);
    await flush();
    expect(service.getAssetOverride("ui/logo.png")).toBe("http://localhost/m/logo.png");
  });

  it("G116: prelúdio remove rede/carregamento de código do escopo", async () => {
    const source = buildSandboxSource("m", "self.postMessage({ type: 'log', payload: { message: [typeof fetch, typeof importScripts, typeof WebSocket, typeof self.mod].join(',') } });");
    const worker = new VmWorker(source);
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);
    await flush();
    expect(messages[0]).toEqual({ type: "log", payload: { message: "undefined,undefined,undefined,object" } });
    expect(messages.at(-1)).toEqual({ type: "__ready", payload: {} });
    expect(SANDBOX_BLOCKED_GLOBALS).toContain("fetch");
  });

  it("G116: watchdog encerra script que não termina de avaliar e limita taxa", async () => {
    vi.useFakeTimers();
    try {
      const silent = new VmWorker("", false);
      const sandbox = new ScriptSandbox({ maxExecutionTimeMs: 100, allowedCapabilities: ["log"] }, { workerFactory: () => silent });
      expect(sandbox.executeScript("while(true){}", () => undefined)).toBe(true);
      vi.advanceTimersByTime(150);
      expect(silent.terminated).toBe(true);
      expect(sandbox.lastTerminationReason).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }

    const spam = new VmWorker("", false);
    const sandbox = new ScriptSandbox({ maxExecutionTimeMs: 1000, allowedCapabilities: ["log"] }, { workerFactory: () => spam, now: () => 0 });
    sandbox.executeScript("x", () => undefined);
    for (let i = 0; i < 250; i += 1) spam.onmessage?.({ data: { type: "log", payload: { message: "x" } } } as MessageEvent<unknown>);
    expect(spam.terminated).toBe(true);
    expect(sandbox.lastTerminationReason).toBe("rate_limit");
  });

  it("G117: lista mods instalados (inclui inválidos) e resolve realPath em disco", async () => {
    const driver = new FakeDriver();
    driver.installedMods = [
      {
        manifest: manifest("disk", { overrides: [{ virtualPath: "a.png", realPath: "img/a.png", modId: "disk", priority: 1 }] }),
        rootPath: "/data/mods/disk",
        folderName: "disk",
        source: "local",
        workshopItemId: null,
        error: null,
      },
      { manifest: null, rootPath: "/data/mods/broken", folderName: "broken", source: "local", workshopItemId: null, error: "mod.json inválido" },
    ];
    driver.files.set("disk/img/a.png", new Uint8Array([137, 80, 78, 71]));

    const service = new ModdingService(ctxWith([]), { tauriDriver: driver, enabledStore: memoryStore() });
    await service.initialize();
    const installed = service.getInstalledMods();
    expect(installed).toHaveLength(2);
    expect(installed.find((m) => m.modId === "disk")).toMatchObject({ rootPath: "/data/mods/disk", enabled: false });
    expect(installed.find((m) => m.modId === null)?.error).toBe("mod.json inválido");

    expect(await service.enableMod("disk")).toBe(true);
    expect(service.getAssetOverride("/a.png")).toBe(`asset://localhost/${encodeURIComponent("/data/mods/disk/img/a.png")}`);
    const url = await service.resolveAssetUrl("a.png");
    expect(url?.startsWith("blob:")).toBe(true);
    expect(await service.resolveAssetUrl("a.png")).toBe(url);
    service.disableMod("disk");
    expect(await service.resolveAssetUrl("a.png")).toBeNull();
  });

  it("G116: download do Workshop acompanha progresso até instalar e registra o mod", async () => {
    const emitted: Emitted = [];
    const driver = new FakeDriver();
    driver.states = [
      { itemId: "", subscribed: true, installed: false, downloading: true, downloadPending: false, needsUpdate: false, bytesDownloaded: 10, bytesTotal: 100 },
      { itemId: "", subscribed: true, installed: false, downloading: true, downloadPending: false, needsUpdate: false, bytesDownloaded: 60, bytesTotal: 100 },
      { itemId: "", subscribed: true, installed: true, downloading: false, downloadPending: false, needsUpdate: false, bytesDownloaded: 100, bytesTotal: 100 },
    ];
    const service = new ModdingService(ctxWith(emitted), { tauriDriver: driver, enabledStore: memoryStore(), workshopPollIntervalMs: 1 });
    driver.installedMods = [
      { manifest: manifest("ws-mod"), rootPath: "/steam/ws/42", folderName: "42", source: "workshop", workshopItemId: "42", error: null },
    ];
    expect(await service.downloadWorkshopMod("42")).toBe(true);
    const progress = emitted.filter((e) => e.type === "game.modding.workshop-progress").map((e) => (e.payload as { progressPercentage: number }).progressPercentage);
    expect(progress).toEqual([10, 60, 100, 100]);
    expect(service.getInstalledMods().find((m) => m.modId === "ws-mod")?.workshopItemId).toBe("42");

    // falha reportada pela Steam encerra a espera
    driver.states = [
      { itemId: "", subscribed: true, installed: false, downloading: true, downloadPending: false, needsUpdate: false, bytesDownloaded: 0, bytesTotal: 100 },
    ];
    const pending = service.downloadWorkshopMod("43");
    service.handleWorkshopDownloadResult("43", false, "Timeout");
    expect(await pending).toBe(false);
    expect(emitted.some((e) => e.type === "game.modding.mod-error")).toBe(true);

    driver.downloadStarted = false;
    expect(await service.downloadWorkshopMod("44")).toBe(false);
    expect(await service.downloadWorkshopMod("abc")).toBe(false);
  });
});
