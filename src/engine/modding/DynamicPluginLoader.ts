import type {
  AssetOverrideDescriptor,
  ModDependencyDescriptor,
  ModManifestDescriptor,
} from "../../contracts/modding/types";
import { KERNEL_API_VERSION } from "../../core/contracts/kernel-version";
import { satisfies } from "../../core/internal/semver";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

export class DynamicPluginLoader {
  private readonly manifests =
    new Map<string, ModManifestDescriptor>();

  public parseManifest(rawJson: string): ModManifestDescriptor {
    let parsed: unknown;

    try {
      parsed = JSON.parse(rawJson) as unknown;
    } catch (error: unknown) {
      throw new Error(
        `Falha no parsing do mod.json: ${this.getErrorMessage(error)}`,
      );
    }

    try {
      return this.normalizeManifest(parsed);
    } catch (error: unknown) {
      throw new Error(
        `Falha no parsing do mod.json: ${this.getErrorMessage(error)}`,
      );
    }
  }

  public validateEngineCompatibility(
    manifest: ModManifestDescriptor,
    currentEngineVersion: string = KERNEL_API_VERSION,
  ): boolean {
    const minimumVersion = manifest.minEngineVersion.trim();
    if (minimumVersion.length === 0) return true;

    return satisfies(
      currentEngineVersion,
      `>=${minimumVersion}`,
    );
  }

  public registerMod(
    manifest: ModManifestDescriptor,
  ): void {
    const normalized = this.normalizeManifest(manifest);
    this.manifests.set(normalized.modId, normalized);
  }

  public unregisterMod(
    modId: string,
  ): boolean {
    return this.manifests.delete(modId);
  }

  public getMod(
    modId: string,
  ): ModManifestDescriptor | null {
    return this.manifests.get(modId) ?? null;
  }

  public getLoadedMods(): ReadonlyArray<ModManifestDescriptor> {
    return Array.from(this.manifests.values());
  }

  public resolveLoadOrder(
    rootModIds?: ReadonlyArray<string>,
  ): ReadonlyArray<ModManifestDescriptor> {
    const roots = rootModIds
      ? rootModIds.map((modId): ModManifestDescriptor => {
          const manifest = this.manifests.get(modId);
          if (!manifest) {
            throw new Error(`Mod obrigatório não registrado: ${modId}`);
          }
          return manifest;
        })
      : Array.from(this.manifests.values());

    const resolved: ModManifestDescriptor[] = [];
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];

    const visit = (manifest: ModManifestDescriptor): void => {
      const currentState = state.get(manifest.modId) ?? 0;

      if (currentState === 2) return;

      if (currentState === 1) {
        const cycleStart = stack.indexOf(manifest.modId);
        const cycle = cycleStart >= 0
          ? [...stack.slice(cycleStart), manifest.modId]
          : [...stack, manifest.modId];

        throw new Error(
          `Dependência cíclica entre mods: ${cycle.join(" -> ")}`,
        );
      }

      state.set(manifest.modId, 1);
      stack.push(manifest.modId);

      for (const dependency of manifest.dependencies ?? []) {
        const dependencyManifest = this.manifests.get(dependency.modId);

        if (!dependencyManifest) {
          throw new Error(
            `Dependência ausente: ${manifest.modId} requer ${dependency.modId} >= ${dependency.minVersion}`,
          );
        }

        if (
          !satisfies(
            dependencyManifest.version,
            `>=${dependency.minVersion}`,
          )
        ) {
          throw new Error(
            `Versão incompatível: ${manifest.modId} requer ${dependency.modId} >= ${dependency.minVersion}, encontrada ${dependencyManifest.version}`,
          );
        }

        visit(dependencyManifest);
      }

      stack.pop();
      state.set(manifest.modId, 2);
      resolved.push(manifest);
    };

    for (const manifest of roots) {
      visit(manifest);
    }

