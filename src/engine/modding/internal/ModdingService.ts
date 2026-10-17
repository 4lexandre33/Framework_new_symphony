import type { PluginContext } from "@core";
import { type ModdingApi } from "../../../tokens/modding";
import {
  AssetOverriddenEvent,
  MODDING_API_VERSION,
  ModErrorEvent,
  ModLoadedEvent,
  ModScriptMessageEvent,
  ModUnloadedEvent,
  WorkshopDownloadProgressEvent,
  type AssetOverrideDescriptor,
  type InstallModOptions,
  type InstalledModInfo,
  type ModManifestDescriptor,
  type ModScriptCapability,
  type ModSource,
  type WorkshopItemState,
} from "../../../contracts/modding/types";
import { AssetOverrideRegistry } from "./AssetOverrideRegistry";
import { DynamicPluginLoader } from "./DynamicPluginLoader";
import { isModId, normalizeRelativePath, normalizeVirtualPath, validateModManifest } from "./ModManifestValidator";
import { ScriptSandbox, type SandboxMessageEnvelope, type SandboxWorkerFactory } from "./ScriptSandbox";
import { SteamWorkshopDriver } from "./SteamWorkshopDriver";
import { TauriModdingDriver } from "./TauriModdingDriver";

const ENABLED_STORAGE_KEY = "symphony.modding.enabled";
const DEFAULT_SCRIPT_CAPABILITIES: ReadonlyArray<ModScriptCapability> = ["log", "messages"];
const VALID_CAPABILITIES: ReadonlySet<string> = new Set(["log", "messages", "assets"]);
const MAX_SCRIPT_BYTES = 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  json: "application/json",
  txt: "text/plain",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

interface InstalledEntry {
  readonly manifest: ModManifestDescriptor | null;
  readonly source: ModSource;
  readonly rootPath: string | null;
  readonly workshopItemId: string | null;
  readonly error: string | null;
  readonly scriptSource?: string;
  readonly baseUrl?: string;
}

/** Persistência dos mods ativos: arquivo no app data (Tauri) ou localStorage. */
export interface EnabledModsStore {
  load(): Promise<ReadonlyArray<string>>;
  save(modIds: ReadonlyArray<string>): Promise<void>;
}

export interface ModdingServiceOptions {
  readonly tauriDriver?: TauriModdingDriver;
  readonly enabledStore?: EnabledModsStore;
  readonly workerFactory?: SandboxWorkerFactory | null;
  readonly scriptTimeoutMs?: number;
  readonly workshopPollIntervalMs?: number;
  readonly workshopTimeoutMs?: number;
}

