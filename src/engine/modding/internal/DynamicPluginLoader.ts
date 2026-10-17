import {
  MODDING_API_VERSION,
  type ModManifestDescriptor,
} from "../../../contracts/modding/types";
import { satisfies } from "@core";
import { validateModManifest } from "./ModManifestValidator";

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

  /**
   * `minEngineVersion` é comparado com `MODDING_API_VERSION` (versão da API
   * de modding/`game.modding`), não com a API do kernel (G118). Vazio = qualquer.
   */
  public validateEngineCompatibility(
    manifest: ModManifestDescriptor,
    currentEngineVersion: string = MODDING_API_VERSION,
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
    // G118: mesma regra do Rust (ModManifestValidator ↔ modding.rs).
    const result = validateModManifest(value);
    if (result.manifest === null) {
      throw new Error(`Manifesto inválido: ${result.error ?? "desconhecido"}`);
    }
    return result.manifest;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
