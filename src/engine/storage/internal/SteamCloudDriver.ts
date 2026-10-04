import type { SaveGameMetadata } from "../../../contracts/storage/types";

export class SteamCloudDriver {
  private readonly storagePrefix = "steam_cloud_save_";

  public async saveGame(slotName: string, data: Record<string, unknown>): Promise<SaveGameMetadata> {
    const timestamp = Date.now();
    const saveId = `steam_save_${slotName}_${timestamp}`;
    const payload = JSON.stringify(data);
    const checksum = this.calculateChecksum(payload);

    const metadata: SaveGameMetadata = {
      saveId,
      slotName,
      playTimeSeconds: (data.playTimeSeconds as number) || 0,
      timestamp,
      gameVersion: (data.gameVersion as string) || "1.0.0",
      checksum,
    };

    const container = {
      metadata,
      data,
    };

    try {
      localStorage.setItem(`${this.storagePrefix}${slotName}`, JSON.stringify(container));
      console.log(`[SteamCloudDriver] ☁️ Save '${slotName}' gravado com sucesso na Steam Cloud (Simulada/LocalStorage).`);
    } catch (err) {
      console.error(`[SteamCloudDriver] ❌ Erro ao gravar save na Steam Cloud:`, err);
      throw err;
    }

    return metadata;
  }

  public async loadGame<T = Record<string, unknown>>(slotName: string): Promise<T | null> {
    try {
      const raw = localStorage.getItem(`${this.storagePrefix}${slotName}`);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      console.log(`[SteamCloudDriver] ☁️ Save '${slotName}' carregado da Steam Cloud.`);
      return parsed.data as T;
    } catch (err) {
      console.error(`[SteamCloudDriver] ❌ Erro ao carregar save da Steam Cloud:`, err);
      return null;
    }
  }

  public async listSaves(): Promise<SaveGameMetadata[]> {
    const saves: SaveGameMetadata[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.storagePrefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.metadata) saves.push(parsed.metadata);
          }
        } catch {
          // Ignora registros corrompidos
        }
      }
    }
    return saves;
  }

  public async deleteSave(slotName: string): Promise<boolean> {
    const key = `${this.storagePrefix}${slotName}`;
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      console.log(`[SteamCloudDriver] 🗑️ Save '${slotName}' removido da Steam Cloud.`);
      return true;
    }
    return false;
  }

  private calculateChecksum(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}