function localStorageStore(): EnabledModsStore {
  return {
    async load(): Promise<ReadonlyArray<string>> {
      try {
        const raw = globalThis.localStorage?.getItem(ENABLED_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(parsed) ? parsed.filter(isModId) : [];
      } catch {
        return [];
      }
    },
    async save(modIds: ReadonlyArray<string>): Promise<void> {
      try {
        globalThis.localStorage?.setItem(ENABLED_STORAGE_KEY, JSON.stringify(modIds));
      } catch {
        // armazenamento indisponível: preferência vale só nesta sessão
      }
    },
  };
}

function tauriStore(driver: TauriModdingDriver): EnabledModsStore {
  const fallback = localStorageStore();
  return {
    async load(): Promise<ReadonlyArray<string>> {
      const ids = await driver.loadEnabledMods();
      return ids === null ? fallback.load() : ids.filter(isModId);
    },
    async save(modIds: ReadonlyArray<string>): Promise<void> {
      if (!(await driver.saveEnabledMods(modIds))) await fallback.save(modIds);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModdingService implements ModdingApi {
  private readonly registry = new AssetOverrideRegistry();
  private readonly loader = new DynamicPluginLoader();
  private readonly workshopDriver = new SteamWorkshopDriver();
  private readonly tauriDriver: TauriModdingDriver;
  private readonly enabledStore: EnabledModsStore;
  private readonly workerFactory: SandboxWorkerFactory | null | undefined;
  private readonly scriptTimeoutMs: number;
  private readonly workshopPollIntervalMs: number;
  private readonly workshopTimeoutMs: number;
  private readonly enabledModIds = new Set<string>();
  private readonly installed = new Map<string, InstalledEntry>();
  private invalidMods: InstalledEntry[] = [];
  private readonly sandboxes = new Map<string, ScriptSandbox>();
  private readonly scriptCapabilities = new Map<string, ReadonlyArray<ModScriptCapability>>();
  /** `${modId}\n${virtualPath}` → caminho relativo do arquivo no mod. */
  private readonly overrideSources = new Map<string, { readonly modId: string; readonly relativePath: string }>();
  private readonly blobUrls = new Map<string, string>();
  private readonly workshopFailures = new Map<string, string>();
  private disposed = false;

  public constructor(
    private readonly ctx: PluginContext,
    options: ModdingServiceOptions = {},
  ) {
    this.tauriDriver = options.tauriDriver ?? new TauriModdingDriver();
    this.enabledStore =
      options.enabledStore ?? (this.tauriDriver.available ? tauriStore(this.tauriDriver) : localStorageStore());
    this.workerFactory = options.workerFactory;
    this.scriptTimeoutMs = options.scriptTimeoutMs ?? 5_000;
    this.workshopPollIntervalMs = options.workshopPollIntervalMs ?? 500;
    this.workshopTimeoutMs = options.workshopTimeoutMs ?? 10 * 60_000;
  }

  /** Escaneia mods instalados e reativa os persistidos (G118). */
  public async initialize(): Promise<void> {
    await this.refreshInstalledMods();

    let persisted: ReadonlyArray<string> = [];
    try {
      persisted = await this.enabledStore.load();
    } catch (error: unknown) {
      this.ctx.log.warn("Falha ao ler mods ativos persistidos.", { error: errorMessage(error) });
    }

    for (const modId of persisted) {
      if (this.disposed) return;
      if (!(await this.enableModInternal(modId, false))) {
        this.ctx.log.warn("Mod persistido não pôde ser reativado.", { modId });
      }
    }
  }

  public async refreshInstalledMods(): Promise<ReadonlyArray<InstalledModInfo>> {
    let native: Awaited<ReturnType<TauriModdingDriver["listInstalledMods"]>> = [];

    try {
      native = await this.tauriDriver.listInstalledMods();
    } catch (error: unknown) {
      this.ctx.log.warn("Falha ao escanear mods instalados.", { error: errorMessage(error) });
      return this.getInstalledMods();
    }

    this.invalidMods = [];
    for (const [modId, entry] of Array.from(this.installed)) {
      if (entry.source !== "game" && !this.enabledModIds.has(modId)) {
        this.installed.delete(modId);
        this.loader.unregisterMod(modId);
      }
    }

    for (const raw of native) {
      const source: ModSource = raw.source === "workshop" ? "workshop" : "local";
      const validation = raw.error ? { manifest: null, error: raw.error } : validateModManifest(raw.manifest);

      if (validation.manifest === null) {
        const entry: InstalledEntry = {
          manifest: null,
          source,
          rootPath: raw.rootPath,
          workshopItemId: raw.workshopItemId ?? null,
          error: validation.error ?? "manifesto inválido",
        };
        this.invalidMods.push(entry);
        this.ctx.log.warn("Mod instalado rejeitado.", { rootPath: raw.rootPath, error: entry.error });
        continue;
      }

      const manifest = validation.manifest;
      if (this.installed.get(manifest.modId)?.source === "game") {
        continue; // mod do jogo com o mesmo id tem precedência explícita
      }
      this.installed.set(manifest.modId, {
        manifest,
        source,
        rootPath: raw.rootPath,
        workshopItemId: raw.workshopItemId ?? null,
        error: null,
      });
      this.loader.registerMod(manifest);
    }

    return this.getInstalledMods();
  }

  public installMod(manifest: unknown, options: InstallModOptions = {}): InstalledModInfo {
    const validation = validateModManifest(manifest);
    if (validation.manifest === null) {
      return {
        modId: null,
        manifest: null,
        source: "game",
        rootPath: null,
        workshopItemId: null,
        enabled: false,
        error: validation.error,
      };
    }

    const valid = validation.manifest;
    const existing = this.installed.get(valid.modId);
    if (existing && options.replace !== true) {
      return this.toInfo(valid.modId, existing, "modId já instalado (use replace: true)");
    }
    if (existing && this.enabledModIds.has(valid.modId)) {
      this.disableMod(valid.modId);
    }

    if (options.scriptSource !== undefined && (typeof options.scriptSource !== "string" || options.scriptSource.length > MAX_SCRIPT_BYTES)) {
      return this.toInfo(valid.modId, null, "scriptSource inválido");
    }

    const entry: InstalledEntry = {
      manifest: valid,
      source: "game",
      rootPath: null,
      workshopItemId: null,
      error: null,
      ...(options.scriptSource !== undefined ? { scriptSource: options.scriptSource } : {}),
      ...(typeof options.baseUrl === "string" && options.baseUrl.length > 0 ? { baseUrl: options.baseUrl } : {}),
    };
    this.installed.set(valid.modId, entry);
    this.loader.registerMod(valid);
    return this.toInfo(valid.modId, entry, null);
  }

  private toInfo(modId: string, entry: InstalledEntry | null, error: string | null): InstalledModInfo {
    return {
      modId,
      manifest: entry?.manifest ?? null,
      source: entry?.source ?? "game",
      rootPath: entry?.rootPath ?? null,
      workshopItemId: entry?.workshopItemId ?? null,
      enabled: this.enabledModIds.has(modId),
      error: error ?? entry?.error ?? null,
    };
  }

  public getInstalledMods(): ReadonlyArray<InstalledModInfo> {
    const result: InstalledModInfo[] = [];
    for (const [modId, entry] of this.installed) {
      result.push(this.toInfo(modId, entry, null));
    }
    for (const entry of this.invalidMods) {
      result.push({
        modId: null,
        manifest: null,
        source: entry.source,
        rootPath: entry.rootPath,
        workshopItemId: entry.workshopItemId,
        enabled: false,
        error: entry.error,
      });
    }
    return result;
  }

  public getLoadedMods(): ReadonlyArray<ModManifestDescriptor> {
    if (this.enabledModIds.size === 0) return [];

    try {
      return this.loader.resolveLoadOrder(Array.from(this.enabledModIds));
    } catch (error: unknown) {
      this.ctx.log.error("Estado de dependências de mods ativos ficou inválido.", {
        error: errorMessage(error),
      });
      return [];
    }
  }

  public enableMod(modId: string): Promise<boolean> {
    return this.enableModInternal(modId, true);
  }

  private async enableModInternal(modId: string, persist: boolean): Promise<boolean> {
    if (this.disposed || typeof modId !== "string") return false;
    const normalizedModId = modId.trim();
    if (!isModId(normalizedModId)) return false;
    if (this.enabledModIds.has(normalizedModId)) return true;

    let loadOrder: ReadonlyArray<ModManifestDescriptor>;

    try {
      loadOrder = this.loader.resolveLoadOrder([normalizedModId]);
    } catch (error: unknown) {
      this.ctx.log.warn("Não foi possível resolver dependências do mod.", {
        modId: normalizedModId,
        error: errorMessage(error),
      });
      return false;
    }

    for (const manifest of loadOrder) {
      if (!this.loader.validateEngineCompatibility(manifest, MODDING_API_VERSION)) {
        this.ctx.log.warn("Mod exige versão mais nova da API de modding.", {
          modId: manifest.modId,
          minEngineVersion: manifest.minEngineVersion,
          moddingApiVersion: MODDING_API_VERSION,
        });
        return false;
      }
    }

    for (const manifest of loadOrder) {
      if (this.enabledModIds.has(manifest.modId)) continue;
      const entry = this.installed.get(manifest.modId) ?? null;

      for (const override of manifest.overrides ?? []) {
        const resolved = this.resolveOverrideUrl(entry, override);
        this.registry.registerOverride(resolved);
        this.overrideSources.set(`${manifest.modId}\n${resolved.virtualPath}`, {
          modId: manifest.modId,
          relativePath: override.realPath,
        });
        this.emitAssetOverridden(resolved);
      }

      this.enabledModIds.add(manifest.modId);
      this.ctx.events.emit(ModLoadedEvent.type, {
        modId: manifest.modId,
        manifest,
      });

      if (manifest.entryScript) {
        await this.startScript(manifest, entry);
      }
    }

    if (persist) await this.persistEnabled();
    return true;
  }

  private resolveOverrideUrl(entry: InstalledEntry | null, override: AssetOverrideDescriptor): AssetOverrideDescriptor {
    let realPath = override.realPath;
    if (entry?.rootPath) {
      realPath = this.tauriDriver.toAssetUrl(entry.rootPath, override.realPath);
    } else if (entry?.baseUrl) {
      try {
        realPath = new URL(override.realPath, new URL(entry.baseUrl, globalThis.location?.href ?? "http://localhost/")).toString();
      } catch {
        realPath = `${entry.baseUrl.replace(/\/+$/u, "")}/${override.realPath}`;
      }
    }
    return { ...override, realPath };
  }

  private async startScript(manifest: ModManifestDescriptor, entry: InstalledEntry | null): Promise<void> {
    const entryScript = manifest.entryScript;
    if (!entryScript) return;

    let source: string | null = entry?.scriptSource ?? null;
    if (source === null && entry?.rootPath) {
      const bytes = await this.tauriDriver.readModFile(manifest.modId, entryScript);
      source = bytes && bytes.byteLength <= MAX_SCRIPT_BYTES ? new TextDecoder().decode(bytes) : null;
    }

    if (source === null) {
      this.emitModError(manifest.modId, "entryScript indisponível (sem fonte para o script)");
      return;
    }

    const capabilities = this.scriptCapabilities.get(manifest.modId) ?? DEFAULT_SCRIPT_CAPABILITIES;
    const sandbox = new ScriptSandbox(
      { maxExecutionTimeMs: this.scriptTimeoutMs, allowedCapabilities: capabilities },
      { modId: manifest.modId, ...(this.workerFactory !== undefined ? { workerFactory: this.workerFactory } : {}) },
    );

    if (!sandbox.supported) {
      this.emitModError(manifest.modId, "Web Worker indisponível: script de mod não executado");
      return;
    }

    this.sandboxes.get(manifest.modId)?.terminate();
    this.sandboxes.set(manifest.modId, sandbox);

    const started = sandbox.executeScript(source, (envelope) => this.handleScriptMessage(manifest.modId, envelope));
    if (!started) {
      this.sandboxes.delete(manifest.modId);
      this.emitModError(manifest.modId, "falha ao iniciar o sandbox do script");
    }
  }

  private handleScriptMessage(modId: string, envelope: SandboxMessageEnvelope): void {
    if (!this.enabledModIds.has(modId)) return;
    const payload = envelope.payload;

    switch (envelope.type) {
      case "log":
        this.ctx.log.info(`[mod:${modId}] ${String(payload.message ?? "")}`);
        return;
      case "error":
        this.emitModError(modId, String(payload.message ?? "erro no script"));
        return;
      case "message":
        this.ctx.events.emit(ModScriptMessageEvent.type, {
          modId,
          type: String(payload.type ?? ""),
          data: payload.data ?? null,
        });
        return;
      case "asset-override": {
        const relative = normalizeRelativePath(payload.realPath);
        const virtualPath = normalizeVirtualPath(payload.virtualPath);
        const priority = typeof payload.priority === "number" && Number.isFinite(payload.priority) ? payload.priority : 0;
        if (relative === null || virtualPath === null) {
          this.emitModError(modId, "registerAssetOverride com caminho inválido");
          return;
        }
        const resolved = this.resolveOverrideUrl(this.installed.get(modId) ?? null, {
          virtualPath,
          realPath: relative,
          modId,
          priority,
        });
        this.registry.registerOverride(resolved);
        this.overrideSources.set(`${modId}\n${resolved.virtualPath}`, { modId, relativePath: relative });
        this.emitAssetOverridden(resolved);
        return;
      }
      default:
        return;
    }
  }

  public setScriptCapabilities(modId: string, capabilities: ReadonlyArray<ModScriptCapability>): void {
    if (!isModId(modId) || !Array.isArray(capabilities)) return;
    this.scriptCapabilities.set(
      modId,
      capabilities.filter((capability) => VALID_CAPABILITIES.has(capability)),
    );
  }

  public postToModScript(modId: string, type: string, payload: unknown): boolean {
    return this.sandboxes.get(modId)?.postMessage(type, payload) ?? false;
  }

  public disableMod(modId: string): boolean {
    const disabled = this.disableModInternal(modId);
    if (disabled) void this.persistEnabled();
    return disabled;
  }

  private disableModInternal(modId: string): boolean {
    const normalizedModId = typeof modId === "string" ? modId.trim() : "";
    if (!this.enabledModIds.has(normalizedModId)) return false;

    const enabledDependents = this.loader
      .getDependents(normalizedModId)
      .filter((manifest): boolean => this.enabledModIds.has(manifest.modId));

    if (enabledDependents.length > 0) {
      this.ctx.log.warn("Mod não pode ser desativado enquanto dependentes estão ativos.", {
        modId: normalizedModId,
        dependents: enabledDependents.map((manifest): string => manifest.modId),
      });
      return false;
    }

    this.teardownMod(normalizedModId);
    this.ctx.events.emit(ModUnloadedEvent.type, {
      modId: normalizedModId,
    });

    return true;
  }

  private teardownMod(modId: string): void {
    this.enabledModIds.delete(modId);
    this.registry.removeOverridesForMod(modId);
    this.sandboxes.get(modId)?.terminate();
    this.sandboxes.delete(modId);

    for (const key of Array.from(this.overrideSources.keys())) {
      if (key.startsWith(`${modId}\n`)) this.overrideSources.delete(key);
    }
    for (const [key, url] of Array.from(this.blobUrls)) {
      if (key.startsWith(`${modId}\n`)) {
        this.revokeUrl(url);
        this.blobUrls.delete(key);
      }
    }
  }

  private revokeUrl(url: string): void {
    try {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    } catch {
      // best-effort
    }
  }

  private async persistEnabled(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.enabledStore.save(Array.from(this.enabledModIds));
    } catch (error: unknown) {
      this.ctx.log.warn("Falha ao persistir mods ativos.", { error: errorMessage(error) });
    }
  }

  public getAssetOverride(virtualPath: string): string | null {
    return this.registry.resolveOverride(virtualPath);
  }

  public async resolveAssetUrl(virtualPath: string): Promise<string | null> {
    const descriptor = this.registry.resolveDescriptor(virtualPath);
    if (!descriptor) return null;

    const source = this.overrideSources.get(`${descriptor.modId}\n${descriptor.virtualPath}`);
    const entry = source ? this.installed.get(source.modId) : undefined;
    if (!source || !entry?.rootPath) {
      return descriptor.realPath;
    }

    const cacheKey = `${source.modId}\n${source.relativePath}`;
    const cached = this.blobUrls.get(cacheKey);
    if (cached) return cached;

    const bytes = await this.tauriDriver.readModFile(source.modId, source.relativePath);
    if (!bytes || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") {
      return descriptor.realPath;
    }
    if (!this.enabledModIds.has(source.modId)) return null;

    const extension = source.relativePath.split(".").pop()?.toLowerCase() ?? "";
    const blob = new Blob([bytes as BlobPart], { type: MIME_BY_EXTENSION[extension] ?? "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(cacheKey, url);
    return url;
  }

  public registerAssetOverride(override: AssetOverrideDescriptor): void {
    this.registry.registerOverride(override);
    const winner = this.registry.resolveDescriptor(override.virtualPath);
    this.emitAssetOverridden(winner && winner.modId === override.modId.trim() ? winner : override);
  }

  /** Falha reportada pela Steam (`game.steam.workshop-download-result`). */
  public handleWorkshopDownloadResult(itemId: string, success: boolean, error?: string): void {
    if (!success) this.workshopFailures.set(itemId, error ?? "download falhou");
  }

  public async getWorkshopItemState(itemId: string): Promise<WorkshopItemState | null> {
    return this.tauriDriver.getWorkshopItemState(itemId);
  }

  public async downloadWorkshopMod(itemId: string): Promise<boolean> {
    const normalizedItemId = typeof itemId === "string" ? itemId.trim() : "";
    if (!/^\d{1,20}$/u.test(normalizedItemId) || this.disposed) return false;

    this.workshopFailures.delete(normalizedItemId);
    const started = await this.tauriDriver.downloadWorkshopItem(normalizedItemId);
    if (!started) return false;

    const deadline = Date.now() + this.workshopTimeoutMs;
    let lastBytes = -1;

    while (!this.disposed && Date.now() <= deadline) {
      const failure = this.workshopFailures.get(normalizedItemId);
      if (failure) {
        this.workshopFailures.delete(normalizedItemId);
        this.emitModError(`workshop:${normalizedItemId}`, failure);
        return false;
      }

      const state = await this.tauriDriver.getWorkshopItemState(normalizedItemId);
      if (state === null) return false;

      if (state.bytesDownloaded !== lastBytes) {
        lastBytes = state.bytesDownloaded;
        const total = state.bytesTotal;
        this.workshopDriver.registerSubscribedItem({
          itemId: normalizedItemId,
          title: "",
          description: "",
          ownerSteamId: "",
          fileSizeBytes: total,
          isSubscribed: state.subscribed,
          isDownloading: state.downloading || state.downloadPending,
          downloadProgressPercentage: total > 0 ? (state.bytesDownloaded / total) * 100 : 0,
        });
        this.ctx.events.emit(WorkshopDownloadProgressEvent.type, {
          itemId: normalizedItemId,
          progressPercentage: total > 0 ? Math.min(100, (state.bytesDownloaded / total) * 100) : 0,
          bytesDownloaded: state.bytesDownloaded,
          totalBytes: total,
        });
      }

      if (state.installed && !state.downloading && !state.downloadPending && !state.needsUpdate) {
        this.ctx.events.emit(WorkshopDownloadProgressEvent.type, {
          itemId: normalizedItemId,
          progressPercentage: 100,
          bytesDownloaded: state.bytesTotal,
          totalBytes: state.bytesTotal,
        });
        const mods = await this.refreshInstalledMods();
        const found = mods.some((mod) => mod.workshopItemId === normalizedItemId && mod.modId !== null);
        if (!found) {
          this.emitModError(`workshop:${normalizedItemId}`, "item instalado sem mod.json válido");
        }
        return found;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, this.workshopPollIntervalMs));
    }

    return false;
  }

  public async publishWorkshopMod(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string> {
    return this.tauriDriver.publishWorkshopItem(localFolderPath, title, description);
  }

  /**
   * Desativa todos os mods e limpa overrides manuais. Mantém mods
   * instalados, capacidades e a lista persistida (G118: módulo segue utilizável).
   */
  public clear(): void {
    for (const modId of Array.from(this.enabledModIds)) {
      this.teardownMod(modId);
      this.ctx.events.emit(ModUnloadedEvent.type, { modId });
    }
    this.registry.clear();
    this.overrideSources.clear();
    for (const url of this.blobUrls.values()) this.revokeUrl(url);
    this.blobUrls.clear();
    this.workshopDriver.clear();
  }

  /** Teardown do plugin (não altera a lista persistida). */
  public dispose(): void {
    if (this.disposed) return;
    for (const modId of Array.from(this.enabledModIds)) this.teardownMod(modId);
    this.registry.clear();
    for (const url of this.blobUrls.values()) this.revokeUrl(url);
    this.blobUrls.clear();
    this.disposed = true;
  }

  private emitModError(modId: string, error: string): void {
    this.ctx.log.warn("Erro de mod.", { modId, error });
    this.ctx.events.emit(ModErrorEvent.type, { modId, error });
  }

  private emitAssetOverridden(override: AssetOverrideDescriptor): void {
    this.ctx.events.emit(AssetOverriddenEvent.type, {
      virtualPath: override.virtualPath,
      realPath: override.realPath,
      modId: override.modId,
    });
  }
}
