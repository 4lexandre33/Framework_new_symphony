import type {
  AssetOverrideDescriptor,
} from "../../../contracts/modding/types";

import { normalizeVirtualPath } from "./ModManifestValidator";

/**
 * Overrides por caminho virtual NORMALIZADO (G118): `textures/a.png`,
 * `/textures/a.png`, `./textures//a.png` e `textures\a.png` são a mesma chave.
 */
export class AssetOverrideRegistry {
  private readonly overridesByVirtualPath =
    new Map<string, AssetOverrideDescriptor[]>();

  public registerOverride(
    descriptor: AssetOverrideDescriptor,
  ): void {
    const virtualPath = this.validateDescriptor(descriptor);
    const normalized: AssetOverrideDescriptor = {
      virtualPath,
      realPath: descriptor.realPath.trim(),
      modId: descriptor.modId.trim(),
      priority: descriptor.priority,
    };

    const existing =
      this.overridesByVirtualPath.get(virtualPath) ?? [];

    const updated = existing
      .filter((item): boolean => item.modId !== normalized.modId);

    updated.push(normalized);
    updated.sort(this.compareOverrides);

    this.overridesByVirtualPath.set(
      virtualPath,
      updated,
    );
  }

  /** Descritor vencedor (maior prioridade) ou `null`. */
  public resolveDescriptor(
    virtualPath: string,
  ): AssetOverrideDescriptor | null {
    const normalizedPath = normalizeVirtualPath(virtualPath);
    if (normalizedPath === null) return null;
    return this.overridesByVirtualPath.get(normalizedPath)?.[0] ?? null;
  }

  public resolveOverride(
    virtualPath: string,
  ): string | null {
    return this.resolveDescriptor(virtualPath)?.realPath ?? null;
  }

  public removeOverridesForMod(
    modId: string,
  ): void {
    const normalizedModId = modId.trim();
    if (normalizedModId.length === 0) return;

    for (const [virtualPath, list] of this.overridesByVirtualPath) {
      const filtered = list.filter(
        (item): boolean => item.modId !== normalizedModId,
      );

      if (filtered.length === 0) {
        this.overridesByVirtualPath.delete(virtualPath);
      } else if (filtered.length !== list.length) {
        this.overridesByVirtualPath.set(virtualPath, filtered);
      }
    }
  }

  public getAllOverrides(): ReadonlyArray<AssetOverrideDescriptor> {
    const result: AssetOverrideDescriptor[] = [];

    for (const list of this.overridesByVirtualPath.values()) {
      result.push(...list);
    }

    return result;
  }

  public clear(): void {
    this.overridesByVirtualPath.clear();
  }

  private readonly compareOverrides = (
    first: AssetOverrideDescriptor,
    second: AssetOverrideDescriptor,
  ): number => {
    const priorityDifference = second.priority - first.priority;
    if (priorityDifference !== 0) return priorityDifference;

    return first.modId.localeCompare(second.modId);
  };

  private validateDescriptor(
    descriptor: AssetOverrideDescriptor,
  ): string {
    if (typeof descriptor.virtualPath !== "string" || descriptor.virtualPath.trim().length === 0) {
      throw new Error("Asset override inválido: virtualPath é obrigatório.");
    }

    const virtualPath = normalizeVirtualPath(descriptor.virtualPath);
    if (virtualPath === null) {
      throw new Error("Asset override inválido: virtualPath não pode conter '..', NUL ou drive.");
    }

    if (typeof descriptor.realPath !== "string" || descriptor.realPath.trim().length === 0) {
      throw new Error("Asset override inválido: realPath é obrigatório.");
    }

    if (typeof descriptor.modId !== "string" || descriptor.modId.trim().length === 0) {
      throw new Error("Asset override inválido: modId é obrigatório.");
    }

    if (typeof descriptor.priority !== "number" || !Number.isFinite(descriptor.priority)) {
      throw new Error("Asset override inválido: priority deve ser finito.");
    }

    return virtualPath;
  }
}
