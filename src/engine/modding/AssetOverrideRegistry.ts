import type {
  AssetOverrideDescriptor,
} from "../../contracts/modding/types";

export class AssetOverrideRegistry {
  private readonly overridesByVirtualPath =
    new Map<string, AssetOverrideDescriptor[]>();

  public registerOverride(
    descriptor: AssetOverrideDescriptor,
  ): void {
    this.validateDescriptor(descriptor);

    const existing =
      this.overridesByVirtualPath.get(descriptor.virtualPath) ?? [];

    const updated = existing
      .filter((item): boolean => item.modId !== descriptor.modId);

    updated.push(descriptor);
    updated.sort(this.compareOverrides);

    this.overridesByVirtualPath.set(
      descriptor.virtualPath,
      updated,
    );
  }

  public resolveOverride(
    virtualPath: string,
  ): string | null {
    const normalizedPath = virtualPath.trim();
    if (normalizedPath.length === 0) return null;

    const list = this.overridesByVirtualPath.get(normalizedPath);
    return list?.[0]?.realPath ?? null;
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
  ): void {
    if (descriptor.virtualPath.trim().length === 0) {
      throw new Error("Asset override inválido: virtualPath é obrigatório.");
    }

    if (descriptor.realPath.trim().length === 0) {
      throw new Error("Asset override inválido: realPath é obrigatório.");
    }

    if (descriptor.modId.trim().length === 0) {
      throw new Error("Asset override inválido: modId é obrigatório.");
    }

    if (!Number.isFinite(descriptor.priority)) {
      throw new Error("Asset override inválido: priority deve ser finito.");
    }
  }
}
