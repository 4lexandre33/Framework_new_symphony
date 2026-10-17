import type { MonetizationItemDTO, MonetizationItemType } from "../../../contracts/monetization/types";

const SKU_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const CURRENCY_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const ITEM_TYPES: ReadonlySet<string> = new Set(["consumable", "durable", "currency", "bundle"]);
const MAX_CATALOG_ITEMS = 2048;

/** Valida um item de catálogo; lança `Error` com o motivo (G13/G120). */
export function validateCatalogItem(item: MonetizationItemDTO): MonetizationItemDTO {
  if (typeof item !== "object" || item === null) throw new Error("Item da loja inválido.");
  const sku = typeof item.sku === "string" ? item.sku.trim() : "";
  if (sku.length === 0) throw new Error("SKU do item da loja é obrigatório.");
  if (!SKU_PATTERN.test(sku)) throw new Error("SKU do item da loja inválido ([A-Za-z0-9_.:-], até 128).");
  if (typeof item.title !== "string" || item.title.trim().length === 0 || item.title.length > 256) {
    throw new Error("Título do item da loja é obrigatório.");
  }
  if (typeof item.description !== "string" || item.description.length > 4096) {
    throw new Error("Descrição do item da loja inválida.");
  }
  if (typeof item.priceBaseCents !== "number" || item.priceBaseCents < 0) {
    throw new Error("O preço do item não pode ser negativo.");
  }
  if (!Number.isSafeInteger(item.priceBaseCents)) {
    throw new Error("O preço do item precisa ser inteiro (centavos).");
  }
  if (typeof item.currencyCode !== "string" || !CURRENCY_CODE_PATTERN.test(item.currencyCode)) {
    throw new Error("currencyCode precisa ser ISO 4217 (ex.: BRL).");
  }
  if (!ITEM_TYPES.has(item.itemType)) throw new Error("itemType inválido.");
  if (
    item.grantedCurrencyAmount !== undefined &&
    (!Number.isSafeInteger(item.grantedCurrencyAmount) || item.grantedCurrencyAmount <= 0)
  ) {
    throw new Error("grantedCurrencyAmount precisa ser inteiro > 0.");
  }
  if (item.grantedCurrencyId !== undefined && !CURRENCY_ID_PATTERN.test(item.grantedCurrencyId)) {
    throw new Error("grantedCurrencyId inválido.");
  }
  if (
    item.grantedItemSkus !== undefined &&
    (!Array.isArray(item.grantedItemSkus) || item.grantedItemSkus.some((granted) => typeof granted !== "string" || !SKU_PATTERN.test(granted)))
  ) {
    throw new Error("grantedItemSkus inválido.");
  }
  if (
    item.steamItemDefId !== undefined &&
    (!Number.isSafeInteger(item.steamItemDefId) || item.steamItemDefId <= 0 || item.steamItemDefId > 2_147_483_647)
  ) {
    throw new Error("steamItemDefId inválido.");
  }
  if (
    item.discountPercentage !== undefined &&
    (typeof item.discountPercentage !== "number" || item.discountPercentage < 0 || item.discountPercentage > 100)
  ) {
    throw new Error("discountPercentage precisa estar entre 0 e 100.");
  }
  return { ...item, sku };
}

export class StoreCatalogRegistry {
  private readonly itemsBySku = new Map<string, MonetizationItemDTO>();

  public registerItem(item: MonetizationItemDTO): void {
    const valid = validateCatalogItem(item);
    if (!this.itemsBySku.has(valid.sku) && this.itemsBySku.size >= MAX_CATALOG_ITEMS) {
      throw new Error(`Catálogo limitado a ${MAX_CATALOG_ITEMS} itens.`);
    }
    this.itemsBySku.set(valid.sku, Object.freeze({ ...valid }));
  }

  public getItem(sku: string): MonetizationItemDTO | null {
    if (typeof sku !== "string") return null;
    return this.itemsBySku.get(sku.trim()) ?? null;
  }

  public getItemBySteamDef(definitionId: number): MonetizationItemDTO | null {
    for (const item of this.itemsBySku.values()) {
      if (item.steamItemDefId === definitionId) return item;
    }
    return null;
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
