import type { MonetizationItemDTO, MonetizationItemType } from "../../../contracts/monetization/types";

export class StoreCatalogRegistry {
  private readonly itemsBySku = new Map<string, MonetizationItemDTO>();

  public registerItem(item: MonetizationItemDTO): void {
    if (!item.sku || item.sku.trim().length === 0) {
      throw new Error("SKU do item da loja é obrigatório.");
    }
    if (item.priceBaseCents < 0) {
      throw new Error("O preço do item não pode ser negativo.");
    }
    this.itemsBySku.set(item.sku.trim(), item);
  }

  public getItem(sku: string): MonetizationItemDTO | null {
    return this.itemsBySku.get(sku.trim()) ?? null;
  }

  public getCatalog(): ReadonlyArray<MonetizationItemDTO> {
    return Array.from(this.itemsBySku.values());
  }

  public getItemsByType(type: MonetizationItemType): ReadonlyArray<MonetizationItemDTO> {
    return Array.from(this.itemsBySku.values()).filter((item) => item.itemType === type);
  }

  public removeItem(sku: string): boolean {
    return this.itemsBySku.delete(sku.trim());
  }

  public clear(): void {
    this.itemsBySku.clear();
  }
}