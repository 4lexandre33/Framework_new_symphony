import type {
  SteamWorkshopItemDTO,
} from "../../../contracts/modding/types";

export class SteamWorkshopDriver {
  private readonly workshopItems =
    new Map<string, SteamWorkshopItemDTO>();

  public registerSubscribedItem(
    item: SteamWorkshopItemDTO,
  ): void {
    const progress = this.normalizePercentage(
      item.downloadProgressPercentage,
    );

    this.workshopItems.set(
      item.itemId,
      {
        ...item,
        fileSizeBytes: Math.max(0, item.fileSizeBytes),
        downloadProgressPercentage: progress,
        isDownloading: item.isSubscribed && progress < 100 && item.isDownloading,
      },
    );
  }

  public updateDownloadProgress(
    itemId: string,
    percentage: number,
  ): boolean {
    const item = this.workshopItems.get(itemId);
    if (!item) return false;

    const progress = this.normalizePercentage(percentage);

    this.workshopItems.set(
      itemId,
      {
        ...item,
        isDownloading: item.isSubscribed && progress < 100,
        downloadProgressPercentage: progress,
      },
    );

    return true;
  }

  public getItem(
    itemId: string,
  ): SteamWorkshopItemDTO | null {
    return this.workshopItems.get(itemId) ?? null;
  }

  public getSubscribedItems(): ReadonlyArray<SteamWorkshopItemDTO> {
    return Array.from(this.workshopItems.values()).filter(
      (item): boolean => item.isSubscribed,
    );
  }

  public clear(): void {
    this.workshopItems.clear();
  }

  private normalizePercentage(
    percentage: number,
  ): number {
    if (!Number.isFinite(percentage)) return 0;
    return Math.min(100, Math.max(0, percentage));
  }
}