    return resolved;
  }

  public getDependents(
    modId: string,
  ): ReadonlyArray<ModManifestDescriptor> {
    const result: ModManifestDescriptor[] = [];

    for (const manifest of this.manifests.values()) {
      if (manifest.modId === modId) continue;
      if (this.dependsTransitivelyOn(manifest, modId, new Set<string>())) {
        result.push(manifest);
      }
    }

    return result;
  }

  public clear(): void {
    this.manifests.clear();
  }

  private dependsTransitivelyOn(
    manifest: ModManifestDescriptor,
    targetModId: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(manifest.modId)) return false;
    visited.add(manifest.modId);

    for (const dependency of manifest.dependencies ?? []) {
      if (dependency.modId === targetModId) return true;

      const dependencyManifest = this.manifests.get(dependency.modId);
      if (
        dependencyManifest &&
        this.dependsTransitivelyOn(
          dependencyManifest,
          targetModId,
          visited,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private normalizeManifest(
    value: unknown,
  ): ModManifestDescriptor {
    if (!this.isRecord(value)) {
      throw new Error("Manifesto inválido: o conteúdo deve ser um objeto JSON.");
    }

    const modId = this.requireNonEmptyString(value, "modId");
    const name = this.requireNonEmptyString(value, "name");
    const version = this.requireNonEmptyString(value, "version");
    const author = this.requireString(value, "author");
    const description = this.requireString(value, "description");
    const minEngineVersion = this.requireString(value, "minEngineVersion");

    const entryScript = this.optionalNonEmptyString(value, "entryScript");
    const dependencies = this.normalizeDependencies(value.dependencies, modId);
    const overrides = this.normalizeOverrides(value.overrides, modId);

    return {
      modId,
      name,
      version,
      author,
      description,
      minEngineVersion,
      ...(entryScript ? { entryScript } : {}),
      ...(overrides ? { overrides } : {}),
      ...(dependencies ? { dependencies } : {}),
    };
  }

  private normalizeDependencies(
    value: unknown,
    ownerModId: string,
  ): ReadonlyArray<ModDependencyDescriptor> | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new Error("Manifesto inválido: dependencies deve ser um array.");
    }

    const dependencies: ModDependencyDescriptor[] = [];
    const seen = new Set<string>();

    for (const rawDependency of value) {
      if (!this.isRecord(rawDependency)) {
        throw new Error("Manifesto inválido: dependência deve ser um objeto.");
      }

      const modId = this.requireNonEmptyString(rawDependency, "modId");
      const minVersion = this.requireNonEmptyString(rawDependency, "minVersion");

      if (modId === ownerModId) {
        throw new Error(`Manifesto inválido: ${ownerModId} não pode depender de si mesmo.`);
      }

      if (seen.has(modId)) {
        throw new Error(`Manifesto inválido: dependência duplicada ${modId}.`);
      }

      seen.add(modId);
      dependencies.push({ modId, minVersion });
    }

    return dependencies;
  }

  private normalizeOverrides(
    value: unknown,
    ownerModId: string,
  ): ReadonlyArray<AssetOverrideDescriptor> | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new Error("Manifesto inválido: overrides deve ser um array.");
    }

    const overrides: AssetOverrideDescriptor[] = [];

    for (const rawOverride of value) {
      if (!this.isRecord(rawOverride)) {
        throw new Error("Manifesto inválido: asset override deve ser um objeto.");
      }

      const virtualPath = this.requireNonEmptyString(rawOverride, "virtualPath");
      const realPath = this.requireNonEmptyString(rawOverride, "realPath");
      const modId = this.requireNonEmptyString(rawOverride, "modId");
      const priority = rawOverride.priority;

      if (modId !== ownerModId) {
        throw new Error(
          `Manifesto inválido: override ${virtualPath} declara modId ${modId}, esperado ${ownerModId}.`,
        );
      }

      if (typeof priority !== "number" || !Number.isFinite(priority)) {
        throw new Error(
          `Manifesto inválido: priority do override ${virtualPath} deve ser finito.`,
        );
      }

      overrides.push({
        virtualPath,
        realPath,
        modId,
        priority,
      });
    }

    return overrides;
  }

  private requireNonEmptyString(
    record: UnknownRecord,
    key: string,
  ): string {
    const value = this.requireString(record, key).trim();
    if (value.length === 0) {
      throw new Error(`Manifesto inválido: ${key} é obrigatório.`);
    }
    return value;
  }

  private requireString(
    record: UnknownRecord,
    key: string,
  ): string {
    const value = record[key];
    if (typeof value !== "string") {
      throw new Error(`Manifesto inválido: ${key} deve ser string.`);
    }
    return value;
  }

  private optionalNonEmptyString(
    record: UnknownRecord,
    key: string,
  ): string | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Manifesto inválido: ${key} deve ser string não vazia.`);
    }
    return value.trim();
  }

  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
